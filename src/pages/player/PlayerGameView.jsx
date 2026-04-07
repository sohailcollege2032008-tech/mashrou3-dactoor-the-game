import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useServerClock } from '../../hooks/useServerClock'
import { Trophy, Clock, CheckCircle2, XCircle, AlertCircle, Zap } from 'lucide-react'
import confetti from 'canvas-confetti'

export default function PlayerGameView() {
  const { roomId } = useParams()
  const { session } = useAuth()
  const navigate = useNavigate()

  // Clock sync: measures offset between client clock and server clock (SNTP-style)
  const clockOffset = useServerClock()

  const [room, setRoom] = useState(null)
  const [player, setPlayer] = useState(null)
  // The choice index the player picked this round (optimistic)
  const [selectedChoice, setSelectedChoice] = useState(null)
  // Whether the answer has been confirmed by the server
  const [answerLocked, setAnswerLocked] = useState(false)
  // Result revealed by host: { is_correct, is_first_correct }
  const [revealedResult, setRevealedResult] = useState(null)

  // Stores the CORRECTED SERVER timestamp when the current question appeared
  // = Date.now() + clockOffset at the moment the question was shown
  // This is what we compare against to compute fair reaction time
  const questionServerStartRef = useRef(null)

  // Reset per-question state when a new question appears
  const resetForNewQuestion = () => {
    setSelectedChoice(null)
    setAnswerLocked(false)
    setRevealedResult(null)
    // Record the server-corrected time at which this question appeared on screen
    questionServerStartRef.current = Date.now() + clockOffset.current
  }

  useEffect(() => {
    fetchInitialData()

    const sub = supabase.channel(`player_room_${roomId}_${session.user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, (payload) => {
        setRoom(prev => {
          const updated = { ...prev, ...payload.new }

          // New question started → reset everything
          if (payload.new.current_question_index !== undefined &&
              payload.new.current_question_index !== prev?.current_question_index) {
            resetForNewQuestion()
          }

          // Host revealed answers → player can now see if they were right
          if (payload.new.status === 'revealing' && prev?.status !== 'revealing') {
            fetchMyAnswerResult(payload.new.current_question_index ?? prev?.current_question_index)
          }

          return updated
        })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players', filter: `user_id=eq.${session.user.id}` }, (payload) => {
        setPlayer(payload.new)
      })
      .subscribe()

    return () => supabase.removeChannel(sub)
  }, [roomId, session])

  const fetchInitialData = async () => {
    const { data: p } = await supabase
      .from('players').select('*')
      .eq('room_id', roomId).eq('user_id', session.user.id).single()

    if (!p) {
      alert('You are not part of this room!')
      navigate('/')
      return
    }
    setPlayer(p)

    if (rError || !r) {
      console.error('[Player] Error fetching room:', rError)
      alert("Error loading game data")
      return
    }
    setRoom(r)

    if (r.status === 'playing' || r.status === 'revealing') {
      // Check if already answered current question
      const { data: a, error: aError } = await supabase.from('answers').select('*')
        .eq('room_id', roomId)
        .eq('player_id', p.id)
        .eq('question_index', r.current_question_index)
        .maybeSingle()

      if (aError) console.error('[Player] Error fetching initial answer:', aError)
      
      if (a) {
        setSelectedChoice(a.selected_choice)
        setAnswerLocked(true)
        if (r.status === 'revealing') {
          setRevealedResult({ is_correct: a.is_correct, is_first_correct: a.is_first_correct })
        }
      }
    }

    // Record server-corrected question start time
    questionServerStartRef.current = Date.now() + clockOffset.current
  }

  const fetchMyAnswerResult = async (questionIndex) => {
    const { data: myPlayer } = await supabase
      .from('players').select('id')
      .eq('room_id', roomId).eq('user_id', session.user.id).single()

    if (!myPlayer) return

    const { data: a, error } = await supabase.from('answers').select('is_correct, is_first_correct')
      .eq('room_id', roomId)
      .eq('player_id', myPlayer.id)
      .eq('question_index', questionIndex)
      .maybeSingle()

    if (error) {
      console.error('[Player] Error fetching answer result:', error)
      return
    }

    if (a) {
      setRevealedResult({ is_correct: a.is_correct, is_first_correct: a.is_first_correct })
      if (a.is_correct) {
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } })
      }
    } else {
      // Player didn't answer → show "time's up / didn't answer"
      setRevealedResult({ is_correct: false, is_first_correct: false, didNotAnswer: true })
    }
  }

  const handleChoiceClick = async (choiceIndex) => {
    if (answerLocked) return   // already picked

    // Fair reaction time: (server-corrected click time) - (server-corrected question-shown time)
    const serverClickTime = Date.now() + clockOffset.current
    const reactionMs = questionServerStartRef.current
      ? Math.round(serverClickTime - questionServerStartRef.current)
      : 5000

    // Optimistic UI: lock the choice immediately so it feels instant
    setSelectedChoice(choiceIndex)
    setAnswerLocked(true)

    const correctChoice = room.questions.questions[room.current_question_index].correct

    const { data, error } = await supabase.rpc('submit_answer', {
      p_room_id: roomId,
      p_player_id: player.id,
      p_question_index: room.current_question_index,
      p_selected_choice: choiceIndex,
      p_correct_choice: correctChoice,
      p_reaction_time_ms: reactionMs
    })

    if (error || data?.error) {
      console.warn('[Game] Submit error:', error || data?.error)
      // Optional: show a small toast or just let it be. 
      // We don't want to alert() here to avoid breaking user flow during intense play.
    }
  }

  useEffect(() => {
    if (room?.status === 'finished') {
      confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 } })
    }
  }, [room?.status])

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

        {/* PLAYING — show question */}
        {room.status === 'playing' && currentQuestion && (
          <div className="max-w-4xl w-full">
            {!answerLocked ? (
              // Question + choices
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
              // Answer locked — waiting for host to reveal
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
                      <div
                        key={idx}
                        className={`relative p-6 rounded-2xl border-2 transition-all ${
                          isPicked
                            ? 'border-primary bg-primary/20 scale-[1.02] shadow-[0_0_20px_rgba(0,255,255,0.3)]'
                            : 'border-gray-700 bg-gray-800 opacity-40'
                        }`}
                      >
                        <span className="text-xl font-medium">{choice}</span>
                        {isPicked && (
                          <div className="absolute top-2 right-2 text-primary">
                            <Zap size={16} fill="currentColor" />
                          </div>
                        )}
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

        {/* REVEALING — host revealed, show result */}
        {room.status === 'revealing' && currentQuestion && (
          <div className="max-w-4xl w-full animate-in fade-in zoom-in duration-500">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-400">{currentQuestion.question}</h2>
            </div>

            {/* Show choices with correct highlighted */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              {currentQuestion.choices.map((choice, idx) => {
                const isCorrect = idx === currentQuestion.correct
                const isPicked = idx === selectedChoice
                return (
                  <div
                    key={idx}
                    className={`relative p-6 rounded-2xl border-2 transition-all ${
                      isCorrect
                        ? 'border-primary bg-primary/20 shadow-[0_0_20px_rgba(0,255,255,0.2)]'
                        : isPicked
                          ? 'border-red-500 bg-red-500/20'
                          : 'border-gray-700 bg-gray-800 opacity-30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-medium">{choice}</span>
                      {isCorrect && <CheckCircle2 className="text-primary" size={24} />}
                      {!isCorrect && isPicked && <XCircle className="text-red-400" size={24} />}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Personal result card */}
            {revealedResult ? (
              <div className={`text-center p-8 rounded-3xl border backdrop-blur-md ${
                revealedResult.didNotAnswer
                  ? 'bg-gray-900/80 border-gray-700'
                  : revealedResult.is_correct
                    ? 'bg-primary/10 border-primary shadow-[0_0_40px_rgba(0,255,255,0.15)]'
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
                    {revealedResult.is_first_correct && (
                      <div className="inline-flex items-center gap-2 bg-[#FFD700]/20 text-[#FFD700] px-4 py-2 rounded-full font-bold mt-4">
                        <Trophy size={16} /> Fastest correct answer! +1 Bonus
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
