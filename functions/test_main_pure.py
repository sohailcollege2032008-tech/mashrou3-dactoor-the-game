"""
tmp-w4-pure-test.py — pure-function tests for the tournament security pass.

Imports the modified functions from main.py WITHOUT deploying, and asserts:
  _resolve_winner   : surrender is a LOSS (never falls through to score/FFA-rank),
                      forfeit unchanged, score comparison unchanged, 0-0 rank rule unchanged.
  _split_answer_key : the questions written to RTDB carry no answer field at all,
                      and the key stays index-aligned across non-dict / missing-correct
                      entries (a short key would shift every later question).
  _correct_for      : reads the server-only key, including a tiebreaker appended
                      past the end of the main list.
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

# ── _split_answer_key / _correct_for ──────────────────────────────────────────
qs = [
    {"question": "Q0", "choices": ["a", "b"], "correct": 1},
    None,
    {"question": "Q2", "choices": ["a", "b", "c"], "correct": 0},
    {"question": "Q3", "choices": ["a", "b"]},           # missing `correct`
]
safe, key = main._split_answer_key(qs, "duelX")
check("split: length preserved with None + missing-correct",
      len(safe) == len(qs) and len(key) == len(qs), f"safe {len(safe)} key {len(key)}")
check("split: no answer field survives into the node",
      all(isinstance(q, dict) and "correct" not in q and "correct_hash" not in q for q in safe),
      f"{safe}")
check("split: key holds the real indices", key[0] == 1 and key[2] == 0, f"key={key}")
check("split: unusable entries marked -1, not dropped",
      key[1] == -1 and key[3] == -1, f"key={key}")
check("split: None replaced by an RTDB-safe placeholder",
      isinstance(safe[1], dict) and safe[1].get("invalid") is True, f"{safe[1]}")

# A tiebreaker is appended to `questions` at index len(main) + n, and its key
# sits at index n of the reserve list — the same lookup must find it.
tb_qs = [{"question": "T", "choices": ["a", "b", "c", "d"], "correct": 2}]
all_safe, all_key = main._split_answer_key(qs + tb_qs, "duelY")
fake_key = {"main": all_key[:len(qs)], "tb": all_key[len(qs):]}
check("correct_for: main question resolved from the key",
      main._correct_for("t", "duelY", 0, all_safe[0], key=fake_key) == 1,
      f"got {main._correct_for('t', 'duelY', 0, all_safe[0], key=fake_key)}")
check("correct_for: appended tiebreaker resolved at its final index",
      main._correct_for("t", "duelY", len(qs), all_safe[-1], key=fake_key) == 2,
      f"got {main._correct_for('t', 'duelY', len(qs), all_safe[-1], key=fake_key)}")
check("correct_for: -1 in the key is not an answer",
      main._correct_for("t", "duelY", 1, all_safe[1], key=fake_key) is None,
      f"got {main._correct_for('t', 'duelY', 1, all_safe[1], key=fake_key)}")
check("correct_for: index past the reserve is not an answer",
      main._correct_for("t", "duelY", 99, None, key=fake_key) is None, "expected None")

# A duel launched before the key existed still decodes from its stored hash.
legacy_hash = __import__("hashlib").sha256("duel:duelZ:3:2".encode()).hexdigest()
legacy_q = {"question": "L", "choices": ["a", "b", "c", "d"], "correct_hash": legacy_hash}
check("correct_for: legacy hash still decodes",
      main._correct_for("t", "duelZ", 3, legacy_q, key={}) == 2,
      f"got {main._correct_for('t', 'duelZ', 3, legacy_q, key={})}")

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