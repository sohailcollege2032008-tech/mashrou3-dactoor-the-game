import React, { useEffect, useState, useRef, useCallback } from 'react'
import MathText from '../../components/common/MathText'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ref as rtdbRef,
  onValue,
  runTransaction,
  update,
  get as rtdbGet,
  increment,
  set,
  onDisconnect,
} from 'firebase/database'
import { rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { Loader2, Timer, WifiOff, LogOut, Flag } from 'lucide-react'

const QUESTION_DURATION_MS = 30_000
const REVEAL_DURATION_MS   = 3_000
const FORFEIT_TIMEOUT_S    = 120

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

/**
 * DuelGame can be used standalone (regular duel) or embedded in a tournament.
 * Props:
 *   duelPath          {string}  RTDB base path — default 'duels'
 *   questionDurationMs {number} override for question timer — default 30000
 *   onFinished        {fn}      called on game end instead of navigating to /duel/results
 *   duelIdOverride    {string}  use this duelId instead of the URL param
 */
export default function DuelGame({
  duelPath          = 'duels',
  questionDurationMs: propDurationMs,
  onFinished,
  duelIdOverride,
} = {}) {
  const { duelId: duelIdParam } = useParams()
  const duelId  = duelIdOverride || duelIdParam
  const navigate = useNavigate()
  const { session } = useAuth()
  const uid = session?.uid

  // Effective question duration (prop overrides constant)
  const activeDurationMs = propDurationMs || QUESTION_DURATION_MS

  const [duel, setDuel]               = useState(null)
  const [loading, setLoading]         = useState(true)
  const [timerPct, setTimerPct]       = useState(1)
  const [selectedChoice, setSelectedChoice] = useState(null)
  const [hasAnswered, setHasAnswered] = useState(false)

  // Presence
  const [watchOpponentUid, setWatchOpponentUid]   = useState(null)
  const [opponentConnected, setOpponentConnected] = useState(true)
  const [disconnectCountdown, setDisconnectCountdown] = useState(null)

  // Exit / surrender
  const [confirmAction, setConfirmAction] = useState(null) // 'forfeit' | 'surrender'
  const [actionLoading, setActionLoading] = useState(false)

  // ── Refs ─────────────────────────────────────────────────────────────────
  const duelRef             = useRef(null)
  const serverOffsetRef     = useRef(0)          // Firebase server clock offset (ms)
  const revealInProgressRef = useRef(false)      // guard for triggerReveal
  const nextInProgressRef   = useRef(false)      // guard for triggerNextOrFinish
  const timerIntervalRef    = useRef(null)
  const revealTimerRef      = useRef(null)
  const countdownIntervalRef = useRef(null)

  // server-adjusted "now"
  const serverNow = useCallback(() => Date.now() + serverOffsetRef.current, [])

  // ── Server clock offset ───────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onValue(rtdbRef(rtdb, '.info/serverTimeOffset'), snap => {
      serverOffsetRef.current = snap.val() ?? 0
    })
    return () => unsub()
  }, [])

  // Keep duelRef current
  useEffect(() => { duelRef.current = duel }, [duel])

  // ── Own presence + activeDuelId ───────────────────────────────────────────
  useEffect(() => {
    if (!duelId || !uid) return
    const presRef = rtdbRef(rtdb, `duel_presence/${duelId}/${uid}`)
    set(presRef, { connected: true })
    onDisconnect(presRef).set({ connected: false })
    localStorage.setItem('activeDuelId', duelId)
    return () => { set(presRef, { connected: false }) }
  }, [duelId, uid])

  // ── Watch opponent presence ───────────────────────────────────────────────
  useEffect(() => {
    if (!duelId || !watchOpponentUid) return
    const unsub = onValue(rtdbRef(rtdb, `duel_presence/${duelId}/${watchOpponentUid}`), snap => {
      const data = snap.val()
      setOpponentConnected(!data || data.connected !== false)
    })
    return () => unsub()
  }, [duelId, watchOpponentUid])

  // ── Disconnect countdown → auto-forfeit ──────────────────────────────────
  useEffect(() => {
    if (opponentConnected) {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
      }
      setDisconnectCountdown(null)
      return
    }
    if (countdownIntervalRef.current) return

    let secs = FORFEIT_TIMEOUT_S
    setDisconnectCountdown(secs)

    countdownIntervalRef.current = setInterval(() => {
      secs -= 1
      setDisconnectCountdown(secs)
      if (secs <= 0) {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
        const cur = duelRef.current
        if (!cur || cur.status === 'finished') return
        const oppUid = Object.keys(cur.players || {}).find(p => p !== uid)
        update(rtdbRef(rtdb, `${duelPath}/${duelId}`), {
          status: 'finished',
          forfeit_by: oppUid || null,
        }).catch(console.error)
      }
    }, 1000)

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
      }
    }
  }, [opponentConnected, duelId, duelPath, uid])

  // ── Reset per-question state ──────────────────────────────────────────────
  const lastQiRef = useRef(null)
  useEffect(() => {
    if (!duel) return
    const qi = duel.current_question_index
    if (qi !== lastQiRef.current) {
      lastQiRef.current = qi
      setSelectedChoice(null)
      setHasAnswered(false)
      revealInProgressRef.current = false
      nextInProgressRef.current   = false
    }
  }, [duel?.current_question_index])

  // ── Subscribe to duel ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!duelId) return
    const unsub = onValue(rtdbRef(rtdb, `${duelPath}/${duelId}`), snap => {
      const data = snap.val()
      setDuel(data)
      setLoading(false)
      if (data?.players && uid) {
        const oppUid = Object.keys(data.players).find(p => p !== uid)
        if (oppUid) setWatchOpponentUid(prev => prev ?? oppUid)
      }
      if (data?.status === 'finished') {
        localStorage.removeItem('activeDuelId')
        if (onFinished) {
          onFinished()
        } else {
          navigate(`/duel/results/${duelId}`, { replace: true })
        }
      }
    })
    return () => unsub()
  }, [duelId, navigate, uid])

  // ── triggerReveal: playing → revealing + compute scores ──────────────────
  const triggerReveal = useCallback(async () => {
    if (revealInProgressRef.current) return
    const currentDuel = duelRef.current
    if (!currentDuel || currentDuel.status !== 'playing') return
    revealInProgressRef.current = true

    try {
      const statusRef = rtdbRef(rtdb, `${duelPath}/${duelId}/status`)
      let iWon = false
      await runTransaction(statusRef, current => {
        if (current === 'playing') { iWon = true; return 'revealing' }
        return current
      })

      if (!iWon) { revealInProgressRef.current = false; return }

      // Only the winner of the transaction computes scores
      const qi = currentDuel.current_question_index
      const question = currentDuel.questions?.[qi]
      const answersSnap = await rtdbGet(rtdbRef(rtdb, `${duelPath}/${duelId}/answers/${qi}`))
      const allAnswers  = answersSnap.val() || {}
      const realPlayers = new Set(Object.keys(currentDuel.players || {}))
      // Only score answers from the two registered players — ignore any visitor answers
      const answers = Object.fromEntries(
        Object.entries(allAnswers).filter(([aUid]) => realPlayers.has(aUid))
      )
      const scoreUpdates = {}

      // Hybrid scoring: regular duels cap repeated questions at 1pt; tournament = pure race
      const isRegularDuel = duelPath === 'duels'
      const correctAnswers = Object.entries(answers)
        .filter(([, a]) => a.selected_choice === question?.correct)
        .sort((a, b) => (a[1].reaction_time_ms ?? 0) - (b[1].reaction_time_ms ?? 0))
      const arrivalRank = {}
      correctAnswers.forEach(([aUid], i) => { arrivalRank[aUid] = i })

      for (const [aUid, answer] of Object.entries(answers)) {
        const isCorrect = answer.selected_choice === question?.correct
        let pointsEarned = 0
        if (isCorrect) {
          const rank = arrivalRank[aUid] ?? 99
          if (isRegularDuel && question?.played_by_uids?.includes(aUid)) {
            pointsEarned = 1  // repeated question — capped at 1pt regardless of arrival rank
          } else {
            pointsEarned = rank === 0 ? 2 : 1  // race-based: 1st correct = 2pts, 2nd+ = 1pt
          }
        }

        scoreUpdates[`answers/${qi}/${aUid}/is_correct`]    = isCorrect
        scoreUpdates[`answers/${qi}/${aUid}/points_earned`] = pointsEarned
        if (isCorrect) {
          scoreUpdates[`players/${aUid}/score`] = increment(pointsEarned)
        }
      }
      scoreUpdates['reveal_started_at'] = serverNow()

      await update(rtdbRef(rtdb, `${duelPath}/${duelId}`), scoreUpdates)
    } catch (e) {
      console.error('triggerReveal error:', e)
    } finally {
      revealInProgressRef.current = false
    }
  }, [duelId, duelPath, serverNow])

  // ── triggerNextOrFinish: revealing → playing (next Q) or finished ─────────
  const triggerNextOrFinish = useCallback(async () => {
    if (nextInProgressRef.current) return
    const currentDuel = duelRef.current
    if (!currentDuel || currentDuel.status !== 'revealing') return
    nextInProgressRef.current = true

    try {
      const result = await runTransaction(
        rtdbRef(rtdb, `${duelPath}/${duelId}`),
        current => {
          if (!current || current.status !== 'revealing') return // abort

          const nextQi    = (current.current_question_index ?? 0) + 1
          const isFinished = nextQi >= current.total_questions

          if (isFinished) {
            return { ...current, status: 'finished', reveal_started_at: null }
          }
          return {
            ...current,
            status: 'playing',
            current_question_index: nextQi,
            question_started_at: serverNow(),  // server-calibrated timestamp
            reveal_started_at: null,
          }
        }
      )

      if (!result.committed) nextInProgressRef.current = false
    } catch (e) {
      console.error('triggerNextOrFinish error:', e)
      nextInProgressRef.current = false
    }
  }, [duelId, duelPath, serverNow])

  // ── Timer: question countdown ─────────────────────────────────────────────
  useEffect(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    if (!duel || duel.status !== 'playing' || !duel.question_started_at) {
      setTimerPct(1)
      return
    }

    const tick = () => {
      const elapsed = serverNow() - duel.question_started_at
      const pct     = Math.max(0, 1 - elapsed / activeDurationMs)
      setTimerPct(pct)
      if (pct <= 0) {
        clearInterval(timerIntervalRef.current)
        triggerReveal()
      }
    }
    tick()
    timerIntervalRef.current = setInterval(tick, 200)
    return () => clearInterval(timerIntervalRef.current)
  }, [duel?.status, duel?.question_started_at, triggerReveal, serverNow, activeDurationMs])

  // ── Watch answers: both answered → reveal early ───────────────────────────
  useEffect(() => {
    if (!duel || duel.status !== 'playing') return
    const qi         = duel.current_question_index
    const answers    = duel.answers?.[qi] || {}
    const playerUids = Object.keys(duel.players || {})
    // Only count answers from real players (ignore any visitor who slipped in)
    const validAnswerCount = playerUids.filter(p => p in answers).length
    if (playerUids.length >= 2 && validAnswerCount >= playerUids.length) {
      triggerReveal()
    }
  }, [duel?.answers, duel?.status, duel?.current_question_index, triggerReveal])

  // ── Timer: reveal countdown (3s) ─────────────────────────────────────────
  useEffect(() => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
    if (!duel || duel.status !== 'revealing' || !duel.reveal_started_at) return

    const elapsed   = serverNow() - duel.reveal_started_at
    const remaining = REVEAL_DURATION_MS - elapsed

    if (remaining <= 0) { triggerNextOrFinish(); return }

    revealTimerRef.current = setTimeout(triggerNextOrFinish, remaining)
    return () => clearTimeout(revealTimerRef.current)
  }, [duel?.status, duel?.reveal_started_at, triggerNextOrFinish, serverNow])

  // ── Answer submission ─────────────────────────────────────────────────────
  const submitAnswer = useCallback(async (choiceIndex) => {
    if (hasAnswered || !duel || duel.status !== 'playing' || !uid) return
    if (!duel.question_started_at) return

    const reactionTimeMs = serverNow() - duel.question_started_at
    setSelectedChoice(choiceIndex)
    setHasAnswered(true)

    const qi = duel.current_question_index
    try {
      await update(rtdbRef(rtdb, `${duelPath}/${duelId}/answers/${qi}`), {
        [uid]: { uid, selected_choice: choiceIndex, reaction_time_ms: reactionTimeMs }
      })
    } catch (e) {
      console.error('submitAnswer error:', e)
    }
  }, [hasAnswered, duel, uid, duelId, duelPath, serverNow])

  // ── Forfeit (loss) ────────────────────────────────────────────────────────
  const handleForfeit = useCallback(async () => {
    if (actionLoading) return
    setActionLoading(true)
    setConfirmAction(null)
    try {
      await update(rtdbRef(rtdb, `${duelPath}/${duelId}`), { status: 'finished', forfeit_by: uid })
    } catch (e) {
      console.error(e)
      setActionLoading(false)
    }
  }, [duelId, duelPath, uid, actionLoading])

  // ── Surrender (draw) ──────────────────────────────────────────────────────
  const handleSurrender = useCallback(async () => {
    if (actionLoading) return
    setActionLoading(true)
    setConfirmAction(null)
    try {
      await update(rtdbRef(rtdb, `${duelPath}/${duelId}`), { status: 'finished', surrender_by: uid })
    } catch (e) {
      console.error(e)
      setActionLoading(false)
    }
  }, [duelId, duelPath, uid, actionLoading])

  // ── Render guards ─────────────────────────────────────────────────────────
  if (loading || !duel) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  const qi          = duel.current_question_index ?? 0
  const question    = duel.questions?.[qi]
  const players     = duel.players || {}
  const playerUids  = Object.keys(players)
  const myPlayer    = players[uid]
  const opponentUid = playerUids.find(p => p !== uid)
  const opponentPlayer = opponentUid ? players[opponentUid] : null

  const isRevealing    = duel.status === 'revealing'
  const currentAnswers = duel.answers?.[qi] || {}
  const myAnswer       = currentAnswers[uid]
  const opponentAnswer = opponentUid ? currentAnswers[opponentUid] : null

  const timeLeftSec = Math.ceil(timerPct * (activeDurationMs / 1000))

  function choiceStyle(i) {
    if (!isRevealing && !hasAnswered) {
      return 'bg-gray-900 border border-gray-700 hover:border-primary/60 hover:bg-gray-800 text-white active:scale-95'
    }
    if (!isRevealing && hasAnswered) {
      if (i === selectedChoice) return 'bg-primary/15 border border-primary/50 text-primary'
      return 'bg-gray-900 border border-gray-800 text-gray-600'
    }
    const isCorrect  = i === question?.correct
    const wasMyChoice = i === myAnswer?.selected_choice
    if (isCorrect) return 'bg-green-500/15 border border-green-500/60 text-green-300 font-bold'
    if (wasMyChoice && !isCorrect) return 'bg-red-500/15 border border-red-500/60 text-red-400'
    return 'bg-gray-900 border border-gray-800 text-gray-600'
  }

  return (
    <div className="min-h-screen bg-background text-white flex flex-col" dir="rtl">

      {/* Disconnect banner */}
      {!opponentConnected && disconnectCountdown !== null && (
        <div className="mx-4 mt-3 z-50">
          <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <WifiOff size={16} className="text-yellow-400 flex-shrink-0" />
              <div>
                <p className="text-yellow-300 font-bold text-sm">خصمك انقطع الاتصال</p>
                <p className="text-yellow-600 text-xs">ستفوز تلقائياً إذا لم يعد خلال</p>
              </div>
            </div>
            <span className="text-yellow-300 font-mono font-bold text-2xl tabular-nums flex-shrink-0">
              {disconnectCountdown}s
            </span>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 gap-2">
        <PlayerPill player={myPlayer} score={myPlayer?.score} align="right" />

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
      <div dir={duel.force_rtl ? 'rtl' : 'ltr'} className="flex-1 flex flex-col px-4 pt-4 pb-4 gap-4 overflow-y-auto">
        <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5">
          <p dir={duel.force_rtl ? 'rtl' : 'auto'} className="text-white font-bold text-base leading-relaxed text-center">
            <MathText text={question?.question} dir={duel.force_rtl ? 'rtl' : 'auto'} />
          </p>
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
                  {myAnswer.is_correct && myAnswer.points_earned != null && (
                    <span className={`font-mono text-xs font-bold ${myAnswer.points_earned === 1 ? 'text-yellow-400' : 'text-green-400'}`}>
                      +{myAnswer.points_earned}
                    </span>
                  )}
                  <span className="font-mono text-xs text-gray-500">{myAnswer.reaction_time_ms}ms</span>
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
                  {opponentAnswer.is_correct && opponentAnswer.points_earned != null && (
                    <span className={`font-mono text-xs font-bold ${opponentAnswer.points_earned === 1 ? 'text-yellow-400' : 'text-green-400'}`}>
                      +{opponentAnswer.points_earned}
                    </span>
                  )}
                  <span className="font-mono text-xs text-gray-500">{opponentAnswer.reaction_time_ms}ms</span>
                </div>
              ) : (
                <span className="text-gray-600 text-xs">لم يجب</span>
              )}
            </div>
          </div>
        )}

        {/* Choices */}
        <div dir={duel.force_rtl ? 'rtl' : 'ltr'} className="space-y-3">
          {(question?.choices || []).map((choice, i) => (
            <button
              key={i}
              onClick={() => submitAnswer(i)}
              disabled={hasAnswered || isRevealing}
              className={`w-full flex items-center gap-3 px-4 py-4 rounded-2xl transition-all duration-150 ${choiceStyle(i)} disabled:cursor-default`}
            >
              <span className="w-7 h-7 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-xs font-bold flex-shrink-0 font-mono">
                {String.fromCharCode(65 + i)}
              </span>
              <span dir={duel.force_rtl ? 'rtl' : 'auto'} className="flex-1 text-sm font-medium leading-snug">
                <MathText text={choice} dir={duel.force_rtl ? 'rtl' : 'auto'} />
              </span>
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

      {/* Exit / Surrender bar */}
      <div className="flex items-center justify-center gap-4 px-4 pb-4 pt-1">
        <button
          onClick={() => setConfirmAction('surrender')}
          disabled={actionLoading}
          className="flex items-center gap-1.5 text-gray-600 hover:text-yellow-400 transition-colors text-xs font-bold disabled:opacity-40"
        >
          <Flag size={13} />
          استسلام (تعادل)
        </button>
        <span className="w-px h-4 bg-gray-800" />
        <button
          onClick={() => setConfirmAction('forfeit')}
          disabled={actionLoading}
          className="flex items-center gap-1.5 text-gray-600 hover:text-red-400 transition-colors text-xs font-bold disabled:opacity-40"
        >
          <LogOut size={13} />
          الخروج (خسارة)
        </button>
      </div>

      {/* Confirm overlay */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" dir="rtl">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmAction(null)} />
          <div className="relative bg-[#0D1321] border-t border-gray-700 rounded-t-2xl p-6 w-full max-w-sm space-y-4">
            <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto -mt-2 mb-2" />
            {confirmAction === 'forfeit' ? (
              <>
                <div className="text-center space-y-1">
                  <p className="text-white font-bold text-lg">الخروج من اللعبة؟</p>
                  <p className="text-gray-400 text-sm">ستُحسب خسارة حتى لو كنت متقدم بالنقاط</p>
                </div>
                <button onClick={handleForfeit} className="w-full py-3 bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 text-red-400 font-bold rounded-2xl text-sm transition-colors">
                  تأكيد الخروج
                </button>
              </>
            ) : (
              <>
                <div className="text-center space-y-1">
                  <p className="text-white font-bold text-lg">الاستسلام؟</p>
                  <p className="text-gray-400 text-sm">ستنتهي اللعبة بتعادل لكلا اللاعبَين</p>
                </div>
                <button onClick={handleSurrender} className="w-full py-3 bg-yellow-500/10 border border-yellow-500/30 hover:bg-yellow-500/20 text-yellow-400 font-bold rounded-2xl text-sm transition-colors">
                  تأكيد التعادل
                </button>
              </>
            )}
            <button onClick={() => setConfirmAction(null)} className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm font-bold transition-colors">
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
