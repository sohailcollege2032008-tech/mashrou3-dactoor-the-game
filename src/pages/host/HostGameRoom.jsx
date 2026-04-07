import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Play, UserCheck, XCircle, CheckCircle, SkipForward, Trophy, Eye, Timer } from 'lucide-react'
import confetti from 'canvas-confetti'

// ─── Optional countdown timer (visual only – host controls pacing) ────────────
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
        <div
          className={`h-full rounded-full transition-all ${isUrgent ? 'bg-red-400' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
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
  const [answers, setAnswers] = useState([])
  const [revealResult, setRevealResult] = useState(null)   // winner info from reveal RPC
  const [isRevealing, setIsRevealing] = useState(false)
  const [timerKey, setTimerKey] = useState(0)
  const [showTimer, setShowTimer] = useState(false)

  useEffect(() => {
    fetchInitialData()

    const sub = supabase.channel(`host_room_${roomId}`)
      // Join requests: push payload directly (no fetch!)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'join_requests', filter: `room_id=eq.${roomId}` }, (payload) => {
        setRequests(prev => [...prev, payload.new])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'join_requests', filter: `room_id=eq.${roomId}` }, () => {
        fetchRequests() // only on update (approval/rejection) do we need fresh data
      })
      // Players: push/update locally
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` }, (payload) => {
        setPlayers(prev => [...prev, payload.new].sort((a, b) => b.score - a.score))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` }, (payload) => {
        setPlayers(prev =>
          prev.map(p => p.id === payload.new.id ? { ...p, ...payload.new } : p)
              .sort((a, b) => b.score - a.score)
        )
      })
      // Answers: push payload directly — ZERO db reads for answers!
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers', filter: `room_id=eq.${roomId}` }, (payload) => {
        setAnswers(prev => [...prev, payload.new])
      })
      // Room updates: merge (preserve TOAST/JSONB columns)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, (payload) => {
        setRoom(prev => ({ ...prev, ...payload.new }))
      })
      .subscribe()

    return () => supabase.removeChannel(sub)
  }, [roomId])

  const fetchInitialData = async () => {
    const { data: roomData, error } = await supabase.from('rooms').select('*').eq('id', roomId).single()
    if (error) {
      console.error('[Host] Error fetching room:', error)
      alert('Error loading room: ' + error.message)
      return
    }
    setRoom(roomData)
    fetchRequests()
    fetchPlayers()
    fetchAnswers(roomData)
  }

  const fetchRequests = async () => {
    const { data, error } = await supabase.from('join_requests').select('*').eq('room_id', roomId).eq('status', 'pending')
    if (error) console.error('[Host] Error fetching requests:', error)
    else setRequests(data || [])
  }

  const fetchPlayers = async () => {
    const { data, error } = await supabase.from('players').select('*').eq('room_id', roomId).order('score', { ascending: false })
    if (error) console.error('[Host] Error fetching players:', error)
    else setPlayers(data || [])
  }

  const fetchAnswers = async (currentRoom) => {
    const r = currentRoom || room
    if (!r || r.current_question_index < 0) return
    const { data, error } = await supabase.from('answers').select('*')
      .eq('room_id', roomId).eq('question_index', r.current_question_index)
    if (error) console.error('[Host] Error fetching answers:', error)
    else setAnswers(data || [])
  }

  // Reset answers on question change
  useEffect(() => {
    if (room?.status === 'playing') {
      setAnswers([])
      setRevealResult(null)
      setTimerKey(k => k + 1)
    }
  }, [room?.current_question_index, room?.status])

  useEffect(() => {
    if (room?.status === 'finished') {
      confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 } })
      fetchPlayers()
    }
  }, [room?.status])

  const handleRequest = async (requestId, action) => {
    const currentRequest = requests.find(r => r.id === requestId)
    if (!currentRequest) return

    // Optimistic: remove from list immediately
    setRequests(prev => prev.filter(r => r.id !== requestId))

    try {
      const { data, error } = await supabase.rpc('process_join_request', { 
        p_request_id: requestId, 
        p_action: action 
      })

      if (error || (data && data.success === false)) {
        const errorMsg = error?.message || data?.error || 'Unknown error'
        console.error('[Host] Join request failed:', errorMsg)
        alert(`❌ Failed to ${action} ${currentRequest.player_name}: ${errorMsg}`)
        
        // Rollback: put it back in the list
        setRequests(prev => [...prev, currentRequest])
      }
    } catch (err) {
      console.error('[Host] Join request exception:', err)
      alert(`❌ Error processing request: ${err.message}`)
      setRequests(prev => [...prev, currentRequest])
    }
  }

  const startGame = async () => {
    const { error } = await supabase.from('rooms').update({
      status: 'playing',
      current_question_index: 0,
      question_started_at: new Date().toISOString()
    }).eq('id', roomId)
    
    if (error) {
      console.error('[Host] Error starting game:', error)
      alert('Failed to start game: ' + error.message)
    } else {
      setTimerKey(k => k + 1)
    }
  }

  const revealAnswer = async () => {
    setIsRevealing(true)
    
    // BUG 4 FIX: Fetch fresh players first so leaderboard is accurate when host reveals
    await fetchPlayers()

    const { data, error } = await supabase.rpc('reveal_answer', {
      p_room_id: roomId,
      p_question_index: room.current_question_index
    })
    setIsRevealing(false)
    if (error) {
      console.error('[Host] Error revealing answer:', error)
      alert('Failed to reveal answer: ' + error.message)
    } else {
      setRevealResult(data)
    }
  }

  const nextQuestion = async () => {
    if (!room?.questions?.questions) return
    const total = room.questions.questions.length
    const isFinished = room.current_question_index + 1 >= total

    if (isFinished) {
      const { error } = await supabase.from('rooms').update({ status: 'finished' }).eq('id', roomId)
      if (error) {
        console.error('[Host] Error finishing game:', error)
        alert('Failed to finish game: ' + error.message)
      }
    } else {
      const { error } = await supabase.rpc('start_next_question', {
        p_room_id: roomId,
        p_next_question_index: room.current_question_index + 1
      })
      if (error) {
        console.error('[Host] Error starting next question:', error)
        alert('Failed to advance: ' + error.message)
      }
    }
    setRevealResult(null)
  }

  if (!room) return <div className="text-white p-6 flex items-center gap-3"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Loading Room...</div>

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
            <p className="text-xl text-primary font-mono tracking-widest">JOIN CODE: {room.code}</p>
          </div>
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

        {/* ─── LOBBY ─────────────────────────────────────────────────────── */}
        {room.status === 'lobby' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Pending Requests */}
            <div className="bg-gray-900/50 p-6 rounded-2xl border border-gray-800">
              <h2 className="text-2xl font-display font-bold mb-4 flex items-center gap-2">
                Join Requests <span className="text-primary bg-primary/20 px-3 py-1 rounded-full text-sm">{requests.length}</span>
              </h2>
              <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                {requests.length === 0 && <p className="text-gray-500 italic">No pending requests...</p>}
                {requests.map(req => (
                  <div key={req.id} className="flex items-center justify-between p-4 bg-gray-800 rounded-xl border border-gray-700">
                    <div>
                      <div className="font-bold flex items-center gap-2">
                        {req.player_avatar && <img src={req.player_avatar} alt="avatar" className="w-6 h-6 rounded-full" />}
                        {req.player_name}
                      </div>
                      <div className="text-sm text-gray-400">{req.player_email}</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleRequest(req.id, 'approved')} className="bg-green-500/20 text-green-500 hover:bg-green-500/30 p-2 rounded-lg transition-colors"><CheckCircle size={20} /></button>
                      <button onClick={() => handleRequest(req.id, 'rejected')} className="bg-red-500/20 text-red-500 hover:bg-red-500/30 p-2 rounded-lg transition-colors"><XCircle size={20} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Approved Players */}
            <div className="bg-gray-900/50 p-6 rounded-2xl border border-gray-800 flex flex-col">
              <h2 className="text-2xl font-display font-bold mb-4 flex items-center gap-2">
                Ready Players <span className="text-secondary bg-secondary/20 px-3 py-1 rounded-full text-sm">{totalPlayers}</span>
              </h2>
              <div className="flex-1 grid grid-cols-2 gap-4 auto-rows-max overflow-y-auto pr-2 max-h-72">
                {totalPlayers === 0 && <p className="text-gray-500 italic col-span-2">Waiting for approvals...</p>}
                {players.map(p => (
                  <div key={p.id} className="flex items-center gap-3 p-3 bg-gray-800 rounded-xl border border-gray-700">
                    {p.avatar_url
                      ? <img src={p.avatar_url} alt="avatar" className="w-8 h-8 rounded-full" />
                      : <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center"><UserCheck size={16} /></div>
                    }
                    <span className="font-bold truncate">{p.nickname}</span>
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

        {/* ─── PLAYING & REVEALING ───────────────────────────────────────── */}
        {(room.status === 'playing' || room.status === 'revealing') && !currentQuestion && (
          <div className="bg-gray-900/50 p-12 rounded-2xl border border-gray-800 text-center animate-pulse">
            <h2 className="text-2xl font-bold text-gray-400">Preparing first question...</h2>
            <p className="text-gray-500 mt-2">The game is about to begin.</p>
          </div>
        )}

        {(room.status === 'playing' || room.status === 'revealing') && currentQuestion && (
          <div className="space-y-6">
            {/* Question card */}
            <div className="bg-gray-900/50 p-8 rounded-2xl border border-primary relative overflow-hidden">
              {/* Progress bar */}
              <div className="absolute top-0 left-0 w-full h-1 bg-gray-800">
                <div className="h-full bg-primary transition-all" style={{ width: `${((room.current_question_index + 1) / room.questions.questions.length) * 100}%` }} />
              </div>

              <div className="flex justify-between items-center mb-4 text-gray-400">
                <span className="font-bold text-primary">Question {room.current_question_index + 1} / {room.questions.questions.length}</span>
                <span className={`font-mono text-lg ${answeredCount === totalPlayers ? 'text-green-400 font-bold' : ''}`}>
                  {answeredCount} / {totalPlayers} answered
                </span>
              </div>

              {/* Optional timer */}
              {showTimer && !isRevealing_ && (
                <div className="mb-6">
                  <QuestionTimer key={timerKey} started={room.question_started_at} duration={currentQuestion.time_limit || 30} />
                </div>
              )}

              <h2 className="text-3xl font-bold mb-8">{currentQuestion.question}</h2>

              {/* Choices */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {currentQuestion.choices.map((choice, i) => {
                  const isCorrect = i === currentQuestion.correct
                  const count = answers.filter(a => a.selected_choice === i).length
                  return (
                    <div key={i} className={`p-4 rounded-xl border flex justify-between items-center transition-all ${
                      isRevealing_
                        ? isCorrect
                          ? 'border-primary bg-primary/10 shadow-[0_0_15px_rgba(0,255,255,0.2)]'
                          : 'border-gray-700 bg-gray-800 opacity-50'
                        : 'border-gray-700 bg-gray-800'
                    }`}>
                      <span className={isRevealing_ && isCorrect ? 'font-bold text-primary' : ''}>{choice}</span>
                      <span className="font-mono text-xl font-bold">{count}</span>
                    </div>
                  )
                })}
              </div>

              {/* Winner banner (after reveal) */}
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

              {/* Action buttons */}
              <div className="mt-8 flex items-center justify-between gap-4">
                {/* Timer toggle */}
                <button
                  onClick={() => setShowTimer(v => !v)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm transition-all ${showTimer ? 'border-primary text-primary bg-primary/10' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}
                >
                  <Timer size={16} /> {showTimer ? 'Hide Timer' : 'Show Timer'}
                </button>

                <div className="flex gap-3">
                  {/* Reveal button — only when playing */}
                  {room.status === 'playing' && (
                    <button
                      onClick={revealAnswer}
                      disabled={isRevealing}
                      className="bg-yellow-500 text-black font-bold px-6 py-3 rounded-xl flex items-center gap-2 hover:bg-yellow-400 disabled:opacity-50 transition-all active:scale-95"
                    >
                      <Eye size={20} /> {isRevealing ? 'Revealing...' : 'Reveal Answer'}
                    </button>
                  )}

                  {/* Next button — only after reveal */}
                  {room.status === 'revealing' && (
                    <button
                      onClick={nextQuestion}
                      className="bg-white text-black font-bold px-6 py-3 rounded-xl flex items-center gap-2 hover:bg-gray-200 transition-all active:scale-95"
                    >
                      Next <SkipForward size={20} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Live Leaderboard */}
            <div className="bg-gray-900/50 p-6 rounded-2xl border border-gray-800">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Trophy className="text-[#FFD700]" /> Live Leaderboard
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {players.slice(0, 3).map((p, idx) => (
                  <div key={p.id} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-bold text-gray-500">#{idx + 1}</span>
                      <span className="font-bold">{p.nickname}</span>
                    </div>
                    <span className="font-mono text-primary font-bold">{p.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── FINISHED ──────────────────────────────────────────────────── */}
        {room.status === 'finished' && (
          <div className="bg-gray-900/50 p-12 rounded-2xl border border-gray-800 text-center">
            <Trophy size={64} className="mx-auto text-[#FFD700] mb-6" />
            <h2 className="text-5xl font-display font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">Game Finished!</h2>
            <p className="text-xl text-gray-400 mb-12">Final Leaderboard</p>
            <div className="max-w-2xl mx-auto space-y-4">
              {players.map((p, idx) => (
                <div key={p.id} className={`flex items-center justify-between p-4 rounded-xl border ${idx === 0 ? 'bg-primary/20 border-primary' : 'bg-gray-800 border-gray-700'}`}>
                  <div className="flex items-center gap-4">
                    <span className={`text-2xl font-bold ${idx === 0 ? 'text-primary' : 'text-gray-500'}`}>#{idx + 1}</span>
                    {p.avatar_url
                      ? <img src={p.avatar_url} alt="avatar" className="w-10 h-10 rounded-full" />
                      : <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center"><UserCheck size={20} /></div>
                    }
                    <span className="font-bold text-xl">{p.nickname}</span>
                  </div>
                  <div className="text-2xl font-mono font-bold text-white">{p.score} PTS</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
