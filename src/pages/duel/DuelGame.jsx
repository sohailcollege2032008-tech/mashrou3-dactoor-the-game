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
import { findCorrectForDuel } from '../../utils/crypto'
import { WifiOff, LogOut, Flag } from 'lucide-react'

const QUESTION_DURATION_MS = 30_000
const REVEAL_DURATION_MS   = 3_000
const FORFEIT_TIMEOUT_S    = 120

// ── Editorial player pill ─────────────────────────────────────────────────────
function PlayerPill({ player, score, align = 'right' }) {
  if (!player) return <div style={{ width: 100 }} />
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: align === 'left' ? 'row-reverse' : 'row' }}>
      <div style={{
        width: 34, height: 34, borderRadius: '50%',
        border: '2px solid var(--ink)',
        overflow: 'hidden', flexShrink: 0, background: 'var(--paper-3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {player.avatar_url
          ? <img src={player.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontFamily: 'var(--serif)', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
              {(player.nickname || '?')[0]}
            </span>
        }
      </div>
      <div style={{ minWidth: 0, textAlign: align === 'left' ? 'right' : 'left' }}>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 12, fontWeight: 500, color: 'var(--ink)', margin: 0, maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {player.nickname}
        </p>
        <p style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
          {score ?? 0}
        </p>
      </div>
    </div>
  )
}

// ── Timer bar (thin ink rule) ─────────────────────────────────────────────────
function TimerBar({ pct }) {
  const color = pct > 0.5 ? 'var(--ink)' : pct > 0.25 ? 'var(--gold)' : 'var(--alert)'
  return (
    <div style={{ height: 3, background: 'var(--rule)', width: '100%', flexShrink: 0 }}>
      <div style={{
        height: '100%', width: `${Math.max(0, pct * 100)}%`,
        background: color, transition: 'width 200ms linear, background 300ms',
      }} />
    </div>
  )
}

/**
 * DuelGame — standalone or tournament-embedded.
 * Props:
 *   duelPath          {string}  RTDB base path — default 'duels'
 *   questionDurationMs {number} override for question timer
 *   onFinished        {fn}      called on game end
 *   duelIdOverride    {string}  use this instead of URL param
 *   isObserver        {bool}    host watching; disables answers
 *   tournamentBadge   {string}  e.g. "بطولة X — النهائي"
 */
