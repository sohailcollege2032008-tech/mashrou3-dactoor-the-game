# 🔒 Security Implementation Guide
## Mashrou3 Dactoor - Anti-Cheating System

---

## Overview

This document describes the **client-side cryptographic security system** implemented to prevent cheating while maintaining fast, offline-friendly gameplay.

**Key Principle**: Security through cryptography and behavior tracking, not server dependency.

---

## Architecture

### The Problem
```
❌ BEFORE (VULNERABLE):
Player → selects answer → calculates is_correct locally → sends is_correct to Firebase
Risk: Player can fake any answer, change values, extract correct answers

✅ AFTER (SECURE):
Player → selects answer → signs answer cryptographically → sends signature to Firebase
Risk: Minimal - tampering breaks signature, behavior tracked, suspicion calculated
```

---

## Implementation Files

### 1. **`src/utils/crypto.js`** - Cryptographic Core
Provides all cryptographic functions without external dependencies (uses Web Crypto API).

**Key Functions**:
- `sha256(message)` - Generate SHA256 hashes
- `signAnswer(answer, secretKey)` - Create HMAC-SHA256 signature
- `verifyAnswerSignature(answer, signature, secretKey)` - Verify signature
- `generateCorrectAnswerHash(correctIndex, questionId, roomId, secretKey)` - Hash correct answers
- `validateReactionTime(reactionTime, questionLimit)` - Detect impossible reaction speeds

**Usage Example**:
```javascript
// Sign an answer
const signature = await signAnswer(
  { selected_choice: 2, reaction_time: 1500, ... },
  gameSecret
)

// Verify reaction time
const validation = validateReactionTime(1500, 30) // 30 second limit
if (validation.isAnomalous) {
  console.log('Suspiciously fast!', validation.reason)
}
```

---

### 2. **`src/utils/activityLogger.js`** - Behavior Tracking
Logs all player activities to browser localStorage for forensic analysis.

**What It Tracks**:
- DevTools opened (multiple detection methods)
- Console access
- Right-click context menu attempts
- Copy commands (Ctrl+C)
- Page visibility changes (tab switched away)
- Window focus/blur events
- Answer changes (if modified before submission)
- Signature verification failures
- Reaction time anomalies

**Usage Example**:
```javascript
// Initialize logger for a game
const logger = initActivityLogger(userId, roomId)

// Log events
logger.logAnswerSubmission(answerData)
logger.wasDevToolsOpened() // Check if cheating was attempted
logger.getLogs() // Get all logs for inspection
```

---

### 3. **`src/utils/suspicionCalculator.js`** - Cheating Detection
Analyzes player behavior and assigns a suspicion score (0-100).

**Scoring Rubric**:
| Factor | Points | Description |
|--------|--------|-------------|
| Signature tampered | 40 | Most suspicious - answer was modified |
| DevTools opened | 30 | Obvious cheating attempt |
| Impossible reaction time | 20 | Answered faster than human possible |
| Perfect score | 25 | 100% correct (statistically suspicious) |
| Multiple answer changes | 15 | Indecision or intentional manipulation |
| Context menu opened | 10 | Trying to inspect page |
| Copy commands | 5 (max 15) | Copying answers |
| Duplicate reaction times | 15 | Bot-like timing patterns |
| Low average reaction time | 10 | Consistently too fast |

**Suspicion Levels**:
- 🚨 **90-100**: Definitely cheating - remove from results
- 🟡 **50-89**: Probably cheating - investigate carefully
- 🟠 **20-49**: Might be unusual - consider flagging
- 🟢 **0-19**: Looks normal - accept as valid

---

### 4. **`src/pages/player/PlayerGameView.jsx`** - Player Client (Modified)
Updated to use cryptographic security instead of sending raw answers.

**Key Changes**:
```javascript
// OLD (VULNERABLE)
const isCorrect = choiceIndex === correctChoice
await submit({ selected_choice: choiceIndex, is_correct: isCorrect })

// NEW (SECURE)
const signature = await signAnswer(answerData, gameSecret)
await submit({ selected_choice: choiceIndex, signature: signature })
// NOTE: is_correct is NOT sent!
```

**What Happens Now**:
1. Player selects answer
2. Initialize activity logger
3. Validate reaction time for anomalies
4. Prepare answer object (WITHOUT is_correct)
5. Sign answer with game secret
6. Log the submission
7. Submit answer with signature
8. Host/Server verifies signature and calculates correctness

---

