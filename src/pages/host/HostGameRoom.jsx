import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ref, onValue, update, get, set, onDisconnect } from 'firebase/database'
import { rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { Play, UserCheck, XCircle, CheckCircle, SkipForward, Trophy, Eye, Timer, Loader2, WifiOff, Wifi, StopCircle } from 'lucide-react'
import confetti from 'canvas-confetti'

function QuestionTimer({ started, duration }) {
  const [elapsed, setElapsed] = useState(0)
  const rafRef = useRef(null)
  const startRef = useRef(null)

  useEffect(() => {
    startRef.current = performance.now()
    setElapsed(0)
    const tick = () => {
      const diff = (performance.now() - startRef.current) / 1000
      setElapsed(diff)
      if (diff < duration) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [started, duration])

  const remaining = Math.max(0, duration - elapsed)
  const pct = ((duration - remaining) / duration) * 100
  const isUrgent = remaining < duration * 0.3

  return (
    <div className="flex items-center gap-3">
      <Timer size={18} className={isUrgent ? 'text-red-400 animate-pulse' : 'text-gray-400'} />
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${isUrgent ? 'bg-red-400' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono font-bold w-8 text-right ${isUrgent ? 'text-red-400' : 'text-gray-300'}`}>
        {Math.ceil(remaining)}s
      </span>
    </div>
  )
}

export default function HostGameRoom() {
  const { roomId } = useParams()
  const { session } = useAuth()
  const navigate = useNavigate()

  const [room, setRoom] = useState(null)
  const [requests, setRequests] = useState([])
  const [players, setPlayers] = useState([])
  const [presence, setPresence] = useState({})   // { [userId]: { online, last_seen } }
  const [answers, setAnswers] = useState([])
  const [revealResult, setRevealResult] = useState(null)
  const [isRevealing, setIsRevealing] = useState(false)
  const [timerKey, setTimerKey] = useState(0)
  const [showTimer, setShowTimer] = useState(false)
  const [processingRequests, setProcessingRequests] = useState(new Set())
  const [endingGame, setEndingGame] = useState(false)

  // ── Host presence ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const hostPresenceRef = ref(rtdb, `rooms/${roomId}/presence/host`)

    // Mark host as online
    set(hostPresenceRef, { online: true, last_seen: Date.now() })

    // Mark host as offline on disconnect
    onDisconnect(hostPresenceRef).set({ online: false, last_seen: Date.now() })

    return () => {
      // Mark offline on unmount (navigating away)
      set(hostPresenceRef, { online: false, last_seen: Date.now() })
    }
  }, [roomId, session])

  // ── Subscribe to room ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const roomRef = ref(rtdb, `rooms/${roomId}`)
    const unsubRoom = onValue(roomRef, (snap) => {
      if (!snap.exists()) return
      const data = snap.val()
      setRoom(prev => {
        if (prev && data.current_question_index !== prev.current_question_index) {
          setAnswers([])
          setRevealResult(null)
          setTimerKey(k => k + 1)
        }
        if (data.status === 'finished' && prev?.status !== 'finished') {
          confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 } })
        }
        return data
      })
    })
    return () => unsubRoom()
  }, [roomId, session])

  // ── Subscribe to join requests ────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const reqRef = ref(rtdb, `rooms/${roomId}/join_requests`)
    const unsubReq = onValue(reqRef, (snap) => {
      if (!snap.exists()) { setRequests([]); return }
      const all = Object.entries(snap.val()).map(([key, val]) => ({ key, ...val }))
      setRequests(all.filter(r => r.status === 'pending'))
    })
    return () => unsubReq()
  }, [roomId, session])

  // ── Subscribe to players ──────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const playersRef = ref(rtdb, `rooms/${roomId}/players`)
    const unsubPlayers = onValue(playersRef, (snap) => {
      if (!snap.exists()) { setPlayers([]); return }
      const list = Object.values(snap.val()).sort((a, b) => b.score - a.score)
      setPlayers(list)
    })
    return () => unsubPlayers()
  }, [roomId, session])

  // ── Subscribe to presence ─────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const presenceRef = ref(rtdb, `rooms/${roomId}/presence/players`)
    const unsubPresence = onValue(presenceRef, (snap) => {
      setPresence(snap.exists() ? snap.val() : {})
    })
    return () => unsubPresence()
  }, [roomId, session])

  // ── Subscribe to answers ──────────────────────────────────────────────────
  useEffect(() => {
    if (!session || room?.current_question_index === undefined) return
    const qIdx = room.current_question_index
    const answersRef = ref(rtdb, `rooms/${roomId}/answers/${qIdx}`)
    const unsubAnswers = onValue(answersRef, (snap) => {
      if (!snap.exists()) { setAnswers([]); return }
      setAnswers(Object.values(snap.val()))
    })
    return () => unsubAnswers()
  }, [roomId, session, room?.current_question_index])

  // ── Handle join request ───────────────────────────────────────────────────
  const handleRequest = async (reqKey, action) => {
    setProcessingRequests(prev => new Set(prev).add(reqKey))
    try {
      if (action === 'approved') {
        const reqSnap = await get(ref(rtdb, `rooms/${roomId}/join_requests/${reqKey}`))
        if (!reqSnap.exists()) return
        const reqData = reqSnap.val()
        await update(ref(rtdb), {
          [`rooms/${roomId}/join_requests/${reqKey}/status`]: 'approved',
          [`rooms/${roomId}/players/${reqKey}`]: {
            user_id: reqKey,
            nickname: reqData.player_name,
            avatar_url: reqData.player_avatar || null,
            score: 0,
            joined_at: Date.now()
          }
        })
      } else {
        await update(ref(rtdb, `rooms/${roomId}/join_requests/${reqKey}`), { status: 'rejected' })
      }
    } catch (err) {
      alert('Error processing request: ' + err.message)
    } finally {
      setProcessingRequests(prev => { const n = new Set(prev); n.delete(reqKey); return n })
    }
  }

  // ── Start game ────────────────────────────────────────────────────────────
  const startGame = async () => {
    try {
      await update(ref(rtdb, `rooms/${roomId}`), {
        status: 'playing',
        current_question_index: 0,
        question_started_at: Date.now()
      })
      setTimerKey(k => k + 1)
    } catch (err) {
      alert('Failed to start game: ' + err.message)
    }
  }

  // ── End competition (forced) ──────────────────────────────────────────────
  const endCompetition = async () => {
    if (!window.confirm('إنهاء المسابقة الآن؟ لن يتمكن أي أحد من الإجابة بعدها.')) return
    setEndingGame(true)
    try {
      await update(ref(rtdb, `rooms/${roomId}`), { status: 'finished' })
    } catch (err) {
      alert('Failed to end competition: ' + err.message)
    } finally {
      setEndingGame(false)
    }
  }

  // ── Reveal answer ─────────────────────────────────────────────────────────
  const revealAnswer = async () => {
    setIsRevealing(true)
    try {
      const qIdx = room.current_question_index
      const correctChoice = room.questions.questions[qIdx].correct
      const answersSnap = await get(ref(rtdb, `rooms/${roomId}/answers/${qIdx}`))
      const answersData = answersSnap.exists() ? Object.values(answersSnap.val()) : []
      const correctAnswers = answersData
        .filter(a => a.selected_choice === correctChoice)
        .sort((a, b) => a.reaction_time_ms - b.reaction_time_ms)
      const winner = correctAnswers[0] || null

      const scoreUpdates = {}
      if (winner) {
        const playerRef = `rooms/${roomId}/players/${winner.user_id}/score`
        const playerSnap = await get(ref(rtdb, playerRef))
        scoreUpdates[playerRef] = (playerSnap.val() || 0) + 1
      }

      const answerUpdates = {}
      if (winner) {
        answerUpdates[`rooms/${roomId}/answers/${qIdx}/${winner.user_id}/is_first_correct`] = true
      }

      const revealData = winner
        ? { winner_nickname: winner.player_name, winner_time_ms: winner.reaction_time_ms }
        : { winner_nickname: null, winner_time_ms: null }

      await update(ref(rtdb), {
        ...scoreUpdates,
        ...answerUpdates,
        [`rooms/${roomId}/status`]: 'revealing',
        [`rooms/${roomId}/reveal_data`]: revealData
      })
      setRevealResult(revealData)
    } catch (err) {
      alert('Failed to reveal answer: ' + err.message)
    } finally {
      setIsRevealing(false)
    }
  }

  // ── Next question ─────────────────────────────────────────────────────────
  const nextQuestion = async () => {
    if (!room?.questions?.questions) return
    const total = room.questions.questions.length
    const isFinished = room.current_question_index + 1 >= total
    try {
      if (isFinished) {
        await update(ref(rtdb, `rooms/${roomId}`), { status: 'finished' })
      } else {
        await update(ref(rtdb, `rooms/${roomId}`), {
          status: 'playing',
          current_question_index: room.current_question_index + 1,
          question_started_at: Date.now(),
          reveal_data: null
        })
      }
      setRevealResult(null)
    } catch (err) {
      alert('Failed to advance: ' + err.message)
    }
  }

  if (!room) return (
    <div className="text-white p-6 flex items-center gap-3">
      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      Loading Room...
    </div>
  )

  const currentQuestion = room.questions?.questions?.[room.current_question_index]
  const isRevealing_ = room.status === 'revealing'
  const answeredCount = answers.length
  const totalPlayers = players.length

  return (
    <div className="min-h-screen bg-background text-white p-6">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between bg-gray-900/50 p-6 rounded-2xl border border-gray-800">
          <div>
            <h1 className="text-4xl font-display font-bold text-white mb-2">{room.title}</h1>
            <p className="text-xl text-primary font-mono tracking-widest">JOIN CODE: {roomId}</p>
          </div>
          <div className="flex items-center gap-4">
            {/* End Competition button — visible any time except finished */}
            {room.status !== 'finished' && (
              <button
                onClick={endCompetition}
                disabled={endingGame}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all font-bold text-sm disabled:opacity-50"
              >
                <StopCircle size={16} /> {endingGame ? 'Ending...' : 'End Competition'}
              </button>
            )}
            <div className="text-right">
              <div className="text-2xl font-bold">{totalPlayers} Players</div>
              <div className={`capitalize px-4 py-1 rounded-full inline-block mt-2 text-sm font-bold ${
                room.status === 'playing' ? 'bg-green-500/20 text-green-400' :
                room.status === 'revealing' ? 'bg-yellow-500/20 text-yellow-400' :
                room.status === 'finished' ? 'bg-primary/20 text-primary' :
                'bg-gray-800 text-gray-400'
              }`}>
                {room.status}
              </div>
            </div>
          </div>
        </div>

        {/* ─── LOBBY ──────────────────────────────────────────────────────── */}
        {room.status === 'lobby' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-gray-900/50 p-6 rounded-2xl border border-gray-800">
              <h2 className="text-2xl font-display font-bold mb-4 flex items-center gap-2">
                Join Requests <span className="text-primary bg-primary/20 px-3 py-1 rounded-full text-sm">{requests.length}</span>
              </h2>
              <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                {requests.length === 0 && <p className="text-gray-500 italic">No pending requests...</p>}
                {requests.map(req => (
                  <div key={req.key} className="flex items-center justify-between p-4 bg-gray-800 rounded-xl border border-gray-700">
                    <div>
                      <div className="font-bold flex items-center gap-2">
                        {req.player_avatar && <img src={req.player_avatar} alt="avatar" className="w-6 h-6 rounded-full" />}
                        {req.player_name}
                      </div>
                      <div className="text-sm text-gray-400">{req.player_email}</div>
                    </div>
                    <div className="flex gap-2">
                      {processingRequests.has(req.key) ? (
                        <div className="p-2 text-primary animate-spin"><Loader2 size={20} /></div>
                      ) : (
                        <>
                          <button onClick={() => handleRequest(req.key, 'approved')} className="bg-green-500/20 text-green-500 hover:bg-green-500/30 p-2 rounded-lg transition-colors"><CheckCircle size={20} /></button>
                          <button onClick={() => handleRequest(req.key, 'rejected')} className="bg-red-500/20 text-red-500 hover:bg-red-500/30 p-2 rounded-lg transition-colors"><XCircle size={20} /></button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-900/50 p-6 rounded-2xl border border-gray-800 flex flex-col">
              <h2 className="text-2xl font-display font-bold mb-4 flex items-center gap-2">
                Ready Players <span className="text-secondary bg-secondary/20 px-3 py-1 rounded-full text-sm">{totalPlayers}</span>
              </h2>
              <div className="flex-1 grid grid-cols-2 gap-4 auto-rows-max overflow-y-auto pr-2 max-h-72">
                {totalPlayers === 0 && <p className="text-gray-500 italic col-span-2">Waiting for approvals...</p>}
                {players.map(p => (
                  <div key={p.user_id} className="flex items-center gap-3 p-3 bg-gray-800 rounded-xl border border-gray-700">
                    {p.avatar_url ? <img src={p.avatar_url} alt="avatar" className="w-8 h-8 rounded-full" /> : <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center"><UserCheck size={16} /></div>}
                    <span className="font-bold truncate flex-1">{p.nickname}</span>
                    {/* Online indicator */}
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${presence[p.user_id]?.online ? 'bg-green-400' : 'bg-gray-600'}`} title={presence[p.user_id]?.online ? 'Online' : 'Offline'} />
                  </div>
                ))}
              </div>
              <button
                onClick={startGame}
                disabled={totalPlayers === 0}
                className="mt-6 w-full bg-primary text-background font-bold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-[#00D4FF] disabled:opacity-50 transition-all active:scale-95 text-lg"
              >
                <Play size={24} fill="currentColor" /> Start Game
              </button>
            </div>
          </div>
        )}

        {/* ─── PLAYING & REVEALING ────────────────────────────────────────── */}
        {(room.status === 'playing' || room.status === 'revealing') && !currentQuestion && (
          <div className="bg-gray-900/50 p-12 rounded-2xl border border-gray-800 text-center animate-pulse">
            <h2 className="text-2xl font-bold text-gray-400">Preparing first question...</h2>
          </div>
        )}

        {(room.status === 'playing' || room.status === 'revealing') && currentQuestion && (
          <div className="space-y-6">
            <div className="bg-gray-900/50 p-8 rounded-2xl border border-primary relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gray-800">
                <div className="h-full bg-primary transition-all" style={{ width: `${((room.current_question_index + 1) / room.questions.questions.length) * 100}%` }} />
              </div>
              <div className="flex justify-between items-center mb-4 text-gray-400">
                <span className="font-bold text-primary">Question {room.current_question_index + 1} / {room.questions.questions.length}</span>
                <span className={`font-mono text-lg ${answeredCount === totalPlayers ? 'text-green-400 font-bold' : ''}`}>
                  {answeredCount} / {totalPlayers} answered
                </span>
              </div>

              {showTimer && !isRevealing_ && (
                <div className="mb-6">
                  <QuestionTimer key={timerKey} started={room.question_started_at} duration={currentQuestion.time_limit || 30} />
                </div>
              )}

              <h2 className="text-3xl font-bold mb-8">{currentQuestion.question}</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {currentQuestion.choices.map((choice, i) => {
                  const isCorrect = i === currentQuestion.correct
                  const count = answers.filter(a => a.selected_choice === i).length
                  return (
                    <div key={i} className={`p-4 rounded-xl border flex justify-between items-center transition-all ${
                      isRevealing_
                        ? isCorrect ? 'border-primary bg-primary/10 shadow-[0_0_15px_rgba(0,255,255,0.2)]' : 'border-gray-700 bg-gray-800 opacity-50'
                        : 'border-gray-700 bg-gray-800'
                    }`}>
                      <span className={isRevealing_ && isCorrect ? 'font-bold text-primary' : ''}>{choice}</span>
                      <span className="font-mono text-xl font-bold">{count}</span>
                    </div>
                  )
                })}
              </div>

              {isRevealing_ && revealResult?.winner_nickname && (
                <div className="mt-6 flex items-center gap-3 bg-[#FFD700]/10 border border-[#FFD700]/40 text-[#FFD700] px-6 py-3 rounded-xl">
                  <Trophy size={20} />
                  <span className="font-bold">Fastest correct: <span className="text-white">{revealResult.winner_nickname}</span></span>
                  <span className="text-sm ml-auto opacity-70">{revealResult.winner_time_ms}ms</span>
                </div>
              )}
              {isRevealing_ && revealResult && !revealResult.winner_nickname && (
                <div className="mt-6 text-gray-500 text-center text-sm">No one answered correctly this round.</div>
              )}

              <div className="mt-8 flex items-center justify-between gap-4">
                <button
                  onClick={() => setShowTimer(v => !v)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm transition-all ${showTimer ? 'border-primary text-primary bg-primary/10' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}
                >
                  <Timer size={16} /> {showTimer ? 'Hide Timer' : 'Show Timer'}
                </button>
                <div className="flex gap-3">
                  {room.status === 'playing' && (
                    <button onClick={revealAnswer} disabled={isRevealing} className="bg-yellow-500 text-black font-bold px-6 py-3 rounded-xl flex items-center gap-2 hover:bg-yellow-400 disabled:opacity-50 transition-all active:scale-95">
                      <Eye size={20} /> {isRevealing ? 'Revealing...' : 'Reveal Answer'}
                    </button>
                  )}
                  {room.status === 'revealing' && (
                    <button onClick={nextQuestion} className="bg-white text-black font-bold px-6 py-3 rounded-xl flex items-center gap-2 hover:bg-gray-200 transition-all active:scale-95">
                      Next <SkipForward size={20} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Live Leaderboard with online indicators */}
            <div className="bg-gray-900/50 p-6 rounded-2xl border border-gray-800">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Trophy className="text-[#FFD700]" /> Live Leaderboard
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {players.slice(0, 3).map((p, idx) => (
                  <div key={p.user_id} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-bold text-gray-500">#{idx + 1}</span>
                      <span className="font-bold">{p.nickname}</span>
                      {/* Online dot */}
                      {!presence[p.user_id]?.online && (
                        <span className="flex items-center gap-1 text-xs text-red-400">
                          <WifiOff size={12} /> غادر
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-primary font-bold">{p.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── FINISHED ───────────────────────────────────────────────────── */}
        {room.status === 'finished' && (
          <div className="bg-gray-900/50 p-12 rounded-2xl border border-gray-800 text-center">
            <Trophy size={64} className="mx-auto text-[#FFD700] mb-6" />
            <h2 className="text-5xl font-display font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">Game Finished!</h2>
            <p className="text-xl text-gray-400 mb-12">Final Leaderboard</p>
            <div className="max-w-2xl mx-auto space-y-4">
              {players.map((p, idx) => (
                <div key={p.user_id} className={`flex items-center justify-between p-4 rounded-xl border ${idx === 0 ? 'bg-primary/20 border-primary' : 'bg-gray-800 border-gray-700'}`}>
                  <div className="flex items-center gap-4">
                    <span className={`text-2xl font-bold ${idx === 0 ? 'text-primary' : 'text-gray-500'}`}>#{idx + 1}</span>
                    {p.avatar_url ? <img src={p.avatar_url} alt="avatar" className="w-10 h-10 rounded-full" /> : <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center"><UserCheck size={20} /></div>}
                    <span className="font-bold text-xl">{p.nickname}</span>
                  </div>
                  <div className="text-2xl font-mono font-bold text-white">{p.score} PTS</div>
                </div>
              ))}
            </div>
            <button
              onClick={() => navigate('/host/dashboard')}
              className="mt-10 bg-primary text-background font-bold px-8 py-3 rounded-xl hover:bg-[#00D4FF] transition-all"
            >
              Back to Dashboard
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
