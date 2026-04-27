import React, { useEffect, useState, useRef } from 'react'
import MathText from '../../components/common/MathText'
import { useParams, useNavigate } from 'react-router-dom'
import { ref, onValue, get, set, runTransaction, onDisconnect } from 'firebase/database'
import { doc, updateDoc, increment, getDoc, setDoc, serverTimestamp, collection } from 'firebase/firestore'
import { rtdb, db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useServerClock } from '../../hooks/useServerClock'
import { Trophy, WifiOff, Download, Loader2, Edit2, Check, X } from 'lucide-react'
import confetti from 'canvas-confetti'
import QuestionImage from '../../components/QuestionImage'
import { signAnswer, validateReactionTime, verifyAnswerHash } from '../../utils/crypto'
import { initActivityLogger, getActivityLogger, logActivity } from '../../utils/activityLogger'
import { getDir } from '../../utils/rtlUtils'
import { useUnattendedGameRunner } from '../../hooks/useUnattendedGameRunner'

// ── Mini leaderboard strip ────────────────────────────────────────────────────
function MiniLeaderboard({ top5, myId, myRank, myScore, myNickname }) {
  if (!top5 || top5.length === 0) return null
  const isMeInTop5 = top5.some(p => p.user_id === myId)

  return (
    <div style={{ width: '100%', maxWidth: 640, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
        {top5.map(p => {
          const isMe = p.user_id === myId
          return (
            <div key={p.user_id} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 8px', flexShrink: 0,
              border: `1px solid ${isMe ? 'var(--ink)' : 'var(--rule)'}`,
              background: isMe ? 'var(--ink)' : 'var(--paper-2)',
            }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: isMe ? 'var(--paper-2)' : 'var(--ink-4)' }}>
                #{p.rank}
              </span>
              <span style={{ fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 600, color: isMe ? 'var(--paper)' : 'var(--ink)', maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.nickname}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: isMe ? 'var(--paper)' : 'var(--ink)' }}>
                {p.score}
              </span>
            </div>
          )
        })}
        {!isMeInTop5 && myRank && (
          <>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--ink-4)' }}>···</span>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 8px', flexShrink: 0,
              border: '1px solid var(--ink)', background: 'var(--ink)',
            }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--paper-2)' }}>#{myRank}</span>
              <span style={{ fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 600, color: 'var(--paper)', maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {myNickname}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: 'var(--paper)' }}>{myScore}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Player-side countdown bar ─────────────────────────────────────────────────
