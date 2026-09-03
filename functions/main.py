"""
Tournament Duel Cloud Functions
================================
Handles server-side game progression for tournament 1v1 duels, eliminating
the client-side latency that caused uneven question timing.

Function 1  on_tournament_answer_written
  Trigger : tournament_duels/{tournamentId}/{duelId}/answers/{qi}/{uid}
  Purpose : When ALL real players have answered, atomically claim the reveal
            slot (status playing → revealing + reveal_started_at) and score
            answers server-side.  The transaction guarantees only one winner
            (client timer fallback is a no-op if CF wins, and vice versa).

Function 2  on_tournament_reveal_started
  Trigger : tournament_duels/{tournamentId}/{duelId}/reveal_started_at
  Purpose : Fire REVEAL_DURATION_MS after the reveal timestamp, then atomically
            advance to the next question (or finish).  Includes the tiebreaker
            extension — equal non-zero scores append a reserve question instead
            of finishing.
"""

import hashlib
import random
import time
import logging

from firebase_functions import db_fn, firestore_fn, scheduler_fn, options
from firebase_admin import initialize_app, db as admin_db, firestore as admin_fs

logger = logging.getLogger(__name__)

initialize_app()

REVEAL_DURATION_MS    = 4_000
BASE_PATH             = "tournament_duels"
LIVE_PATH             = "bracket_live"   # public spectator mirror (no question text)
KEYS_PATH             = "duel_keys"      # server-only answer key (never sent to a client)
MIN_REACTION_MS       = 50        # below this = suspiciously fast / clock error
MAX_REACTION_MS       = 65_000    # above this = question expired already

# ── Bracket orchestration constants ───────────────────────────────────────────
DUEL_AUTOSTART_MS     = 25_000    # duel stuck in 'waiting' this long → force start
MAX_TRIGGER_SLEEP_S   = 480       # hard cap on in-function waiting
QUESTIONS_PER_MATCH   = 5
LAUNCH_GRACE_MS       = 3_000     # let the host tab win the launch race when open
ROOM_CODE_CHARSET     = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # same set the host client uses
FFA_LOBBY_GRACE_MS    = 10_000    # players land in the room before question 1 starts
SCHEDULE_WINDOW_MS    = 65_000    # how far ahead the starter picks a scheduled tournament up
RECONCILE_GRACE_MS    = 10_000    # window past duration before reconciler force-advances
                                  # (mobile browsers throttle background timers, so give the
                                  #  owning tab a wide margin before the server steps in)


# ── Helpers ───────────────────────────────────────────────────────────────────

# ── Spectator mirror ─────────────────────────────────────────────────────────
# Everything a viewer needs to follow the bracket live, and nothing else. The
# node carries names, scores, status and the current question NUMBER — never
# question text or the correct answer, so it is safe to expose to any signed-in
# viewer. One RTDB subscription replaces one Firestore read per match per
# viewer per refresh, which is what made a live bracket unaffordable before.

def _mirror_meta(tournament_id: str, tourn: dict) -> None:
    try:
        admin_db.reference(f"{LIVE_PATH}/{tournament_id}/meta").update({
            "title":            tourn.get("title") or "",
            "code":             tourn.get("code") or None,
            "status":           tourn.get("status") or "",
            "current_round":    tourn.get("current_round") or 1,
            "total_rounds":     tourn.get("total_rounds") or 0,
            "actual_top_cut":   tourn.get("actual_top_cut") or 0,
            "winner_uid":       tourn.get("winner_uid") or None,
            "winner_name":      tourn.get("winner_name") or None,
            "awards":           tourn.get("awards") or None,
            "round_recaps":     tourn.get("round_recaps") or None,
            "host_id":          tourn.get("host_id") or None,
            "phase_started_at": tourn.get("phase_started_at") or None,
            "round_break_time": tourn.get("round_break_time") or 0,
            "final_break_time": tourn.get("final_break_time") or 0,
            "updated_at":       _now_ms(),
        })
    except Exception as e:                                    # noqa: BLE001
        logger.exception("[CF-LIVE] meta mirror failed %s: %s", tournament_id, e)


def _mirror_match(tournament_id: str, match_id: str, match: dict) -> None:
    try:
        admin_db.reference(f"{LIVE_PATH}/{tournament_id}/matches/{match_id}").update({
            "match_id":      match_id,
            "round":         match.get("round") or 1,
            "match_number":  match.get("match_number") or 0,
            "a_uid":         match.get("player_a_uid") or None,
            "a_name":        match.get("player_a_name") or None,
            "b_uid":         match.get("player_b_uid") or None,
            "b_name":        match.get("player_b_name") or None,
            "status":        match.get("status") or "pending",
            "winner_uid":    match.get("winner_uid") or None,
            "a_score":       match.get("player_a_score"),
            "b_score":       match.get("player_b_score"),
            "next_match_id": match.get("next_match_id") or None,
            "launch_after":  match.get("launch_after") or None,
            "tie_breaker":   match.get("tie_breaker") or None,
            # BracketBoard already draws a ⚡ for a host-settled match; without
            # this the badge could only ever appear on the host's own page.
            "forced_by_host": bool(match.get("forced_by_host")),
            "updated_at":    _now_ms(),
        })
    except Exception as e:                                    # noqa: BLE001
        logger.exception("[CF-LIVE] match mirror failed %s/%s: %s",
                         tournament_id, match_id, e)


def _mirror_live(tournament_id: str, match_id: str, patch: dict) -> None:
    try:
        admin_db.reference(f"{LIVE_PATH}/{tournament_id}/matches/{match_id}/live").update(
            {**patch, "ts": _now_ms()})
    except Exception as e:                                    # noqa: BLE001
        logger.exception("[CF-LIVE] live mirror failed %s/%s: %s",
                         tournament_id, match_id, e)


