import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ref, onValue, get, set, runTransaction, onDisconnect } from 'firebase/database'
import { rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useServerClock } from '../../hooks/useServerClock'
import { Trophy, Clock, CheckCircle2, XCircle, AlertCircle, Zap, WifiOff } from 'lucide-react'
import confetti from 'canvas-confetti'

export default function PlayerGameView() {
  const { roomId } = useParams()   // roomId = room code (e.g. "A1B2C3")
  const { session } = useAuth()
  const navigate = useNavigate()
  const clockOffset = useServerClock()

  const [room, setRoom] = useState(null)
  const [player, setPlayer] = useState(null)
  const [selectedChoice, setSelectedChoice] = useState(null)
  const [answerLocked, setAnswerLocked] = useState(false)
  const [revealedResult, setRevealedResult] = useState(null)
  const [hostOnline, setHostOnline] = useState(true)

  const questionServerStartRef = useRef(null)
  const prevQuestionIndexRef = useRef(null)
  const prevStatusRef = useRef(null)

  const resetForNewQuestion = () => {
    setSelectedChoice(null)
    setAnswerLocked(false)
    setRevealedResult(null)
    questionServerStartRef.current = Date.now() + clockOffset.current
  }

  // ── Player presence ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const userId = session.uid
    const playerPresenceRef = ref(rtdb, `rooms/${roomId}/presence/players/${userId}`)

    set(playerPresenceRef, { online: true, last_seen: Date.now() })
    onDisconnect(playerPresenceRef).set({ online: false, last_seen: Date.now() })

    return () => {
      set(playerPresenceRef, { online: false, last_seen: Date.now() })
    }
  }, [roomId, session])

  // ── Subscribe to host presence ────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const hostPresenceRef = ref(rtdb, `rooms/${roomId}/presence/host`)
    const unsubHost = onValue(hostPresenceRef, (snap) => {
      if (!snap.exists()) { setHostOnline(true); return }
      setHostOnline(snap.val().online !== false)
    })
    return () => unsubHost()
  }, [roomId, session])

  // ── Subscribe to room ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const userId = session.uid

    const roomRef = ref(rtdb, `rooms/${roomId}`)
    const unsubRoom = onValue(roomRef, async (snap) => {
      if (!snap.exists()) return
      const data = snap.val()

      // New question started
      if (prevQuestionIndexRef.current !== null &&
          data.current_question_index !== prevQuestionIndexRef.current) {
        resetForNewQuestion()
      }

      // Host revealed answers
      if (data.status === 'revealing' && prevStatusRef.current !== 'revealing') {
        fetchMyAnswerResult(data.current_question_index, userId)
      }

      if (data.status === 'finished') {
        confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 } })
      }

      prevQuestionIndexRef.current = data.current_question_index
      prevStatusRef.current = data.status
      setRoom(data)
    })

    return () => unsubRoom()
  }, [roomId, session])

  // ── Subscribe to my player ────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const userId = session.uid

    const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`)
    const unsubPlayer = onValue(playerRef, (snap) => {
      if (snap.exists()) {
        setPlayer(snap.val())
      }
    })

    // Initial check - verify player is in the room
    get(ref(rtdb, `rooms/${roomId}/players/${userId}`)).then(snap => {
      if (!snap.exists()) {
        alert('You are not part of this room!')
        navigate('/')
      } else {
        setPlayer(snap.val())
        questionServerStartRef.current = Date.now() + clockOffset.current
      }
    })

    return () => unsubPlayer()
  }, [roomId, session])

  // ── Load existing answer if rejoining mid-game ────────────────────────────
  useEffect(() => {
    if (!session || !room) return
    const userId = session.uid

    if (room.status === 'playing' || room.status === 'revealing') {
      const qIdx = room.current_question_index
      get(ref(rtdb, `rooms/${roomId}/answers/${qIdx}/${userId}`)).then(snap => {
        if (snap.exists()) {
          const a = snap.val()
          setSelectedChoice(a.selected_choice)
          setAnswerLocked(true)
          if (room.status === 'revealing') {
            fetchMyAnswerResult(qIdx, userId)
          }
        }
      })
    }
  }, [room?.status, room?.current_question_index])

  // ── Fetch my answer result after reveal ───────────────────────────────────
  const fetchMyAnswerResult = async (questionIndex, userId) => {
    const [answerSnap, roomSnap] = await Promise.all([
      get(ref(rtdb, `rooms/${roomId}/answers/${questionIndex}/${userId}`)),
      get(ref(rtdb, `rooms/${roomId}/reveal_data`))
    ])

    const winnerTimeMs = roomSnap.exists() ? roomSnap.val()?.winner_time_ms : null

    if (answerSnap.exists()) {
      const a = answerSnap.val()
      const behindMs = a.is_correct && !a.is_first_correct && winnerTimeMs != null
        ? Math.max(0, a.reaction_time_ms - winnerTimeMs)
        : null
      setRevealedResult({
        is_correct: a.is_correct,
        is_first_correct: a.is_first_correct,
        reaction_time_ms: a.reaction_time_ms,
        behind_ms: behindMs
      })
      if (a.is_correct) confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } })
    } else {
      setRevealedResult({ is_correct: false, is_first_correct: false, didNotAnswer: true })
    }
  }

  // ── Submit answer ─────────────────────────────────────────────────────────
  const handleChoiceClick = async (choiceIndex) => {
    if (answerLocked || !room || !session) return

    const serverClickTime = Date.now() + clockOffset.current
    const reactionMs = questionServerStartRef.current
      ? Math.round(serverClickTime - questionServerStartRef.current)
      : 5000

    // Optimistic UI
    setSelectedChoice(choiceIndex)
    setAnswerLocked(true)

    const userId = session.uid
    const qIdx = room.current_question_index
    const correctChoice = room.questions.questions[qIdx].correct
    const isCorrect = choiceIndex === correctChoice

    const answerRef = ref(rtdb, `rooms/${roomId}/answers/${qIdx}/${userId}`)

    // Use transaction to prevent ghost answers (atomic write-once)
    const result = await runTransaction(answerRef, (current) => {
      if (current !== null) {
        // Already answered - abort transaction
        return undefined
      }
      return {
        user_id: userId,
        player_name: player?.nickname || 'Unknown',
        selected_choice: choiceIndex,
        is_correct: isCorrect,
        is_first_correct: false,  // Host calculates this during reveal
        reaction_time_ms: reactionMs,
        submitted_at: Date.now()
      }
    })

    if (!result.committed) {
      // Already answered - restore locked state (already locked, no change needed)
      console.log('[Player] Answer already submitted')
    }
  }

  if (!room || !player) return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-white">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400">Joining game...</p>
      </div>
    </div>
  )

  const currentQuestion = room.questions?.questions?.[room.current_question_index]

  return (
    <div className="flex flex-col min-h-screen bg-background text-white">
      {/* Host offline banner */}
      {!hostOnline && room?.status !== 'finished' && (
        <div className="bg-red-500/20 border-b border-red-500/40 px-4 py-2 flex items-center justify-center gap-2 text-red-300 text-sm font-bold">
          <WifiOff size={16} /> الهوست خرج من اللعبة — في انتظار عودته...
        </div>
      )}
      {/* Top Bar */}
      <div className="bg-gray-900 border-b border-gray-800 p-4 flex justify-between items-center shadow-lg">
        <div className="flex items-center gap-3">
          {player.avatar_url && <img src={player.avatar_url} alt="avatar" className="w-10 h-10 rounded-full border-2 border-primary" />}
          <div className="font-bold text-lg">{player.nickname}</div>
        </div>
        <div className="flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-xl">
          <Trophy className="text-[#FFD700]" size={20} />
          <span className="font-mono text-xl font-bold">{player.score} PTS</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center p-6">

        {/* LOBBY */}
        {room.status === 'lobby' && (
          <div className="text-center space-y-6 max-w-md w-full">
            <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center mx-auto border-4 border-primary">
              <Clock size={40} className="text-primary animate-pulse" />
            </div>
            <h1 className="text-4xl font-display font-bold">You're In!</h1>
            <p className="text-xl text-gray-400">Waiting for <span className="text-white font-bold">{room.title}</span> to start...</p>
          </div>
        )}

        {/* PLAYING */}
        {room.status === 'playing' && currentQuestion && (
          <div className="max-w-4xl w-full">
            {!answerLocked ? (
              <div className="animate-in fade-in zoom-in duration-300">
                <div className="text-center mb-8">
                  <span className="text-primary font-bold text-sm tracking-widest uppercase mb-2 block">
                    Question {room.current_question_index + 1}
                  </span>
                  <h2 className="text-3xl md:text-5xl font-bold leading-tight">{currentQuestion.question}</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-12">
                  {currentQuestion.choices.map((choice, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleChoiceClick(idx)}
                      className="group relative p-6 bg-gray-800 border-2 border-gray-700 rounded-2xl hover:border-primary hover:bg-gray-700 transition-all text-left active:scale-95 overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                      <span className="relative z-10 text-xl font-medium">{choice}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="max-w-4xl w-full animate-in fade-in zoom-in duration-300">
                <div className="text-center mb-8">
                  <span className="text-primary font-bold text-sm tracking-widest uppercase mb-2 block">
                    Question {room.current_question_index + 1}
                  </span>
                  <h2 className="text-2xl md:text-3xl font-bold leading-tight text-gray-300">{currentQuestion.question}</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                  {currentQuestion.choices.map((choice, idx) => {
                    const isPicked = idx === selectedChoice
                    return (
                      <div key={idx} className={`relative p-6 rounded-2xl border-2 transition-all ${
                        isPicked
                          ? 'border-primary bg-primary/20 scale-[1.02] shadow-[0_0_20px_rgba(0,255,255,0.3)]'
                          : 'border-gray-700 bg-gray-800 opacity-40'
                      }`}>
                        <span className="text-xl font-medium">{choice}</span>
                        {isPicked && <div className="absolute top-2 right-2 text-primary"><Zap size={16} fill="currentColor" /></div>}
                      </div>
                    )
                  })}
                </div>
                <div className="mt-8 text-center">
                  <div className="inline-flex items-center gap-3 bg-gray-900 border border-gray-700 px-6 py-3 rounded-full">
                    <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                    <span className="text-gray-300 font-medium">Answer locked — waiting for host to reveal...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* REVEALING */}
        {room.status === 'revealing' && currentQuestion && (
          <div className="max-w-4xl w-full animate-in fade-in zoom-in duration-500">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-400">{currentQuestion.question}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              {currentQuestion.choices.map((choice, idx) => {
                const isCorrect = idx === currentQuestion.correct
                const isPicked = idx === selectedChoice
                return (
                  <div key={idx} className={`relative p-6 rounded-2xl border-2 transition-all ${
                    isCorrect
                      ? 'border-primary bg-primary/20 shadow-[0_0_20px_rgba(0,255,255,0.2)]'
                      : isPicked
                        ? 'border-red-500 bg-red-500/20'
                        : 'border-gray-700 bg-gray-800 opacity-30'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-medium">{choice}</span>
                      {isCorrect && <CheckCircle2 className="text-primary" size={24} />}
                      {!isCorrect && isPicked && <XCircle className="text-red-400" size={24} />}
                    </div>
                  </div>
                )
              })}
            </div>

            {revealedResult ? (
              <div className={`text-center p-8 rounded-3xl border backdrop-blur-md ${
                revealedResult.didNotAnswer ? 'bg-gray-900/80 border-gray-700'
                  : revealedResult.is_correct ? 'bg-primary/10 border-primary shadow-[0_0_40px_rgba(0,255,255,0.15)]'
                  : 'bg-red-900/20 border-red-700'
              }`}>
                {revealedResult.didNotAnswer ? (
                  <>
                    <AlertCircle size={56} className="mx-auto mb-4 text-gray-500" />
                    <h3 className="text-3xl font-bold text-gray-400">Time's Up!</h3>
                    <p className="text-gray-500 mt-2">You didn't answer this one.</p>
                  </>
                ) : revealedResult.is_correct ? (
                  <>
                    <CheckCircle2 size={56} className="mx-auto mb-4 text-primary" />
                    <h3 className="text-3xl font-bold text-primary">Correct!</h3>
                    {revealedResult.is_first_correct ? (
                      <div className="inline-flex items-center gap-2 bg-[#FFD700]/20 text-[#FFD700] px-4 py-2 rounded-full font-bold mt-4">
                        <Trophy size={16} /> Fastest correct answer! +1 Point
                      </div>
                    ) : revealedResult.behind_ms != null && (
                      <div className="inline-flex items-center gap-2 bg-gray-700/60 text-gray-300 px-4 py-2 rounded-full font-mono text-sm mt-4">
                        <Clock size={14} /> {revealedResult.behind_ms}ms behind the winner
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <XCircle size={56} className="mx-auto mb-4 text-red-400" />
                    <h3 className="text-3xl font-bold text-red-400">Incorrect!</h3>
                  </>
                )}
                <p className="text-gray-500 mt-4 flex items-center justify-center gap-2 text-sm">
                  <AlertCircle size={16} /> Waiting for host to advance...
                </p>
              </div>
            ) : (
              <div className="text-center text-gray-500">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p>Loading result...</p>
              </div>
            )}
          </div>
        )}

        {/* FINISHED */}
        {room.status === 'finished' && (
          <div className="text-center animate-in fade-in duration-1000">
            <Trophy size={100} className="mx-auto text-[#FFD700] mb-8" />
            <h1 className="text-6xl font-display font-bold text-white mb-4">Game Over!</h1>
            <p className="text-2xl text-gray-400 mb-8">
              You finished with a score of <span className="text-primary font-bold">{player.score}</span>
            </p>
            <button onClick={() => navigate('/')} className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-8 rounded-xl transition-colors">
              Return Home
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
