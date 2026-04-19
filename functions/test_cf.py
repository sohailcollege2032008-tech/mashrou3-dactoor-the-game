"""
functions/test_cf.py
====================
End-to-end test suite for the two tournament duel Cloud Functions.

Strategy
--------
Uses the Firebase Admin SDK (service account) to write directly to RTDB —
the same physical path the Cloud Functions listen on.  No browser, no UI,
no real user accounts needed.

Test layout
-----------
  Test 1 — Early reveal + race-based scoring
  Test 2 — Both players answer wrong (0 pts each)
  Test 3 — Tiebreaker extension (equal non-zero scores -> reserve Q appended)
  Test 4 — Idempotency (simultaneous answers, no double-scoring)
  Test 5 — Single answer -> CF does NOT reveal early (correct guard)

Each test:
  • Creates a minimal duel under tournament_duels/test_{ts}/{duel_id}
  • Spawns threads to simulate player answer writes with controlled timing
  • Polls RTDB until expected state, or times out
  • Cleans up the test node

Usage
-----
  python functions/test_cf.py
"""

import sys
import time
import threading
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, db as admin_db

# ── SDK init ──────────────────────────────────────────────────────────────────
SA_KEY       = Path(__file__).parent / "sa-key.json"
DATABASE_URL = "https://mashrou3-dactoor-default-rtdb.europe-west1.firebasedatabase.app"

cred = credentials.Certificate(str(SA_KEY))
firebase_admin.initialize_app(cred, {"databaseURL": DATABASE_URL})

# ── Colours ───────────────────────────────────────────────────────────────────
PASS = "\033[92m[PASS]\033[0m"
FAIL = "\033[91m[FAIL]\033[0m"
INFO = "\033[94m[INFO]\033[0m"
WARN = "\033[93m[WARN]\033[0m"

# ── Shared results list ───────────────────────────────────────────────────────
_results: list[tuple[str, bool]] = []


def check(name: str, condition: bool, detail: str = "") -> bool:
    symbol = PASS if condition else FAIL
    suffix = f"  ({detail})" if detail else ""
    print(f"    {symbol} {name}{suffix}")
    _results.append((name, condition))
    return condition


# ── Helpers ───────────────────────────────────────────────────────────────────

def now_ms() -> int:
    return int(time.time() * 1000)


def get_answers_for_qi(duel: dict, qi: int) -> dict:
    """
    Read answers[qi] from a duel snapshot.
    Firebase returns integer-keyed objects as Python lists — handle both forms.
    """
    raw = duel.get("answers")
    if isinstance(raw, list):
        val = raw[qi] if qi < len(raw) else None
    elif isinstance(raw, dict):
        val = raw.get(str(qi))
    else:
        return {}
    return val if isinstance(val, dict) else {}


