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
MIN_REACTION_MS       = 50        # below this = suspiciously fast / clock error
MAX_REACTION_MS       = 65_000    # above this = question expired already

# ── Bracket orchestration constants ───────────────────────────────────────────
DUEL_AUTOSTART_MS     = 25_000    # duel stuck in 'waiting' this long → force start
MAX_TRIGGER_SLEEP_S   = 480       # hard cap on in-function waiting
QUESTIONS_PER_MATCH   = 5
LAUNCH_GRACE_MS       = 3_000     # let the host tab win the launch race when open


# ── Helpers ───────────────────────────────────────────────────────────────────

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

    # ── Score answers ─────────────────────────────────────────────────────────
    pre_duel  = captured["duel"]
    questions = _to_list(pre_duel.get("questions"))
    question  = questions[current_qi] if current_qi < len(questions) else None
    correct_c = _find_correct_c(duel_id, current_qi, question)

    # Sort correct answers by ascending reaction_time_ms (first = rank 0 = 2 pts).
    # Clamp reaction_time_ms to a valid range so forged ultra-fast times don't
    # steal the first-correct slot; anything outside the bounds is treated as
    # the worst possible time (MAX_REACTION_MS) for ranking purposes.
    def _safe_reaction(ans: dict) -> int:
        ms = ans.get("reaction_time_ms")
        if not isinstance(ms, (int, float)) or ms < MIN_REACTION_MS:
            return MAX_REACTION_MS    # invalid → push to the back
        return min(int(ms), MAX_REACTION_MS)

    correct_list = [
        (uid, ans) for uid, ans in answers_qi.items()
        if uid in player_uids
        and isinstance(ans, dict)
        and ans.get("selected_choice") == correct_c
    ]
    correct_list.sort(key=lambda x: _safe_reaction(x[1]))
    rank_map = {uid: i for i, (uid, _) in enumerate(correct_list)}

    updates: dict = {}
    # Reveal the resolved correct index so clients can highlight without plain `correct`
    if correct_c is not None:
        updates[f"answers/{current_qi}/correct_reveal"] = correct_c

    for p_uid in player_uids:
        ans = answers_qi.get(p_uid)
        if not isinstance(ans, dict):
            continue
        is_ok = (ans.get("selected_choice") == correct_c)
        rank  = rank_map.get(p_uid, 99)
        pts   = (2 if rank == 0 else 1) if is_ok else 0

        updates[f"answers/{current_qi}/{p_uid}/is_correct"]    = is_ok
        updates[f"answers/{current_qi}/{p_uid}/points_earned"] = pts

        if is_ok and pts > 0:
            cur_score = (
                ((pre_duel.get("players") or {}).get(p_uid) or {}).get("score") or 0
            )
            updates[f"players/{p_uid}/score"] = cur_score + pts

    if updates:
        duel_ref.update(updates)

    logger.info("[CF] Reveal claimed — tournament=%s duel=%s qi=%d",
                tournament_id, duel_id, current_qi)


# ── Function 2 ─────────────────────────────────────────────────────────────────

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

    # Sleep for the remainder of the reveal phase
    reveal_ts  = after_val if isinstance(after_val, (int, float)) else _now_ms()
    elapsed_ms = _now_ms() - int(reveal_ts)
    sleep_ms   = max(0, REVEAL_DURATION_MS - elapsed_ms)
    if sleep_ms > 0:
        time.sleep(sleep_ms / 1000.0)

    # ── Atomically advance to next question (or finish) ───────────────────────
    duel_ref = admin_db.reference(f"{BASE_PATH}/{tournament_id}/{duel_id}")

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

    _try_transaction(duel_ref, advance_fn)
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

    # Skip if the host client already wrote results (avoid conflicting shuffles)
    if len(tourn_ref.collection("ffa_results").limit(1).get()) > 0:
        logger.info("[CF-FFA] ffa_results already present — skipping %s", tournament_id)
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


def _hash_correct(duel_id: str, qi: int, correct_idx: int) -> str:
    """Mirror of crypto.js hashCorrectForDuel — sha256("duel:{id}:{qi}:{idx}")."""
    return hashlib.sha256(f"duel:{duel_id}:{qi}:{correct_idx}".encode()).hexdigest()


def _strip_correct(questions: list, duel_id: str) -> list:
    """Replace each question's plain `correct` with `correct_hash`."""
    out = []
    for qi, q in enumerate(questions):
        if not isinstance(q, dict):
            continue
        if q.get("correct") is None:
            out.append(q)
            continue
        safe = {k: v for k, v in q.items() if k != "correct"}
        safe["correct_hash"] = _hash_correct(duel_id, qi, q["correct"])
        out.append(safe)
    return out


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
    wait = (tourn.get("phase_transition_wait") or 0) if (match.get("round") or 1) == 1 \
        else (tourn.get("round_break_time") or 0)
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

    # Hash both sets in one pass. A tiebreaker is appended to `questions` at
    # index len(questions) + i, and the answer hash is bound to that index, so
    # hashing the reserve separately (from 0) left it permanently unscoreable.
    all_safe = _strip_correct(questions + tiebreakers, match_id)
    safe_questions   = all_safe[:len(questions)]
    safe_tiebreakers = all_safe[len(questions):]

    payload = {
        "tournament_id": tournament_id,
        "match_id": match_id,
        "round": match.get("round") or 1,
        "question_duration_ms": tourn.get("duel_question_duration") or 30_000,
        "creator_uid": uid_a,
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

    if duel.get("forfeit_by"):
        loser = duel["forfeit_by"]
        winner = uid_b if loser == uid_a else uid_a
        return winner, loser, None

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


def _finalize_match(fs, tournament_id: str, match_id: str) -> bool:
    """
    Write a finished duel's result onto its bracket match, push the winner into
    the next match and progress the round.  A match already 'finished' is
    skipped, so the client and the server can both attempt this safely.
    """
    tourn_ref = fs.collection("tournaments").document(tournament_id)
    match_ref = tourn_ref.collection("bracket_matches").document(match_id)
    match = match_ref.get().to_dict()
    if not match or match.get("status") == "finished":
        return False

    duel_id = match.get("duel_id") or match_id
    duel = admin_db.reference(f"{BASE_PATH}/{tournament_id}/{duel_id}").get()
    if not duel or duel.get("status") != "finished":
        return False

    tourn = tourn_ref.get().to_dict() or {}
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
        return False

    winner_name = match.get("player_a_name") if winner == match.get("player_a_uid") \
        else match.get("player_b_name")

    if match.get("next_match_id"):
        # Odd match numbers feed slot A of the next match, even ones feed slot B.
        slot = "player_a" if (match.get("match_number") or 1) % 2 == 1 else "player_b"
        tourn_ref.collection("bracket_matches").document(match["next_match_id"]).update({
            f"{slot}_uid": winner,
            f"{slot}_name": winner_name,
        })

    logger.info("[CF-BR] finalized %s — winner %s", match_id, winner_name)
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
    if after is None:
        return
    tourn = after.to_dict() or {}
    if tourn.get("status") != "bracket":
        return

    tournament_id = event.params["tournamentId"]
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
    if match.get("status") != "pending":
        return
    if not match.get("player_a_uid") or not match.get("player_b_uid"):
        return

    tournament_id = event.params["tournamentId"]
    match_id      = event.params["matchId"]
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

            _progress_round(fs, tournament_id, tourn_ref.get().to_dict() or {},
                            tourn.get("current_round") or 1)
        except Exception as e:                                # noqa: BLE001
            logger.exception("[CF-REC] tournament %s failed: %s", tournament_id, e)
