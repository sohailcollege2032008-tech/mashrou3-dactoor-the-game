import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ref as rtdbRef,
  onValue,
  runTransaction,
  update,
  get as rtdbGet,
  increment,
} from 'firebase/database'
import { rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { Loader2, Timer } from 'lucide-react'

const QUESTION_DURATION_MS = 30_000
const REVEAL_DURATION_MS = 3_000

// ── Avatar pill ───────────────────────────────────────────────────────────────
function PlayerPill({ player, score, align = 'right' }) {
  if (!player) return <div className="w-28" />
  return (
    <div className={`flex items-center gap-2 ${align === 'left' ? 'flex-row-reverse' : ''}`}>
      {player.avatar_url ? (
        <img src={player.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border-2 border-gray-700 flex-shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center text-gray-400 text-sm font-bold flex-shrink-0">
          {(player.nickname || '?')[0]}
        </div>
      )}
      <div className={`min-w-0 ${align === 'left' ? 'text-right' : 'text-left'}`}>
        <p className="text-white text-xs font-bold truncate max-w-[72px]">{player.nickname}</p>
        <p className="text-primary text-sm font-mono font-bold">{score ?? 0}</p>
      </div>
    </div>
  )
}

// ── Timer Bar ─────────────────────────────────────────────────────────────────
function TimerBar({ pct }) {
  const color = pct > 0.5 ? '#00B8D9' : pct > 0.25 ? '#F59E0B' : '#EF4444'
  return (
    <div className="h-1 bg-gray-800 w-full">
      <div
        className="h-full transition-all duration-200"
        style={{ width: `${Math.max(0, pct * 100)}%`, backgroundColor: color }}
      />
    </div>
  )
}

export default function DuelGame() {
  const { duelId } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const uid = session?.uid

  const [duel, setDuel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [timerPct, setTimerPct] = useState(1)
  const [selectedChoice, setSelectedChoice] = useState(null)
  const [hasAnswered, setHasAnswered] = useState(false)
  const [answerTime, setAnswerTime] = useState(null)

  // Refs to avoid stale closures
  const duelRef = useRef(null)
  const transitionInProgressRef = useRef(false)
  const timerIntervalRef = useRef(null)
  const revealTimerRef = useRef(null)

  // Keep duelRef in sync
  useEffect(() => {
    duelRef.current = duel
  }, [duel])

  // Reset per-question state when question index changes
  const lastQiRef = useRef(null)
  useEffect(() => {
    if (!duel) return
    const qi = duel.current_question_index
    if (qi !== lastQiRef.current) {
      lastQiRef.current = qi
      setSelectedChoice(null)
      setHasAnswered(false)
      setAnswerTime(null)
      transitionInProgressRef.current = false
    }
  }, [duel?.current_question_index])

  // Subscribe to duel
  useEffect(() => {
    if (!duelId) return
    const ref = rtdbRef(rtdb, `duels/${duelId}`)
    const unsub = onValue(ref, snap => {
      const data = snap.val()
      setDuel(data)
      setLoading(false)
      if (data?.status === 'finished') {
        navigate(`/duel/results/${duelId}`, { replace: true })
      }
    })
    return () => unsub()
  }, [duelId, navigate])

  // ── Transition helpers ────────────────────────────────────────────────────

  const triggerReveal = useCallback(async () => {
    if (transitionInProgressRef.current) return
    const currentDuel = duelRef.current
    if (!currentDuel || currentDuel.status !== 'playing') return
    transitionInProgressRef.current = true

    try {
      const statusRef = rtdbRef(rtdb, `duels/${duelId}/status`)
      let iWon = false
      await runTransaction(statusRef, current => {
        if (current === 'playing') { iWon = true; return 'revealing' }
        return current
      })

      if (!iWon) {
        transitionInProgressRef.current = false
        return
      }

      // I won the transaction — compute scores
      const qi = currentDuel.current_question_index
      const question = currentDuel.questions[qi]
      const answersSnap = await rtdbGet(rtdbRef(rtdb, `duels/${duelId}/answers/${qi}`))
      const answers = answersSnap.val() || {}
      const scoreUpdates = {}

      for (const [aUid, answer] of Object.entries(answers)) {
        const isCorrect = answer.selected_choice === question.correct
        const pointsEarned = isCorrect ? 1 : 0
        scoreUpdates[`answers/${qi}/${aUid}/is_correct`] = isCorrect
        scoreUpdates[`answers/${qi}/${aUid}/points_earned`] = pointsEarned
        if (isCorrect) {
          scoreUpdates[`players/${aUid}/score`] = increment(1)
        }
      }
      scoreUpdates['reveal_started_at'] = Date.now()

      await update(rtdbRef(rtdb, `duels/${duelId}`), scoreUpdates)
    } catch (e) {
      console.error('triggerReveal error:', e)
    } finally {
      transitionInProgressRef.current = false
    }
  }, [duelId])

  const triggerNextOrFinish = useCallback(async () => {
    if (transitionInProgressRef.current) return
    const currentDuel = duelRef.current
    if (!currentDuel || currentDuel.status !== 'revealing') return
    transitionInProgressRef.current = true

    try {
      const statusRef = rtdbRef(rtdb, `duels/${duelId}/status`)
      let iWon = false
      await runTransaction(statusRef, current => {
        if (current === 'revealing') {
          iWon = true
          const nextQi = (currentDuel.current_question_index ?? 0) + 1
          if (nextQi >= currentDuel.total_questions) return 'finished'
          return 'playing'
        }
        return current
      })

      if (!iWon) {
        transitionInProgressRef.current = false
        return
      }

      const nextQi = (currentDuel.current_question_index ?? 0) + 1
      if (nextQi >= currentDuel.total_questions) {
        // finished — navigation handled by onValue listener
        return
      }

      await update(rtdbRef(rtdb, `duels/${duelId}`), {
        current_question_index: nextQi,
        question_started_at: Date.now(),
        reveal_started_at: null,
      })
    } catch (e) {
      console.error('triggerNextOrFinish error:', e)
    } finally {
      transitionInProgressRef.current = false
    }
  }, [duelId])

  // ── Timer: question countdown (30s) ──────────────────────────────────────
  useEffect(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    if (!duel || duel.status !== 'playing' || !duel.question_started_at) {
      setTimerPct(1)
      return
    }

    const tick = () => {
      const elapsed = Date.now() - duel.question_started_at
      const pct = Math.max(0, 1 - elapsed / QUESTION_DURATION_MS)
      setTimerPct(pct)
      if (pct <= 0) {
        clearInterval(timerIntervalRef.current)
        triggerReveal()
      }
    }
    tick()
    timerIntervalRef.current = setInterval(tick, 200)
    return () => clearInterval(timerIntervalRef.current)
  }, [duel?.status, duel?.question_started_at, triggerReveal])

  // ── Watch answers: if both answered, trigger reveal early ─────────────────
  useEffect(() => {
    if (!duel || duel.status !== 'playing') return
    const qi = duel.current_question_index
    const answers = duel.answers?.[qi] || {}
    const playerUids = Object.keys(duel.players || {})
    if (playerUids.length >= 2 && Object.keys(answers).length >= playerUids.length) {
      triggerReveal()
    }
  }, [duel?.answers, duel?.status, duel?.current_question_index, triggerReveal])

  // ── Timer: reveal countdown (3s) ─────────────────────────────────────────
  useEffect(() => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
    if (!duel || duel.status !== 'revealing' || !duel.reveal_started_at) return

    const elapsed = Date.now() - duel.reveal_started_at
    const remaining = REVEAL_DURATION_MS - elapsed

    if (remaining <= 0) {
      triggerNextOrFinish()
      return
    }
    revealTimerRef.current = setTimeout(() => {
      triggerNextOrFinish()
    }, remaining)
    return () => clearTimeout(revealTimerRef.current)
  }, [duel?.status, duel?.reveal_started_at, triggerNextOrFinish])

  // ── Answer submission ─────────────────────────────────────────────────────
  const submitAnswer = useCallback(async (choiceIndex) => {
    if (hasAnswered || !duel || duel.status !== 'playing' || !uid) return
    if (!duel.question_started_at) return

    const reactionTimeMs = Date.now() - duel.question_started_at
    setSelectedChoice(choiceIndex)
    setHasAnswered(true)
    setAnswerTime(reactionTimeMs)

    const qi = duel.current_question_index
    try {
      await update(rtdbRef(rtdb, `duels/${duelId}/answers/${qi}`), {
        [uid]: {
          uid,
          selected_choice: choiceIndex,
          reaction_time_ms: reactionTimeMs,
        }
      })
    } catch (e) {
      console.error('submitAnswer error:', e)
    }
  }, [hasAnswered, duel, uid, duelId])

  if (loading || !duel) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  const qi = duel.current_question_index ?? 0
  const question = duel.questions?.[qi]
  const players = duel.players || {}
  const playerUids = Object.keys(players)
  const myPlayer = players[uid]
  const opponentUid = playerUids.find(p => p !== uid)
  const opponentPlayer = opponentUid ? players[opponentUid] : null

  const isRevealing = duel.status === 'revealing'
  const currentAnswers = duel.answers?.[qi] || {}
  const myAnswer = currentAnswers[uid]
  const opponentAnswer = opponentUid ? currentAnswers[opponentUid] : null

  const timeLeftSec = Math.ceil(timerPct * (QUESTION_DURATION_MS / 1000))

  function choiceStyle(i) {
    if (!isRevealing && !hasAnswered) {
      return 'bg-gray-900 border border-gray-700 hover:border-primary/60 hover:bg-gray-800 text-white active:scale-95'
    }
    if (!isRevealing && hasAnswered) {
      // Waiting for reveal — show selection
      if (i === selectedChoice) {
        return 'bg-primary/15 border border-primary/50 text-primary'
      }
      return 'bg-gray-900 border border-gray-800 text-gray-600'
    }
    // Revealing
    const isCorrect = i === question?.correct
    const wasMyChoice = i === myAnswer?.selected_choice
    if (isCorrect) return 'bg-green-500/15 border border-green-500/60 text-green-300 font-bold'
    if (wasMyChoice && !isCorrect) return 'bg-red-500/15 border border-red-500/60 text-red-400'
    return 'bg-gray-900 border border-gray-800 text-gray-600'
  }

  return (
    <div className="min-h-screen bg-background text-white flex flex-col" dir="rtl">

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 gap-2">
        <PlayerPill player={myPlayer} score={myPlayer?.score} align="right" />

        {/* Center: counter + timer */}
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
          <p className="text-xs text-gray-500 font-mono">{qi + 1}/{duel.total_questions}</p>
          <div className="flex items-center gap-1">
            <Timer size={12} className="text-primary" />
            <span className={`text-lg font-bold font-mono tabular-nums ${timeLeftSec <= 5 ? 'text-red-400' : 'text-white'}`}>
              {duel.status === 'revealing' ? '✓' : timeLeftSec}
            </span>
          </div>
        </div>

        <PlayerPill player={opponentPlayer} score={opponentPlayer?.score} align="left" />
      </div>

      {/* Timer bar */}
      <TimerBar pct={duel.status === 'revealing' ? 0 : timerPct} />

      {/* Question */}
      <div className="flex-1 flex flex-col px-4 pt-4 pb-4 gap-4 overflow-y-auto">
        <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5">
          <p className="text-white font-bold text-base leading-relaxed text-center">{question?.question}</p>
          {question?.image_url && (
            <img
              src={question.image_url}
              alt="question"
              className="mt-4 w-full max-h-48 object-contain bg-gray-900 rounded-xl border border-gray-700"
            />
          )}
        </div>

        {/* Reveal mini-result */}
        {isRevealing && (
          <div className="flex items-center justify-center gap-6 py-2">
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-1">أنت</p>
              {myAnswer ? (
                <div className={`flex items-center gap-1 text-sm font-bold ${myAnswer.is_correct ? 'text-green-400' : 'text-red-400'}`}>
                  <span>{myAnswer.is_correct ? '✓' : '✗'}</span>
                  <span className="font-mono text-xs text-gray-400">{myAnswer.reaction_time_ms}ms</span>
                </div>
              ) : (
                <span className="text-gray-600 text-xs">لم تجب</span>
              )}
            </div>
            <div className="w-px h-8 bg-gray-700" />
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-1">خصمك</p>
              {opponentAnswer ? (
                <div className={`flex items-center gap-1 text-sm font-bold ${opponentAnswer.is_correct ? 'text-green-400' : 'text-red-400'}`}>
                  <span>{opponentAnswer.is_correct ? '✓' : '✗'}</span>
                  <span className="font-mono text-xs text-gray-400">{opponentAnswer.reaction_time_ms}ms</span>
                </div>
              ) : (
                <span className="text-gray-600 text-xs">لم يجب</span>
              )}
            </div>
          </div>
        )}

        {/* Choices */}
        <div className="space-y-3">
          {(question?.choices || []).map((choice, i) => (
            <button
              key={i}
              onClick={() => submitAnswer(i)}
              disabled={hasAnswered || isRevealing}
              className={`w-full flex items-center gap-3 px-4 py-4 rounded-2xl text-right transition-all duration-150 ${choiceStyle(i)} disabled:cursor-default`}
            >
              <span className="w-7 h-7 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-xs font-bold flex-shrink-0 font-mono">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1 text-sm font-medium leading-snug">{choice}</span>
              {isRevealing && i === question?.correct && (
                <span className="text-green-500 font-bold flex-shrink-0">✓</span>
              )}
            </button>
          ))}
        </div>

        {/* Waiting indicator */}
        {hasAnswered && !isRevealing && (
          <div className="flex items-center justify-center gap-2 text-gray-500 text-sm py-2">
            <Loader2 size={14} className="animate-spin text-primary" />
            في انتظار الخصم...
          </div>
        )}
      </div>
    </div>
  )
}
