"""
tmp-w4-pure-test.py — pure-function tests for the tournament security pass.

Imports the modified functions from main.py WITHOUT deploying, and asserts:
  _resolve_winner   : surrender is a LOSS (never falls through to score/FFA-rank),
                      forfeit unchanged, score comparison unchanged, 0-0 rank rule unchanged.
  _strip_correct    : length is preserved across non-dict / missing-correct questions
                      (index alignment for answer hashing).
  _questions_for_round : out-of-range assigned indices now log an error instead of
                      silently returning a short question list.
Prints PASS/FAIL per case. Exit code 0 only when every case passes.
"""
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import main  # noqa: E402  (imports fine: initialize_app() works in this venv)

# ── Fake Firestore for the 0-0 FFA-rank branch of _resolve_winner ─────────────
class FakeDoc:
    def __init__(self, data):
        self._data = data
    def get(self):
        return self
    def to_dict(self):
        return self._data
    def collection(self, path):
        return FakeCol()

RANKS = {"A": 5, "B": 3}

class FakeCol:
    def document(self, uid):
        return FakeDoc({"rank": RANKS.get(uid, 999)})

class FakeFs:
    def collection(self, path):
        return FakeCol()

FS = FakeFs()
MATCH = {"player_a_uid": "A", "player_b_uid": "B"}

def resolve(duel):
    return main._resolve_winner(FS, "TID", duel, MATCH)

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS" if cond else "FAIL") + "  " + name + ("  " + detail if detail else ""))

# ── _resolve_winner ───────────────────────────────────────────────────────────
w, l, tb = resolve({"players": {"A": {"score": 10}, "B": {"score": 2}}, "surrender_by": "A"})
check("surrender: A loses (B wins)", (w, l, tb) == ("B", "A", None), f"got {(w,l,tb)}")

w, l, tb = resolve({"players": {"A": {"score": 2}, "B": {"score": 10}}, "surrender_by": "B"})
check("surrender: B loses even when ahead", (w, l, tb) == ("A", "B", None), f"got {(w,l,tb)}")

w, l, tb = resolve({"players": {"A": {"score": 2}, "B": {"score": 10}}, "forfeit_by": "A"})
check("forfeit: A loses (B wins)", (w, l, tb) == ("B", "A", None), f"got {(w,l,tb)}")

w, l, tb = resolve({"players": {"A": {"score": 6}, "B": {"score": 1}}})
check("score diff: higher wins", (w, l, tb) == ("A", "B", None), f"got {(w,l,tb)}")

w, l, tb = resolve({"players": {"A": {"score": 0}, "B": {"score": 0}}})
check("0-0 tie: better FFA rank wins", (w, l, tb) == ("B", "A", "ffa_rank"), f"got {(w,l,tb)}")

w, l, tb = resolve({"players": {"A": {"score": 0}, "B": {"score": 0}}, "surrender_by": "A"})
check("0-0 + surrender: surrender wins over rank", (w, l, tb) == ("B", "A", None), f"got {(w,l,tb)}")

# ── _strip_correct ────────────────────────────────────────────────────────────
qs = [
    {"question": "Q0", "choices": ["a", "b"], "correct": 1},
    None,
    {"question": "Q2", "choices": ["a", "b", "c"], "correct": 0},
    {"question": "Q3", "choices": ["a", "b"]},           # missing `correct`
]
stripped = main._strip_correct(qs, "duelX")
check("strip: length preserved with None + missing-correct", len(stripped) == len(qs),
      f"len {len(stripped)} != {len(qs)}")
check("strip: Q0 hashed at index 0",
      stripped[0].get("correct_hash") is not None and "correct" not in stripped[0],
      f"{stripped[0]}")
check("strip: None replaced by an RTDB-safe placeholder at index 1",
      isinstance(stripped[1], dict) and stripped[1].get("invalid") is True and "correct" not in stripped[1],
      f"{stripped[1]}")
check("strip: Q2 hashed at its real index 2",
      stripped[2].get("correct_hash") is not None and "correct" not in stripped[2],
      f"{stripped[2]}")
check("strip: missing-correct kept as-is at index 3", stripped[3] == qs[3], f"{stripped[3]}")

# hash index alignment — a tiebreaker appended at the end must hash with its
# real final index, not shift onto a wrong index.
qs_tb = [{"question": "T", "choices": ["a", "b", "c", "d"], "correct": 2}]
combined = main._strip_correct(qs + qs_tb, "duelY")
last = combined[-1]
last_idx = len(combined) - 1
check("strip: appended tiebreaker hashed at final index",
      last.get("correct_hash") == main._hash_correct("duelY", last_idx, 2),
      f"hash {last.get('correct_hash')}")

# ── _questions_for_round error logging ────────────────────────────────────────
log_events = []
handler = logging.Handler()
handler.emit = lambda record: log_events.append(record.getMessage())
main.logger.addHandler(handler)
main.logger.setLevel(logging.ERROR)

deck = [{"question": f"Q{i}", "choices": ["a", "b"], "correct": 0} for i in range(5)]
tourn = {"round_questions": {"1": [0, 1, 1, 99, "x"]}, "deck_id": "deck-1", "title": "T"}
picked = main._questions_for_round(1, tourn, deck, 5)
check("q-for-round: out-of-range silently dropped but returned resolvable",
      picked == [deck[0], deck[1], deck[1]], f"len {len(picked)}")
check("q-for-round: error logged when picked != assigned",
      any("round 1 assigned 5 indices, only 3 resolvable" in m for m in log_events),
      "; ".join(log_events or ["no log"]))
main.logger.removeHandler(handler)

# ── Summary ───────────────────────────────────────────────────────────────────
print("\n===== SUMMARY =====")
failed = 0
for name, ok, _ in results:
    if not ok:
        failed += 1
print(f"{len(results) - failed}/{len(results)} PASSED")
sys.exit(1 if failed else 0)