export default function DuelGame({
  duelPath          = 'duels',
  questionDurationMs: propDurationMs,
  onFinished,
  duelIdOverride,
  isObserver        = false,
  tournamentBadge   = null,
} = {}) {
  const { duelId: duelIdParam } = useParams()
  const duelId  = duelIdOverride || duelIdParam
  const navigate = useNavigate()
  const { session } = useAuth()
  const uid = session?.uid

  const activeDurationMs = propDurationMs || QUESTION_DURATION_MS

  const [duel, setDuel]               = useState(null)
  const [loading, setLoading]         = useState(true)
  const [timerPct, setTimerPct]       = useState(1)
  const [selectedChoice, setSelectedChoice] = useState(null)
  const [hasAnswered, setHasAnswered] = useState(false)

  const [watchOpponentUid, setWatchOpponentUid]   = useState(null)
  const [opponentConnected, setOpponentConnected] = useState(true)
  const [disconnectCountdown, setDisconnectCountdown] = useState(null)

  const [confirmAction, setConfirmAction] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  const [startCountdown,  setStartCountdown]  = useState(null)

  const duelRef             = useRef(null)
  const serverOffsetRef     = useRef(0)
  const revealInProgressRef = useRef(false)
  const nextInProgressRef   = useRef(false)
  const timerIntervalRef    = useRef(null)
  const revealTimerRef      = useRef(null)
  const countdownIntervalRef = useRef(null)

  const serverNow = useCallback(() => Date.now() + serverOffsetRef.current, [])

  useEffect(() => {
    const unsub = onValue(rtdbRef(rtdb, '.info/serverTimeOffset'), snap => {
      const val = snap.val()
      serverOffsetRef.current = Number.isFinite(val) ? val : 0
    })
    return () => unsub()
  }, [])

  useEffect(() => { duelRef.current = duel }, [duel])

  useEffect(() => {
    if (!duelId || !uid || isObserver) return
    const presRef = rtdbRef(rtdb, `duel_presence/${duelId}/${uid}`)
    set(presRef, { connected: true })
    onDisconnect(presRef).set({ connected: false })
    localStorage.setItem('activeDuelId', duelId)
    return () => { set(presRef, { connected: false }) }
  }, [duelId, uid, isObserver])

  useEffect(() => {
    if (!duelId || !watchOpponentUid) return
    const unsub = onValue(rtdbRef(rtdb, `duel_presence/${duelId}/${watchOpponentUid}`), snap => {
      const data = snap.val()
      setOpponentConnected(!data || data.connected !== false)
    })
    return () => unsub()
  }, [duelId, watchOpponentUid])

  useEffect(() => {
    if (isObserver) return
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
          status: 'finished', forfeit_by: oppUid || null,
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

  useEffect(() => {
    if (!duel) return
    setSelectedChoice(null)
    setHasAnswered(false)
    revealInProgressRef.current = false
    nextInProgressRef.current   = false
  }, [duel?.current_question_index])

  useEffect(() => {
    if (!duel || duelPath === 'duels' || duel.status !== 'waiting') return

    setStartCountdown(5)
    const ticks = [
      setTimeout(() => setStartCountdown(4), 1000),
      setTimeout(() => setStartCountdown(3), 2000),
      setTimeout(() => setStartCountdown(2), 3000),
      setTimeout(() => setStartCountdown(1), 4000),
      setTimeout(async () => {
        setStartCountdown(0)
        try {
          await runTransaction(rtdbRef(rtdb, `${duelPath}/${duelId}`), current => {
            if (!current || current.status !== 'waiting') return undefined
            return { ...current, status: 'playing', question_started_at: Date.now() + serverOffsetRef.current }
          })
        } catch (e) { console.error('auto-start error:', e) }
      }, 5000),
    ]
    return () => ticks.forEach(clearTimeout)
  }, [duel?.status, duelPath, duelId])

  useEffect(() => {
    if (!duelId) return
    const unsub = onValue(rtdbRef(rtdb, `${duelPath}/${duelId}`), snap => {
      const data = snap.val()
      setDuel(data)
      setLoading(false)
      if (!isObserver && data?.players && uid) {
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

      const qi = currentDuel.current_question_index
      const question = currentDuel.questions?.[qi]
      const answersSnap = await rtdbGet(rtdbRef(rtdb, `${duelPath}/${duelId}/answers/${qi}`))
      const allAnswers  = answersSnap.val() || {}
      const realPlayers = new Set(Object.keys(currentDuel.players || {}))
      const answers = Object.fromEntries(
        Object.entries(allAnswers).filter(([aUid]) => realPlayers.has(aUid))
      )
      const scoreUpdates = {}

      let correctC = question?.correct ?? null
      if (correctC == null && question?.correct_hash) {
        correctC = await findCorrectForDuel(
          duelId, qi, question.choices?.length ?? 4, question.correct_hash
        )
      }

      if (correctC != null) scoreUpdates[`answers/${qi}/correct_reveal`] = correctC

      const isRegularDuel = duelPath === 'duels'
      const correctAnswers = Object.entries(answers)
        .filter(([, a]) => a.selected_choice === correctC)
        .sort((a, b) => (a[1].reaction_time_ms ?? 0) - (b[1].reaction_time_ms ?? 0))
      const arrivalRank = {}
      correctAnswers.forEach(([aUid], i) => { arrivalRank[aUid] = i })

      for (const [aUid, answer] of Object.entries(answers)) {
        const isCorrect = answer.selected_choice === correctC
        let pointsEarned = 0
        if (isCorrect) {
          const rank = arrivalRank[aUid] ?? 99
          if (isRegularDuel && question?.played_by_uids?.includes(aUid)) {
            pointsEarned = 1
          } else {
            pointsEarned = rank === 0 ? 2 : 1
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

  const triggerNextOrFinish = useCallback(async () => {
    if (nextInProgressRef.current) return
    const currentDuel = duelRef.current
    if (!currentDuel || currentDuel.status !== 'revealing') return
    nextInProgressRef.current = true

    try {
      const result = await runTransaction(
        rtdbRef(rtdb, `${duelPath}/${duelId}`),
        current => {
          if (!current || current.status !== 'revealing') return

          const nextQi = (current.current_question_index ?? 0) + 1
          const atEnd  = nextQi >= (current.total_questions ?? 0)

          if (atEnd && duelPath !== 'duels') {
            const uids   = Object.keys(current.players || {})
            const scores = uids.map(u => current.players?.[u]?.score ?? 0)
            const tied   = uids.length === 2 && scores[0] === scores[1] && scores[0] > 0

            if (tied) {
              const tbPool = current.tiebreaker_questions || []
              const tbUsed = current.tiebreaker_used || 0
              if (tbUsed < tbPool.length) {
                return {
                  ...current,
                  questions:              [...(current.questions || []), tbPool[tbUsed]],
                  total_questions:        (current.total_questions ?? 0) + 1,
                  tiebreaker_used:        tbUsed + 1,
                  is_tiebreaker:          true,
                  status:                 'playing',
                  current_question_index: nextQi,
                  question_started_at:    serverNow(),
                  reveal_started_at:      null,
                }
              }
            }
          }

          if (atEnd) return { ...current, status: 'finished', reveal_started_at: null }
          return {
            ...current,
            status: 'playing',
            current_question_index: nextQi,
            question_started_at: serverNow(),
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

  useEffect(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    if (!duel || duel.status !== 'playing') {
      setTimerPct(1); return
    }
    const startedAt = duel.question_started_at || serverNow()
    const tick = () => {
      const elapsed = serverNow() - startedAt
      const pct     = Math.max(0, 1 - elapsed / activeDurationMs)
      setTimerPct(pct)
      if (pct <= 0) {
        clearInterval(timerIntervalRef.current)
        if (duelPath === 'duels') {
          triggerReveal()
        } else if (!hasAnswered && !isObserver && uid) {
          const qi = duelRef.current?.current_question_index ?? 0
          update(rtdbRef(rtdb, `${duelPath}/${duelId}/answers/${qi}/${uid}`), { uid, timed_out: true }).catch(console.error)
        }
      }
    }
    tick()
    timerIntervalRef.current = setInterval(tick, 200)
    return () => clearInterval(timerIntervalRef.current)
  }, [duel?.status, duel?.question_started_at, triggerReveal, serverNow, activeDurationMs])

  useEffect(() => {
    if (!duel || duel.status !== 'playing') return
    if (duelPath !== 'duels') return
    const qi         = duel.current_question_index
    const answers    = duel.answers?.[qi] || {}
    const playerUids = Object.keys(duel.players || {})
    const validAnswerCount = playerUids.filter(p => p in answers).length
    if (playerUids.length >= 2 && validAnswerCount >= playerUids.length) triggerReveal()
  }, [duel?.answers, duel?.status, duel?.current_question_index, duelPath, triggerReveal])

  useEffect(() => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
    if (!duel || duel.status !== 'revealing' || !duel.reveal_started_at) return
    const elapsed   = serverNow() - duel.reveal_started_at
    const remaining = REVEAL_DURATION_MS - elapsed
    if (remaining <= 0) { triggerNextOrFinish(); return }
    revealTimerRef.current = setTimeout(triggerNextOrFinish, remaining)
    return () => clearTimeout(revealTimerRef.current)
  }, [duel?.status, duel?.reveal_started_at, triggerNextOrFinish, serverNow])

  const submitAnswer = useCallback(async (choiceIndex) => {
    if (isObserver || hasAnswered || !duel || duel.status !== 'playing' || !uid) return
    const startedAt = duel.question_started_at || serverNow()
    const reactionTimeMs = serverNow() - startedAt
    setSelectedChoice(choiceIndex)
    setHasAnswered(true)
    const qi = duel.current_question_index
    try {
      await update(rtdbRef(rtdb, `${duelPath}/${duelId}/answers/${qi}`), {
        [uid]: { uid, selected_choice: choiceIndex, reaction_time_ms: reactionTimeMs }
      })
    } catch (e) { console.error('submitAnswer error:', e) }
  }, [hasAnswered, duel, uid, duelId, duelPath, serverNow])

  const handleForfeit = useCallback(async () => {
    if (actionLoading) return
    setActionLoading(true); setConfirmAction(null)
    try {
      await update(rtdbRef(rtdb, `${duelPath}/${duelId}`), { status: 'finished', forfeit_by: uid })
    } catch (e) { console.error(e); setActionLoading(false) }
  }, [duelId, duelPath, uid, actionLoading])

  const handleSurrender = useCallback(async () => {
    if (actionLoading) return
    setActionLoading(true); setConfirmAction(null)
    try {
      await update(rtdbRef(rtdb, `${duelPath}/${duelId}`), { status: 'finished', surrender_by: uid })
    } catch (e) { console.error(e); setActionLoading(false) }
  }, [duelId, duelPath, uid, actionLoading])

  /* ── Loading ────────────────────────────────────────────────────────────── */
  if (loading || !duel) {
    return (
      <div style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="40" height="40" viewBox="0 0 100 100" fill="none" style={{ animation: 'mr-spin-slow 10s linear infinite' }}>
          <circle cx="50" cy="50" r="46" stroke="var(--rule)" strokeWidth="1" />
          <circle cx="50" cy="50" r="36" stroke="var(--ink)" strokeWidth="1.5" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="22" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>
        <style>{`@keyframes mr-spin-slow { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  const qi             = duel.current_question_index ?? 0
  const question       = duel.questions?.[qi]
  const players        = duel.players || {}
  const playerUids     = Object.keys(players)
  const myPlayer       = players[uid]
  const opponentUid    = playerUids.find(p => p !== uid)
  const opponentPlayer = opponentUid ? players[opponentUid] : null

  /* ── Tournament duel — "about to start" waiting screen ─────────────────── */
  if (duelPath !== 'duels' && duel.status === 'waiting') {
    return (
      <div style={{
        minHeight: '100svh', background: 'var(--paper)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 32, padding: 24,
      }}>
        {isObserver && (
          <span className="folio" style={{ border: '1px solid var(--gold)', padding: '4px 12px', color: 'var(--gold)', letterSpacing: '0.2em' }}>
            OBSERVER MODE
          </span>
        )}
        {tournamentBadge && (
          <span className="folio" style={{ border: '1px solid var(--gold)', padding: '4px 12px', color: 'var(--gold)', letterSpacing: '0.15em' }}>
            🏆 {tournamentBadge}
          </span>
        )}

        {/* VS display */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <PlayerPill player={myPlayer}       score={0} align="right" />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.1em' }}>VS</span>
          <PlayerPill player={opponentPlayer} score={0} align="left" />
        </div>

        {/* Countdown */}
        <div style={{ textAlign: 'center' }}>
          {startCountdown !== null ? (
            <p style={{
              fontFamily: 'var(--serif)', fontSize: 96, fontWeight: 400, lineHeight: 1,
              color: startCountdown === 0 ? 'var(--burgundy)' : 'var(--ink)',
              margin: '0 0 8px',
            }}>
              {startCountdown === 0 ? 'Go!' : startCountdown}
            </p>
          ) : (
            <div style={{ position: 'relative', width: 60, height: 60, margin: '0 auto 8px' }}>
              <svg width="60" height="60" viewBox="0 0 100 100" fill="none"
                style={{ animation: 'mr-spin-slow 10s linear infinite' }}>
                <circle cx="50" cy="50" r="46" stroke="var(--rule)" strokeWidth="1" />
                <circle cx="50" cy="50" r="36" stroke="var(--ink)" strokeWidth="1.5" />
              </svg>
              <style>{`@keyframes mr-spin-slow { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}
          <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
            {startCountdown === null ? 'جارٍ التحضير…' : startCountdown > 0 ? 'تبدأ المباراة خلال…' : 'انطلق!'}
          </p>
        </div>
      </div>
    )
  }

  const isRevealing    = duel.status === 'revealing'
  const currentAnswers = duel.answers?.[qi] || {}
  const myAnswer       = currentAnswers[uid]
  const opponentAnswer = opponentUid ? currentAnswers[opponentUid] : null
  const correctReveal  = currentAnswers.correct_reveal ?? question?.correct ?? null
  const timeLeftSec    = Math.ceil(timerPct * (activeDurationMs / 1000))

  function choiceStyle(i) {
    if (!isRevealing && !hasAnswered) {
      return {
        background: 'var(--paper)', color: 'var(--ink)',
        border: '1px solid var(--rule)', borderBottomWidth: 2, borderBottomColor: 'var(--ink)',
        cursor: 'pointer',
      }
    }
    if (!isRevealing && hasAnswered) {
      if (i === selectedChoice) return { background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)' }
      return { background: 'var(--paper)', color: 'var(--ink-4)', border: '1px solid var(--rule)', opacity: 0.35 }
    }
    const isCorrect   = i === correctReveal
    const wasMyChoice = i === myAnswer?.selected_choice
    if (isCorrect) return { background: 'rgba(34,197,94,0.07)', border: '2px solid #22c55e', color: 'var(--ink)' }
    if (wasMyChoice && !isCorrect) return { background: 'rgba(180,48,57,0.07)', border: '2px solid var(--alert)', color: 'var(--ink)' }
    return { background: 'var(--paper)', color: 'var(--ink-4)', border: '1px solid var(--rule)', opacity: 0.25 }
  }

  function choiceLetterStyle(i) {
    if (!isRevealing && !hasAnswered) return { border: '1px solid var(--rule)', color: 'var(--ink-3)', background: 'transparent' }
    if (!isRevealing && i === selectedChoice) return { border: '1px solid var(--paper-2)', color: 'var(--paper)', background: 'transparent' }
    const isCorrect   = i === correctReveal
    const wasMyChoice = i === myAnswer?.selected_choice
    if (isCorrect)   return { border: '1px solid #22c55e', background: '#22c55e', color: 'var(--paper)' }
    if (wasMyChoice) return { border: '1px solid var(--alert)', background: 'var(--alert)', color: 'var(--paper)' }
    return { border: '1px solid var(--rule)', color: 'var(--ink-4)', background: 'transparent' }
  }

  return (
    <div style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }} dir="rtl">

      {/* Tournament badge */}
      {tournamentBadge && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--rule)', textAlign: 'center' }}>
          <span className="folio" style={{ color: 'var(--gold)', letterSpacing: '0.15em' }}>🏆 {tournamentBadge}</span>
        </div>
      )}

      {/* Tiebreaker banner */}
      {duel.is_tiebreaker && (
        <div style={{ padding: '7px 16px', borderBottom: '1px solid var(--gold)', background: 'rgba(176,137,68,0.06)', textAlign: 'center' }}>
          <span className="ar" style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)' }}>⚡ سؤال فاصل!</span>
        </div>
      )}

      {/* Observer banner */}
      {isObserver && (
        <div style={{ padding: '7px 16px', borderBottom: '1px solid var(--rule)', background: 'var(--paper-2)', textAlign: 'center' }}>
          <span className="folio" style={{ color: 'var(--ink-3)', letterSpacing: '0.2em' }}>OBSERVER MODE — لا يمكنك الإجابة</span>
        </div>
      )}

      {/* Disconnect banner */}
      {!isObserver && !opponentConnected && disconnectCountdown !== null && (
        <div style={{
          padding: '10px 16px', borderBottom: '1px solid var(--gold)',
          background: 'rgba(176,137,68,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <WifiOff size={14} style={{ color: 'var(--gold)', flexShrink: 0 }} />
            <div>
              <p className="ar" style={{ fontWeight: 600, fontSize: 13, color: 'var(--gold)', margin: 0 }}>خصمك انقطع الاتصال</p>
              <p className="ar" style={{ fontSize: 11, color: 'var(--ink-3)', margin: 0 }}>ستفوز تلقائياً إذا لم يعد خلال</p>
            </div>
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 700, color: 'var(--gold)', flexShrink: 0 }}>
            {disconnectCountdown}s
          </span>
        </div>
      )}

      {/* ── Top bar: player pills + question counter + timer ──────────── */}
      <div style={{
        padding: '12px 16px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        borderBottom: '1px solid var(--rule)',
      }}>
        <PlayerPill player={myPlayer} score={myPlayer?.score} align="right" />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)' }}>
            {qi + 1} / {duel.total_questions}
          </span>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: isObserver ? 14 : 20, fontWeight: 700,
            color: isObserver ? 'var(--ink-4)' : timeLeftSec <= 5 ? 'var(--alert)' : 'var(--ink)',
          }}>
            {duel.status === 'revealing' ? '✓' : timeLeftSec}
          </span>
        </div>

        <PlayerPill player={opponentPlayer} score={opponentPlayer?.score} align="left" />
      </div>

      {/* Timer bar */}
      {!isObserver && <TimerBar pct={duel.status === 'revealing' ? 0 : timerPct} />}

      {/* ── Question + choices ────────────────────────────────────────── */}
      <div dir={duel.force_rtl ? 'rtl' : 'ltr'} style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px', gap: 12, overflowY: 'auto' }}>

        {/* Question card */}
        <div style={{
          border: '1px solid var(--rule)', borderBottomWidth: 2, borderBottomColor: 'var(--ink)',
          padding: '16px', background: 'var(--paper)',
        }}>
          <p dir={duel.force_rtl ? 'rtl' : 'auto'} style={{ fontFamily: 'var(--serif)', fontSize: 17, fontWeight: 500, color: 'var(--ink)', margin: 0, lineHeight: 1.55, textAlign: 'center' }}>
            <MathText text={question?.question} dir={duel.force_rtl ? 'rtl' : 'auto'} />
          </p>
          {question?.image_url && (
            <img src={question.image_url} alt="question" style={{ marginTop: 12, width: '100%', maxHeight: 200, objectFit: 'contain', border: '1px solid var(--rule)' }} />
          )}
        </div>

        {/* Reveal mini-result */}
        {isRevealing && (
          <div style={{
            border: '1px solid var(--rule)', padding: '10px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28,
          }}>
            {[
              { label: 'أنت', answer: myAnswer },
              { label: 'خصمك', answer: opponentAnswer },
            ].map(({ label, answer }, idx) => (
              <div key={idx} style={{ textAlign: 'center' }}>
                <p className="ar" style={{ fontSize: 10, color: 'var(--ink-4)', margin: '0 0 4px' }}>{label}</p>
                {answer ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: answer.is_correct ? '#22c55e' : 'var(--alert)' }}>
                      {answer.is_correct ? '✓' : '✗'}
                    </span>
                    {answer.is_correct && answer.points_earned != null && (
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: answer.points_earned === 1 ? 'var(--gold)' : '#22c55e' }}>
                        +{answer.points_earned}
                      </span>
                    )}
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)' }}>{answer.reaction_time_ms}ms</span>
                  </div>
                ) : (
                  <span className="ar" style={{ fontSize: 11, color: 'var(--ink-4)' }}>لم يجب</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Choices */}
        <div dir={duel.force_rtl ? 'rtl' : 'ltr'} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(question?.choices || []).map((choice, i) => (
            <button
              key={i}
              onClick={() => submitAnswer(i)}
              disabled={hasAnswered || isRevealing}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: '13px 14px', transition: 'opacity 150ms',
                ...choiceStyle(i),
              }}
            >
              <span style={{
                width: 26, height: 26, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
                ...choiceLetterStyle(i),
              }}>
                {isRevealing && i === correctReveal ? '✓' :
                 isRevealing && i === myAnswer?.selected_choice && i !== correctReveal ? '✗' :
                 String.fromCharCode(65 + i)}
              </span>
              <span dir={duel.force_rtl ? 'rtl' : 'auto'} style={{ flex: 1, fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 500, lineHeight: 1.4, textAlign: 'right' }}>
                <MathText text={choice} dir={duel.force_rtl ? 'rtl' : 'auto'} />
              </span>
            </button>
          ))}
        </div>

        {/* Waiting for opponent */}
        {hasAnswered && !isRevealing && (
          <div style={{ textAlign: 'center', padding: '6px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--burgundy)', animation: 'mr-dot-pulse 1.6s ease-in-out infinite' }} />
            <span className="ar" style={{ fontSize: 12, color: 'var(--ink-3)' }}>في انتظار الخصم…</span>
            <style>{`@keyframes mr-dot-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.6)} }`}</style>
          </div>
        )}
      </div>

      {/* ── Exit / surrender bar ─────────────────────────────────────── */}
      {!isObserver && (
        <div style={{
          borderTop: '1px solid var(--rule)', padding: '10px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20,
        }}>
          <button
            onClick={() => setConfirmAction('surrender')}
            disabled={actionLoading}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
              fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--ink-4)',
              opacity: actionLoading ? 0.4 : 1,
            }}
          >
            <Flag size={11} />
            استسلام
          </button>
          <div style={{ width: 1, height: 14, background: 'var(--rule)' }} />
          <button
            onClick={() => setConfirmAction('forfeit')}
            disabled={actionLoading}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
              fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--ink-4)',
              opacity: actionLoading ? 0.4 : 1,
            }}
          >
            <LogOut size={11} />
            الخروج
          </button>
        </div>
      )}

      {/* ── Editorial confirm overlay ─────────────────────────────────── */}
      {confirmAction && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} dir="rtl">
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={() => setConfirmAction(null)} />
          <div style={{
            position: 'relative', background: 'var(--paper)',
            borderTop: '3px double var(--rule-strong)',
            width: '100%', maxWidth: 400, padding: '24px 20px',
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            {confirmAction === 'forfeit' ? (
              <>
                <div style={{ textAlign: 'center' }}>
                  <h3 style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 400, color: 'var(--ink)', margin: '0 0 6px' }}>
                    الخروج من اللعبة؟
                  </h3>
                  <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
                    ستُحسب خسارة حتى لو كنت متقدم بالنقاط
                  </p>
                </div>
                <button onClick={handleForfeit} style={{
                  width: '100%', padding: '13px', background: 'transparent',
                  border: '1px solid var(--alert)', color: 'var(--alert)',
                  fontFamily: 'var(--arabic)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>
                  تأكيد الخروج
                </button>
              </>
            ) : (
              <>
                <div style={{ textAlign: 'center' }}>
                  <h3 style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 400, color: 'var(--ink)', margin: '0 0 6px' }}>
                    الاستسلام؟
                  </h3>
                  <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
                    ستنتهي اللعبة بتعادل لكلا اللاعبَين
                  </p>
                </div>
                <button onClick={handleSurrender} style={{
                  width: '100%', padding: '13px', background: 'transparent',
                  border: '1px solid var(--gold)', color: 'var(--gold)',
                  fontFamily: 'var(--arabic)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>
                  تأكيد التعادل
                </button>
              </>
            )}
            <button onClick={() => setConfirmAction(null)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'var(--ink-4)', padding: '4px 0',
            }}>
              إلغاء
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