function PlayerCountdown({ startedAt, duration }) {
  const [remaining, setRemaining] = useState(duration)
  const rafRef = useRef(null)

  useEffect(() => {
    const tick = () => {
      const rem = Math.max(0, duration - (Date.now() - startedAt) / 1000)
      setRemaining(rem)
      if (rem > 0) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [startedAt, duration])

  const pct     = (remaining / duration) * 100
  const urgent  = remaining < duration * 0.25
  const expired = remaining === 0

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        height: 3, background: 'var(--rule)', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${pct}%`,
          background: expired ? 'var(--rule)' : urgent ? 'var(--alert)' : 'var(--ink)',
          transition: 'background 300ms',
        }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 }}>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700,
          color: expired ? 'var(--ink-4)' : urgent ? 'var(--alert)' : 'var(--ink)',
        }}>
          {expired ? 'Time up' : `${Math.ceil(remaining)}s`}
        </span>
      </div>
    </div>
  )
}

function questionFontSize(text = '') {
  const len = text.length
  if (len > 220) return 14
  if (len > 120) return 16
  return 18
}

export default function PlayerGameView() {
  const { roomId }   = useParams()
  const { session }  = useAuth()
  const navigate     = useNavigate()
  const clockOffset  = useServerClock()

  const [room, setRoom]               = useState(null)
  const [player, setPlayer]           = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [selectedChoice, setSelectedChoice] = useState(null)
  const [answerLocked, setAnswerLocked]     = useState(false)
  const [revealedResult, setRevealedResult] = useState(null)
  const [hostOnline, setHostOnline]         = useState(true)
  const [top5, setTop5]                     = useState([])

  const [autoNavCountdown, setAutoNavCountdown] = useState(null)

  const [editingName, setEditingName]   = useState(false)
  const [nameInput, setNameInput]       = useState('')
  const [savingName, setSavingName]     = useState(false)

  const questionServerStartRef = useRef(null)
  const prevQuestionIndexRef   = useRef(null)
  const prevStatusRef          = useRef(null)

  const resetForNewQuestion = () => {
    setSelectedChoice(null)
    setAnswerLocked(false)
    setRevealedResult(null)
    questionServerStartRef.current = Date.now() + clockOffset.current
  }

  useEffect(() => {
    if (!session) return
    const uid = session.uid
    const presRef = ref(rtdb, `rooms/${roomId}/presence/players/${uid}`)
    set(presRef, { online: true, last_seen: Date.now() })
    onDisconnect(presRef).set({ online: false, last_seen: Date.now() })
    return () => set(presRef, { online: false, last_seen: Date.now() })
  }, [roomId, session])

  useEffect(() => {
    if (!session) return
    const unsub = onValue(ref(rtdb, `rooms/${roomId}/presence/host`), snap => {
      setHostOnline(!snap.exists() || snap.val().online !== false)
    })
    return () => unsub()
  }, [roomId, session])

  useEffect(() => {
    if (!session) return
    const uid = session.uid
    const unsub = onValue(ref(rtdb, `rooms/${roomId}`), async snap => {
      if (!snap.exists()) return
      const data = snap.val()

      if (prevQuestionIndexRef.current !== null &&
          data.current_question_index !== prevQuestionIndexRef.current) {
        resetForNewQuestion()
      }
      if (data.status === 'revealing' && prevStatusRef.current !== 'revealing') {
        fetchMyAnswerResult(data.current_question_index, uid)
      }
      if (data.status === 'finished' && prevStatusRef.current !== 'finished') {
        confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 } })
        const qSetId  = data.question_set_id
        const hostUid = data.host_id

        if (data.tournament_id) setAutoNavCountdown(5)

        if (qSetId && uid) {
          updateDoc(doc(db, 'profiles', uid), {
            [`played_decks.${qSetId}`]: increment(1)
          }).catch(() => {})

          ;(async () => {
            try {
              const isTournament = !!data.tournament_id
              const [deckSnap, hostSnap, tournSnap] = await Promise.all([
                getDoc(doc(db, 'question_sets', qSetId)),
                hostUid ? getDoc(doc(db, 'profiles', hostUid)) : Promise.resolve(null),
                isTournament ? getDoc(doc(db, 'tournaments', data.tournament_id)) : Promise.resolve(null),
              ])
              const deckData       = deckSnap.data() || {}
              const hostName       = hostSnap?.data()?.display_name || 'دكتور'
              const tournamentTitle = tournSnap?.data()?.title || ''
              const myScore        = data.players?.[uid]?.score ?? 0

              const historyDocId = isTournament
                ? `t_${data.tournament_id}_ffa_${roomId}`
                : roomId

              const historyEntry = isTournament
                ? {
                    type:             'tournament_ffa',
                    tournament_id:    data.tournament_id,
                    tournament_title: tournamentTitle,
                    deck_id:          qSetId,
                    deck_title:       deckData.title || qSetId,
                    played_at:        serverTimestamp(),
                    host_uid:         hostUid || null,
                    host_name:        hostName,
                    score:            myScore,
                    total_questions:  deckData.questions?.questions?.length || 0,
                    room_code:        roomId,
                  }
                : {
                    type:            'competition',
                    deck_id:         qSetId,
                    deck_title:      deckData.title || qSetId,
                    deck_is_global:  deckData.is_global || false,
                    played_at:       serverTimestamp(),
                    host_uid:        hostUid || null,
                    host_name:       hostName,
                    score:           myScore,
                    total_questions: deckData.questions?.questions?.length || 0,
                    room_code:       roomId,
                  }

              await setDoc(doc(db, 'profiles', uid, 'game_history', historyDocId), historyEntry)

              if (hostUid) {
                updateDoc(doc(db, 'profiles', uid), {
                  [`hosted_by.${hostUid}`]: hostName,
                }).catch(() => {})
              }

              const sortedLeaderboard = data.players
                ? Object.values(data.players)
                    .sort((a, b) => (b.score || 0) - (a.score || 0))
                    .map((p, i) => ({
                      rank: i + 1, user_id: p.user_id,
                      nickname: p.nickname, score: p.score || 0,
                    }))
                : []
              const myRank = sortedLeaderboard.findIndex(p => p.user_id === uid) + 1

              const playerNotifRef = doc(db, 'notifications', uid, 'items', roomId)
              const existingNotif  = await getDoc(playerNotifRef)
              if (!existingNotif.exists()) {
                await setDoc(playerNotifRef, {
                  type:             'game_finished',
                  room_id:          roomId,
                  room_title:       data.title || roomId,
                  host_name:        hostName,
                  my_rank:          myRank,
                  my_score:         myScore,
                  total_players:    sortedLeaderboard.length,
                  full_leaderboard: sortedLeaderboard,
                  created_at:       serverTimestamp(),
                  read:             false,
                })
              }

              if (hostUid) {
                const hostNotifRef = doc(db, 'notifications', hostUid, 'items', roomId)
                getDoc(hostNotifRef).then(snap => {
                  if (!snap.exists()) {
                    return setDoc(hostNotifRef, {
                      type:            'game_finished',
                      room_id:         roomId,
                      room_title:      data.title || roomId,
                      total_players:   sortedLeaderboard.length,
                      winner_nickname: sortedLeaderboard[0]?.nickname || null,
                      results_url:     `/host/game/${roomId}`,
                      created_at:      serverTimestamp(),
                      read:            false,
                    })
                  }
                }).catch(() => {})
              }
            } catch (e) {
              console.error('Failed to write competition history/notifications:', e)
            }
          })()
        }
      }

      prevQuestionIndexRef.current = data.current_question_index
      prevStatusRef.current        = data.status
      setRoom(data)
    })
    return () => unsub()
  }, [roomId, session])

  useEffect(() => {
    if (!session) return
    const uid = session.uid
    const unsub = onValue(ref(rtdb, `rooms/${roomId}/players/${uid}`), snap => {
      if (snap.exists()) setPlayer(snap.val())
    })
    get(ref(rtdb, `rooms/${roomId}/players/${uid}`)).then(snap => {
      if (!snap.exists()) { alert('You are not in this room!'); navigate('/') }
      else {
        setPlayer(snap.val())
        questionServerStartRef.current = Date.now() + clockOffset.current
      }
    })
    return () => unsub()
  }, [roomId, session])

  useEffect(() => {
    if (!session) return
    const unsub = onValue(ref(rtdb, `rooms/${roomId}/leaderboard/top5`), snap => {
      setTop5(snap.exists() ? Object.values(snap.val()) : [])
    })
    return () => unsub()
  }, [roomId, session])

  useUnattendedGameRunner({ roomId, room, session })

  useEffect(() => {
    if (autoNavCountdown === null || !room?.tournament_id) return
    if (autoNavCountdown <= 0) {
      navigate(`/tournament/${room.tournament_id}/wait`, { replace: true })
      return
    }
    const t = setTimeout(() => setAutoNavCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [autoNavCountdown, room?.tournament_id, navigate])

  useEffect(() => {
    if (!session || !room) return
    const uid = session.uid
    if (room.status === 'playing' || room.status === 'revealing') {
      const qIdx = room.current_question_index
      get(ref(rtdb, `rooms/${roomId}/answers/${qIdx}/${uid}`)).then(snap => {
        if (snap.exists()) {
          const a = snap.val()
          setSelectedChoice(a.selected_choice)
          setAnswerLocked(true)
          if (room.status === 'revealing') fetchMyAnswerResult(qIdx, uid)
        }
      })
    }
  }, [room?.status, room?.current_question_index])

  const fetchMyAnswerResult = async (questionIndex, uid) => {
    const [answerSnap, revealSnap] = await Promise.all([
      get(ref(rtdb, `rooms/${roomId}/answers/${questionIndex}/${uid}`)),
      get(ref(rtdb, `rooms/${roomId}/reveal_data`)),
    ])
    const revealData     = revealSnap.exists() ? revealSnap.val() : null
    const winnerTimeMs   = revealData?.winner_time_ms ?? null
    const winnerNickname = revealData?.winner_nickname ?? null

    if (answerSnap.exists()) {
      const a = answerSnap.val()
      const behindMs = a.is_correct && !a.is_first_correct && winnerTimeMs != null
        ? Math.max(0, a.reaction_time_ms - winnerTimeMs) : null
      setRevealedResult({
        is_correct:       a.is_correct,
        is_first_correct: a.is_first_correct,
        reaction_time_ms: a.reaction_time_ms,
        points_earned:    a.points_earned ?? 0,
        rank:             a.rank ?? null,
        behind_ms:        behindMs,
        winner_nickname:  winnerNickname,
        winners:          revealData?.winners || [],
      })
      if (a.is_correct) confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } })
    } else {
      setRevealedResult({
        didNotAnswer: true,
        winner_nickname: winnerNickname,
        winners:          revealData?.winners || [],
      })
    }
  }

  const handleChoiceClick = async (choiceIndex) => {
    if (answerLocked || !room || !session) return

    const serverNow  = Date.now() + clockOffset.current
    const reactionMs = questionServerStartRef.current
      ? Math.round(serverNow - questionServerStartRef.current)
      : 5000

    setSelectedChoice(choiceIndex)
    setAnswerLocked(true)

    let logger = getActivityLogger()
    if (!logger) logger = initActivityLogger(session.uid, roomId)

    const uid    = session.uid
    const qIdx   = room.current_question_index
    const questionLimit = room.config?.timer_seconds || 30
    const timeValidation = validateReactionTime(reactionMs, questionLimit)
    const isAnomalous = timeValidation.isAnomalous

    if (isAnomalous) {
      logger.addLog('anomalous_reaction_time', { reaction_time_ms: reactionMs, reason: timeValidation.reason, question_index: qIdx })
    }

    const answerData = {
      selected_choice: choiceIndex, reaction_time: reactionMs,
      timestamp: Date.now(), room_id: roomId, user_id: uid, question_index: qIdx
    }

    let gameSecret = room.game_secret || 'default-secret-' + roomId
    if (!room.game_secret) gameSecret = 'secure-' + roomId + '-' + (room.created_at || 'generated')

    let signature = null
    try {
      signature = await signAnswer(answerData, gameSecret)
    } catch (err) {
      console.error('Failed to sign answer:', err)
      logger.addLog('signing_error', { error: err.message, question_index: qIdx })
      alert('Security error: Failed to encrypt your answer. Please try again.')
      setAnswerLocked(false)
      return
    }

    logger.logAnswerSubmission({ ...answerData, signature: signature.substring(0, 16) + '...' })

    const answerRef = ref(rtdb, `rooms/${roomId}/answers/${qIdx}/${uid}`)
    await runTransaction(answerRef, current => {
      if (current !== null) return undefined
      return {
        user_id:          uid,
        player_name:      player?.nickname || 'Unknown',
        selected_choice:  choiceIndex,
        is_anomalous:     isAnomalous,
        reaction_time_ms: reactionMs,
        signature:        signature,
        submitted_at:     Date.now(),
      }
    })
  }

  const saveNickname = async () => {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === player?.nickname) { setEditingName(false); return }
    setSavingName(true)
    try {
      await update(ref(rtdb, `rooms/${roomId}/players/${session.uid}`), { nickname: trimmed })
    } catch (err) { alert('Error: ' + err.message) }
    finally { setSavingName(false); setEditingName(false) }
  }

  const [downloadingLogs, setDownloadingLogs] = useState(false)

  const downloadLogs = async () => {
    if (!room) return
    setDownloadingLogs(true)
    try {
      const questions = room.questions?.questions || []
      const pad = (s, n) => String(s).padEnd(n)
      const lines = []
      lines.push('=== Med Royale — Game Log ===')
      lines.push(`Room      : ${roomId}`)
      lines.push(`Date      : ${new Date().toLocaleString()}`)
      lines.push(`Questions : ${questions.length}`)
      lines.push(`Scoring   : ${room.config?.scoring_mode || 'classic'}`)
      lines.push('')

      const playersSnap = await get(ref(rtdb, `rooms/${roomId}/players`))
      const allPlayers  = playersSnap.exists()
        ? Object.values(playersSnap.val()).sort((a, b) => b.score - a.score)
        : []

      for (let qi = 0; qi < questions.length; qi++) {
        const q = questions[qi]
        lines.push('═'.repeat(62))
        lines.push(`Q${qi + 1}: ${q.question}`)
        const secretKey = `${roomId}:${room.created_at}`
        let correctIdx = -1
        for (let i = 0; i < q.choices.length; i++) {
          const isMatch = await verifyAnswerHash(i, q.correct_hash, `${roomId}-q${qi}`, roomId, secretKey)
          if (isMatch) { correctIdx = i; break }
        }
        lines.push(`Correct: ${q.choices[correctIdx] || '?'}`)
        lines.push('─'.repeat(62))

        const ansSnap  = await get(ref(rtdb, `rooms/${roomId}/answers/${qi}`))
        const ansMap   = ansSnap.exists() ? ansSnap.val() : {}
        const answered = Object.values(ansMap)
        const answeredIds = new Set(answered.map(a => a.user_id))

        const correct  = answered.filter(a =>  a.is_correct).sort((a, b) => a.reaction_time_ms - b.reaction_time_ms)
        const wrong    = answered.filter(a => !a.is_correct).sort((a, b) => a.reaction_time_ms - b.reaction_time_ms)
        const noAnswer = allPlayers.filter(p => !answeredIds.has(p.user_id))

        correct.forEach((a, i) => {
          const pts = a.points_earned != null ? `  +${a.points_earned}pt` : ''
          lines.push(`  ✓  #${i + 1}  ${pad(a.player_name || '?', 28)}${pad(a.reaction_time_ms + 'ms', 10)}${pts}`)
        })
        wrong.forEach(a => {
          const chosen = q.choices[a.selected_choice] || '?'
          lines.push(`  ✗       ${pad(a.player_name || '?', 28)}${pad(a.reaction_time_ms + 'ms', 10)}  chose: ${chosen}`)
        })
        noAnswer.forEach(p => {
          lines.push(`  —       ${pad(p.nickname, 28)}no answer`)
        })
        lines.push('')
      }

      lines.push('═'.repeat(62))
      lines.push('FINAL SCORES')
      lines.push('─'.repeat(62))
      allPlayers.forEach((p, i) => {
        lines.push(`  #${pad(i + 1, 4)}${pad(p.nickname, 32)}${p.score} pts`)
      })

      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/plain;charset=utf-8' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `dactoor-${roomId}-${new Date().toISOString().slice(0, 10)}.txt`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Error downloading logs: ' + err.message)
    } finally {
      setDownloadingLogs(false)
    }
  }

  const nextQImg = room?.questions?.questions?.[room?.current_question_index + 1]?.image_url
  useEffect(() => {
    if (!nextQImg) return
    const img = new Image(); img.src = nextQImg
  }, [nextQImg])

  if (!room || !player) return (
    <div style={{ height: '100svh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <svg width="40" height="40" viewBox="0 0 100 100" fill="none" style={{ animation: 'mr-spin-slow 10s linear infinite' }}>
          <circle cx="50" cy="50" r="46" stroke="var(--rule)" strokeWidth="1" />
          <circle cx="50" cy="50" r="36" stroke="var(--ink)" strokeWidth="1.5" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="22" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>
        <style>{`@keyframes mr-spin-slow { to { transform: rotate(360deg); } }`}</style>
        <span className="folio">Joining game…</span>
      </div>
    </div>
  )

  const currentQ = room.questions?.questions?.[room.current_question_index]
  const myId     = session?.uid

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100svh', background: 'var(--paper)', overflow: 'hidden' }}>

      {/* ── Host offline banner ───────────────────────────────────────── */}
      {!hostOnline && room?.status !== 'finished' && !room?.config?.unattended_mode && (
        <div style={{
          background: 'rgba(180,48,57,0.08)', borderBottom: '1px solid var(--alert)',
          padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          flexShrink: 0,
        }}>
          <WifiOff size={13} style={{ color: 'var(--alert)' }} />
          <span className="ar" style={{ fontSize: 13, color: 'var(--alert)', fontWeight: 600 }}>الهوست خرج — في انتظار عودته...</span>
        </div>
      )}

      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <div style={{
        borderBottom: '2px solid var(--ink)', padding: '10px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
        background: 'var(--paper)',
      }}>
        {/* Avatar + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, marginRight: 12 }}>
          {player.avatar_url && (
            <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--ink)', overflow: 'hidden', flexShrink: 0 }}>
              <img src={player.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
          {editingName ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
              <input
                autoFocus
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveNickname(); if (e.key === 'Escape') setEditingName(false) }}
                maxLength={30}
                style={{
                  flex: 1, minWidth: 0, background: 'var(--paper-2)',
                  border: '1px solid var(--ink)', padding: '4px 8px',
                  fontFamily: 'var(--serif)', fontSize: 14, color: 'var(--ink)', outline: 'none',
                }}
              />
              <button onClick={saveNickname} disabled={savingName} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', padding: 4 }}>
                {savingName ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={13} />}
              </button>
              <button onClick={() => setEditingName(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 4 }}>
                <X size={13} />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {player.nickname}
              </span>
              {room?.status === 'lobby' && (
                <button
                  onClick={() => { setNameInput(player.nickname); setEditingName(true) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: 2 }}
                >
                  <Edit2 size={11} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Score */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          border: '1px solid var(--rule)', padding: '5px 12px', flexShrink: 0,
        }}>
          <Trophy size={13} style={{ color: 'var(--gold)' }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
            {player.score} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--ink-4)' }}>PTS</span>
          </span>
        </div>
      </div>

      {/* ── Main area ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', padding: '16px', paddingBottom: 24 }}>

        {/* ────────── LOBBY ────────────────────────────────────────────── */}
        {room.status === 'lobby' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            <div style={{ textAlign: 'center', maxWidth: 340 }}>
              <div style={{ position: 'relative', width: 72, height: 72, margin: '0 auto 24px' }}>
                <svg width="72" height="72" viewBox="0 0 100 100" fill="none"
                  style={{ animation: 'mr-spin-slow 10s linear infinite' }}>
                  <circle cx="50" cy="50" r="46" stroke="var(--rule)" strokeWidth="1" />
                  <circle cx="50" cy="50" r="36" stroke="var(--ink)" strokeWidth="1.5" />
                  <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
                    fontFamily="Fraunces, Georgia, serif" fontSize="22" fontWeight="500" fill="var(--ink)">MR</text>
                </svg>
                <div style={{ position: 'absolute', inset: -8, border: '1px solid var(--rule)', borderRadius: '50%', animation: 'mr-ring-pulse 2.6s ease-in-out infinite' }} />
                <style>{`
                  @keyframes mr-spin-slow  { to { transform: rotate(360deg); } }
                  @keyframes mr-ring-pulse { 0%,100%{transform:scale(1);opacity:0.6} 50%{transform:scale(1.1);opacity:0.15} }
                `}</style>
              </div>
              <p className="folio" style={{ marginBottom: 10, letterSpacing: '0.25em' }}>YOU'RE IN</p>
              <h2 style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 400, color: 'var(--ink)', margin: '0 0 8px', lineHeight: 1.1 }}>
                Waiting for<br /><em style={{ fontWeight: 300, color: 'var(--burgundy)' }}>{room.title}</em>
              </h2>
            </div>
          </div>
        )}

        {/* ────────── PLAYING ──────────────────────────────────────────── */}
        {room.status === 'playing' && currentQ && (
          <div style={{ width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 12 }}>

            {player?.joined_at_question_index > 0 && (
              <div style={{ border: '1px solid var(--gold)', background: 'rgba(176,137,68,0.06)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--gold)' }}>!</span>
                <span className="ar" style={{ fontSize: 12, color: 'var(--gold)' }}>دخلت من سؤال {player.joined_at_question_index + 1} — الأسئلة السابقة محسوبة صفر.</span>
              </div>
            )}

            <MiniLeaderboard top5={top5} myId={myId} myRank={player?.rank} myScore={player?.score} myNickname={player?.nickname} />

            {/* Question card */}
            <div dir={getDir(currentQ.question, room.force_rtl)} style={{
              border: '1px solid var(--rule)', borderBottomWidth: 2, borderBottomColor: 'var(--ink)',
              padding: '16px', background: 'var(--paper)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span className="folio" style={{ letterSpacing: '0.2em', color: 'var(--burgundy)' }}>
                  Q {room.current_question_index + 1} / {room.questions.questions.length}
                </span>
              </div>
              <p style={{ fontFamily: 'var(--serif)', fontSize: questionFontSize(currentQ.question), fontWeight: 500, color: 'var(--ink)', lineHeight: 1.55, margin: 0 }}>
                <MathText text={currentQ.question} dir={getDir(currentQ.question, room.force_rtl)} />
              </p>
              {currentQ.image_url && (
                <QuestionImage src={currentQ.image_url} style={{ width: '100%', maxHeight: 160, objectFit: 'contain', marginTop: 12, border: '1px solid var(--rule)' }} />
              )}
              {room.countdown_started_at && (
                <PlayerCountdown startedAt={room.countdown_started_at} duration={room.countdown_duration} />
              )}
            </div>

            {/* Choices */}
            {!answerLocked ? (
              <div dir={getDir(currentQ.question, room.force_rtl)} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {currentQ.choices.map((choice, idx) => (
                  <button key={idx} onClick={() => handleChoiceClick(idx)} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 14px',
                    background: 'var(--paper)', color: 'var(--ink)',
                    border: '1px solid var(--rule)', borderBottomWidth: 2, borderBottomColor: 'var(--ink)',
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'background 80ms',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--paper-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--paper)'}
                  >
                    <span style={{
                      width: 26, height: 26, flexShrink: 0,
                      border: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: 'var(--ink-3)',
                    }}>
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.4 }}>
                      <MathText text={choice} dir={getDir(choice, room.force_rtl)} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div dir={getDir(currentQ.question, room.force_rtl)} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {currentQ.choices.map((choice, idx) => {
                  const isPicked = idx === selectedChoice
                  return (
                    <div key={idx} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 14px',
                      background: isPicked ? 'var(--ink)' : 'var(--paper)',
                      border: `1px solid ${isPicked ? 'var(--ink)' : 'var(--rule)'}`,
                      opacity: isPicked ? 1 : 0.35,
                    }}>
                      <span style={{
                        width: 26, height: 26, flexShrink: 0,
                        border: `1px solid ${isPicked ? 'var(--paper-2)' : 'var(--rule)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
                        color: isPicked ? 'var(--paper)' : 'var(--ink-3)',
                      }}>
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <span style={{ fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 500, color: isPicked ? 'var(--paper)' : 'var(--ink)', lineHeight: 1.4 }}>
                        <MathText text={choice} dir={getDir(choice, room.force_rtl)} />
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {answerLocked && !revealedResult && (
              <div style={{ textAlign: 'center', padding: '8px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--burgundy)', animation: 'mr-dot-pulse 1.6s ease-in-out infinite' }} />
                <span className="ar" style={{ fontSize: 12, color: 'var(--ink-3)' }}>في انتظار الكشف…</span>
                <style>{`@keyframes mr-dot-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.6)} }`}</style>
              </div>
            )}
          </div>
        )}

        {/* ────────── REVEALING ────────────────────────────────────────── */}
        {room.status === 'revealing' && currentQ && (
          <div style={{ width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 12 }}>

            <MiniLeaderboard top5={top5} myId={myId} myRank={player?.rank} myScore={player?.score} myNickname={player?.nickname} />

            {/* Question (dimmed) */}
            <div dir={getDir(currentQ.question, room.force_rtl)} style={{
              border: '1px solid var(--rule)', padding: '12px 16px',
              background: 'var(--paper-2)',
            }}>
              <p style={{ fontFamily: 'var(--serif)', fontSize: questionFontSize(currentQ.question), color: 'var(--ink-3)', margin: 0, lineHeight: 1.5 }}>
                <MathText text={currentQ.question} dir={getDir(currentQ.question, room.force_rtl)} />
              </p>
              {currentQ.image_url && (
                <QuestionImage src={currentQ.image_url} style={{ width: '100%', maxHeight: 120, objectFit: 'contain', marginTop: 10, border: '1px solid var(--rule)' }} />
              )}
            </div>

            {/* Revealed choices */}
            <div dir={getDir(currentQ.question, room.force_rtl)} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {currentQ.choices.map((choice, idx) => {
                const revealedAnswer = room.revealed_answers?.[room.current_question_index]
                const isCorrect = choice === revealedAnswer
                const isPicked  = idx === selectedChoice
                return (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 14px',
                    border: isCorrect
                      ? '2px solid #22c55e'
                      : isPicked
                        ? `2px solid var(--alert)`
                        : '1px solid var(--rule)',
                    background: isCorrect
                      ? 'rgba(34,197,94,0.07)'
                      : isPicked
                        ? 'rgba(180,48,57,0.07)'
                        : 'var(--paper)',
                    opacity: (!isCorrect && !isPicked) ? 0.3 : 1,
                  }}>
                    <span style={{
                      width: 26, height: 26, flexShrink: 0,
                      background: isCorrect ? '#22c55e' : isPicked ? 'var(--alert)' : 'transparent',
                      border: `1px solid ${isCorrect ? '#22c55e' : isPicked ? 'var(--alert)' : 'var(--rule)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
                      color: (isCorrect || isPicked) ? 'var(--paper)' : 'var(--ink-3)',
                    }}>
                      {isCorrect ? '✓' : isPicked ? '✗' : String.fromCharCode(65 + idx)}
                    </span>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.4 }}>
                      <MathText text={choice} dir={getDir(choice, room.force_rtl)} />
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Result card */}
            {revealedResult ? (
              <div style={{
                border: revealedResult.didNotAnswer
                  ? '1px solid var(--rule)'
                  : revealedResult.is_correct
                    ? '1px solid #22c55e'
                    : '1px solid var(--alert)',
                background: revealedResult.didNotAnswer
                  ? 'var(--paper-2)'
                  : revealedResult.is_correct
                    ? 'rgba(34,197,94,0.07)'
                    : 'rgba(180,48,57,0.07)',
                padding: '16px', textAlign: 'center',
              }}>
                {revealedResult.didNotAnswer ? (
                  <p className="ar" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-3)', margin: 0 }}>انتهى الوقت!</p>
                ) : revealedResult.is_correct ? (
                  <>
                    <p style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 400, color: '#22c55e', margin: '0 0 4px' }}>Correct!</p>
                    {revealedResult.points_earned > 0 ? (
                      <p className="ar" style={{ fontSize: 13, color: '#22c55e', margin: 0 }}>عاش يا بطل، أخدت {revealedResult.points_earned} نقطة</p>
                    ) : (
                      <p className="ar" style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0 }}>إجابة صحيحة! لكن لم يحالفك الحظ في النقاط.</p>
                    )}
                  </>
                ) : (
                  <>
                    <p style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 400, color: 'var(--alert)', margin: '0 0 4px' }}>Wrong.</p>
                    <p className="ar" style={{ fontSize: 13, color: 'var(--alert)', margin: 0 }}>غلط! معلش، ركز في اللى جاي</p>
                  </>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <Loader2 size={18} style={{ color: 'var(--ink-3)', animation: 'spin 1s linear infinite', margin: '0 auto 6px' }} />
                <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)', margin: 0 }}>جاري التحميل…</p>
              </div>
            )}

            {/* Honor Roll */}
            {revealedResult?.winners?.length > 0 && (
              <div style={{ border: '1px solid var(--rule)' }}>
                <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="folio" style={{ letterSpacing: '0.18em' }}>QUESTION HONOR ROLL</span>
                </div>
                <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {revealedResult.winners.map(w => {
                    const isMe = w.user_id === myId
                    return (
                      <div key={w.user_id} style={{
                        padding: '9px 14px', borderBottom: '1px solid var(--rule)',
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: isMe ? 'var(--paper-2)' : 'var(--paper)',
                      }}>
                        <div style={{
                          width: 22, height: 22, flexShrink: 0,
                          background: w.rank === 1 ? 'var(--gold)' : w.rank === 2 ? 'var(--ink-3)' : 'var(--rule)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
                          color: w.rank <= 2 ? 'var(--paper)' : 'var(--ink)',
                        }}>
                          {w.rank}
                        </div>
                        <span style={{ fontFamily: 'var(--serif)', fontSize: 13, color: 'var(--ink)', flex: 1 }}>
                          {isMe ? 'أنا' : w.nickname}
                        </span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)', marginLeft: 'auto' }}>{w.time_ms}ms</span>
                        <span style={{
                          fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700,
                          color: isMe ? 'var(--burgundy)' : 'var(--ink)', marginLeft: 6,
                        }}>+{w.points}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {revealedResult && (
              <p className="ar" style={{ textAlign: 'center', fontSize: 11, color: 'var(--ink-4)' }}>في انتظار الهوست…</p>
            )}
          </div>
        )}

        {/* ────────── FINISHED ─────────────────────────────────────────── */}
        {room.status === 'finished' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            <div style={{ textAlign: 'center', maxWidth: 360, width: '100%' }}>
              <p className="folio" style={{ marginBottom: 16, letterSpacing: '0.3em' }}>GAME FINISHED</p>
              <h1 style={{
                fontFamily: 'var(--serif)', fontSize: 'clamp(40px, 10vw, 64px)',
                fontWeight: 400, lineHeight: 1.0, letterSpacing: '-0.025em',
                color: 'var(--ink)', margin: '0 0 8px',
              }}>
                انتهت!
              </h1>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 48, fontWeight: 700, color: 'var(--ink)', margin: '0 0 24px' }}>
                {player.score}
                <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-4)', marginLeft: 4 }}>pts</span>
              </p>

              {/* Top 5 final */}
              {top5.length > 0 && (
                <div style={{ border: '1px solid var(--rule)', marginBottom: 24 }}>
                  {top5.map(p => (
                    <div key={p.user_id} style={{
                      padding: '9px 14px', borderBottom: '1px solid var(--rule)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: p.user_id === myId ? 'var(--paper-2)' : 'var(--paper)',
                    }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)', minWidth: 20 }}>#{p.rank}</span>
                      <span style={{ fontFamily: 'var(--serif)', fontSize: 14, color: 'var(--ink)', flex: 1, textAlign: 'left', marginLeft: 8 }}>{p.nickname}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{p.score}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {room.tournament_id && (
                  <div>
                    <button
                      onClick={() => navigate(`/tournament/${room.tournament_id}/wait`, { replace: true })}
                      style={{
                        width: '100%', padding: '13px 20px',
                        background: 'var(--ink)', color: 'var(--paper)',
                        border: '1px solid var(--ink)', fontFamily: 'var(--arabic)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      متابعة البطولة{autoNavCountdown !== null ? ` (${autoNavCountdown}ث)` : ''}
                    </button>
                    {autoNavCountdown !== null && (
                      <p className="ar" style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>سيتم الانتقال تلقائياً…</p>
                    )}
                  </div>
                )}
                <button
                  onClick={downloadLogs}
                  disabled={downloadingLogs}
                  style={{
                    width: '100%', padding: '11px 20px',
                    background: 'var(--paper-2)', color: 'var(--ink)',
                    border: '1px solid var(--rule)',
                    fontFamily: 'var(--sans)', fontSize: 13, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    opacity: downloadingLogs ? 0.5 : 1,
                  }}
                >
                  {downloadingLogs
                    ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> جاري التحميل...</>
                    : <><Download size={13} /> تحميل اللوجز</>}
                </button>
                {!room.tournament_id && (
                  <button
                    onClick={() => navigate('/')}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
                      textTransform: 'uppercase', color: 'var(--ink-4)', padding: '8px 0',
                    }}
                  >
                    الرئيسية →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
