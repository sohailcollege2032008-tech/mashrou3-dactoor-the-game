import React, { useEffect, useState, useRef } from 'react'
import MathText from '../../components/common/MathText'
import { useParams, useNavigate } from 'react-router-dom'
import { ref, onValue, get, set, runTransaction, onDisconnect } from 'firebase/database'
import { doc, updateDoc, increment, getDoc, setDoc, addDoc, serverTimestamp, collection } from 'firebase/firestore'
import { rtdb, db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useServerClock } from '../../hooks/useServerClock'
import { Trophy, Clock, CheckCircle2, XCircle, AlertCircle, Zap, WifiOff, Download, Loader2, Edit2, Check, X, Star } from 'lucide-react'
import confetti from 'canvas-confetti'
import QuestionImage from '../../components/QuestionImage'
import { signAnswer, validateReactionTime, verifyAnswerHash } from '../../utils/crypto'
import { initActivityLogger, getActivityLogger, logActivity } from '../../utils/activityLogger'
import { getDir } from '../../utils/rtlUtils'
import { useUnattendedGameRunner } from '../../hooks/useUnattendedGameRunner'

// ── Mini leaderboard strip ────────────────────────────────────────────────────
// top5: [{rank, user_id, nickname, score}] — from rooms/${roomId}/leaderboard/top5
// myId, myRank, myScore, myNickname — player's own data (from player node)
function MiniLeaderboard({ top5, myId, myRank, myScore, myNickname }) {
  if (!top5 || top5.length === 0) return null
  const isMeInTop5 = top5.some(p => p.user_id === myId)

  return (
    <div className="w-full max-w-2xl mb-3">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
        {top5.map(p => {
          const isMe = p.user_id === myId
          return (
            <div key={p.user_id}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0 transition-colors ${
                isMe
                  ? 'bg-primary/20 border border-primary/50 text-primary'
                  : 'bg-gray-800/80 border border-gray-700 text-gray-300'
              }`}
            >
              <span className="text-gray-500 font-mono">#{p.rank}</span>
              <span className="max-w-[80px] truncate">{p.nickname}</span>
              <span className={`font-mono ${isMe ? 'text-primary' : 'text-gray-400'}`}>{p.score}</span>
            </div>
          )
        })}
        {/* Show my chip only if I'm not in top 5 */}
        {!isMeInTop5 && myRank && (
          <>
            <span className="text-gray-700 text-xs flex-shrink-0">···</span>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0 bg-primary/20 border border-primary/50 text-primary">
              <span className="text-gray-500 font-mono">#{myRank}</span>
              <span className="max-w-[80px] truncate">{myNickname}</span>
              <span className="font-mono text-primary">{myScore}</span>
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

  const pct    = (remaining / duration) * 100
  const urgent  = remaining < duration * 0.25
  const expired = remaining === 0

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${
      expired ? 'border-gray-700 bg-gray-800/40'
      : urgent ? 'border-red-500/50 bg-red-500/10'
      : 'border-primary/40 bg-primary/5'
    }`}>
      <Clock size={13} className={expired ? 'text-gray-600' : urgent ? 'text-red-400 animate-pulse' : 'text-primary'} />
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-none ${expired ? 'bg-gray-600' : urgent ? 'bg-red-400' : 'bg-primary'}`}
          style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono font-bold text-sm w-10 text-right tabular-nums ${
        expired ? 'text-gray-500' : urgent ? 'text-red-400' : 'text-primary'
      }`}>
        {expired ? 'Done' : `${Math.ceil(remaining)}s`}
      </span>
    </div>
  )
}

// ── Dynamic font size for question text ───────────────────────────────────────
function questionFontClass(text = '') {
  const len = text.length
  if (len > 220) return 'text-sm'
  if (len > 120) return 'text-base'
  return 'text-lg'
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

  // Nickname editing
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

  // ── Player presence ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const uid = session.uid
    const presRef = ref(rtdb, `rooms/${roomId}/presence/players/${uid}`)
    set(presRef, { online: true, last_seen: Date.now() })
    onDisconnect(presRef).set({ online: false, last_seen: Date.now() })
    return () => set(presRef, { online: false, last_seen: Date.now() })
  }, [roomId, session])

  // ── Host presence ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const unsub = onValue(ref(rtdb, `rooms/${roomId}/presence/host`), snap => {
      setHostOnline(!snap.exists() || snap.val().online !== false)
    })
    return () => unsub()
  }, [roomId, session])

  // ── Room subscription ─────────────────────────────────────────────────────
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

        if (qSetId && uid) {
          // Increment played count
          updateDoc(doc(db, 'profiles', uid), {
            [`played_decks.${qSetId}`]: increment(1)
          }).catch(() => {})

          ;(async () => {
            try {
              const [deckSnap, hostSnap] = await Promise.all([
                getDoc(doc(db, 'question_sets', qSetId)),
                hostUid ? getDoc(doc(db, 'profiles', hostUid)) : Promise.resolve(null),
              ])
              const deckData = deckSnap.data() || {}
              const hostName = hostSnap?.data()?.display_name || 'دكتور'
              const myScore  = data.players?.[uid]?.score ?? 0

              // ── Write game history entry ────────────────────────────────
              await setDoc(doc(db, 'profiles', uid, 'game_history', roomId), {
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
              })

              // Track that this host has hosted us (for phone visibility)
              if (hostUid) {
                updateDoc(doc(db, 'profiles', uid), {
                  [`hosted_by.${hostUid}`]: hostName,
                }).catch(() => {})
              }

              // ── Write player notification ───────────────────────────────
              const sortedLeaderboard = data.players
                ? Object.values(data.players)
                    .sort((a, b) => (b.score || 0) - (a.score || 0))
                    .map((p, i) => ({
                      rank: i + 1, user_id: p.user_id,
                      nickname: p.nickname, score: p.score || 0,
                    }))
                : []
              const myRank = sortedLeaderboard.findIndex(p => p.user_id === uid) + 1

              // Use roomId as document ID so re-navigating never duplicates
              await setDoc(doc(db, 'notifications', uid, 'items', roomId), {
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
              }, { merge: false })

              // ── Write host notification (backup for unattended mode) ────
              // Only write if host notification doesn't exist yet (use room-keyed doc)
              if (hostUid) {
                setDoc(
                  doc(db, 'notifications', hostUid, 'items', roomId),
                  {
                    type:            'game_finished',
                    room_id:         roomId,
                    room_title:      data.title || roomId,
                    total_players:   sortedLeaderboard.length,
                    winner_nickname: sortedLeaderboard[0]?.nickname || null,
                    results_url:     `/host/game/${roomId}`,
                    created_at:      serverTimestamp(),
                    read:            false,
                  },
                  { merge: false }   // don't overwrite if host already wrote it
                ).catch(() => {})   // silently ignore — host may have already written
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

  // ── My player node ────────────────────────────────────────────────────────
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

  // ── Leaderboard subscription (top 5 only — minimal bandwidth) ────────────
  useEffect(() => {
    if (!session) return
    const unsub = onValue(ref(rtdb, `rooms/${roomId}/leaderboard/top5`), snap => {
      setTop5(snap.exists() ? Object.values(snap.val()) : [])
    })
    return () => unsub()
  }, [roomId, session])

  // ── Unattended game runner ────────────────────────────────────────────────
  // When unattended_mode is on, this client acts as a backup runner so the
  // game advances even if the host closes their browser.
  useUnattendedGameRunner({ roomId, room, session })

  // ── Rejoin: load existing answer ──────────────────────────────────────────
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

  // ── Fetch result after reveal ─────────────────────────────────────────────
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

  // ── Submit answer with cryptographic signing ──────────────────────────────────
  const handleChoiceClick = async (choiceIndex) => {
    if (answerLocked || !room || !session) return

    const serverNow  = Date.now() + clockOffset.current
    const reactionMs = questionServerStartRef.current
      ? Math.round(serverNow - questionServerStartRef.current)
      : 5000

    setSelectedChoice(choiceIndex)
    setAnswerLocked(true)

    // Initialize activity logger if not already done
    let logger = getActivityLogger()
    if (!logger) {
      logger = initActivityLogger(session.uid, roomId)
    }

    const uid    = session.uid
    const qIdx   = room.current_question_index

    // SECURITY: Validate reaction time (detect impossible speeds)
    const questionLimit = room.config?.timer_seconds || 30
    const timeValidation = validateReactionTime(reactionMs, questionLimit)
    const isAnomalous = timeValidation.isAnomalous

    if (isAnomalous) {
      logger.addLog('anomalous_reaction_time', {
        reaction_time_ms: reactionMs,
        reason: timeValidation.reason,
        question_index: qIdx
      })
    }

    // SECURITY: Prepare answer for signing (NO is_correct field!)
    const answerData = {
      selected_choice: choiceIndex,
      reaction_time: reactionMs,
      timestamp: Date.now(),
      room_id: roomId,
      user_id: uid,
      question_index: qIdx
    }

    // SECURITY: Get game secret (stored in room config or generated per room)
    let gameSecret = room.game_secret || 'default-secret-' + roomId
    if (!room.game_secret) {
      // If no secret in room, use room ID + created timestamp to make it harder to predict
      gameSecret = 'secure-' + roomId + '-' + (room.created_at || 'generated')
    }

    // SECURITY: Sign the answer to prevent tampering
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

    // Log the submission
    logger.logAnswerSubmission({
      ...answerData,
      signature: signature.substring(0, 16) + '...' // Log partial signature for record
    })

    const answerRef = ref(rtdb, `rooms/${roomId}/answers/${qIdx}/${uid}`)

    // SECURITY: Submit answer WITHOUT is_correct field
    // Server/Host will verify the answer using the signature and correct answer hash
    await runTransaction(answerRef, current => {
      if (current !== null) return undefined  // already answered — abort
      return {
        user_id:          uid,
        player_name:      player?.nickname || 'Unknown',
        selected_choice:  choiceIndex,
        // NOTE: is_correct is NOT sent - server/host calculates it
        is_anomalous:     isAnomalous,
        reaction_time_ms: reactionMs,
        signature:        signature,  // Cryptographic proof of answer integrity
        submitted_at:     Date.now(),
      }
    })
  }

  // ── Nickname editing ──────────────────────────────────────────────────────
  const saveNickname = async () => {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === player?.nickname) { setEditingName(false); return }
    setSavingName(true)
    try {
      await update(ref(rtdb, `rooms/${roomId}/players/${session.uid}`), { nickname: trimmed })
    } catch (err) { alert('Error: ' + err.message) }
    finally { setSavingName(false); setEditingName(false) }
  }

  // ── Download game logs ────────────────────────────────────────────────────
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

      // Read all players for the room
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
          const isMatch = await verifyAnswerHash(
            i, 
            q.correct_hash, 
            `${roomId}-q${qi}`, 
            roomId, 
            secretKey
          )
          if (isMatch) {
            correctIdx = i
            break
          }
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

      const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/plain;charset=utf-8' })
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

  // Preload next question's image while answering current one (must be before early return)
  const nextQImg = room?.questions?.questions?.[room?.current_question_index + 1]?.image_url
  useEffect(() => {
    if (!nextQImg) return
    const img = new Image()
    img.src = nextQImg
  }, [nextQImg])

  // ─────────────────────────────────────────────────────────────────────────
  if (!room || !player) return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-white">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400">Joining game...</p>
      </div>
    </div>
  )

  const currentQ = room.questions?.questions?.[room.current_question_index]
  const myId     = session?.uid

  return (
    <div className="flex flex-col h-screen bg-background text-white overflow-hidden">

      {/* Host offline banner */}
      {!hostOnline && room?.status !== 'finished' && !room?.config?.unattended_mode && (
        <div className="bg-red-500/20 border-b border-red-500/40 px-4 py-2 flex items-center justify-center gap-2 text-red-300 text-sm font-bold flex-shrink-0">
          <WifiOff size={15} /> الهوست خرج — في انتظار عودته...
        </div>
      )}

      {/* Top bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex justify-between items-center shadow-lg flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
          {player.avatar_url && (
            <img src={player.avatar_url} alt="" className="w-9 h-9 rounded-full border-2 border-primary flex-shrink-0" />
          )}
          {/* Inline nickname editor — only in lobby */}
          {editingName ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                autoFocus
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveNickname(); if (e.key === 'Escape') setEditingName(false) }}
                maxLength={30}
                className="flex-1 min-w-0 bg-gray-800 border border-primary rounded-lg px-3 py-1 text-white font-bold text-sm focus:outline-none"
              />
              <button onClick={saveNickname} disabled={savingName}
                className="p-1.5 bg-primary/20 text-primary rounded-lg hover:bg-primary/30 transition-colors flex-shrink-0">
                {savingName ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              </button>
              <button onClick={() => setEditingName(false)}
                className="p-1.5 bg-gray-700 text-gray-400 rounded-lg hover:bg-gray-600 transition-colors flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold text-base truncate">{player.nickname}</span>
              {/* Edit icon — only in lobby */}
              {room?.status === 'lobby' && (
                <button
                  onClick={() => { setNameInput(player.nickname); setEditingName(true) }}
                  className="p-1 text-gray-600 hover:text-primary transition-colors flex-shrink-0"
                  title="تغيير الاسم"
                >
                  <Edit2 size={13} />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-xl flex-shrink-0">
          <Trophy className="text-[#FFD700]" size={16} />
          <span className="font-mono text-lg font-bold">{player.score} PTS</span>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col items-center overflow-y-auto px-4 pt-4 pb-4">

        {/* ── LOBBY ──────────────────────────────────────────────────────── */}
        {room.status === 'lobby' && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-6 max-w-md w-full">
              <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mx-auto border-4 border-primary">
                <Clock size={36} className="text-primary animate-pulse" />
              </div>
              <h1 className="text-3xl font-display font-bold">You're In!</h1>
              <p className="text-lg text-gray-400">في انتظار <span className="text-white font-bold">{room.title}</span></p>
            </div>
          </div>
        )}

        {/* ── PLAYING ────────────────────────────────────────────────────── */}
        {room.status === 'playing' && currentQ && (
          <div className="w-full max-w-2xl flex flex-col gap-3">

            {/* Late-joiner notice */}
            {player?.joined_at_question_index > 0 && (
              <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-3 py-2 flex items-center gap-2 text-xs text-orange-300">
                <span className="flex-shrink-0"><AlertCircle size={13} /></span>
                <span>دخلت من سؤال {player.joined_at_question_index + 1} — الأسئلة السابقة محسوبة صفر.</span>
              </div>
            )}
            {/* Mini leaderboard */}
            <MiniLeaderboard top5={top5} myId={myId} myRank={player?.rank} myScore={player?.score} myNickname={player?.nickname} />

            {/* Question card */}
            <div dir={getDir(currentQ.question, room.force_rtl)} className="bg-gray-900/80 rounded-2xl border border-gray-800 p-4 flex-shrink-0 space-y-3">
              <span className="text-primary font-bold text-xs tracking-widest uppercase block">
                سؤال {room.current_question_index + 1} / {room.questions.questions.length}
              </span>
              <p className={`text-white font-bold ${questionFontClass(currentQ.question)} leading-snug`}>
                <MathText text={currentQ.question} dir={getDir(currentQ.question, room.force_rtl)} />
              </p>
              {currentQ.image_url && (
                <QuestionImage src={currentQ.image_url} className="w-full max-h-36 object-contain rounded-xl border border-gray-700 bg-gray-950" />
              )}
              {/* Countdown bar — appears when host starts it */}
              {room.countdown_started_at && (
                <PlayerCountdown startedAt={room.countdown_started_at} duration={room.countdown_duration} />
              )}
            </div>

            {/* Choices */}
            {!answerLocked ? (
              <div dir={getDir(currentQ.question, room.force_rtl)} className="grid grid-cols-2 gap-2">
                {currentQ.choices.map((choice, idx) => (
                  <button key={idx} onClick={() => handleChoiceClick(idx)}
                    className="flex items-center gap-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl px-4 py-3 transition-all active:scale-95 group">
                    <span className="w-8 h-8 rounded-lg bg-gray-700 group-hover:bg-primary/20 text-gray-300 group-hover:text-primary font-bold flex-shrink-0 flex items-center justify-center text-sm transition-colors">
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className="text-white font-medium text-sm leading-snug">
                      <MathText text={choice} dir={getDir(choice, room.force_rtl)} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div dir={getDir(currentQ.question, room.force_rtl)} className="grid grid-cols-2 gap-2">
                  {currentQ.choices.map((choice, idx) => {
                    const isPicked = idx === selectedChoice
                    return (
                      <div key={idx} className={`flex items-center gap-3 border rounded-xl px-4 py-3 transition-all ${
                        isPicked
                          ? 'bg-primary/10 border-primary'
                          : 'bg-gray-900/50 border-gray-800 opacity-40'
                      }`}>
                        <span className={`w-8 h-8 rounded-lg font-bold flex-shrink-0 flex items-center justify-center text-sm ${
                          isPicked ? 'bg-primary text-background' : 'bg-gray-700 text-gray-400'
                        }`}>
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <span className={`font-medium text-sm leading-snug ${isPicked ? 'text-white' : 'text-gray-400'}`}>
                          <MathText text={choice} dir={getDir(choice, room.force_rtl)} />
                        </span>
                        {isPicked && <Zap size={13} className="ml-auto flex-shrink-0 text-primary" fill="currentColor" />}
                      </div>
                    )
                  })}
                </div>
                <div className="py-2 text-center">
                  <div className="inline-flex items-center gap-2 bg-gray-900 border border-gray-700 px-4 py-2 rounded-full">
                    <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                    <span className="ar text-gray-400 text-sm">في انتظار الكشف...</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── REVEALING ──────────────────────────────────────────────────── */}
        {room.status === 'revealing' && currentQ && (
          <div className="w-full max-w-2xl flex flex-col gap-3">

            {/* Mini leaderboard */}
            <MiniLeaderboard top5={top5} myId={myId} myRank={player?.rank} myScore={player?.score} myNickname={player?.nickname} />

            {/* Question */}
            <div dir={getDir(currentQ.question, room.force_rtl)} className="bg-gray-900/80 rounded-2xl border border-gray-800 p-4 flex-shrink-0 space-y-2">
              <p className={`text-gray-300 font-medium ${questionFontClass(currentQ.question)} leading-snug`}>
                <MathText text={currentQ.question} dir={getDir(currentQ.question, room.force_rtl)} />
              </p>
              {currentQ.image_url && (
                <QuestionImage src={currentQ.image_url} className="w-full max-h-28 object-contain rounded-xl border border-gray-700 bg-gray-950" />
              )}
            </div>

            {/* Choices with correct highlight (revealed_answer shows only text, not index) */}
            <div dir={getDir(currentQ.question, room.force_rtl)} className="grid grid-cols-2 gap-2 flex-shrink-0">
              {currentQ.choices.map((choice, idx) => {
                const revealedAnswer = room.revealed_answers?.[room.current_question_index]
                const isCorrect = choice === revealedAnswer
                const isPicked  = idx === selectedChoice
                return (
                  <div key={idx} className={`flex items-center gap-3 border rounded-xl px-4 py-3 transition-all ${
                    isCorrect
                      ? 'bg-primary/15 border-primary shadow-[0_0_12px_rgba(0,255,255,0.12)]'
                      : isPicked
                        ? 'bg-red-500/15 border-red-500'
                        : 'bg-gray-900/30 border-gray-800 opacity-30'
                  }`}>
                    <span className={`w-8 h-8 rounded-lg font-bold flex-shrink-0 flex items-center justify-center text-sm ${
                      isCorrect ? 'bg-primary text-background' : isPicked ? 'bg-red-500 text-white' : 'bg-gray-700 text-gray-400'
                    }`}>
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className={`font-medium text-sm leading-snug ${isCorrect || isPicked ? 'text-white' : 'text-gray-400'}`}>
                      <MathText text={choice} dir={getDir(choice, room.force_rtl)} />
                    </span>
                    {isCorrect && <CheckCircle2 size={14} className="ml-auto flex-shrink-0 text-primary" />}
                    {!isCorrect && isPicked && <XCircle size={14} className="ml-auto flex-shrink-0 text-red-400" />}
                  </div>
                )
              })}
            </div>

            {/* Result card & Honor Roll */}
            <div className="w-full flex flex-col gap-4">
              {revealedResult ? (
                <div className={`w-full p-5 rounded-2xl border ${
                  revealedResult.didNotAnswer
                    ? 'bg-gray-900/80 border-gray-700'
                    : revealedResult.is_correct
                      ? 'bg-primary/10 border-primary shadow-[0_0_30px_rgba(0,255,255,0.1)]'
                      : 'bg-red-900/20 border-red-700'
                }`}>
                  {revealedResult.didNotAnswer ? (
                    <div className="ar text-center">
                      <AlertCircle size={40} className="mx-auto mb-2 text-gray-500" />
                      <h3 className="text-xl font-bold text-gray-400">انتهى الوقت!</h3>
                    </div>
                  ) : revealedResult.is_correct ? (
                    <div className="ar text-center">
                      <CheckCircle2 size={40} className="mx-auto mb-2 text-primary" />
                      <h3 className="text-2xl font-bold text-primary">صح! 🎉</h3>
                      {revealedResult.points_earned > 0 ? (
                        <p className="text-primary/70 text-sm mt-1">عاش يا بطل، أخدت {revealedResult.points_earned} نقطة</p>
                      ) : (
                        <p className="text-primary/70 text-sm mt-1 italic opacity-80">إجابة صحيحة! لكن لم يحالفك الحظ في النقاط هذه المرة.</p>
                      )}
                    </div>
                  ) : (
                    <div className="ar text-center">
                      <XCircle size={40} className="mx-auto mb-2 text-red-500" />
                      <h3 className="text-xl font-bold text-red-400">غلط! معلش</h3>
                      <p className="text-red-400/60 text-sm mt-1">ركز في اللى جاي</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full text-center text-gray-500 py-4">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-sm">جاري التحميل...</p>
                </div>
              )}

              {/* Question Honor Roll */}
              {revealedResult && revealedResult.winners && revealedResult.winners.length > 0 && (
                <div className="bg-gray-900/50 rounded-2xl border border-gray-800 p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                    <h3 className="text-xs font-bold text-gray-400 flex items-center gap-1.5 uppercase tracking-wider">
                      <Star size={12} className="text-yellow-500" /> لوحة شرف السؤال
                    </h3>
                  </div>
                  
                  <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                    {revealedResult.winners.map((w) => {
                      const isMe = w.user_id === myId
                      return (
                        <div key={w.user_id} 
                          className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
                            isMe 
                              ? 'bg-primary/10 border-primary shadow-[0_0_10px_rgba(0,255,255,0.1)]' 
                              : 'bg-gray-800/50 border-gray-700'
                          }`}
                        >
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-[10px] shrink-0 ${
                            w.rank === 1 ? 'bg-yellow-500 text-black' :
                            w.rank === 2 ? 'bg-gray-300 text-black' :
                            w.rank === 3 ? 'bg-orange-400 text-black' :
                            'bg-gray-700 text-gray-400'
                          }`}>
                            {w.rank}
                          </div>
                          
                          <span className={`text-sm font-bold truncate flex-1 ${isMe ? 'text-primary' : 'text-white'}`}>
                            {isMe ? 'أنا' : w.nickname}
                          </span>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500 font-mono italic">{w.time_ms}ms</span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${isMe ? 'bg-primary/20 text-primary' : 'bg-gray-700 text-gray-400'}`}>
                              +{w.points}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {revealedResult && (
                <p className="ar text-gray-600 mt-1 flex items-center justify-center gap-1.5 text-[10px]">
                  <AlertCircle size={10} /> في انتظار الهوست...
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── FINISHED ───────────────────────────────────────────────────── */}
        {room.status === 'finished' && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Trophy size={80} className="mx-auto text-[#FFD700] mb-6" />
              <h1 className="text-5xl font-display font-bold mb-3">انتهت!</h1>
              <p className="text-xl text-gray-400 mb-2">نقاطك النهائية</p>
              <p className="text-5xl font-mono font-bold text-primary mb-8">{player.score}</p>
              {/* Mini final leaderboard — uses top5 (already minimal) */}
              {top5.length > 0 && (
                <div className="space-y-2 max-w-xs mx-auto mb-8">
                  {top5.map(p => (
                    <div key={p.user_id} className={`flex items-center justify-between px-4 py-2 rounded-xl text-sm ${
                      p.user_id === myId ? 'bg-primary/20 border border-primary text-primary' : 'bg-gray-800 border border-gray-700'
                    }`}>
                      <span className="font-bold">#{p.rank} {p.nickname}</span>
                      <span className="font-mono font-bold">{p.score}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-3 justify-center flex-wrap">
                <button
                  onClick={downloadLogs}
                  disabled={downloadingLogs}
                  className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 font-bold py-3 px-6 rounded-xl transition-colors disabled:opacity-50"
                >
                  {downloadingLogs
                    ? <><Loader2 size={15} className="animate-spin" /> جاري التحميل...</>
                    : <><Download size={15} /> تحميل اللوجز</>}
                </button>
                <button onClick={() => navigate('/')}
                  className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-8 rounded-xl transition-colors">
                  الرئيسية
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