def _to_list(value: object) -> list:
    """Coerce an RTDB integer-keyed dict (or list) to a Python list."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        try:
            return [value[k] for k in sorted(value.keys(), key=lambda x: int(x))]
        except (ValueError, TypeError):
            return list(value.values())
    return []


def _answers_for_qi(duel_data: dict, qi: int) -> dict:
    """
    Extract the per-player answers dict for question index `qi`.

    Firebase RTDB returns integer-keyed objects as Python lists when keys are
    sequential integers (0, 1, 2 …).  Handle both list and dict safely.
    """
    raw = duel_data.get("answers")
    if raw is None:
        return {}
    if isinstance(raw, list):
        val = raw[qi] if qi < len(raw) else None
    else:
        val = raw.get(str(qi))
    return val if isinstance(val, dict) else {}


def _now_ms() -> int:
    return int(time.time() * 1000)


class _Abort(Exception):
    """
    Raised inside an RTDB transaction_update to leave the value untouched.

    The Python admin SDK has no "return None to abort" contract — returning None
    makes it try to write null and blow up with
    ``ValueError: Value must not be none.``, killing the invocation. Aborting is
    documented as raising, and the exception propagates to the caller.
    """


def _try_transaction(ref, update_fn) -> bool:
    """Run a transaction that may abort. True if it committed, False if aborted."""
    try:
        ref.transaction(update_fn)
        return True
    except _Abort:
        return False


def _find_correct_c(duel_id: str, qi: int, question: object) -> object:
    """
    Return the correct-choice index for a question.

    New duels store ``correct_hash`` (SHA-256 of "duel:{duelId}:{qi}:{index}").
    Legacy duels still carry the plain ``correct`` integer — accepted as fallback.
    Returns None if neither field is present or the hash cannot be matched.
    """
    if not isinstance(question, dict):
        return None
    # Legacy format: plain integer
    if question.get("correct") is not None:
        return question["correct"]
    # New format: brute-force 4 choices against the stored hash
    correct_hash = question.get("correct_hash")
    if not correct_hash:
        return None
    choices = question.get("choices") or []
    for i in range(len(choices)):
        h = hashlib.sha256(f"duel:{duel_id}:{qi}:{i}".encode()).hexdigest()
        if h == correct_hash:
            return i
    logger.warning("[CF] correct_hash mismatch — duel=%s qi=%d", duel_id, qi)
    return None


# ── Answer key (server-only) ─────────────────────────────────────────────────
# The duel node used to carry correct_hash = sha256("duel:{duelId}:{qi}:{i}").
# A participant reads their own duel node, and a tournament duel's id IS the
# match id ("r1m1"), so four SHA-256 calls handed them the answer before they
# answered. The plain key lives here instead: no client may read it (rules),
# the tournament's host may write it (so the host tab can still launch a
# match), and the Admin SDK reads it when scoring. Consequence, and the point:
# the server is now the only thing that can decide whether an answer is right.

def _write_duel_key(tournament_id: str, duel_id: str, main: list, tb: list) -> None:
    try:
        admin_db.reference(f"{KEYS_PATH}/{tournament_id}/{duel_id}").set(
            {"main": list(main), "tb": list(tb), "at": _now_ms()})
    except Exception as e:                                    # noqa: BLE001
        logger.exception("[CF-KEY] write failed %s/%s: %s", tournament_id, duel_id, e)


def _duel_key(tournament_id: str, duel_id: str) -> object:
    try:
        return admin_db.reference(f"{KEYS_PATH}/{tournament_id}/{duel_id}").get()
    except Exception as e:                                    # noqa: BLE001
        logger.exception("[CF-KEY] read failed %s/%s: %s", tournament_id, duel_id, e)
        return None


def _split_answer_key(questions: list, duel_id: str) -> tuple:
    """
    Return (questions with every answer field removed, list of correct indices).

    The list is index-aligned with `questions` even when an entry is unusable —
    answers are looked up by index, and a shorter list would silently shift
    every later question onto the wrong answer. -1 marks "no answer known".
    """
    safe, key = [], []
    for qi, q in enumerate(questions):
        if not isinstance(q, dict):
            logger.error("[CF-KEY] question %d is not a dict (duel %s)", qi, duel_id)
            safe.append({"question": "", "choices": [], "invalid": True})
            key.append(-1)
            continue
        c = q.get("correct")
        if isinstance(c, bool) or not isinstance(c, int):
            logger.error("[CF-KEY] question %d has no usable `correct` (duel %s)", qi, duel_id)
            key.append(-1)
        else:
            key.append(int(c))
        safe.append({k: v for k, v in q.items() if k not in ("correct", "correct_hash")})
    return safe, key


def _correct_for(tournament_id: str, duel_id: str, qi: int, question: object,
                 key: object = None) -> object:
    """
    The correct index for one question of a tournament duel.

    Prefers the server-only key. A tiebreaker is appended to `questions` at
    index len(main) + n, which is exactly where it sits in the reserve list, so
    the same lookup covers it. Falls back to the old in-node hash for duels
    launched before the key existed.
    """
    k = key if key is not None else _duel_key(tournament_id, duel_id)
    if isinstance(k, dict):
        main = _to_list(k.get("main"))
        tb   = _to_list(k.get("tb"))
        c = None
        if qi < len(main):
            c = main[qi]
        else:
            j = qi - len(main)
            if 0 <= j < len(tb):
                c = tb[j]
        if isinstance(c, int) and not isinstance(c, bool) and c >= 0:
            return c
    return _find_correct_c(duel_id, qi, question)


def _recover_correct_from_deck(duel: dict, question: object) -> object:
    """
    Last resort for a duel with neither a key nor a hash — e.g. the launcher
    created the node but its key write failed. Tournament duels never shuffle
    answer choices, so the deck's own `correct` index still applies; the
    question is matched by its text. One Firestore read, failure path only.
    """
    if not isinstance(question, dict):
        return None
    text    = question.get("question")
    deck_id = duel.get("deck_id")
    if not text or not deck_id:
        return None
    try:
        deck = admin_fs.client().collection("question_sets").document(deck_id).get().to_dict() or {}
    except Exception as e:                                    # noqa: BLE001
        logger.exception("[CF-KEY] deck recovery read failed %s: %s", deck_id, e)
        return None
    for q in ((deck.get("questions") or {}).get("questions") or []):
        if isinstance(q, dict) and q.get("question") == text:
            c = q.get("correct")
            if isinstance(c, int) and not isinstance(c, bool):
                return c
    return None


def _score_question(tournament_id: str, duel_ref, duel: dict, qi: int) -> bool:
    """
    Score one question of a tournament duel. Returns True if it scored.

    Idempotent by design: `answers/{qi}/correct_reveal` is the marker, and it is
    written in the same multi-path update as the points, so a second caller —
    the reveal trigger, the reconciler, a retry — is a no-op. Called from three
    places on purpose: the answer trigger (both players answered), the reveal
    trigger (someone ran out of time, so the answer trigger never fired), and
    the reconciler (every tab died).
    """
    if not isinstance(duel, dict):
        return False
    answers_qi = _answers_for_qi(duel, qi)
    if answers_qi.get("correct_reveal") is not None:
        return False

    player_uids = list((duel.get("players") or {}).keys())
    if not player_uids:
        return False

    questions = _to_list(duel.get("questions"))
    question  = questions[qi] if qi < len(questions) else None
    duel_id   = duel.get("match_id") or duel_ref.key
    correct_c = _correct_for(tournament_id, duel_id, qi, question)
    if correct_c is None:
        correct_c = _recover_correct_from_deck(duel, question)
        if correct_c is not None:
            logger.warning("[CF-KEY] recovered qi=%d from the deck (tournament=%s duel=%s)",
                           qi, tournament_id, duel_id)
    if correct_c is None:
        logger.error("[CF] no answer key for qi=%d (tournament=%s duel=%s) — question unscored",
                     qi, tournament_id, duel_id)
        return False

    # Rank correct answers by reaction time.
    #
    # `at` is the server's own stamp: the client writes {".sv": "timestamp"} and
    # the rule accepts nothing else, so the time between the question opening and
    # the answer landing is measured here rather than reported by the tab that
    # wants the bonus. The self-reported value stays as the fallback for a tab
    # that predates `at`, and a forged ultra-fast time is clamped to the worst
    # rank instead of being believed.
    q_start = duel.get("question_started_at")

    def _safe_reaction(ans: dict) -> int:
        at = ans.get("at")
        if isinstance(at, (int, float)) and isinstance(q_start, (int, float)):
            measured = int(at) - int(q_start)
            if measured < 0:
                return MAX_REACTION_MS      # the clock moved — do not reward it
            return max(MIN_REACTION_MS, min(measured, MAX_REACTION_MS))
        ms = ans.get("reaction_time_ms")
        if not isinstance(ms, (int, float)) or ms < MIN_REACTION_MS:
            return MAX_REACTION_MS
        return min(int(ms), MAX_REACTION_MS)

    correct_list = [
        (uid, ans) for uid, ans in answers_qi.items()
        if uid in player_uids and isinstance(ans, dict)
        and ans.get("selected_choice") == correct_c
    ]
    correct_list.sort(key=lambda x: _safe_reaction(x[1]))
    rank_map = {uid: i for i, (uid, _) in enumerate(correct_list)}

    updates = {f"answers/{qi}/correct_reveal": correct_c}
    live_scores = {}
    for p_uid in player_uids:
        base = ((duel.get("players") or {}).get(p_uid) or {}).get("score") or 0
        live_scores[p_uid] = base
        ans = answers_qi.get(p_uid)
        if not isinstance(ans, dict):
            continue
        is_ok = (ans.get("selected_choice") == correct_c)
        rank  = rank_map.get(p_uid, 99)
        pts   = (2 if rank == 0 else 1) if is_ok else 0
        updates[f"answers/{qi}/{p_uid}/is_correct"]         = is_ok
        updates[f"answers/{qi}/{p_uid}/points_earned"]      = pts
        updates[f"answers/{qi}/{p_uid}/reaction_ms_server"] = _safe_reaction(ans)
        if pts > 0:
            updates[f"players/{p_uid}/score"] = base + pts
            live_scores[p_uid] = base + pts

    duel_ref.update(updates)
    _mirror_live(tournament_id, duel_id, {
        "qi": qi, "total": len(questions), "scores": live_scores, "status": "revealing",
    })
    logger.info("[CF] scored qi=%d — tournament=%s duel=%s", qi, tournament_id, duel_id)
    return True


# ── Function 1 ─────────────────────────────────────────────────────────────────

@db_fn.on_value_written(
    reference=f"{BASE_PATH}/{{tournamentId}}/{{duelId}}/answers/{{qi}}/{{uid}}",
    region="europe-west1",
    memory=options.MemoryOption.MB_256,
    timeout_sec=30,
)
def on_tournament_answer_written(event: db_fn.Event[db_fn.Change]) -> None:
    """
    Fires every time an answer node changes under a tournament duel.
    If all real players have now answered, atomically claims the reveal
    and computes scores — no client round-trip required.
    """
    # Skip deletions
    if event.data.after is None:
        return

    tournament_id = event.params["tournamentId"]
    duel_id       = event.params["duelId"]
    qi_param      = event.params["qi"]   # string, e.g. "0"

    duel_ref = admin_db.reference(f"{BASE_PATH}/{tournament_id}/{duel_id}")
    duel     = duel_ref.get()

    if duel is None or duel.get("status") != "playing":
        return

    current_qi = duel.get("current_question_index", 0)
    if str(current_qi) != qi_param:
        return  # answer is for a stale question index, skip

    # Check all real players have submitted an answer for this question
    player_uids = list((duel.get("players") or {}).keys())
    if len(player_uids) < 2:
        return

    answers_qi = _answers_for_qi(duel, current_qi)

    # A spectator watching a knockout match is shown no question text at all,
    # so the tension has to come from somewhere: mirror WHO has locked an
    # answer in — never what they picked, never whether it is right. The
    # spectator's question counter used to move only when a question was
    # scored, a whole question behind the players; this moves it with them.
    _mirror_live(tournament_id, duel_id, {
        "qi":     current_qi,
        "total":  duel.get("total_questions") or len(_to_list(duel.get("questions"))),
        "status": "question",
        "locked": {u: True for u in player_uids if u in answers_qi},
    })

    if not all(p in answers_qi for p in player_uids):
        return  # someone hasn't answered yet

    # ── Atomically claim reveal: playing → revealing + set reveal_started_at ──
    reveal_ts = _now_ms()
    captured  = {"duel": None, "won": False}

    def claim_fn(current):
        captured["won"] = False          # reset on every retry
        if current is None or current.get("status") != "playing":
            raise _Abort()               # another path already claimed it
        captured["duel"] = current
        captured["won"]  = True
        return {
            **current,
            "status":          "revealing",
            "reveal_started_at": reveal_ts,
        }

    _try_transaction(duel_ref, claim_fn)

    if not captured["won"]:
        return  # client timer or another CF invocation won the race

    # Scoring itself lives in _score_question so the reveal trigger and the
    # reconciler score the same way — a player who never answers means this
    # trigger never fires, and the client can no longer score for itself.
    _score_question(tournament_id, duel_ref, captured["duel"], current_qi)

    logger.info("[CF] Reveal claimed — tournament=%s duel=%s qi=%d",
                tournament_id, duel_id, current_qi)


# ── Function 2 ─────────────────────────────────────────────────────────────────

def _advance_reveal(duel_ref) -> bool:
    """
    Atomically advance a revealed duel to the next question (or finish).

    Shared by on_tournament_reveal_started (the normal path) and the reconciler
    (the stale-reveal backstop).  Aborts when the duel is no longer in
    'revealing' so concurrent writers can never double-advance.
    """
    def advance_fn(current):
        if current is None or current.get("status") != "revealing":
            raise _Abort()  # already advanced

        next_qi  = (current.get("current_question_index") or 0) + 1
        total_qs = current.get("total_questions") or 0
        at_end   = next_qi >= total_qs
        now_ms   = _now_ms()

        if at_end:
            # ── Tiebreaker extension: equal non-zero scores → append reserve Q ─
            uids = list((current.get("players") or {}).keys())
            if len(uids) == 2:
                score_a = ((current["players"][uids[0]] or {}).get("score") or 0)
                score_b = ((current["players"][uids[1]] or {}).get("score") or 0)
                if score_a == score_b and score_a > 0:
                    tb_pool = _to_list(current.get("tiebreaker_questions"))
                    tb_used = current.get("tiebreaker_used") or 0
                    if tb_used < len(tb_pool):
                        new_qs = _to_list(current.get("questions")) + [tb_pool[tb_used]]
                        return {
                            **current,
                            "questions":              new_qs,
                            "total_questions":        total_qs + 1,
                            "tiebreaker_used":        tb_used + 1,
                            "is_tiebreaker":          True,
                            "status":                 "playing",
                            "current_question_index": next_qi,
                            "question_started_at":    now_ms,
                            "reveal_started_at":      None,
                        }
            # Reserve exhausted or both-zero — finish
            return {**current, "status": "finished", "reveal_started_at": None}

        return {
            **current,
            "status":                 "playing",
            "current_question_index": next_qi,
            "question_started_at":    now_ms,
            "reveal_started_at":      None,
        }

    return _try_transaction(duel_ref, advance_fn)


@db_fn.on_value_written(
    reference=f"{BASE_PATH}/{{tournamentId}}/{{duelId}}/reveal_started_at",
    region="europe-west1",
    memory=options.MemoryOption.MB_256,
    timeout_sec=60,
)
def on_tournament_reveal_started(event: db_fn.Event[db_fn.Change]) -> None:
    """
    Fires when reveal_started_at is written on a tournament duel.
    Waits until the reveal phase ends, then advances to the next question
    (or finishes, with optional tiebreaker extension).
    """
    after_val  = event.data.after
    before_val = event.data.before

    # Only act on null → value  (skip deletions and value → value updates)
    if after_val is None:
        return
    if before_val is not None:
        return

    tournament_id = event.params["tournamentId"]
    duel_id       = event.params["duelId"]

    # Score first. When a player never answers, the answer trigger never fires,
    # and the client can no longer score for itself — this is the only place the
    # question gets resolved, so it must happen before the reveal phase elapses.
    duel_ref_early = admin_db.reference(f"{BASE_PATH}/{tournament_id}/{duel_id}")
    early = duel_ref_early.get()
    if isinstance(early, dict) and early.get("status") == "revealing":
        _score_question(tournament_id, duel_ref_early, early,
                        early.get("current_question_index") or 0)

    # Sleep for the remainder of the reveal phase
    reveal_ts  = after_val if isinstance(after_val, (int, float)) else _now_ms()
    elapsed_ms = _now_ms() - int(reveal_ts)
    sleep_ms   = max(0, REVEAL_DURATION_MS - elapsed_ms)
    if sleep_ms > 0:
        time.sleep(sleep_ms / 1000.0)

    # ── Atomically advance to next question (or finish) ───────────────────────
    duel_ref = admin_db.reference(f"{BASE_PATH}/{tournament_id}/{duel_id}")
    if _advance_reveal(duel_ref):
        # Nothing mirrored the advance itself, so the lock lamps of the question
        # that just ended would stay lit over the next one. Clear them, and
        # carry the counter across in the same write.
        moved = duel_ref.get() or {}
        _mirror_live(tournament_id, duel_id, {
            "qi":     moved.get("current_question_index") or 0,
            "total":  moved.get("total_questions") or 0,
            "status": moved.get("status") or "playing",
            "locked": None,
        })
        logger.info("[CF] Advanced duel — tournament=%s duel=%s", tournament_id, duel_id)

# ── Function 3 ─────────────────────────────────────────────────────────────────

@db_fn.on_value_written(
    reference="rooms/{roomId}/status",
    region="europe-west1",
    memory=options.MemoryOption.MB_256,
    timeout_sec=60,
)
def on_ffa_room_finished(event: db_fn.Event[db_fn.Change]) -> None:
    """
    Server-side FFA finalization for tournament rooms.

    When a tournament FFA room flips to 'finished', write the ffa_results
    subcollection + flip the tournament to the bracket phase.  This mirrors the
    host-browser logic (HostGameRoom.writeTournamentFFAResults) so the
    tournament progresses even when the host's tab is closed.
    Idempotent: skips if ffa_results were already written (by the host client),
    avoiding conflicting random tie-breaks at the cut.
    """
    after  = event.data.after
    before = event.data.before
    if after is None or before is None or before == after:
        return
    if after != "finished":
        return

    room_id = event.params["roomId"]
    room = admin_db.reference(f"rooms/{room_id}").get()
    if not room:
        return

    # The host's "you still have a room open" pointer, cleared for every
    # finished room — tournament or not, and before the tournament check below.
    #
    # Clearing it is the host tab's job, but in unattended mode the final
    # advance is performed by a player's tab, and `host_rooms/{uid}` is
    # writable by that host alone. So the pointer outlived the game it
    # described and the host came back to a dashboard offering to rejoin a room
    # that was already over. The server is the one writer that cannot be
    # denied, so it owns the cleanup.
    host_uid = room.get("host_id")
    if host_uid:
        try:
            ptr = admin_db.reference(f"host_rooms/{host_uid}/active")
            cur = ptr.get()
            if isinstance(cur, dict) and cur.get("code") == room_id:
                ptr.delete()
                logger.info("[CF-FFA] cleared host_rooms pointer for %s (room %s finished)",
                            host_uid, room_id)
        except Exception as e:                                # noqa: BLE001
            logger.exception("[CF-FFA] host_rooms cleanup failed for %s: %s", host_uid, e)

    if not room.get("tournament_id"):
        return
    tournament_id = room["tournament_id"]

    fs = admin_fs.client()
    tourn_ref = fs.collection("tournaments").document(tournament_id)
    tourn = (tourn_ref.get().to_dict() or {})
    if tourn.get("status") == "bracket" or tourn.get("status") == "finished":
        return

    # If the host client already wrote results but the tournament never flipped
    # to 'bracket' (its tab died between batch.commit() and updateDoc), just flip
    # the phase — never re-run the tie-break shuffle or rewrite the results.
    if len(tourn_ref.collection("ffa_results").limit(1).get()) > 0:
        if (tourn.get("status") or "") != "bracket":
            tourn_ref.update({"status": "bracket", "current_round": 1,
                              "phase_started_at": int(time.time() * 1000)})
            logger.info("[CF-FFA] ffa_results present — flipped %s to bracket", tournament_id)
        else:
            logger.info("[CF-FFA] ffa_results already present + status bracket — skipping %s",
                        tournament_id)
        return

    actual_top_cut = tourn.get("actual_top_cut") or 8

    def _score(p):
        return p.get("score") or 0
    def _correct(p):
        return p.get("correct_count") or 0
    def _speed(p):
        return p.get("total_reaction_ms") or 0

    players = [p for p in (room.get("players") or {}).values() if p]
    players.sort(key=lambda p: (-_score(p), -_correct(p), _speed(p)))

    def _same(a, b):
        return _score(a) == _score(b) and _correct(a) == _correct(b) and _speed(a) == _speed(b)

    final_order = players
    if len(players) > actual_top_cut:
        cut_player  = players[actual_top_cut - 1]
        next_player = players[actual_top_cut]
        if _same(cut_player, next_player):
            first_tied = next(i for i, p in enumerate(players) if _same(p, cut_player))
            tied_group = [p for p in players if _same(p, cut_player)]
            random.shuffle(tied_group)
            final_order = players[:first_tied] + tied_group

    batch = fs.batch()
    for rank, p in enumerate(final_order, start=1):
        uid = p.get("user_id") or p.get("uid")
        if not uid:
            continue
        batch.set(tourn_ref.collection("ffa_results").document(uid), {
            "uid": uid,
            "nickname": p.get("nickname"),
            "avatar_url": p.get("avatar_url"),
            "score": _score(p),
            "correct_count": _correct(p),
            "total_reaction_ms": _speed(p),
            "rank": rank,
            "advanced": rank <= actual_top_cut,
        })
    batch.update(tourn_ref, {"status": "bracket", "current_round": 1, "phase_started_at": int(time.time() * 1000)})
    batch.commit()
    logger.info("[CF-FFA] tournament %s finalized → bracket", tournament_id)


# ══════════════════════════════════════════════════════════════════════════════
# FFA PHASE — server-side launch
# ══════════════════════════════════════════════════════════════════════════════
# The qualifier used to start only inside the host's open lobby tab: a
# scheduled tournament whose host had closed the tab never began, and the
# players sat watching a countdown that had already reached zero. The launch is
# the same shape as TournamentLobby.launchFFA (room, players, config, then the
# phase flip on the tournament doc) so both can run — whoever claims the
# tournament doc first owns the room, and the loser deletes the room it made.


def _to_ms(value) -> int:
    """Firestore timestamp | epoch ms | None → epoch ms (0 when absent)."""
    if value is None:
        return 0
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    ts = getattr(value, "timestamp", None)
    if callable(ts):
        try:
            return int(ts() * 1000)
        except Exception:                                     # noqa: BLE001
            return 0
    return 0


def _rounds_for_top_cut(top_cut: int) -> int:
    n, rounds = 1, 0
    while n * 2 <= (top_cut or 0):
        n *= 2
        rounds += 1
    return max(rounds, 1)


def _actual_top_cut(registered: int, desired: int) -> int:
    cap = min(desired or 0, registered)
    n = 1
    while n * 2 <= cap:
        n *= 2
    return n


def _missing_assignments(round_questions: dict, planned_rounds: int) -> list:
    """
    Rounds without enough assigned questions. Assignment is mandatory — the
    manual launch refuses without it, and so must this one, or a scheduled
    tournament would quietly run on the legacy random fallback.
    """
    rq = round_questions or {}
    missing = []
    if len(_to_list(rq.get("ffa"))) < 1:
        missing.append("ffa")
    for r in range(1, planned_rounds + 1):
        if len(_to_list(rq.get(str(r)))) < QUESTIONS_PER_MATCH:
            missing.append(str(r))
    return missing


def _gen_room_code() -> str:
    """A free 6-char room code, in the host client's charset."""
    for _ in range(12):
        code = "".join(random.choice(ROOM_CODE_CHARSET) for _ in range(6))
        if admin_db.reference(f"rooms/{code}/code").get() is None:
            return code
    return "T" + "".join(random.choice(ROOM_CODE_CHARSET) for _ in range(5))


