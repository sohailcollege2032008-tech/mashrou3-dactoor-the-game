import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ref, onValue, get, set, runTransaction, onDisconnect } from 'firebase/database'
import { rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useServerClock } from '../../hooks/useServerClock'
import { Trophy, Clock, CheckCircle2, XCircle, AlertCircle, Zap, WifiOff, Download, Loader2 } from 'lucide-react'
import confetti from 'canvas-confetti'

// ── Mini leaderboard strip ────────────────────────────────────────────────────
function MiniLeaderboard({ players, myId }) {
  if (!players || players.length === 0) return null
  const top = players.slice(0, 5)
  const myRank = players.findIndex(p => p.user_id === myId) + 1

  return (
    <div className="w-full max-w-2xl mb-3">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
        {top.map((p, i) => {
          const isMe = p.user_id === myId
          return (
            <div key={p.user_id}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0 transition-colors ${
                isMe
                  ? 'bg-primary/20 border border-primary/50 text-primary'
                  : 'bg-gray-800/80 border border-gray-700 text-gray-300'
              }`}
            >
              <span className="text-gray-500 font-mono">#{i + 1}</span>
              <span className="max-w-[80px] truncate">{p.nickname}</span>
              <span className={`font-mono ${isMe ? 'text-primary' : 'text-gray-400'}`}>{p.score}</span>
            </div>
          )
        })}
        {/* Show my rank if not in top 5 */}
        {myRank > 5 && (
          <>
            <span className="text-gray-700 text-xs flex-shrink-0">···</span>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0 bg-primary/20 border border-primary/50 text-primary">
              <span className="text-gray-500 font-mono">#{myRank}</span>
              <span className="max-w-[80px] truncate">{players[myRank - 1]?.nickname}</span>
              <span className="font-mono text-primary">{players[myRank - 1]?.score}</span>
            </div>
          </>
        )}
      </div>
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
      if (data.status === 'finished') {
        confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 } })
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

  // ── Leaderboard subscription ──────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const unsub = onValue(ref(rtdb, `rooms/${roomId}/players`), snap => {
      if (!snap.exists()) { setLeaderboard([]); return }
      setLeaderboard(Object.values(snap.val()).sort((a, b) => b.score - a.score))
    })
    return () => unsub()
  }, [roomId, session])

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
      })
      if (a.is_correct) confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } })
    } else {
      setRevealedResult({ didNotAnswer: true, winner_nickname: winnerNickname })
    }
  }

  // ── Submit answer ─────────────────────────────────────────────────────────
  const handleChoiceClick = async (choiceIndex) => {
    if (answerLocked || !room || !session) return

    const serverNow  = Date.now() + clockOffset.current
    const reactionMs = questionServerStartRef.current
      ? Math.round(serverNow - questionServerStartRef.current)
      : 5000

    setSelectedChoice(choiceIndex)
    setAnswerLocked(true)

    const uid          = session.uid
    const qIdx         = room.current_question_index
    const correctChoice = room.questions.questions[qIdx].correct
    const isCorrect    = choiceIndex === correctChoice
    const answerRef    = ref(rtdb, `rooms/${roomId}/answers/${qIdx}/${uid}`)

    await runTransaction(answerRef, current => {
      if (current !== null) return undefined  // already answered — abort
      return {
        user_id:          uid,
        player_name:      player?.nickname || 'Unknown',
        selected_choice:  choiceIndex,
        is_correct:       isCorrect,
        is_first_correct: false,
        reaction_time_ms: reactionMs,
        submitted_at:     Date.now(),
      }
    })
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

      lines.push('=== Mashrou3 Dactoor — Game Log ===')
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
        lines.push(`Correct: ${q.choices[q.correct] || '?'}`)
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
      {!hostOnline && room?.status !== 'finished' && (
        <div className="bg-red-500/20 border-b border-red-500/40 px-4 py-2 flex items-center justify-center gap-2 text-red-300 text-sm font-bold flex-shrink-0">
          <WifiOff size={15} /> الهوست خرج — في انتظار عودته...
        </div>
      )}

      {/* Top bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex justify-between items-center shadow-lg flex-shrink-0">
        <div className="flex items-center gap-3">
          {player.avatar_url && (
            <img src={player.avatar_url} alt="" className="w-9 h-9 rounded-full border-2 border-primary" />
          )}
          <span className="font-bold text-base">{player.nickname}</span>
        </div>
        <div className="flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-xl">
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

            {/* Mini leaderboard */}
            <MiniLeaderboard players={leaderboard} myId={myId} />

            {/* Question card */}
            <div className="bg-gray-900/80 rounded-2xl border border-gray-800 p-4 flex-shrink-0">
              <span className="text-primary font-bold text-xs tracking-widest uppercase block mb-2">
                سؤال {room.current_question_index + 1} / {room.questions.questions.length}
              </span>
              <p className={`text-white font-bold ${questionFontClass(currentQ.question)} leading-snug`}>
                {currentQ.question}
              </p>
              {currentQ.image_url && (
                <img src={currentQ.image_url} alt="q" className="mt-3 w-full max-h-36 object-contain rounded-xl border border-gray-700 bg-gray-950" />
              )}
            </div>

            {/* Choices */}
            {!answerLocked ? (
              <div className="grid grid-cols-2 gap-2">
                {currentQ.choices.map((choice, idx) => (
                  <button key={idx} onClick={() => handleChoiceClick(idx)}
                    className="flex items-center gap-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl px-4 py-3 text-left transition-all active:scale-95 group">
                    <span className="w-8 h-8 rounded-lg bg-gray-700 group-hover:bg-primary/20 text-gray-300 group-hover:text-primary font-bold flex-shrink-0 flex items-center justify-center text-sm transition-colors">
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className="text-white font-medium text-sm leading-snug">{choice}</span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
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
                          {choice}
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
            <MiniLeaderboard players={leaderboard} myId={myId} />

            {/* Question */}
            <div className="bg-gray-900/80 rounded-2xl border border-gray-800 p-4 flex-shrink-0">
              <p className={`text-gray-300 font-medium ${questionFontClass(currentQ.question)} leading-snug`}>
                {currentQ.question}
              </p>
              {currentQ.image_url && (
                <img src={currentQ.image_url} alt="q" className="mt-2 w-full max-h-28 object-contain rounded-xl border border-gray-700 bg-gray-950" />
              )}
            </div>

            {/* Choices with correct highlight */}
            <div className="grid grid-cols-2 gap-2 flex-shrink-0">
              {currentQ.choices.map((choice, idx) => {
                const isCorrect = idx === currentQ.correct
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
                      {choice}
                    </span>
                    {isCorrect && <CheckCircle2 size={14} className="ml-auto flex-shrink-0 text-primary" />}
                    {!isCorrect && isPicked && <XCircle size={14} className="ml-auto flex-shrink-0 text-red-400" />}
                  </div>
                )
              })}
            </div>

            {/* Result card */}
            <div className="flex-1 flex items-center">
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
                      {revealedResult.winner_nickname && (
                        <p className="text-gray-500 text-sm mt-1">
                          الأول: <span className="text-[#FFD700] font-bold">{revealedResult.winner_nickname}</span>
                        </p>
                      )}
                    </div>
                  ) : revealedResult.is_correct ? (
                    <div className="ar text-center">
                      <CheckCircle2 size={40} className="mx-auto mb-2 text-primary" />
                      <h3 className="text-2xl font-bold text-primary">صح! 🎉</h3>

                      {revealedResult.is_first_correct ? (
                        <div className="flex flex-col items-center gap-2 mt-3">
                          <div className="inline-flex items-center gap-2 bg-[#FFD700]/20 text-[#FFD700] px-4 py-1.5 rounded-full font-bold text-sm">
                            <Trophy size={14} /> الأول على الإجابة الصحيحة!
                          </div>
                          {revealedResult.points_earned > 0 && (
                            <span className="text-primary font-mono font-bold text-lg">+{revealedResult.points_earned} نقطة</span>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 mt-3">
                          {revealedResult.winner_nickname && (
                            <p className="text-gray-400 text-sm">
                              الأول: <span className="text-[#FFD700] font-bold">{revealedResult.winner_nickname}</span>
                            </p>
                          )}
                          <div className="flex items-center gap-3">
                            {revealedResult.behind_ms != null && (
                              <div className="inline-flex items-center gap-1 bg-gray-700/60 text-gray-300 px-3 py-1 rounded-full font-mono text-xs">
                                <Clock size={11} /> {revealedResult.behind_ms}ms متأخر
                              </div>
                            )}
                            {revealedResult.points_earned > 0 && (
                              <span className="text-primary font-mono font-bold">+{revealedResult.points_earned} نقطة</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="ar text-center">
                      <XCircle size={40} className="mx-auto mb-2 text-red-400" />
                      <h3 className="text-2xl font-bold text-red-400">غلط!</h3>
                      {revealedResult.winner_nickname && (
                        <p className="text-gray-500 text-sm mt-1">
                          الأول: <span className="text-[#FFD700] font-bold">{revealedResult.winner_nickname}</span>
                        </p>
                      )}
                    </div>
                  )}
                  <p className="ar text-gray-600 mt-3 flex items-center justify-center gap-1.5 text-xs">
                    <AlertCircle size={12} /> في انتظار الهوست...
                  </p>
                </div>
              ) : (
                <div className="w-full text-center text-gray-500 py-4">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-sm">جاري التحميل...</p>
                </div>
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
              {/* Mini final leaderboard */}
              {leaderboard.length > 0 && (
                <div className="space-y-2 max-w-xs mx-auto mb-8">
                  {leaderboard.slice(0, 5).map((p, i) => (
                    <div key={p.user_id} className={`flex items-center justify-between px-4 py-2 rounded-xl text-sm ${
                      p.user_id === myId ? 'bg-primary/20 border border-primary text-primary' : 'bg-gray-800 border border-gray-700'
                    }`}>
                      <span className="font-bold">#{i + 1} {p.nickname}</span>
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
