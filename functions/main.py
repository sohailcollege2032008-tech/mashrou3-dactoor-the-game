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

    # Rank correct answers by reaction time; clamp forged ultra-fast times so
    # they cannot steal the first-correct slot.
    def _safe_reaction(ans: dict) -> int:
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
        updates[f"answers/{qi}/{p_uid}/is_correct"]    = is_ok
        updates[f"answers/{qi}/{p_uid}/points_earned"] = pts
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
    if not room or not room.get("tournament_id"):
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
            total += a.get("reaction_time_ms") or 0
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
            tourn_ref.update({"status": "finished", "winner_uid": winner, "winner_name": name})
            logger.info("[CF-BR] tournament %s finished — champion %s", tournament_id, name)
        return

    # Open the next round.  current_round is bumped first so the launcher sees a
    # consistent state, then each next-round match gets its own launch_after —
    # that write is also what re-triggers the launcher for those matches.
    if (tourn.get("current_round") or 1) != rnd:
        return
    now = _now_ms()
    tourn_ref.update({"phase_started_at": now, "current_round": rnd + 1})

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

    IMPORTANT: advancement must happen even when the match was ALREADY
    finalised by a player's browser tab.  A client tab can write the match
    result (it is a participant), but its own advancement write is denied by
    the security rules (it is not yet a participant of the next match).  If we
    skip 'finished' matches here, the winner is lost forever — which is what
    happened in production on 2026-08-14 (two of four round-1 winners never
    reached round 2).  Every step below is idempotent; the reconciler calls
    this same code as a backstop.
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
        # A client tab (or a previous invocation) already finalised the match.
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
            # Lost the finalise race to a client tab — reload and use its winner.
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
        try:
            tourn_ref = fs.collection("tournaments").document(tournament_id)
            if len(tourn_ref.collection("ffa_results").limit(1).get()) > 0:
                tourn_ref.update({"status": "bracket", "current_round": 1,
                                  "phase_started_at": _now_ms()})
                logger.info("[CF-REC] ffa_results present — flipped %s to bracket", tournament_id)
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

                # A match finalised by a client tab still needs its winner
                # advanced server-side (client advancement is rule-denied).
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