def _start_ffa_room(room_code: str) -> bool:
    """lobby → playing, once. Aborts if anyone already started it."""
    def start_fn(current):
        if current is None or current.get("status") != "lobby":
            raise _Abort()
        return {
            **current,
            "status": "playing",
            "current_question_index": 0,
            "question_started_at": _now_ms(),
        }

    started = _try_transaction(admin_db.reference(f"rooms/{room_code}"), start_fn)
    if started:
        logger.info("[CF-FFA] started room %s", room_code)
    return started


def _launch_ffa(fs, tournament_id: str, tourn: dict) -> str:
    """
    Create the FFA room and move the tournament into the qualifier phase.

    Returns the room code, or "" when it did not launch (already launched, too
    few players, or rounds without questions). Safe to call twice, and safe to
    call while the host tab is doing the same thing.
    """
    if (tourn.get("status") or "") != "registration":
        return ""

    regs = admin_db.reference(f"tournament_registrations/{tournament_id}").get() or {}
    if not isinstance(regs, dict) or len(regs) < 2:
        logger.info("[CF-FFA] %s has %d registrations — not launching",
                    tournament_id, len(regs) if isinstance(regs, dict) else 0)
        return ""

    cap = tourn.get("top_cut") or 8
    missing = _missing_assignments(tourn.get("round_questions"), _rounds_for_top_cut(cap))
    if missing:
        logger.error("[CF-FFA] %s not launched — rounds without questions: %s",
                     tournament_id, ", ".join(missing))
        return ""

    deck_id = tourn.get("deck_id")
    deck = (fs.collection("question_sets").document(deck_id).get().to_dict() or {}) if deck_id else {}
    deck_block = deck.get("questions") or {}
    deck_qs = _to_list(deck_block.get("questions"))
    if not deck_qs:
        logger.error("[CF-FFA] %s not launched — deck %s has no questions",
                     tournament_id, deck_id)
        return ""

    ffa_idxs = _to_list((tourn.get("round_questions") or {}).get("ffa"))
    picked = [deck_qs[i] for i in ffa_idxs
              if isinstance(i, int) and 0 <= i < len(deck_qs)]
    room_questions = {**deck_block, "questions": picked or deck_qs}

    players_obj = {}
    for uid, reg in regs.items():
        if not isinstance(reg, dict):
            continue
        players_obj[reg.get("uid") or uid] = {
            "user_id": reg.get("uid") or uid,
            "nickname": reg.get("nickname") or "لاعب",
            "avatar_url": reg.get("avatar_url"),
            "score": 0,
        }

    actual = _actual_top_cut(len(players_obj), cap)
    if actual < 2:
        logger.info("[CF-FFA] %s resolved to a bracket of %d — not launching",
                    tournament_id, actual)
        return ""

    timer_seconds = int(round((tourn.get("ffa_question_duration") or 30_000) / 1000))
    now = _now_ms()
    code = _gen_room_code()

    # The room is written BEFORE the phase flip on purpose: a player tab reacts
    # to the flip by reading rooms/{code}/status, and a room that is not there
    # yet leaves it sitting on the wait screen with nothing to retry.
    admin_db.reference(f"rooms/{code}").set({
        "code": code,
        "host_id": tourn.get("host_id"),
        "question_set_id": deck_id,
        "title": (tourn.get("title") or "بطولة") + " — FFA",
        "questions": room_questions,
        "force_rtl": bool(deck.get("force_rtl")),
        "tournament_id": tournament_id,
        "status": "lobby",
        "current_question_index": 0,
        "players": players_obj,
        "config": {
            "scoring_mode": "ranked",
            "first_correct_points": 3,
            "points_decrement": 1,
            "timer_seconds": timer_seconds,
            "auto_accept": True,
            "shuffle_questions": True,
            "auto_mode": True,
            "auto_timer": timer_seconds,
            "unattended_mode": True,
            # Marks the room as one nobody has to press start on. A host-launched
            # room has no auto_start_at, so the reconciler never force-starts a
            # lobby the host is deliberately holding open.
            "auto_start_at": now + FFA_LOBBY_GRACE_MS,
        },
        "created_at": now,
    })

    claimed = {"v": False}
    tourn_ref = fs.collection("tournaments").document(tournament_id)

    @admin_fs.transactional
    def _claim(txn, target):
        data = target.get(transaction=txn).to_dict() or {}
        if (data.get("status") or "") != "registration" or data.get("ffa_room_id"):
            return
        claimed["v"] = True
        txn.update(target, {
            "status": "ffa",
            "actual_top_cut": actual,
            "total_rounds": _total_rounds_for(actual),
            "ffa_room_id": code,
            "phase_started_at": now,
        })

    _claim(fs.transaction(), tourn_ref)

    if not claimed["v"]:
        # The host tab (or a concurrent invocation) launched first — take the
        # orphan room back out so it cannot be joined by a stale link.
        admin_db.reference(f"rooms/{code}").delete()
        logger.info("[CF-FFA] %s was already launched — dropped spare room %s",
                    tournament_id, code)
        return ""

    logger.info("[CF-FFA] launched %s — room %s, %d players, top cut %d",
                tournament_id, code, len(players_obj), actual)
    return code