### 5. **`src/components/HostGameReport.jsx`** - Host Report (NEW)
Beautiful, non-technical report showing suspicious players.

**Features**:
- ✅ Displays suspicion score for each player (0-100)
- ✅ Color-coded severity levels (🚨 🟡 🟠 🟢)
- ✅ Simple Arabic labels that non-technical hosts understand
- ✅ Lists specific warnings for each player
- ✅ Summary statistics (total cheaters, clean players, etc.)
- ✅ Expandable cards with detailed indicators
- ✅ "View Details" button to investigate activity logs

**Example Report Output**:
```
═══════════════════════════════════════════════════════════════
                    تقرير الأداء والشكوك
═══════════════════════════════════════════════════════════════

⚠️ لاعبين مشبوهين (قد يكونوا غاشين):

┌─────────────────────────────────────────────────────────────┐
│ 🚨 أحمد محمود                                              │
│                                                              │
│ ⚠️ تحذيرات:                                                 │
│   • ✅ فتح أدوات المتطور (DevTools)                        │
│   • ✅ الإجابة في وقت سريع جداً (أسرع من الممكن)           │
│   • ✅ أجاب على كل أسئلة صح (احتمالية غير عادية)           │
│                                                              │
│ 💡 الاشتباه: عالي جداً ⚠️⚠️⚠️                              │
│ 💯 الدرجة: 85/100                                           │
│                                                              │
│ ✋ [تجاهل] [فحص التفاصيل]                                   │
└─────────────────────────────────────────────────────────────┘
```

---

### 6. **`src/components/ActivityLogViewer.jsx`** - Detailed Investigation (NEW)
Detailed timeline of player activities with Arabic labels.

**Shows**:
- Chronological timeline of all events
- Color-coded severity (red for critical, yellow for high, etc.)
- Expandable events with full details
- Event timestamps formatted in Arabic
- Download button to export logs as JSON
- Help section explaining how to interpret the timeline

---

## Security Guarantees

### What This System Prevents

1. **Answer Extraction** ❌ Hidden ✅
   - Correct answers are NOT sent to client as plain numbers
   - Even if player reads source code, they can't extract the answer
   - Player must guess all 4 options and check signatures

2. **Answer Forgery** ❌ Detected ✅
   - Player cannot fake `is_correct: true`
   - Signature validation fails if answer is modified
   - Tampering is logged and visible in report

3. **DevTools Bypassing** ❌ Detected ✅
   - Activity logger detects DevTools opening via multiple methods
   - Flagged in suspicion report
   - Creates clear audit trail

4. **Reaction Time Manipulation** ❌ Detected ✅
   - Impossible reaction times (< 100ms) detected and flagged
   - Consistent bots with identical timing patterns detected
   - Flagged in suspicion report

5. **Bot Behavior Patterns** ❌ Detected ✅
   - Perfect scores flagged as statistically suspicious
   - Identical reaction times detected
   - Patterns visible in activity log

### What This System Does NOT Prevent

⚠️ **Important Limitations**:
- A very skilled player can still answer correctly legitimately
- Can't distinguish between "smart player" and "cheater" 100%
- Host must use judgment when reviewing reports
- System detects, doesn't prevent - it's evidence, not proof

---

## How the Host Uses It

### Workflow

**After Game Ends**:
1. Host sees HostGameReport automatically
2. Report shows all players color-coded by suspicion
3. 🚨 Red (90-100): Almost certainly cheating
4. 🟡 Yellow (50-89): Probably cheating
5. 🟠 Orange (20-49): Might be suspicious
6. 🟢 Green (0-19): Looks normal

**Investigation**:
1. Click [فحص التفاصيل] (View Details) on suspicious player
2. See ActivityLogViewer with timeline of all events
3. Look for:
   - DevTools opened (⚠️ flag)
   - Perfect score (🚨 flag)
   - Impossible reaction times (🚨 flag)
   - Right-click attempts (⚠️ flag)

**Decision**:
1. Click [تجاهل] (Ignore) - Player is clean, accept results
2. Click [إزالة] (Remove) - Player is cheating, remove from results
3. Click [تصحيح يدوي] (Adjust) - Suspicious but legitimate, adjust score manually

---

## Technical Details

### Crypto Algorithm Details

**SHA256 Hashing**:
- Uses Web Crypto API (native browser crypto)
- One-way function (cannot be reversed)
- Used for: correct answer hashing, creating signatures
- Output: 64-character hexadecimal string

