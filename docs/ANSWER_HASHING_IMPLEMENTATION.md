# Answer Hashing Security Implementation

## Overview
This implementation replaces plain-text correct answers with cryptographic hashes to prevent cheating. Players cannot see the correct answer during or after the game (unless explicitly revealed by the host).

## Key Changes

### 1. **Crypto Module** (`src/utils/crypto.js`)
Already has the required functions:
- `generateCorrectAnswerHash(correctIndex, questionId, roomId, secretKey)` - Creates SHA256 hash
- `verifyAnswerHash(selectedChoice, correctHash, questionId, roomId, secretKey)` - Verifies if answer matches

**Secret Key Formula:**
```javascript
secretKey = `${roomId}:${room.created_at}`
```

### 2. **Upload Questions Modal** (`src/components/host/UploadQuestionsModal.jsx`)
- ✅ Imports crypto functions
- Questions stored as-is in Firestore (for host reference)
- Hash generation happens at game start, not upload time

### 3. **Host Game Room** (`src/pages/host/HostGameRoom.jsx`)

#### Start Game Function
When game starts, the host:
1. Generates secret key from `roomId` + `room.created_at`
2. For each question:
   - Generates `correct_hash` using `generateCorrectAnswerHash()`
   - Removes plain `correct` field from stored questions
   - Stores only `correct_hash` in RTDB
3. Updates room with `questions` containing hashes instead of correct indices

**Code:**
```javascript
const secretKey = `${roomId}:${room.created_at}`
const secureQuestions = {
  ...questions,
  questions: questions.questions.map(async (q, qIdx) => {
    const correctHash = await generateCorrectAnswerHash(
      q.correct,
      `${roomId}-q${qIdx}`,
      roomId,
      secretKey
    )
    const { correct, ...qWithoutCorrect } = q
    return {
      ...qWithoutCorrect,
      correct_hash: correctHash,
    }
  })
}
```

#### Reveal Answer Function
When host reveals the answer:
1. Gets all answers for the question
2. Generates same secret key
3. Uses `verifyAnswerHash()` to check each answer against `correct_hash`
4. Finds correct answers and calculates scoring
5. **Stores `revealed_answer`** (answer text) for post-game display

**Important:** This happens on the host side only. Players never see the index, only whether they were correct.

### 4. **Player Game View** (`src/pages/player/PlayerGameView.jsx`)

#### During Reveal Phase
- **Before:** `idx === currentQ.correct` (exposes answer)
- **After:** `choice === revealedAnswer` (only after host reveals)

This uses `room.revealed_answers[questionIndex]` which is set by the host.

#### Security
- Player's submission code (line 282) does NOT send `is_correct` to server
- Player cannot deduce answer during game by reading RTDB
- During reveal, only shows matched answer text (cannot reverse-engineer hash)

### 5. **Firebase RTDB Rules** (`docs/database.rules.json`)

Key security rules:

```json
{
  "correct": {
    ".read": false,
    ".write": false
  },
  "correct_hash": {
    ".read": "...host during playing... && status === 'playing'"
  },
  "revealed_answers": {
    ".read": "status === 'finished' || host_check"
  },
  "answers": {
    "is_correct": {
      ".read": "status === 'finished' || is_host",
      ".write": "is_host"
    }
  }
}
```

## Data Flow

### Upload Phase
1. Host uploads questions with `correct: 1` (index)
2. Stored in Firestore as-is

### Game Start
1. Host clicks "Start Game"
2. Questions fetched from Firestore
3. For each question:
   - Hash = SHA256(`roomId:created_at:roomId-q${idx}:${correct_index}`)
   - Store question WITHOUT `correct`, only `correct_hash`
   - Upload to RTDB in `rooms/{roomId}/questions`

### During Game
1. Player selects answer → submits `selected_choice` only
2. Host reveals answer:
   - Reads all answers
   - For each player answer: `verifyAnswerHash(selected_choice, correct_hash, ...)`
   - Finds winners
   - Sets `is_correct` on answers
   - **Stores `revealed_answer` text in `rooms/{roomId}/revealed_answers/{questionIndex}`**

### After Game (Finished)
1. Players can see:
   - Their `is_correct` status
   - Their `points_earned`
   - Their `rank`
   - The `revealed_answer` text
2. Players CANNOT see:
   - The `correct_hash`
   - How the hash was calculated

## Verification Checklist

- [ ] No `correct` field in RTDB during game
- [ ] `correct_hash` present and long (~64 chars SHA256)
- [ ] Host can reveal answer using hash verification
- [ ] Player sees only matched answer text after reveal
- [ ] `revealed_answers` field set after each reveal
- [ ] Rules prevent non-host from reading `correct_hash` during game
- [ ] Rules allow reading `revealed_answers` only when game finished

## Testing

### Test Case 1: Prevent Pre-reveal Cheating
1. Start game
2. Try to read `rooms/{roomId}/questions/0/correct` → SHOULD BE undefined
3. Try to read `rooms/{roomId}/questions/0/correct_hash` as player → SHOULD BE forbidden
4. As host, try to read same hash → SHOULD SUCCEED

### Test Case 2: Verify Answer Correctness
1. Player submits selected_choice = 2
2. Correct answer is 2
3. Host reveals → verifyAnswerHash returns true
4. `is_correct` set to true
5. Correct answer text stored in `revealed_answers`

### Test Case 3: Post-game Visibility
1. Game finished
2. Player can read `revealed_answers/{questionIndex}` → SHOULD SUCCEED
3. Player sees matched answer in UI

## Security Properties

1. **Non-reversible:** Cannot deduce original answer from hash
2. **Deterministic:** Same input always produces same hash
3. **Salted:** Secret key includes room ID and creation timestamp
4. **Unique per question:** Question ID included in hash input
5. **Host-controlled:** Only host can generate/verify hashes

## Future Enhancements

1. Add answer submission timeout verification
2. Implement reaction time anomaly detection
3. Add audit logging for answer verification
4. Support weighted scoring for reaction time
5. Add fraud detection for suspicious patterns