# ── Function 8 — scheduled FFA launch ─────────────────────────────────────────

@scheduler_fn.on_schedule(
    schedule="* * * * *",
    region="europe-west1",
    memory=options.MemoryOption.MB_512,
    timeout_sec=180,
)
def tournament_starter(event: scheduler_fn.ScheduledEvent) -> None:
    """
    Start scheduled tournaments without anyone's tab being open.

    Runs every minute, but does not launch on the minute: a tournament due
    inside the next window is waited out to the second, the same way the reveal
    trigger waits out a reveal phase. A tournament whose time passed while
    nobody was watching launches immediately.
    """
    fs = admin_fs.client()
    try:
        pending = fs.collection("tournaments").where("status", "==", "registration").get()
    except Exception as e:                                    # noqa: BLE001
        logger.exception("[CF-START] query failed: %s", e)
        return

    due_list = []
    now = _now_ms()
    for doc in pending:
        tourn = doc.to_dict() or {}
        due = _to_ms(tourn.get("scheduled_start_at"))
        if not due:
            continue                      # manual start — the host owns it
        if due > now + SCHEDULE_WINDOW_MS:
            continue                      # not in this window
        due_list.append((due, doc.id, tourn))

    due_list.sort(key=lambda item: item[0])

    for due, tournament_id, tourn in due_list:
        try:
            wait_ms = due - _now_ms()
            if wait_ms > 0:
                time.sleep(min(wait_ms, SCHEDULE_WINDOW_MS) / 1000.0)
            fresh = fs.collection("tournaments").document(tournament_id).get().to_dict() or {}
            code = _launch_ffa(fs, tournament_id, fresh)
            if not code:
                continue
            time.sleep(FFA_LOBBY_GRACE_MS / 1000.0)
            _start_ffa_room(code)
        except Exception as e:                                # noqa: BLE001
            logger.exception("[CF-START] %s failed: %s", tournament_id, e)


# ══════════════════════════════════════════════════════════════════════════════
# BRACKET ORCHESTRATION
# ══════════════════════════════════════════════════════════════════════════════
# The bracket phase used to advance only inside the host's open browser tab:
# bracket generation, match launch, duel start, result writing and round
# advance all lived in React effects.  If that tab was closed, pointed at a
# different tournament, or simply lost a race, the tournament stalled forever
# with no way to recover.  The functions below reimplement every one of those
# steps server-side.  They are idempotent and guarded, so the client fast path
# and the server can both run without conflicting.
# ══════════════════════════════════════════════════════════════════════════════




def _total_rounds_for(size: int) -> int:
    """log2(size) for a power-of-two bracket size."""
    rounds = 0
    while (1 << (rounds + 1)) <= size:
        rounds += 1
    return rounds