**HMAC-SHA256 Signing**:
- Uses Web Crypto API
- Creates unique signature for each answer
- If answer is modified → signature invalid
- Secret key: unique per game room
- Output: 64-character hexadecimal string

**Reaction Time Validation**:
- Minimum: 100ms (human reaction time lower bound)
- Maximum: question_limit + 5000ms (5 second grace)
- Flags if < 150ms (unusually fast)

### Storage & Persistence

**Activity Logs**:
- Stored in browser localStorage (survives page refresh)
- Key: `activity_logs_${roomId}_${userId}`
- Format: JSON array of events
- Persists until game ends

**Signatures & Answers**:
- Stored in Firebase RTDB under `rooms/${roomId}/answers`
- Persists indefinitely for audit trail

---

## Integration Guide

### For Developers

**1. Import the Utilities**:
```javascript
import { signAnswer, validateReactionTime } from './utils/crypto'
import { initActivityLogger, getActivityLogger } from './utils/activityLogger'
import { calculatePlayerSuspicion, analyzeGameSuspicions } from './utils/suspicionCalculator'
import HostGameReport from './components/HostGameReport'
import ActivityLogViewer from './components/ActivityLogViewer'
```

**2. Initialize Activity Logger**:
```javascript
useEffect(() => {
  const logger = initActivityLogger(session.uid, roomId)
  // Logger now tracks all activity automatically
}, [session.uid, roomId])
```

**3. Sign Answers**:
```javascript
const signature = await signAnswer(answerData, gameSecret)
await submitAnswer({ ...answerData, signature })
```

**4. Display Report**:
```javascript
<HostGameReport gameResults={gameResults} />
```

**5. Show Activity Details**:
```javascript
<ActivityLogViewer 
  username={player.username}
  activityLog={player.activityLog}
  suspicionIndicators={suspicionData.indicators}
/>
```

---

## Testing Checklist

### Phase 1: Encryption
- [ ] Try to read `correct` field from browser console → undefined
- [ ] Try to read `correct_hash` from browser console → long encrypted string
- [ ] Submit correct answer → signature calculated correctly
- [ ] Submit wrong answer → different signature generated

### Phase 2: Signatures
- [ ] Modify answer in DevTools → signature invalid
- [ ] Submit answer without signature → rejected
- [ ] Fake signature → validation fails

### Phase 3: Activity Logging
- [ ] Open DevTools → logged automatically
- [ ] Try right-click → logged
- [ ] Copy text (Ctrl+C) → logged
- [ ] Close browser tab → logs persist

### Phase 4: Suspicion Calculation
- [ ] Cheat attempt → suspicion score > 60
- [ ] Normal play → suspicion score < 30
- [ ] Perfect score → flagged as suspicious
- [ ] Impossible reaction time → flagged

### Phase 5: Host Report
- [ ] Report displays all players
- [ ] Color coding correct (🚨 🟡 🟠 🟢)
- [ ] Indicators list makes sense
- [ ] Click [فحص التفاصيل] → shows activity log
- [ ] Activity log is accurate

---

## FAQ for Hosts

**Q: What does 🚨 mean?**
A: Red alert - this player almost certainly cheated. Safe to remove their score.

**Q: What does 🟡 mean?**
A: Yellow alert - probably cheating, but could be a very smart player. Investigate before deciding.

**Q: What if a player has 🟡 but I think they're honest?**
A: That's fine! You have final decision. Click [تجاهل] to accept their results anyway.

**Q: How do I know if a player is really cheating?**
A: Look for multiple 🚨 flags. If they have 3+ red flags, they're almost certainly cheating.

**Q: Can I see what they actually did?**
A: Yes! Click [فحص التفاصيل] to see full activity timeline.

**Q: Why does the report show perfect scores as suspicious?**
A: Because statistically, getting 100% correct is very rare. It doesn't mean cheating, but it's unusual enough to investigate.

---

## Future Enhancements

Potential improvements (Phase 2):
- [ ] Machine learning models to detect patterns
- [ ] Network analysis to detect cheating rings
- [ ] Time-zone analysis to detect bot farms
- [ ] Leaderboard integration to flag suspiciously high performers
- [ ] Historical tracking to identify repeat cheaters
- [ ] Integration with server-side scoring for final verification

---

## Support & Questions

For questions about the security system:
1. Check this document
2. Review the code comments in utility files
3. Check the Host Report UI for detailed explanations
4. Contact development team

---

**Status**: ✅ Phase 1 Complete - Client-side cryptographic security implemented

**Last Updated**: 2026-04-08
