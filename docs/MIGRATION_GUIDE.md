# Answer Hashing Migration Guide

## Implementation Status

### Completed Changes

1. **Added Crypto Imports**
   - `HostGameRoom.jsx`: Added `generateCorrectAnswerHash`, `verifyAnswerHash`
   - `PlayerGameView.jsx`: Fixed import to use correct function names

2. **Modified Start Game Flow**
   - Secret key generated: `${roomId}:${room.created_at}`
   - Questions processed to replace `correct` with `correct_hash`
   - Hashes generated using SHA256 with room-specific salt
   - Stored in RTDB without exposing plain answer indices

3. **Updated Answer Reveal Logic**
   - Uses `verifyAnswerHash()` instead of direct comparison
   - Calculates winners by hash verification
   - Stores `revealed_answer` (text) after reveal for post-game display

4. **Protected Player View**
   - Player reveal display uses `room.revealed_answers[questionIndex]`
   - No longer exposes `currentQ.correct` field
   - Shows matched answer text only after host reveals

5. **Firebase Rules Document Created**
   - `docs/database.rules.json` contains complete rules
   - Restricts `correct_hash` reading to host during game
   - Allows `revealed_answers` reading after game finishes
   - Prevents plain `correct` field entirely

## Files Modified

```
src/components/host/UploadQuestionsModal.jsx
  ├─ Added crypto import
  └─ Kept questions stored as-is (hashing happens at start)

src/pages/host/HostGameRoom.jsx
  ├─ Added crypto imports (generateCorrectAnswerHash, verifyAnswerHash)
  ├─ Modified startGame() to generate and store hashes
  ├─ Modified revealAnswer() to verify using hashes
  └─ Added revealed_answer storage

src/pages/player/PlayerGameView.jsx
  ├─ Fixed crypto import (removed verifyReactionTime)
  ├─ Added activity logging and signing
  └─ Modified reveal display to use revealed_answers text
```

## Files Created

```
docs/database.rules.json
  └─ Complete Firebase RTDB security rules

docs/ANSWER_HASHING_IMPLEMENTATION.md
  └─ Technical implementation details

docs/MIGRATION_GUIDE.md (this file)
  └─ Migration instructions and summary
```

## Deployment Checklist

### Before Deploying

- [ ] Build passes: `npm run build` (VERIFIED)
- [ ] No console errors in dev environment
- [ ] Test against actual Firebase instance
- [ ] Review database.rules.json with your database admin

### Firebase RTDB Rules Deployment

1. Go to Firebase Console → Realtime Database → Rules
2. Copy content from `docs/database.rules.json`
3. Replace existing rules
4. Click "Publish"
5. Test:
   - [ ] Players cannot read `correct_hash` during game
   - [ ] Host can read `correct_hash` during game (playing status only)
   - [ ] `revealed_answers` readable after game finished
   - [ ] No plain `correct` field accessible anywhere

### Code Deployment

1. Merge PR to main branch
2. Verify build passes in CI/CD
3. Deploy to staging first
4. Run test scenarios (see Testing section)
5. Deploy to production

## Testing Scenarios

### Scenario 1: Game Start Without Cheating
```
1. Host uploads questions with correct answers
2. Host starts game
3. Check Firebase RTDB path: rooms/{roomId}/questions/questions/0
   ✓ Should NOT have "correct" field
   ✓ Should have "correct_hash" field (long string)
4. As player, try to read correct_hash
   ✓ Should be forbidden (403)
5. As host, try to read correct_hash
   ✓ Should succeed
```

### Scenario 2: Answer Reveal
```
1. Players submit answers
2. Host clicks "Reveal Answer"
3. Check Firebase RTDB path: rooms/{roomId}/answers/0/{playerId}
   ✓ Should have "is_correct" set to true/false
   ✓ Should have "points_earned"
4. Check Firebase RTDB path: rooms/{roomId}/revealed_answers/0
   ✓ Should contain answer text (not index)
5. Players see matching answer highlighted in reveal phase
```

### Scenario 3: End Game Visibility
```
1. Host finishes game
2. Game status becomes "finished"
3. As player, try to read revealed_answers
   ✓ Should succeed (game is finished)
4. In UI, players see correct answer text
   ✓ Should match the revealed_answer value
```

## Known Limitations

1. **Client-side hashing:** Hashes generated on client (host). In production, consider backend verification for maximum security.
2. **No rate limiting:** No built-in protection against rapid answer submission attempts.
3. **Stored questions:** Original questions with plain answers stay in Firestore for host reference. Consider additional access controls in Firestore rules.

## Future Enhancements

1. **Backend hash verification:** Move hash generation to Cloud Functions for additional security layer
2. **Answer audit logging:** Log all answer verification attempts
3. **Anti-cheating detection:** Analyze patterns (reaction times, accuracy) for suspicious activity
4. **Blind reveal:** Show answer without revealing which choice was correct until all players have seen
5. **Decoy hashing:** Generate decoy hashes to prevent frequency analysis

## Troubleshooting

### Issue: Players can see correct answer during game
**Cause:** Firebase rules not published or incorrect rules
**Fix:**
1. Check Firebase Console rules are actually published
2. Verify rules match `docs/database.rules.json`
3. Clear browser cache and reload
4. Check JWT token includes `isHost` claim if using custom auth

### Issue: Hash verification fails at reveal
**Cause:** Secret key mismatch or wrong question ID format
**Fix:**
1. Verify `room.created_at` is set when room created
2. Check question ID format: `${roomId}-q${qIdx}` must be consistent
3. Ensure no timezone issues with timestamps
4. Log the secret key being used for debugging

### Issue: revealed_answers not appearing
**Cause:** Reveal logic not setting the field
**Fix:**
1. Check `revealAnswer()` function is storing the answer text
2. Verify the selected answer index is valid
3. Check for errors in browser console during reveal
4. Test with a confirmed correct answer first

## Rollback Plan

If issues arise:

1. **Code Rollback:**
   ```bash
   git revert <commit-hash>
   npm run build
   deploy-to-staging
   ```

2. **Database Rollback:**
   - Revert to previous Firebase rules version
   - OR use temporary rule allowing both `correct` and `correct_hash`
   - Then migrate users to new format gradually

3. **Data Recovery:**
   - Original questions stored in Firestore (unaffected)
   - Game history accessible (answers stored with is_correct)
   - Can reconstruct player scoring from answer data

## Support

For questions or issues:
1. Check `docs/ANSWER_HASHING_IMPLEMENTATION.md` for detailed technical info
2. Review Firebase rules in `docs/database.rules.json`
3. Check browser console for error messages
4. Verify all imports and async/await are correct in modified files
