# Security Audit — Tournament Duel System

**Date:** 2026-04-19  
**Status:** Hardened

---

## Confirmed Exploits (pre-fix) via `exploit_test.py`

All 4 exploits were confirmed using the Admin SDK simulation:

| # | Exploit | Pre-fix | Post-fix (client SDK) |
|---|---------|---------|----------------------|
| 1 | Score injection (`score = 9999`) | VULN | BLOCKED |
| 2 | Victim score overwrite (`score = -999`) | VULN | BLOCKED |
| 3 | Answer overwrite (submit wrong → overwrite correct) | VULN | BLOCKED |
| 4 | Force finish (`status=finished, forfeit_by=victim`) | VULN | BLOCKED |

> **Note:** `exploit_test.py` uses the Firebase **Admin SDK** which permanently bypasses all
> security rules (including `.validate`). This is expected — the same privilege used by Cloud
> Functions. The rules protect against **client SDK** attacks (browser DevTools / Network tab).

---

## Rules Implemented

### RTDB `database.rules.json`

#### Answer write-lock (`duels` + `tournament_duels`)
```json
"selected_choice": {
  ".validate": "!data.exists() ? (newData.isNumber() && auth.uid == $userId) : newData.val() == data.val()"
},
"reaction_time_ms": {
  ".validate": "!data.exists() ? (newData.isNumber() && newData.val() >= 50 && newData.val() <= 65000 && auth.uid == $userId) : newData.val() == data.val()"
}
```
- First write: must be the owner (`auth.uid == $userId`), must be a valid number in range
- Subsequent writes: field is **immutable** — `newData.val() == data.val()` enforces this
- **Blocks:** answer overwrite exploit, reaction_time forgery

#### Score cap (`duels` + `tournament_duels`)
```json
"score": {
  ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= (data.exists() ? data.val() + 2 : 2)"
}
```
- Score can only increase by at most **+2 per write** (max points per question)
- **Blocks:** direct `set(9999)`, `set(-999)`, arbitrary score injection

#### Forfeit/Surrender ownership (`tournament_duels` only)
```json
"forfeit_by":   { ".validate": "newData.isString() && newData.val() == auth.uid" },
"surrender_by": { ".validate": "newData.isString() && newData.val() == auth.uid" }
```
- `.validate` runs on ALL nodes affected by a write, **including parent updates**
- `update(duelRef, {forfeit_by: 'victim_uid'})` fails because `'victim_uid' != auth.uid`
- **Blocks:** forced forfeit / match result forgery

### Firestore `firestore.rules`

| Collection | Was | Now |
|---|---|---|
| `question_sets` | any auth can write | only creator (`host_id`) or owner can update/delete |
| `tournaments` (parent) | any auth can write | any auth can create; only host or owner can update/delete |
| `ffa_results` | any auth can write | only tournament host or owner can write |
| `bracket_matches` | any auth can write | create/delete = host/owner; update = host/owner **or match participants** |

### Cloud Function `functions/main.py`

`reaction_time_ms` is now clamped server-side before ranking:
```python
def _safe_reaction(ans: dict) -> int:
    ms = ans.get("reaction_time_ms")
    if not isinstance(ms, (int, float)) or ms < MIN_REACTION_MS:
        return MAX_REACTION_MS    # invalid → push to the back of the ranking
    return min(int(ms), MAX_REACTION_MS)
```
- A forged `reaction_time_ms: 1` is clamped to `65000` ms → **never wins first-correct**
- Applies to the server-authoritative ranking (CF is the primary scorer for tournament duels)

---

## Remaining Known Limitation

**Correct answer index is plaintext in RTDB** (`questions[i].correct = 2`).  
A player watching the Network tab can see the correct answer before choosing.

**Fix (deferred):** Replace `correct: N` with `correct_hash: sha256(N + secret)` in RTDB.
Store the real index only in Firestore (server-side). CF reveals the index after the reveal
phase and writes `reveal_index` to the duel node. Requires a significant refactor of
`DuelLobby.jsx`, `DuelGame.jsx`, and the CF scoring logic.
