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
import time
import logging

from firebase_functions import db_fn, options
from firebase_admin import initialize_app, db as admin_db

logger = logging.getLogger(__name__)

initialize_app()

REVEAL_DURATION_MS    = 3_000
BASE_PATH             = "tournament_duels"
MIN_REACTION_MS       = 50        # below this = suspiciously fast / clock error
MAX_REACTION_MS       = 65_000    # above this = question expired already


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
            return None                  # abort — another path already claimed it
        captured["duel"] = current
        captured["won"]  = True
        return {
            **current,
            "status":          "revealing",
            "reveal_started_at": reveal_ts,
        }

    duel_ref.transaction(claim_fn)

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
            return None  # abort — already advanced

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

    duel_ref.transaction(advance_fn)
    logger.info("[CF] Advanced duel — tournament=%s duel=%s", tournament_id, duel_id)
