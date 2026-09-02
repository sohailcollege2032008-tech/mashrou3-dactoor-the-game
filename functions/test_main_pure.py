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

# ── _compute_awards ───────────────────────────────────────────────────────────
# The honours list must come only from fields the server writes. The fakes below
# stand in for the two reads it makes: the qualifier results, and each match's
# answers.
FFA_DOCS = {
    "A": {"nickname": "أحمد", "rank": 1, "score": 30},
    "B": {"nickname": "بسمة", "rank": 2, "score": 24},
    "C": {"nickname": "كريم", "rank": 7, "score": 9},
    "D": {"nickname": "دينا", "rank": 8, "score": 8},
}

class AwFfaDoc:
    def __init__(self, uid, data):
        self.id = uid
        self._d = data
    def to_dict(self):
        return self._d

class AwFfaCol:
    def get(self):
        return [AwFfaDoc(u, d) for u, d in FFA_DOCS.items()]

class AwTournDoc:
    def collection(self, name):
        assert name == "ffa_results", name
        return AwFfaCol()

class AwCol:
    def document(self, _id):
        return AwTournDoc()

class AwFs:
    def collection(self, _name):
        return AwCol()

# r1m1: seed 8 (D) knocks out seed 1 (A) — the upset.
# r1m2: B beats C normally.  r2m1: D beats B in the final.
AW_MATCHES = [
    {"match_id": "r1m1", "round": 1, "status": "finished",
     "player_a_uid": "A", "player_a_name": "أحمد", "player_b_uid": "D", "player_b_name": "دينا",
     "winner_uid": "D", "loser_uid": "A"},
    {"match_id": "r1m2", "round": 1, "status": "finished",
     "player_a_uid": "B", "player_a_name": "بسمة", "player_b_uid": "C", "player_b_name": "كريم",
     "winner_uid": "B", "loser_uid": "C"},
    {"match_id": "r2m1", "round": 2, "status": "finished",
     "player_a_uid": "D", "player_a_name": "دينا", "player_b_uid": "B", "player_b_name": "بسمة",
     "winner_uid": "D", "loser_uid": "B"},
]

AW_ANSWERS = {
    "r1m1": {
        "0": {"correct_reveal": 1,
              "A": {"is_correct": True,  "reaction_ms_server": 4000, "reaction_time_ms": 50},
              "D": {"is_correct": True,  "reaction_ms_server": 900}},
        "1": {"correct_reveal": 2,
              "A": {"is_correct": False, "reaction_ms_server": 1200},
              "D": {"is_correct": True,  "reaction_ms_server": 640}},
    },
    "r1m2": {
        "0": {"correct_reveal": 0,
              "B": {"is_correct": True, "reaction_ms_server": 1500},
              "C": {"is_correct": True, "reaction_ms_server": 20}},   # below the floor: ignored
    },
    "r2m1": {
        "0": {"correct_reveal": 3,
              "D": {"is_correct": True, "reaction_ms_server": 1100},
              "B": {"is_correct": True, "reaction_ms_server": 1300}},
    },
}

class AwRef:
    def __init__(self, path):
        self.path = path
    def get(self):
        for mid, data in AW_ANSWERS.items():
            if self.path.endswith(f"/{mid}/answers"):
                return data
        return None

_real_reference = main.admin_db.reference
main.admin_db.reference = lambda path: AwRef(path)
try:
    aw = main._compute_awards(AwFs(), "TID", AW_MATCHES, {"total_rounds": 2})
    aw_walkover = main._compute_awards(
        AwFs(), "TID",
        [{**AW_MATCHES[0], "forced_by_host": True}], {"total_rounds": 2})
finally:
    main.admin_db.reference = _real_reference

by_key = {a["key"]: a for a in aw}
check("awards: champion is the winner of the final",
      by_key.get("champion", {}).get("uid") == "D", f"got {by_key.get('champion')}")
check("awards: runner-up is the other finalist",
      by_key.get("runner_up", {}).get("uid") == "B", f"got {by_key.get('runner_up')}")
check("awards: top qualifier is seed 1",
      by_key.get("qualifier", {}).get("uid") == "A"
      and by_key["qualifier"]["value"] == "30 نقطة", f"got {by_key.get('qualifier')}")
check("awards: Arabic counts 3-10 as a plural",
      main._ar_count(6, "إجابة", "إجابتين", "إجابات", "إجابة") == "إجابات"
      and main._ar_count(1, "نقطة", "نقطتين", "نقاط", "نقطة") == "نقطة"
      and main._ar_count(2, "نقطة", "نقطتين", "نقاط", "نقطة") == "نقطتين"
      and main._ar_count(30, "نقطة", "نقطتين", "نقاط", "نقطة") == "نقطة",
      "1/2/6/30")
check("awards: fastest ignores a sub-floor time and uses the server measurement",
      by_key.get("fastest", {}).get("uid") == "D"
      and by_key["fastest"]["value"] == "0.64 ثانية", f"got {by_key.get('fastest')}")
check("awards: sniper counts only correct answers",
      by_key.get("sniper", {}).get("uid") == "D"
      and by_key["sniper"]["value"] == "3 إجابات صحيحة", f"got {by_key.get('sniper')}")
check("awards: upset is the lowest seed beating the highest",
      by_key.get("upset", {}).get("uid") == "D"
      and "المركز 1" in by_key["upset"]["value"], f"got {by_key.get('upset')}")

check("awards: a walkover is not an upset",
      not any(a["key"] == "upset" for a in aw_walkover),
      f"got {[a['key'] for a in aw_walkover]}")

# ── Summary ───────────────────────────────────────────────────────────────────
print("\n===== SUMMARY =====")
failed = 0
for name, ok, _ in results:
    if not ok:
        failed += 1
print(f"{len(results) - failed}/{len(results)} PASSED")
sys.exit(1 if failed else 0)