def _build_bracket_order(n: int) -> list:
    """Seed order for a single-elimination bracket — port of buildBracketOrder."""
    if n <= 2:
        return [1, 2]
    prev = _build_bracket_order(n // 2)
    out = []
    for seed in prev:
        out.append(seed)
        out.append(n + 1 - seed)
    return out


def _generate_bracket_matches(seeded: list) -> list:
    """Port of tournamentUtils.generateBracketMatches (seeded[0] == seed 1)."""
    n = len(seeded)
    total_rounds = _total_rounds_for(n)
    order = _build_bracket_order(n)
    matches = []

    for i in range(0, len(order), 2):
        seed_a, seed_b = order[i], order[i + 1]
        match_num = i // 2 + 1
        player_a, player_b = seeded[seed_a - 1], seeded[seed_b - 1]
        next_id = f"r2m{-(-match_num // 2)}" if total_rounds > 1 else None
        matches.append({
            "match_id": f"r1m{match_num}",
            "round": 1,
            "match_number": match_num,
            "player_a_uid": player_a.get("uid"),
            "player_b_uid": player_b.get("uid"),
            "player_a_name": player_a.get("nickname"),
            "player_b_name": player_b.get("nickname"),
            "duel_id": None,
            "status": "pending",
            "winner_uid": None,
            "loser_uid": None,
            "player_a_score": None,
            "player_b_score": None,
            "tie_broken_by": None,
            "finished_at": None,
            "next_match_id": next_id,
        })

    for rnd in range(2, total_rounds + 1):
        for match_num in range(1, n // (2 ** rnd) + 1):
            next_id = f"r{rnd + 1}m{-(-match_num // 2)}" if rnd < total_rounds else None
            matches.append({
                "match_id": f"r{rnd}m{match_num}",
                "round": rnd,
                "match_number": match_num,
                "player_a_uid": None,
                "player_b_uid": None,
                "player_a_name": "TBD",
                "player_b_name": "TBD",
                "duel_id": None,
                "status": "pending",
                "winner_uid": None,
                "loser_uid": None,
                "player_a_score": None,
                "player_b_score": None,
                "tie_broken_by": None,
                "finished_at": None,
                "next_match_id": next_id,
            })

    return matches


def _questions_for_round(rnd: int, tourn: dict, deck_qs: list, count: int) -> list:
    """Port of tournamentUtils.getQuestionsForRound."""
    round_qs = tourn.get("round_questions") or {}
    assigned = round_qs.get(str(rnd))
    if assigned:
        picked = [deck_qs[i] for i in assigned
                  if isinstance(i, int) and 0 <= i < len(deck_qs)]
        if len(picked) != len(assigned):
            logger.error(
                "[CF-BR] round %d assigned %d indices, only %d resolvable in deck "
                "(deck len=%d, tournament=%s, deck_id=%s) — matches will run short",
                rnd, len(assigned), len(picked), len(deck_qs),
                tourn.get("title") or "?", tourn.get("deck_id") or "?")
        if picked:
            return picked

    used = set()
    for r in range(1, rnd):
        for i in (round_qs.get(str(r)) or []):
            used.add(i)
    unused = [q for i, q in enumerate(deck_qs) if i not in used]
    pool = list(unused if len(unused) >= count else deck_qs)
    random.shuffle(pool)
    return pool[:count]


def _ensure_bracket(fs, tournament_id: str, tourn: dict) -> bool:
    """
    Generate bracket_matches from ffa_results if they do not exist yet.
    Returns True only when this call created them.
    """
    tourn_ref = fs.collection("tournaments").document(tournament_id)
    if len(tourn_ref.collection("bracket_matches").limit(1).get()) > 0:
        return False

    results = [d.to_dict() or {} for d in tourn_ref.collection("ffa_results").get()]
    if not results:
        logger.info("[CF-BR] no ffa_results yet for %s", tournament_id)
        return False

    top_cut = tourn.get("actual_top_cut") or 0
    advanced = [r for r in results if r.get("advanced")]
    if not advanced:
        advanced = sorted(results, key=lambda r: r.get("rank") or 999)[:top_cut or len(results)]
    advanced.sort(key=lambda r: r.get("rank") or 999)
    if top_cut:
        advanced = advanced[:top_cut]

    # Bracket size must be a power of two — trim to the largest one that fits.
    size = 1
    while size * 2 <= len(advanced):
        size *= 2
    if size < 2:
        logger.warning("[CF-BR] not enough advancers for %s (%d)",
                       tournament_id, len(advanced))
        return False
    advanced = advanced[:size]

    matches = _generate_bracket_matches(advanced)
    phase_start = tourn.get("phase_started_at") or _now_ms()
    round_one_launch = int(phase_start) + int(tourn.get("phase_transition_wait") or 0)

    batch = fs.batch()
    for m in matches:
        # launch_after pins each match's own start time on the match document,
        # so the launcher never has to guess it from a tournament field that
        # may still be mid-update.
        if m["round"] == 1:
            m["launch_after"] = round_one_launch
        batch.set(tourn_ref.collection("bracket_matches").document(m["match_id"]), m)

    patch = {}
    total_rounds = _total_rounds_for(size)
    if tourn.get("total_rounds") != total_rounds:
        patch["total_rounds"] = total_rounds
    if tourn.get("actual_top_cut") != size:
        patch["actual_top_cut"] = size
    if not tourn.get("current_round"):
        patch["current_round"] = 1
    if not tourn.get("phase_started_at"):
        patch["phase_started_at"] = _now_ms()
    if patch:
        batch.update(tourn_ref, patch)

    batch.commit()
    # The qualifier seat of everyone in the bracket, for the spectator page.
    # A match document carries no seed — seeds live in ffa_results, which a
    # spectator page deliberately does not read (one subscription, no question
    # text, no per-player docs). uid → rank for at most `size` players is a few
    # hundred bytes, written once, and it is what lets the live tree print a
    # seat and recognise an upset the moment it happens.
    try:
        admin_db.reference(f"{LIVE_PATH}/{tournament_id}/meta/seats").set(
            {r["uid"]: r.get("rank") for r in advanced if r.get("uid") and r.get("rank")}
        )
    except Exception as e:                                    # noqa: BLE001
        logger.exception("[CF-BR] seats mirror failed for %s: %s", tournament_id, e)

    logger.info("[CF-BR] generated %d matches for %s (top_cut=%d)",
                len(matches), tournament_id, size)
    return True


def _launch_due_at_ms(tourn: dict, match: dict) -> int:
    """
    Wall-clock ms at which `match` may start.

    Prefers launch_after written on the match itself; falls back to deriving it
    from the tournament's phase clock for matches created before that field
    existed.
    """
    pinned = match.get("launch_after")
    if isinstance(pinned, (int, float)) and pinned > 0:
        return int(pinned)

    start = tourn.get("phase_started_at") or 0
    if not start:
        return 0
    rnd   = match.get("round") or 1
    total = tourn.get("total_rounds") or 0
    if rnd == 1:
        wait = tourn.get("phase_transition_wait") or 0
    elif total and rnd == total:
        # The final gets its own, longer break — the one moment in a tournament
        # worth building up to. Falls back to the normal break when unset.
        wait = tourn.get("final_break_time") or tourn.get("round_break_time") or 0
    else:
        wait = tourn.get("round_break_time") or 0
    return int(start) + int(wait)


def _mark_match_active(fs, tournament_id: str, match_id: str) -> None:
    """Point the match doc at its duel and flip to 'active' (only while pending)."""
    ref = fs.collection("tournaments").document(tournament_id) \
            .collection("bracket_matches").document(match_id)

    @admin_fs.transactional
    def _txn(txn, target):
        data = target.get(transaction=txn).to_dict() or {}
        if data.get("status") != "pending":
            return
        txn.update(target, {"duel_id": match_id, "status": "active"})

    try:
        _txn(fs.transaction(), ref)
    except Exception as e:                                    # noqa: BLE001
        logger.warning("[CF-BR] mark_active failed %s: %s", match_id, e)


def _launch_match(fs, tournament_id: str, tourn: dict, match: dict) -> bool:
    """
    Create the RTDB duel for a pending match and flip the match to 'active'.

    The duel key is the match_id rather than a push id, so the host tab and
    this function can never create two duels for the same match: whoever
    writes the node first wins and the other aborts.
    """
    match_id = match.get("match_id")
    uid_a, uid_b = match.get("player_a_uid"), match.get("player_b_uid")
    if not match_id or not uid_a or not uid_b:
        return False
    if match.get("status") != "pending":
        return False

    duel_ref = admin_db.reference(f"{BASE_PATH}/{tournament_id}/{match_id}")
    if duel_ref.get() is not None:
        _mark_match_active(fs, tournament_id, match_id)
        return False

    deck_id = tourn.get("deck_id")
    deck = (fs.collection("question_sets").document(deck_id).get().to_dict() or {}) \
        if deck_id else {}
    deck_qs = ((deck.get("questions") or {}).get("questions")) or []
    if not deck_qs:
        logger.error("[CF-BR] deck %s empty — cannot launch %s", deck_id, match_id)
        return False

    questions = _questions_for_round(match.get("round") or 1, tourn,
                                     deck_qs, QUESTIONS_PER_MATCH)
    if not questions:
        return False

    used_texts = {q.get("question") for q in questions if isinstance(q, dict)}
    spare = [q for q in deck_qs if isinstance(q, dict) and q.get("question") not in used_texts]
    random.shuffle(spare)
    tiebreakers = spare[:3] if spare else list(deck_qs)[:3]

    tourn_ref = fs.collection("tournaments").document(tournament_id)

    def _avatar(uid: str) -> str:
        ffa = tourn_ref.collection("ffa_results").document(uid).get().to_dict() or {}
        return ffa.get("avatar_url") or ""

    # Split main + reserve in one pass: a tiebreaker is appended to `questions`
    # at index len(questions) + n, which is exactly where its key sits in the
    # reserve list. The key itself never enters the duel node — it goes to
    # duel_keys, which no client can read.
    all_safe, all_key = _split_answer_key(questions + tiebreakers, match_id)
    safe_questions   = all_safe[:len(questions)]
    safe_tiebreakers = all_safe[len(questions):]
    main_key         = all_key[:len(questions)]
    tb_key           = all_key[len(questions):]

    payload = {
        "tournament_id": tournament_id,
        "match_id": match_id,
        "round": match.get("round") or 1,
        "question_duration_ms": tourn.get("duel_question_duration") or 30_000,
        "creator_uid": uid_a,
        "host_uid": tourn.get("host_id"),
        "deck_id": deck_id,
        "deck_title": tourn.get("deck_title") or "",
        "questions": safe_questions,
        "total_questions": len(safe_questions),
        "tiebreaker_questions": safe_tiebreakers,
        "tiebreaker_used": 0,
        "is_tiebreaker": False,
        "config": {
            "questionCount": len(questions),
            "shuffleQuestions": False,
            "shuffleAnswers": False,
        },
        "force_rtl": bool(deck.get("force_rtl")),
        "status": "waiting",
        "current_question_index": 0,
        "question_started_at": None,
        "reveal_started_at": None,
        "forfeit_by": None,
        "surrender_by": None,
        "players": {
            uid_a: {"uid": uid_a, "nickname": match.get("player_a_name"),
                    "avatar_url": _avatar(uid_a), "score": 0},
            uid_b: {"uid": uid_b, "nickname": match.get("player_b_name"),
                    "avatar_url": _avatar(uid_b), "score": 0},
        },
        "answers": {},
        "created_at": _now_ms(),
    }

    won = {"v": False}

    def create_fn(current):
        won["v"] = False
        if current is not None:
            raise _Abort()       # someone created it first
        won["v"] = True
        return payload

    _try_transaction(duel_ref, create_fn)
    if won["v"]:
        # Only the launcher that actually created the node may write the key:
        # each launcher shuffles its own reserve questions, so a key written by
        # the loser would not match the questions that are really in the node.
        _write_duel_key(tournament_id, match_id, main_key, tb_key)
    _mark_match_active(fs, tournament_id, match_id)
    if won["v"]:
        logger.info("[CF-BR] launched match %s for tournament %s", match_id, tournament_id)
    return won["v"]


def _sum_reaction_ms(duel: dict, uid: str) -> int:
    total = 0
    answers = duel.get("answers") or {}
    values = answers.values() if isinstance(answers, dict) else answers
    for per_q in values:
        if not isinstance(per_q, dict):
            continue
        a = per_q.get(uid)
        if isinstance(a, dict) and a.get("is_correct"):
            # The server's measurement when it is there; is_correct and
            # reaction_ms_server are both write-denied to clients, so this sum
            # cannot be shaped by the player it decides against.
            total += a.get("reaction_ms_server") or a.get("reaction_time_ms") or 0
    return total


def _resolve_winner(fs, tournament_id: str, duel: dict, match: dict):
    """Return (winner_uid, loser_uid, tie_breaker) for a finished duel."""
    uid_a = match.get("player_a_uid")
    uid_b = match.get("player_b_uid")
    if not uid_a or not uid_b:
        return None, None, None

    players = duel.get("players") or {}
    score_a = (players.get(uid_a) or {}).get("score") or 0
    score_b = (players.get(uid_b) or {}).get("score") or 0

    # A surrender is a loss for the surrendering player — never a draw and never a
    # fall-through to score/FFA-rank ordering. The bracket has no draw outcome, so it
    # is treated exactly like a forfeit. A uid that is not one of the two players is
    # ignored rather than silently crowning player A.
    quitter = duel.get("surrender_by") or duel.get("forfeit_by")
    if quitter in (uid_a, uid_b):
        winner = uid_b if quitter == uid_a else uid_a
        return winner, quitter, None
    if quitter:
        logger.error("[CF-BR] quitter %s is not a player of this match — ignored", quitter)

    if score_a != score_b:
        winner = uid_a if score_a > score_b else uid_b
        return winner, (uid_b if winner == uid_a else uid_a), None

    if score_a == 0:
        tourn_ref = fs.collection("tournaments").document(tournament_id)
        rank_a = (tourn_ref.collection("ffa_results").document(uid_a).get().to_dict() or {}).get("rank", 999)
        rank_b = (tourn_ref.collection("ffa_results").document(uid_b).get().to_dict() or {}).get("rank", 999)
        winner = uid_a if rank_a <= rank_b else uid_b
        return winner, (uid_b if winner == uid_a else uid_a), "ffa_rank"

    react_a = _sum_reaction_ms(duel, uid_a)
    react_b = _sum_reaction_ms(duel, uid_b)
    winner = uid_a if react_a <= react_b else uid_b
    return winner, (uid_b if winner == uid_a else uid_a), "speed"


def _answer_rows(tournament_id: str, matches: list):
    """
    Every scored answer of the tournament, as (match, uid, answer) rows.

    Reads `answers` per match rather than the whole `tournament_duels/{tid}`
    subtree, so the question text never has to come down just to count medals.
    """
    for m in matches:
        duel_id = m.get("duel_id") or m.get("match_id")
        if not duel_id:
            continue
        answers = admin_db.reference(f"{BASE_PATH}/{tournament_id}/{duel_id}/answers").get()
        if not isinstance(answers, (dict, list)):
            continue
        per_q = answers.values() if isinstance(answers, dict) else answers
        for q in per_q:
            if not isinstance(q, dict):
                continue
            for uid, ans in q.items():
                if uid == "correct_reveal" or not isinstance(ans, dict):
                    continue
                yield m, uid, ans


def _ar_count(n: int, one: str, two: str, few: str, many: str) -> str:
    """Arabic counts 3-10 as a plural and 11+ as a singular. 6 إجابات, not 6 إجابة."""
    if n == 1:
        return one
    if n == 2:
        return two
    return few if 3 <= n <= 10 else many


def _ar_qty(n: int, one: str, two: str, few: str, many: str) -> str:
    """
    The whole phrase, numeral included only where Arabic wants one.

    A dual carries its own count — "إجابتين" already means two answers, so
    "2 إجابتين" reads like "2 two-answers"; the singular is the same.
    Only 3-10 and 11+ take the number. Mirrored in
    `src/utils/arabicCount.js`, because what the server writes has to read the
    same way as what the client renders.
    """
    if n == 1 or n == 2:
        return _ar_count(n, one, two, few, many)
    return f"{n} " + _ar_count(n, one, two, few, many)


def _compute_awards(fs, tournament_id: str, matches: list, tourn: dict) -> list:
    """
    The honours list, built from what actually happened.

    Every input is a field only the server writes — `is_correct`,
    `reaction_ms_server`, the qualifier ranks, the match results — so an award
    cannot be farmed by a tab. Each entry is {key, uid, name, value}; the labels
    live in the client, the facts live here.
    """
    tourn_ref = fs.collection("tournaments").document(tournament_id)
    try:
        ffa = {d.id: (d.to_dict() or {}) for d in tourn_ref.collection("ffa_results").get()}
    except Exception:                                         # noqa: BLE001
        ffa = {}

    names = {uid: (v.get("nickname") or "لاعب") for uid, v in ffa.items()}
    for m in matches:
        for slot in ("a", "b"):
            uid = m.get(f"player_{slot}_uid")
            if uid and m.get(f"player_{slot}_name"):
                names.setdefault(uid, m[f"player_{slot}_name"])
    seeds = {uid: v.get("rank") for uid, v in ffa.items() if v.get("rank")}

    def name(uid):
        return names.get(uid) or "لاعب"

    awards = []
    total_rounds = tourn.get("total_rounds") or 0
    final = next((m for m in matches
                  if (m.get("round") or 1) == total_rounds and m.get("winner_uid")), None)

    if final:
        champ = final["winner_uid"]
        awards.append({"key": "champion", "uid": champ, "name": name(champ), "value": ""})
        runner = final.get("loser_uid") or (
            final.get("player_b_uid") if champ == final.get("player_a_uid")
            else final.get("player_a_uid"))
        if runner:
            awards.append({"key": "runner_up", "uid": runner, "name": name(runner), "value": ""})

    # Top of the qualifier — the seat everyone was chasing.
    top_seed = min(seeds.items(), key=lambda kv: kv[1], default=None)
    if top_seed:
        uid = top_seed[0]
        score = (ffa.get(uid) or {}).get("score")
        awards.append({"key": "qualifier", "uid": uid, "name": name(uid),
                       "value": _ar_qty(score, "نقطة", "نقطتين",
                                        "نقاط", "نقطة")
                       if score is not None else ""})

    fastest = None          # (ms, uid)
    correct_count = {}
    for _m, uid, ans in _answer_rows(tournament_id, matches):
        if not ans.get("is_correct"):
            continue
        correct_count[uid] = correct_count.get(uid, 0) + 1
        ms = ans.get("reaction_ms_server")
        if not isinstance(ms, (int, float)):
            ms = ans.get("reaction_time_ms")
        if isinstance(ms, (int, float)) and MIN_REACTION_MS <= ms <= MAX_REACTION_MS:
            if fastest is None or ms < fastest[0]:
                fastest = (int(ms), uid)

    if fastest:
        awards.append({"key": "fastest", "uid": fastest[1], "name": name(fastest[1]),
                       "value": f"{fastest[0] / 1000:.2f} ثانية"})

    if correct_count:
        uid, n = max(correct_count.items(), key=lambda kv: kv[1])
        awards.append({"key": "sniper", "uid": uid, "name": name(uid),
                       "value": _ar_qty(
                           n, "إجابة صحيحة",
                           "إجابتين صحيحتين",
                           "إجابات صحيحة",
                           "إجابة صحيحة")})

    # The biggest upset: the lowest seed that took out the highest one.
    upset = None            # (gap, winner, loser)
    for m in matches:
        w, l = m.get("winner_uid"), m.get("loser_uid")
        if not w or not l or m.get("forced_by_host"):
            continue
        sw, sl = seeds.get(w), seeds.get(l)
        if not sw or not sl or sw <= sl:
            continue
        gap = sw - sl
        if upset is None or gap > upset[0]:
            upset = (gap, w, l)
    if upset:
        _gap, w, l = upset
        awards.append({"key": "upset", "uid": w, "name": name(w),
                       "value": f"أطاح بصاحب المركز {seeds.get(l)}"})

    return awards

def _round_recap(fs, tournament_id: str, all_matches: list, rnd: int) -> dict:
    """
    A short account of a round that just ended, for the gap before the next one.

    Same discipline as the honours board: every field comes from something only
    the server writes — `is_correct`, `reaction_ms_server`, the match results,
    the qualifier ranks — so this is a report, not a claim. Flat keys, because
    it is mirrored into RTDB and read straight back out by the client.
    """
    round_matches = [m for m in all_matches if (m.get("round") or 1) == rnd]
    if not round_matches:
        return {}

    tourn_ref = fs.collection("tournaments").document(tournament_id)
    try:
        ffa = {d.id: (d.to_dict() or {}) for d in tourn_ref.collection("ffa_results").get()}
    except Exception:                                         # noqa: BLE001
        ffa = {}
    seeds = {uid: v.get("rank") for uid, v in ffa.items() if v.get("rank")}
    names = {uid: (v.get("nickname") or "لاعب") for uid, v in ffa.items()}
    for m in round_matches:
        for slot in ("a", "b"):
            uid = m.get(f"player_{slot}_uid")
            if uid and m.get(f"player_{slot}_name"):
                names.setdefault(uid, m[f"player_{slot}_name"])

    def name(uid):
        return names.get(uid) or "لاعب"

    knocked = [name(m["loser_uid"]) for m in round_matches if m.get("loser_uid")]

    fastest = None          # (ms, uid)
    for _m, uid, ans in _answer_rows(tournament_id, round_matches):
        if not ans.get("is_correct"):
            continue
        ms = ans.get("reaction_ms_server")
        if not isinstance(ms, (int, float)):
            ms = ans.get("reaction_time_ms")
        if isinstance(ms, (int, float)) and MIN_REACTION_MS <= ms <= MAX_REACTION_MS:
            if fastest is None or ms < fastest[0]:
                fastest = (int(ms), uid)

    # The round's biggest upset — a walkover is not one, there was no match.
    upset = None            # (gap, winner, loser)
    for m in round_matches:
        w, l = m.get("winner_uid"), m.get("loser_uid")
        if not w or not l or m.get("forced_by_host"):
            continue
        sw, sl = seeds.get(w), seeds.get(l)
        if not sw or not sl or sw <= sl:
            continue
        if upset is None or (sw - sl) > upset[0]:
            upset = (sw - sl, w, l)

    recap = {
        "round":     rnd,
        "matches":   len(round_matches),
        "out":       knocked[:8],
        "out_count": len(knocked),
        "at":        _now_ms(),
    }
    if fastest:
        recap["fastest_name"]  = name(fastest[1])
        recap["fastest_value"] = f"{fastest[0] / 1000:.2f} ثانية"
    if upset:
        recap["upset_name"]  = name(upset[1])
        recap["upset_value"] = f"أطاح بصاحب المركز {seeds.get(upset[2])}"
    return recap


def _progress_round(fs, tournament_id: str, tourn: dict, rnd: int) -> None:
    """When every match of `rnd` is done: crown the champion or open the next round."""
    tourn_ref = fs.collection("tournaments").document(tournament_id)
    all_matches = [{**(d.to_dict() or {}), "match_id": d.id}
                   for d in tourn_ref.collection("bracket_matches").get()]
    round_matches = [m for m in all_matches if (m.get("round") or 1) == rnd]
    if not round_matches:
        return
    if not all(m.get("status") == "finished" for m in round_matches):
        return

    total_rounds = tourn.get("total_rounds") or _total_rounds_for(len(all_matches) + 1)

    if rnd >= total_rounds:
        final = next((m for m in round_matches if m.get("winner_uid")), None)
        if final and not tourn.get("winner_uid"):
            winner = final["winner_uid"]
            name = final.get("player_a_name") if winner == final.get("player_a_uid") \
                else final.get("player_b_name")
            patch = {"status": "finished", "winner_uid": winner, "winner_name": name}
            # The honours list is written with the champion, in the same update, so
            # a viewer never sees a finished tournament with no honours and then
            # watches them pop in a second later.
            try:
                awards = _compute_awards(fs, tournament_id, all_matches,
                                         {**tourn, "winner_uid": winner})
                if awards:
                    patch["awards"] = awards
            except Exception as e:                            # noqa: BLE001
                logger.exception("[CF-BR] awards failed for %s: %s", tournament_id, e)
            tourn_ref.update(patch)
            logger.info("[CF-BR] tournament %s finished — champion %s, %d awards",
                        tournament_id, name, len(patch.get("awards") or []))
        return

    # Open the next round.  current_round is bumped first so the launcher sees a
    # consistent state, then each next-round match gets its own launch_after —
    # that write is also what re-triggers the launcher for those matches.
    if (tourn.get("current_round") or 1) != rnd:
        return
    now = _now_ms()
    patch = {"phase_started_at": now, "current_round": rnd + 1}
    # The break used to be a countdown and nothing else. Say what just happened
    # in it — written in the same update that opens the next round, so it lands
    # exactly once and is never a round behind.
    try:
        recap = _round_recap(fs, tournament_id, all_matches, rnd)
        if recap:
            patch[f"round_recaps.{rnd}"] = recap
    except Exception as e:                                    # noqa: BLE001
        logger.exception("[CF-BR] round recap failed for %s r%d: %s", tournament_id, rnd, e)
    tourn_ref.update(patch)

    launch_after = now + int(tourn.get("round_break_time") or 0)
    batch = fs.batch()
    for m in all_matches:
        if (m.get("round") or 1) != rnd + 1:
            continue
        batch.update(
            tourn_ref.collection("bracket_matches").document(m["match_id"]),
            {"launch_after": launch_after},
        )
    batch.commit()
    logger.info("[CF-BR] tournament %s advanced to round %d", tournament_id, rnd + 1)


def _advance_winner_slot(fs, tournament_id: str, match: dict) -> None:
    """
    Fill the winner's slot in the next match (idempotent).  Odd match numbers
    feed slot A of the next match, even ones feed slot B.  Only fills an empty
    slot so concurrent writers can never clobber each other.
    """
    if not match or not match.get("winner_uid") or not match.get("next_match_id"):
        return
    slot = "player_a" if (match.get("match_number") or 1) % 2 == 1 else "player_b"
    next_ref = fs.collection("tournaments").document(tournament_id) \
        .collection("bracket_matches").document(match["next_match_id"])
    next_match = next_ref.get().to_dict() or {}
    if next_match.get(f"{slot}_uid"):
        return  # already seeded — nothing to do
    winner = match["winner_uid"]
    winner_name = match.get("player_a_name") if winner == match.get("player_a_uid") \
        else match.get("player_b_name")
    next_ref.update({f"{slot}_uid": winner, f"{slot}_name": winner_name})
    logger.info("[CF-BR] advanced %s -> %s.%s (%s)",
                match.get("match_id"), match["next_match_id"], slot, winner_name)


def _finalize_match(fs, tournament_id: str, match_id: str) -> bool:
    """
    Write a finished duel's result onto its bracket match, push the winner into
    the next match and progress the round.

    IMPORTANT: advancement must happen even when the match is ALREADY marked
    finished.  The host force-finish button writes the result directly, and a
    previous invocation may have written it too, but neither of those advances
    the winner into the next match on its own.  If we skip 'finished' matches
    here, the winner is lost forever — which is what happened in production on
    2026-08-14 (two of four round-1 winners never reached round 2).  Every step
    below is idempotent; the reconciler calls this same code as a backstop.

    Players cannot write a bracket match at all any more, so this is the only
    place a played match becomes a result.
    """
    tourn_ref = fs.collection("tournaments").document(tournament_id)
    match_ref = tourn_ref.collection("bracket_matches").document(match_id)
    match = match_ref.get().to_dict()
    if not match:
        return False

    duel_id = match.get("duel_id") or match_id
    duel = admin_db.reference(f"{BASE_PATH}/{tournament_id}/{duel_id}").get()
    if not duel or duel.get("status") != "finished":
        return False

    tourn = tourn_ref.get().to_dict() or {}

    if match.get("status") == "finished" and match.get("winner_uid"):
        # The host force-finish (or a previous invocation) already wrote it.
        winner, loser, tie_breaker = match["winner_uid"], match.get("loser_uid"), match.get("tie_broken_by")
    else:
        winner, loser, tie_breaker = _resolve_winner(fs, tournament_id, duel, match)
        if not winner:
            return False
        players = duel.get("players") or {}
        claimed = {"v": False}

        @admin_fs.transactional
        def _claim(txn, target):
            data = target.get(transaction=txn).to_dict() or {}
            if data.get("status") == "finished":
                return
            claimed["v"] = True
            txn.update(target, {
                "status": "finished",
                "winner_uid": winner,
                "loser_uid": loser,
                "player_a_score": (players.get(match.get("player_a_uid")) or {}).get("score") or 0,
                "player_b_score": (players.get(match.get("player_b_uid")) or {}).get("score") or 0,
                "tie_broken_by": tie_breaker,
                "finished_at": admin_fs.SERVER_TIMESTAMP,
            })

        _claim(fs.transaction(), match_ref)
        if not claimed["v"]:
            # Lost the finalise race — reload and use the winner that landed.
            match = match_ref.get().to_dict() or {}
            winner = match.get("winner_uid")
            if not winner:
                return False
            loser = match.get("loser_uid")
            tie_breaker = match.get("tie_broken_by")

    _advance_winner_slot(fs, tournament_id, match)
    logger.info("[CF-BR] finalized %s — winner %s", match_id, winner)
    _progress_round(fs, tournament_id, tourn, match.get("round") or 1)
    return True


# ── Function 4 — bracket generation ───────────────────────────────────────────

@firestore_fn.on_document_written(
    document="tournaments/{tournamentId}",
    region="europe-west1",
    memory=options.MemoryOption.MB_256,
    timeout_sec=120,
)
def on_tournament_written(event: firestore_fn.Event[firestore_fn.Change]) -> None:
    """
    Generate the bracket as soon as a tournament enters the bracket phase.

    Fixes the failure where the host's browser was the only thing that could
    create bracket_matches: with that tab closed or pointed at a different
    tournament, players sat on 'Awaiting your bracket' forever.
    """
    after = event.data.after
    tournament_id = event.params["tournamentId"]

    if after is None:
        # Tournament deleted — take its spectator mirror with it, otherwise the
        # mirror outlives every tournament it ever described and grows forever.
        try:
            admin_db.reference(f"{LIVE_PATH}/{tournament_id}").delete()
            admin_db.reference(f"{KEYS_PATH}/{tournament_id}").delete()
            logger.info("[CF-LIVE] removed mirror + answer keys for deleted tournament %s",
                        tournament_id)
        except Exception as e:                                # noqa: BLE001
            logger.exception("[CF-LIVE] cleanup failed %s: %s", tournament_id, e)
        return

    tourn = after.to_dict() or {}

    # Mirror on every phase — the spectator page needs registration and FFA too.
    _mirror_meta(tournament_id, tourn)

    if tourn.get("status") != "bracket":
        return

    try:
        _ensure_bracket(admin_fs.client(), tournament_id, tourn)
    except Exception as e:                                    # noqa: BLE001
        logger.exception("[CF-BR] ensure_bracket failed for %s: %s", tournament_id, e)


# ── Function 5 — match launch ─────────────────────────────────────────────────

@firestore_fn.on_document_written(
    document="tournaments/{tournamentId}/bracket_matches/{matchId}",
    region="europe-west1",
    memory=options.MemoryOption.MB_512,
    timeout_sec=540,
)
def on_bracket_match_written(event: firestore_fn.Event[firestore_fn.Change]) -> None:
    """
    Launch a match once both players are known and the phase wait has elapsed.

    Waits out phase_transition_wait (round 1) or round_break_time (later
    rounds) in-function, giving the host tab a few seconds' head start so the
    normal client path still wins whenever it is open.
    """
    after = event.data.after
    if after is None:
        return
    match = after.to_dict() or {}
    tournament_id = event.params["tournamentId"]
    match_id      = event.params["matchId"]

    # Mirror first: this trigger fires on every match write (creation, slot
    # seeding, result), so it is the one place that keeps the spectator tree
    # complete. Everything below is launch gating and returns early a lot.
    _mirror_match(tournament_id, match_id, match)

    if match.get("status") == "finished" and match.get("winner_uid"):
        # A match that was decided without a duel — the host awarded it against
        # an absent player — still needs its winner seated in the next match and
        # the round moved along. _finalize_match hangs off the duel node status,
        # and a walkover never had a duel, so this is that path. Both calls are
        # idempotent, which is what makes it safe to run on every match write.
        fs = admin_fs.client()
        try:
            _advance_winner_slot(fs, tournament_id, {**match, "match_id": match_id})
            tourn = fs.collection("tournaments").document(tournament_id).get().to_dict() or {}
            _progress_round(fs, tournament_id, tourn, match.get("round") or 1)
        except Exception as e:                                # noqa: BLE001
            logger.exception("[CF-BR] walkover follow-up failed %s/%s: %s",
                             tournament_id, match_id, e)
        return

    if match.get("status") != "pending":
        return
    if not match.get("player_a_uid") or not match.get("player_b_uid"):
        return
    fs = admin_fs.client()
    tourn_ref = fs.collection("tournaments").document(tournament_id)
    tourn = tourn_ref.get().to_dict() or {}
    if tourn.get("status") != "bracket":
        return
    # A later round must not start early just because its slots filled up while
    # the previous round was still finishing.
    if (match.get("round") or 1) != (tourn.get("current_round") or 1):
        return

    due_at = _launch_due_at_ms(tourn, match) + LAUNCH_GRACE_MS
    wait_s = max(0.0, (due_at - _now_ms()) / 1000.0)
    if wait_s > MAX_TRIGGER_SLEEP_S:
        return  # too far out — the reconciler picks it up
    if wait_s > 0:
        time.sleep(wait_s)

    fresh = tourn_ref.collection("bracket_matches").document(match_id).get().to_dict() or {}
    if fresh.get("status") != "pending":
        return  # host tab launched it while we waited
    try:
        _launch_match(fs, tournament_id, tourn_ref.get().to_dict() or {},
                      {**fresh, "match_id": match_id})
    except Exception as e:                                    # noqa: BLE001
        logger.exception("[CF-BR] launch failed %s/%s: %s", tournament_id, match_id, e)


# ── Function 6 — duel auto-start + result finalization ────────────────────────

@db_fn.on_value_written(
    reference=f"{BASE_PATH}/{{tournamentId}}/{{duelId}}/status",
    region="europe-west1",
    memory=options.MemoryOption.MB_256,
    timeout_sec=120,
)
def on_tournament_duel_status(event: db_fn.Event[db_fn.Change]) -> None:
    """
    Two tab-independent guarantees for a tournament duel:

    • 'waiting'  → force it to 'playing' when no player opened it in time.  The
      duel used to start only from a player's DuelGame tab, so a match nobody
      opened showed as LIVE on the host bracket while sitting frozen forever.
    • 'finished' → write the result onto the bracket match, advance the winner
      and progress the round, instead of depending on the winner's tab.
    """
    after = event.data.after
    if after is None:
        return

    tournament_id = event.params["tournamentId"]
    duel_id       = event.params["duelId"]
    duel_ref      = admin_db.reference(f"{BASE_PATH}/{tournament_id}/{duel_id}")

    if isinstance(after, str):
        _mirror_live(tournament_id, duel_id, {"status": after})

    if after == "waiting":
        time.sleep(DUEL_AUTOSTART_MS / 1000.0)
        started = {"v": False}

        def start_fn(current):
            started["v"] = False
            if current is None or current.get("status") != "waiting":
                raise _Abort()   # a player's tab (or the reconciler) already started it
            started["v"] = True
            return {**current, "status": "playing", "question_started_at": _now_ms()}

        _try_transaction(duel_ref, start_fn)
        if started["v"]:
            logger.info("[CF-BR] force-started idle duel %s/%s", tournament_id, duel_id)
        return

    if after == "finished":
        duel = duel_ref.get() or {}
        match_id = duel.get("match_id") or duel_id
        try:
            _finalize_match(admin_fs.client(), tournament_id, match_id)
        except Exception as e:                                # noqa: BLE001
            logger.exception("[CF-BR] finalize failed %s/%s: %s",
                             tournament_id, match_id, e)


# ── Function 7 — reconciler (safety net) ──────────────────────────────────────

@scheduler_fn.on_schedule(
    schedule="* * * * *",
    region="europe-west1",
    memory=options.MemoryOption.MB_512,
    timeout_sec=300,
)
def tournament_reconciler(event: scheduler_fn.ScheduledEvent) -> None:
    """
    Every minute, repair any tournament stuck in the bracket phase.

    Last line of defence: regenerates missing brackets, launches overdue
    matches, restarts frozen duels, finalizes finished ones and moves rounds
    along — regardless of which browser tabs happen to be open.
    """
    fs = admin_fs.client()
    try:
        live = fs.collection("tournaments").where("status", "==", "bracket").get()
    except Exception as e:                                    # noqa: BLE001
        logger.exception("[CF-REC] query failed: %s", e)
        return

    # ── FFA recovery sweep ────────────────────────────────────────────────────
    # The host client writes ffa_results in one batch and flips status in a
    # separate updateDoc; if its tab dies in between, the tournament sits in
    # 'ffa' with results present forever. Flip it to 'bracket' — the existing
    # bracket trigger/reconciler path takes over from there.
    try:
        stalled_ffa = fs.collection("tournaments").where("status", "==", "ffa").get()
    except Exception as e:                                    # noqa: BLE001
        logger.exception("[CF-REC] ffa query failed: %s", e)
        stalled_ffa = []

    for doc in stalled_ffa:
        tournament_id = doc.id
        tourn = doc.to_dict() or {}
        try:
            tourn_ref = fs.collection("tournaments").document(tournament_id)
            if len(tourn_ref.collection("ffa_results").limit(1).get()) > 0:
                tourn_ref.update({"status": "bracket", "current_round": 1,
                                  "phase_started_at": _now_ms()})
                logger.info("[CF-REC] ffa_results present — flipped %s to bracket", tournament_id)
                continue

            # A server-launched room whose starter died before it pressed start.
            # Only rooms carrying auto_start_at qualify — a host-launched lobby
            # is the host's to open, however long they hold it.
            room_code = tourn.get("ffa_room_id")
            if not room_code:
                continue
            room = admin_db.reference(f"rooms/{room_code}").get() or {}
            start_at = (room.get("config") or {}).get("auto_start_at") or 0
            stale = start_at and _now_ms() > start_at + RECONCILE_GRACE_MS
            if room.get("status") == "lobby" and stale:
                _start_ffa_room(room_code)
                logger.info("[CF-REC] force-started stalled FFA room %s", room_code)
        except Exception as e:                                # noqa: BLE001
            logger.exception("[CF-REC] ffa recovery failed %s: %s", tournament_id, e)

    for doc in live:
        tournament_id = doc.id
        tourn = doc.to_dict() or {}
        try:
            if _ensure_bracket(fs, tournament_id, tourn):
                continue  # freshly generated — let the match trigger take it

            tourn_ref = fs.collection("tournaments").document(tournament_id)
            matches = [{**(d.to_dict() or {}), "match_id": d.id}
                       for d in tourn_ref.collection("bracket_matches").get()]
            now = _now_ms()

            for m in matches:
                rnd = m.get("round") or 1

                # A match finished by the host force-finish still needs its
                # winner advanced — that button writes the result only.
                if m.get("status") == "finished" and m.get("winner_uid") and m.get("next_match_id"):
                    _advance_winner_slot(fs, tournament_id, m)
                    continue

                if m.get("status") == "pending":
                    if not m.get("player_a_uid") or not m.get("player_b_uid"):
                        continue
                    if rnd != (tourn.get("current_round") or 1):
                        continue
                    if now >= _launch_due_at_ms(tourn, m) + LAUNCH_GRACE_MS:
                        _launch_match(fs, tournament_id, tourn, m)
                    continue

                if m.get("status") != "active":
                    continue

                duel_id = m.get("duel_id") or m["match_id"]
                duel = admin_db.reference(f"{BASE_PATH}/{tournament_id}/{duel_id}").get()
                if not duel:
                    # Match marked active but its duel vanished — reopen it.
                    tourn_ref.collection("bracket_matches").document(m["match_id"]).update(
                        {"status": "pending", "duel_id": None})
                    continue

                status = duel.get("status")
                if status == "finished":
                    _finalize_match(fs, tournament_id, m["match_id"])
                elif status == "waiting":
                    created = duel.get("created_at") or 0
                    if not created or now - created > DUEL_AUTOSTART_MS:
                        admin_db.reference(f"{BASE_PATH}/{tournament_id}/{duel_id}").update(
                            {"status": "playing", "question_started_at": now})
                        logger.info("[CF-REC] restarted idle duel %s/%s",
                                    tournament_id, duel_id)
                elif status == "playing":
                    # Force-started (or abandoned) duel where nobody ever wrote
                    # reveal_started_at — the question timer has long expired and
                    # the match would stay LIVE forever. Re-enter the reveal phase
                    # so on_tournament_reveal_started completes it.
                    q_dur   = duel.get("question_duration_ms") or 30_000
                    q_start = duel.get("question_started_at") or 0
                    if not q_start:
                        # Playing with no clock: the tab that claimed the start
                        # died between the status flip and the clock write. Every
                        # timer downstream reads this field, so give it one.
                        admin_db.reference(f"{BASE_PATH}/{tournament_id}/{duel_id}").update(
                            {"question_started_at": now})
                        logger.info("[CF-REC] duel %s/%s was playing with no clock",
                                    tournament_id, duel_id)
                        continue
                    if q_start and now - q_start > q_dur + RECONCILE_GRACE_MS:
                        admin_db.reference(f"{BASE_PATH}/{tournament_id}/{duel_id}").update(
                            {"status": "revealing", "reveal_started_at": now})
                        logger.info("[CF-REC] recovered frozen playing duel %s/%s",
                                    tournament_id, duel_id)
                elif status == "revealing":
                    # The reveal phase was entered but advance never happened
                    # (client tab closed after writing reveal_started_at). Run the
                    # same idempotent advance the reveal trigger uses.
                    r_ts = duel.get("reveal_started_at") or 0
                    if r_ts and now - r_ts > REVEAL_DURATION_MS + RECONCILE_GRACE_MS:
                        d_ref = admin_db.reference(f"{BASE_PATH}/{tournament_id}/{duel_id}")
                        # Score before advancing, or the question is lost for good.
                        _score_question(tournament_id, d_ref, duel,
                                        duel.get("current_question_index") or 0)
                        if _advance_reveal(d_ref):
                            logger.info("[CF-REC] advanced stale reveal %s/%s",
                                        tournament_id, duel_id)

            _progress_round(fs, tournament_id, tourn_ref.get().to_dict() or {},
                            tourn.get("current_round") or 1)
        except Exception as e:                                # noqa: BLE001
            logger.exception("[CF-REC] tournament %s failed: %s", tournament_id, e)
