/**
 * gameRunner.js
 * Shared game automation logic — used by both HostGameRoom and the
 * unattended-mode player-driven runner so the game can progress
 * even when the host is not connected.
 */
import { ref, get, update, set } from 'firebase/database'
import { rtdb } from '../lib/firebase'
import { verifyAnswerHash } from './crypto'

/**
 * Reveal the current question: verify answers, calculate scores,
 * update leaderboard, and advance room status to 'revealing'.
 *
 * @param {string}   roomId
 * @param {object}   room     - current room snapshot value
 * @param {object[]} players  - array of player objects { user_id, nickname, score, ... }
 */
export async function performReveal(roomId, room, players) {
  const qIdx           = room.current_question_index
  const currentQuestion = room.questions.questions[qIdx]
  const correctHash    = currentQuestion.correct_hash
  const secretKey      = `${roomId}:${room.created_at}`
  const config         = room.config || { scoring_mode: 'classic' }

  // ── Fetch all answers ────────────────────────────────────────────────────
  const answersSnap = await get(ref(rtdb, `rooms/${roomId}/answers/${qIdx}`))
  const allAnswers  = answersSnap.exists() ? Object.values(answersSnap.val()) : []

  // ── Verify each answer against hash ─────────────────────────────────────
  const correct = []
  for (const answer of allAnswers) {
    const isCorrect = await verifyAnswerHash(
      answer.selected_choice,
      correctHash,
      `${roomId}-q${qIdx}`,
      roomId,
      secretKey
    )
    if (isCorrect) correct.push(answer)
  }
  correct.sort((a, b) => a.reaction_time_ms - b.reaction_time_ms)

  // ── Scoring helper ───────────────────────────────────────────────────────
  const getPoints = (rank0) => {
    const {
      scoring_mode,
      first_correct_points: N = 3,
      other_correct_points: M = 1,
      points_decrement: X     = 1,
    } = config
    if (scoring_mode === 'classic') return rank0 === 0 ? 1 : 0
    if (scoring_mode === 'custom')  return rank0 === 0 ? N : M
    if (scoring_mode === 'ranked')  return Math.max(0, N - rank0 * X)
    return 0
  }

  const scoreUpdates  = {}
  const answerUpdates = {}

  // ── Batch-read current scores ────────────────────────────────────────────
  const toUpdate   = correct.filter((_, i) => getPoints(i) > 0)
  const scoreSnaps = await Promise.all(
    toUpdate.map(a => get(ref(rtdb, `rooms/${roomId}/players/${a.user_id}/score`)))
  )

  const newScoreById = {}
  players.forEach(p => { newScoreById[p.user_id] = p.score })

  toUpdate.forEach((a, idx) => {
    const pts      = getPoints(correct.indexOf(a))
    const newScore = (scoreSnaps[idx].val() || 0) + pts
    scoreUpdates[`rooms/${roomId}/players/${a.user_id}/score`]                   = newScore
    answerUpdates[`rooms/${roomId}/answers/${qIdx}/${a.user_id}/points_earned`]  = pts
    newScoreById[a.user_id] = newScore
  })

  correct.forEach((a, i) => {
    answerUpdates[`rooms/${roomId}/answers/${qIdx}/${a.user_id}/rank`]             = i + 1
    answerUpdates[`rooms/${roomId}/answers/${qIdx}/${a.user_id}/is_first_correct`] = i === 0
    answerUpdates[`rooms/${roomId}/answers/${qIdx}/${a.user_id}/is_correct`]       = true
  })

  // ── Build leaderboard ────────────────────────────────────────────────────
  const sortedPlayers = [...players]
    .map(p => ({ ...p, score: newScoreById[p.user_id] ?? p.score }))
    .sort((a, b) => b.score - a.score)

  const top5 = sortedPlayers.slice(0, 5).map((p, i) => ({
    rank:     i + 1,
    user_id:  p.user_id,
    nickname: p.nickname,
    score:    newScoreById[p.user_id] ?? p.score,
  }))

  const rankUpdates = { [`rooms/${roomId}/leaderboard/top5`]: top5 }
  sortedPlayers.forEach((p, i) => {
    rankUpdates[`rooms/${roomId}/players/${p.user_id}/rank`] = i + 1
  })

  // ── Reveal data ──────────────────────────────────────────────────────────
  const winner  = correct[0] || null
  const winners = correct.map((a, i) => ({
    user_id:  a.user_id,
    nickname: a.player_name || 'Unknown',
    time_ms:  a.reaction_time_ms,
    points:   getPoints(i),
    rank:     i + 1,
  }))

  const revealData = {
    winner_nickname: winner?.player_name || null,
    winner_time_ms:  winner?.reaction_time_ms || null,
    correct_count:   correct.length,
    winners,
  }

  // ── Find correct answer text ─────────────────────────────────────────────
  let correctIdx = -1
  for (let i = 0; i < currentQuestion.choices.length; i++) {
    const isMatch = await verifyAnswerHash(
      i,
      currentQuestion.correct_hash,
      `${roomId}-q${qIdx}`,
      roomId,
      secretKey
    )
    if (isMatch) { correctIdx = i; break }
  }
  const correctAnswerText = currentQuestion.choices[correctIdx] || 'Not available'

  // ── Write everything atomically ──────────────────────────────────────────
  await update(ref(rtdb), {
    ...scoreUpdates,
    ...answerUpdates,
    ...rankUpdates,
    [`rooms/${roomId}/status`]:                        'revealing',
    [`rooms/${roomId}/reveal_data`]:                   revealData,
    [`rooms/${roomId}/revealed_answers/${qIdx}`]:      correctAnswerText,
    [`rooms/${roomId}/revealed_correct_index`]:        correctIdx,
  })

  return { revealData, sortedPlayers }
}

/**
 * Advance to the next question (or finish the game if it was the last one).
 *
 * @param {string} roomId
 * @param {object} room     - current room snapshot value
 * @param {string} hostUid  - host's Firebase Auth UID (to clear active room entry)
 */
export async function performNextQuestion(roomId, room, hostUid) {
  const isFinished = room.current_question_index + 1 >= room.questions.questions.length
  if (isFinished) {
    await update(ref(rtdb, `rooms/${roomId}`), { status: 'finished' })
    if (hostUid) {
      await set(ref(rtdb, `host_rooms/${hostUid}/active`), null)
    }
    return 'finished'
  } else {
    await update(ref(rtdb, `rooms/${roomId}`), {
      status:                  'playing',
      current_question_index:  room.current_question_index + 1,
      question_started_at:     Date.now(),
      reveal_data:             null,
      revealed_correct_index:  null,
      countdown_started_at:    null,
      countdown_duration:      null,
    })
    return 'playing'
  }
}