def poll(ref, condition_fn, timeout: float = 15, interval: float = 0.35):
    """Poll RTDB ref until condition_fn(data) -> True or timeout (returns data or None)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        data = ref.get()
        if condition_fn(data):
            return data
        time.sleep(interval)
    return None


def cleanup(path: str):
    try:
        admin_db.reference(path).delete()
    except Exception:
        pass


# ── Fake UIDs (Admin SDK bypasses Firebase Auth — any UID works) ──────────────
UID_A = "test_uid_alpha_0001"
UID_B = "test_uid_beta_0002"

# ── Sample questions ──────────────────────────────────────────────────────────
Q_MATH = {
    "question": "[TEST] 2 + 2 = ?",
    "choices":  ["1", "2", "3", "4"],
    "correct":  3,          # index 3 = "4"
}
Q_MATH2 = {
    "question": "[TEST] 5 + 5 = ?",
    "choices":  ["8", "9", "10", "11"],
    "correct":  2,          # index 2 = "10"
}
Q_TIEBREAK = {
    "question": "[TEST-TB] 3 + 3 = ?",
    "choices":  ["4", "6", "7", "8"],
    "correct":  1,          # index 1 = "6"
}


# ── Duel builder ─────────────────────────────────────────────────────────────

def make_duel(t_id: str, d_id: str, questions: list,
              tb_questions: list | None = None) -> None:
    """Write a minimal 2-player tournament duel to RTDB in 'playing' state."""
    admin_db.reference(f"tournament_duels/{t_id}/{d_id}").set({
        "status":                 "playing",
        "current_question_index": 0,
        "total_questions":        len(questions),
        "questions":              questions,
        "question_started_at":    now_ms(),
        "tournament_id":          t_id,
        "match_id":               "r1m1",
        "round":                  1,
        "tiebreaker_questions":   tb_questions or [],
        "tiebreaker_used":        0,
        "is_tiebreaker":          False,
        "players": {
            UID_A: {"uid": UID_A, "nickname": "Alpha", "score": 0},
            UID_B: {"uid": UID_B, "nickname": "Beta",  "score": 0},
        },
    })


def write_answer(t_id: str, d_id: str, qi: int,
                 uid: str, choice: int, delay_ms: int = 0) -> None:
    """Write a player answer after delay_ms milliseconds."""
    if delay_ms > 0:
        time.sleep(delay_ms / 1000.0)
    admin_db.reference(
        f"tournament_duels/{t_id}/{d_id}/answers/{qi}/{uid}"
    ).set({
        "uid":              uid,
        "selected_choice":  choice,
        "reaction_time_ms": delay_ms + 80,
    })


# ═════════════════════════════════════════════════════════════════════════════
# TEST 1 — Early reveal + race-based scoring
# ═════════════════════════════════════════════════════════════════════════════

def test_early_reveal_and_scoring():
    print(f"\n{INFO} Test 1: Early reveal + race-based scoring")
    t_id = f"test_{now_ms()}_1"
    d_id = "duel_1"
    duel_ref = admin_db.reference(f"tournament_duels/{t_id}/{d_id}")

    make_duel(t_id, d_id, [Q_MATH])

    t0 = time.time()
    # A answers correctly first (delay 0), B answers correctly 200 ms later
    threading.Thread(target=write_answer,
                     args=(t_id, d_id, 0, UID_A, 3, 0),   daemon=True).start()
    threading.Thread(target=write_answer,
                     args=(t_id, d_id, 0, UID_B, 3, 200), daemon=True).start()

    # CF should flip status -> 'revealing' shortly after B answers
    revealed = poll(duel_ref,
                    lambda d: d and d.get("status") == "revealing",
                    timeout=12)
    elapsed = (time.time() - t0) * 1000

    check("Status -> 'revealing' after both answered",
          revealed is not None, f"took {elapsed:.0f}ms")

    if revealed:
        score_a   = (revealed.get("players") or {}).get(UID_A, {}).get("score", -1)
        score_b   = (revealed.get("players") or {}).get(UID_B, {}).get("score", -1)
        answers_0 = get_answers_for_qi(revealed, 0)
        ans_a     = answers_0.get(UID_A) or {}
        ans_b     = answers_0.get(UID_B) or {}

        check("Player A (first correct) = 2 pts",   score_a == 2,   f"got {score_a}")
        check("Player B (second correct) = 1 pt",   score_b == 1,   f"got {score_b}")
        check("Answer A: is_correct = True",         ans_a.get("is_correct") is True)
        check("Answer A: points_earned = 2",         ans_a.get("points_earned") == 2)
        check("Answer B: is_correct = True",         ans_b.get("is_correct") is True)
        check("Answer B: points_earned = 1",         ans_b.get("points_earned") == 1)

    # CF2 should advance -> 'finished' (only 1 question)
    finished = poll(duel_ref,
                    lambda d: d and d.get("status") == "finished",
                    timeout=10)
    check("Status -> 'finished' after 3-second reveal phase", finished is not None)

    cleanup(f"tournament_duels/{t_id}")


# ═════════════════════════════════════════════════════════════════════════════
# TEST 2 — Both players answer wrong
# ═════════════════════════════════════════════════════════════════════════════

def test_both_wrong():
    print(f"\n{INFO} Test 2: Both players answer wrong")
    t_id = f"test_{now_ms()}_2"
    d_id = "duel_2"
    duel_ref = admin_db.reference(f"tournament_duels/{t_id}/{d_id}")

    make_duel(t_id, d_id, [Q_MATH])

    # Both pick choice 0 (wrong; correct is 3)
    threading.Thread(target=write_answer,
                     args=(t_id, d_id, 0, UID_A, 0, 0),   daemon=True).start()
    threading.Thread(target=write_answer,
                     args=(t_id, d_id, 0, UID_B, 0, 120), daemon=True).start()

    finished = poll(duel_ref,
                    lambda d: d and d.get("status") == "finished",
                    timeout=15)
    check("Status -> 'finished'", finished is not None)

    if finished:
        score_a = (finished.get("players") or {}).get(UID_A, {}).get("score", -1)
        score_b = (finished.get("players") or {}).get(UID_B, {}).get("score", -1)
        check("Player A score = 0", score_a == 0, f"got {score_a}")
        check("Player B score = 0", score_b == 0, f"got {score_b}")

    cleanup(f"tournament_duels/{t_id}")


# ═════════════════════════════════════════════════════════════════════════════
# TEST 3 — Tiebreaker extension on equal non-zero scores
# ═════════════════════════════════════════════════════════════════════════════

def test_tiebreaker_extension():
    """
    2-question duel + 1 reserve tiebreaker question.

    Q1 (correct=3):  A correct 1st (+2), B wrong (+0)  -> A=2, B=0
    Q2 (correct=2):  B correct 1st (+2), A wrong (+0)  -> A=2, B=2  ← TIE!

    Expected: CF appends tiebreaker Q (is_tiebreaker=True, total_questions=3).

    Q3/TB (correct=1):  A correct 1st (+2), B wrong (+0)  -> A=4, B=2  -> A wins
    Expected: game finishes with A > B.
    """
    print(f"\n{INFO} Test 3: Tiebreaker extension (equal non-zero scores -> Q appended)")
    t_id = f"test_{now_ms()}_3"
    d_id = "duel_3"
    duel_ref = admin_db.reference(f"tournament_duels/{t_id}/{d_id}")

    make_duel(t_id, d_id, [Q_MATH, Q_MATH2], tb_questions=[Q_TIEBREAK])

    # ── Q1: A correct first, B wrong ─────────────────────────────────────────
    threading.Thread(target=write_answer,
                     args=(t_id, d_id, 0, UID_A, 3, 0),   daemon=True).start()
    threading.Thread(target=write_answer,
                     args=(t_id, d_id, 0, UID_B, 0, 180), daemon=True).start()

    q2_live = poll(duel_ref,
                   lambda d: (d and d.get("status") == "playing"
                              and d.get("current_question_index") == 1),
                   timeout=15)
    check("Q2 started (qi=1)", q2_live is not None)
    if not q2_live:
        cleanup(f"tournament_duels/{t_id}")
        return

    # ── Q2: B correct first, A wrong -> TIE ───────────────────────────────────
    threading.Thread(target=write_answer,
                     args=(t_id, d_id, 1, UID_B, 2, 0),   daemon=True).start()
    threading.Thread(target=write_answer,
                     args=(t_id, d_id, 1, UID_A, 0, 180), daemon=True).start()

    tb_live = poll(duel_ref,
                   lambda d: d and d.get("is_tiebreaker") is True,
                   timeout=15)
    check("Tiebreaker question appended (is_tiebreaker=True)", tb_live is not None)

    if not tb_live:
        cleanup(f"tournament_duels/{t_id}")
        return

    tq = tb_live.get("total_questions")
    qi = tb_live.get("current_question_index")
    check("total_questions -> 3",      tq == 3, f"got {tq}")
    check("current_question_index -> 2", qi == 2, f"got {qi}")

    # ── Tiebreaker Q: A correct first, B wrong -> A wins ──────────────────────
    threading.Thread(target=write_answer,
                     args=(t_id, d_id, 2, UID_A, 1, 0),   daemon=True).start()
    threading.Thread(target=write_answer,
                     args=(t_id, d_id, 2, UID_B, 0, 200), daemon=True).start()

    final = poll(duel_ref,
                 lambda d: d and d.get("status") == "finished",
                 timeout=15)
    check("Game finishes after tiebreaker Q", final is not None)

    if final:
        sa = (final.get("players") or {}).get(UID_A, {}).get("score", -1)
        sb = (final.get("players") or {}).get(UID_B, {}).get("score", -1)
        check("A wins tiebreaker (A score > B score)",
              sa > sb, f"A={sa}, B={sb}")

    cleanup(f"tournament_duels/{t_id}")


# ═════════════════════════════════════════════════════════════════════════════
# TEST 4 — Idempotency: simultaneous answers don't double-score
# ═════════════════════════════════════════════════════════════════════════════

def test_idempotency():
    """
    Both answers arrive within ~5 ms of each other — hardest race condition.
    The RTDB transaction must ensure only one CF invocation claims the reveal.
    Total score must be exactly 3 (2 + 1), never 4 (2 + 2 would mean double).
    """
    print(f"\n{INFO} Test 4: Idempotency — simultaneous answers, no double-scoring")
    t_id = f"test_{now_ms()}_4"
    d_id = "duel_4"
    duel_ref = admin_db.reference(f"tournament_duels/{t_id}/{d_id}")

    make_duel(t_id, d_id, [Q_MATH])

    # Write both answers almost simultaneously (5 ms gap)
    threading.Thread(target=write_answer,
                     args=(t_id, d_id, 0, UID_A, 3, 0), daemon=True).start()
    threading.Thread(target=write_answer,
                     args=(t_id, d_id, 0, UID_B, 3, 5), daemon=True).start()

    final = poll(duel_ref,
                 lambda d: d and d.get("status") == "finished",
                 timeout=15)
    check("Status -> 'finished'", final is not None)

    if final:
        sa    = (final.get("players") or {}).get(UID_A, {}).get("score", 0)
        sb    = (final.get("players") or {}).get(UID_B, {}).get("score", 0)
        total = sa + sb
        check("Total score = 3 (no double-scoring)",
              total == 3, f"A={sa}, B={sb}, total={total}")

    cleanup(f"tournament_duels/{t_id}")


# ═════════════════════════════════════════════════════════════════════════════
# TEST 5 — Single answer: CF does NOT trigger early reveal
# ═════════════════════════════════════════════════════════════════════════════

def test_single_answer_no_premature_reveal():
    """
    Only A answers — CF must NOT flip to 'revealing' because B hasn't answered.
    Status must stay 'playing' for at least 2.5 seconds after A's answer.
    """
    print(f"\n{INFO} Test 5: Single answer -> no premature early reveal")
    t_id = f"test_{now_ms()}_5"
    d_id = "duel_5"
    duel_ref = admin_db.reference(f"tournament_duels/{t_id}/{d_id}")

    make_duel(t_id, d_id, [Q_MATH])
    write_answer(t_id, d_id, 0, UID_A, 3)   # only A answers

    time.sleep(2.5)
    data   = duel_ref.get()
    status = data.get("status") if data else "missing"

    check("Status still 'playing' after 2.5s (CF correctly waiting for B)",
          status == "playing", f"got '{status}'")

    cleanup(f"tournament_duels/{t_id}")


# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=" * 62)
    print("  Tournament Duel Cloud Functions — E2E Test Suite")
    print("  Project : mashrou3-dactoor")
    print(f"  DB URL  : {DATABASE_URL}")
    print("=" * 62)

    suite_start = time.time()

    test_early_reveal_and_scoring()
    test_both_wrong()
    test_tiebreaker_extension()
    test_idempotency()
    test_single_answer_no_premature_reveal()

    elapsed = time.time() - suite_start
    passed  = sum(1 for _, ok in _results if ok)
    failed  = sum(1 for _, ok in _results if not ok)

    print("\n" + "=" * 62)
    print(f"  {passed}/{len(_results)} passed   {elapsed:.1f}s total")

    if failed:
        print(f"\n  {FAIL} {failed} failing assertion(s):")
        for name, ok in _results:
            if not ok:
                print(f"    ✗  {name}")
    else:
        print(f"\n  {PASS} All assertions passed.")

    print("=" * 62)
    sys.exit(0 if failed == 0 else 1)
