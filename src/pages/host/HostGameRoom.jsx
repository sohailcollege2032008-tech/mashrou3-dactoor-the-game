import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ref, onValue, update, get, set, onDisconnect } from 'firebase/database'
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore'
import { rtdb, db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import {
  Play, UserCheck, XCircle, CheckCircle, SkipForward, Trophy,
  Eye, Timer, Loader2, WifiOff, StopCircle, Shuffle, Star, Zap, Settings, Layers
} from 'lucide-react'
import confetti from 'canvas-confetti'
import QuestionImage from '../../components/QuestionImage'

// ── Countdown bar (manual, host-triggered) ─────────────────────────────────
function CountdownBar({ startedAt, duration }) {
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
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-colors ${
      expired ? 'border-gray-700 bg-gray-800/60'
      : urgent ? 'border-red-500/60 bg-red-500/10'
      : 'border-primary/50 bg-primary/10'
    }`}>
      <Timer size={16} className={expired ? 'text-gray-500' : urgent ? 'text-red-400 animate-pulse' : 'text-primary'} />
      <div className=\"flex-1 h-2 bg-gray-700 rounded-full overflow-hidden\">
        <div className={`h-full rounded-full transition-none ${expired ? 'bg-gray-600' : urgent ? 'bg-red-400' : 'bg-primary'}`}
          style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono font-bold text-lg w-12 text-right tabular-nums ${
        expired ? 'text-gray-500' : urgent ? 'text-red-400' : 'text-primary'
      }`}>
        {expired ? 'Done' : `${Math.ceil(remaining)}s`}
      </span>
    </div>
  )
}

// ── Config panel ──────────────────────────────────────────────────────────────
function GameConfigPanel({ config, onChange }) {
  const apply = (key, val) => onChange({ ...config, [key]: val })

  return (
    <div className=\"bg-gray-900/60 border border-gray-800 rounded-2xl p-5 space-y-5\">
      <h3 className=\"text-base font-bold text-white flex items-center gap-2\">
        <Settings size={16} className=\"text-primary\" /> إعدادات الجيم
      </h3>

      {/* Timer duration */}
      <div className=\"flex items-center justify-between\">
        <div className=\"flex items-center gap-2\">
          <Timer size={15} className=\"text-gray-400\" />
          <span className=\"ar text-sm text-gray-200 font-medium\">وقت العد التنازلي</span>
        </div>
        <div className=\"flex items-center gap-1.5\">
          <input
            type=\"number\" min={5} max={300}
            value={config.timer_seconds}
            onChange={e => apply('timer_seconds', Math.max(5, Number(e.target.value)))}
            className=\"w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-primary text-center\"
          />
          <span className=\"text-xs text-gray-500\">ث</span>
        </div>
      </div>

      {/* Auto Mode toggle */}
      <div className=\"space-y-3 pt-1 border-t border-gray-800\">
        <label className=\"flex items-center justify-between cursor-pointer select-none\">
          <div className=\"flex items-center gap-2\">
            <Zap size={15} className=\"text-yellow-400\" />
            <span className=\"ar text-sm text-gray-200 font-medium\">وضع تلقائي (Auto Mode)</span>
          </div>
          <button
            onClick={() => apply('auto_mode', !config.auto_mode)}
            className={`relative w-11 h-6 rounded-full transition-colors ${config.auto_mode ? 'bg-yellow-500' : 'bg-gray-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.auto_mode ? 'translate-x-5' : ''}`} />
          </button>
        </label>

        {config.auto_mode && (
          <div className=\"flex items-center justify-between pl-7 animate-in fade-in slide-in-from-top-1 duration-200\">
            <div className=\"flex items-center gap-2\">
              <Timer size={14} className=\"text-gray-500\" />
              <span className=\"ar text-xs text-gray-400\">تايمر إجباري (ثانية)</span>
            </div>
            <input
              type=\"number\" min={5} max={600}
              value={config.auto_timer}
              onChange={e => apply('auto_timer', Math.max(5, Number(e.target.value)))}
              className=\"w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:border-yellow-500/50 text-center\"
            />
          </div>
        )}
      </div>

      {/* Shuffle Choices toggle */}
      <label className=\"flex items-center justify-between cursor-pointer select-none\">
        <div className=\"flex items-center gap-2\">
          <Shuffle size={15} className=\"text-gray-400\" />
          <span className=\"ar text-sm text-gray-200 font-medium\">ترتيب الاختيارات عشوائي</span>
        </div>
        <button
          onClick={() => apply('shuffle_choices', !config.shuffle_choices)}
          className={`relative w-11 h-6 rounded-full transition-colors ${config.shuffle_choices ? 'bg-primary' : 'bg-gray-700'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.shuffle_choices ? 'translate-x-5' : ''}`} />
        </button>
      </label>

      {/* Shuffle Questions toggle */}
      <label className=\"flex items-center justify-between cursor-pointer select-none\">
        <div className=\"flex items-center gap-2\">
          <Layers size={15} className=\"text-gray-400\" />
          <span className=\"ar text-sm text-gray-200 font-medium\">ترتيب الأسئلة عشوائي</span>
        </div>
        <button
          onClick={() => apply('shuffle_questions', !config.shuffle_questions)}
          className={`relative w-11 h-6 rounded-full transition-colors ${config.shuffle_questions ? 'bg-secondary' : 'bg-gray-700'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.shuffle_questions ? 'translate-x-5' : ''}`} />
        </button>
      </label>

      {/* Repeat entry */}
      <div className=\"pt-1 border-t border-gray-800 space-y-2\">
        <p className=\"ar text-xs text-gray-500 font-bold\">الدخول المتكرر للـ Deck</p>
        <div className=\"grid grid-cols-3 gap-1.5\">
          {[
            { val: 'allow', label: 'مسموح', color: 'primary' },
            { val: 'badge', label: 'تحذير', color: 'yellow-400' },
            { val: 'block', label: 'ممنوع', color: 'red-400' },
          ].map(opt => (
            <button
              key={opt.val}
              onClick={() => apply('repeat_entry', opt.val)}
              className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                config.repeat_entry === opt.val
                  ? opt.val === 'allow' ? 'bg-primary/20 border-primary text-primary'
                    : opt.val === 'badge' ? 'bg-yellow-400/20 border-yellow-400 text-yellow-400'
                    : 'bg-red-400/20 border-red-400 text-red-400'
                  : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className=\"text-xs text-gray-600 font-mono ar\">
          {config.repeat_entry === 'allow' && 'الجميع يقدر يدخل بغض النظر عن التاريخ'}
          {config.repeat_entry === 'badge' && 'يُسمح بالدخول وتظهر إشارة \"دخل قبل كده\"'}
          {config.repeat_entry === 'block' && 'زر الموافقة معطّل للي دخل قبل كده'}
        </p>
      </div>

      {/* Scoring mode */}
      <div>
        <p className=\"ar text-xs text-gray-500 font-bold mb-3\">نظام التقييم</p>
        <div className=\"space-y-2\">

          {/* Classic */}
          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${config.scoring_mode === 'classic' ? 'border-primary bg-primary/10' : 'border-gray-700 hover:border-gray-600'}`}>
            <input type=\"radio\" name=\"mode\" className=\"hidden\" checked={config.scoring_mode === 'classic'} onChange={() => apply('scoring_mode', 'classic')} />
            <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${config.scoring_mode === 'classic' ? 'border-primary' : 'border-gray-600'}`}>
              {config.scoring_mode === 'classic' && <div className=\"w-2 h-2 bg-primary rounded-full\" />}
            </div>
            <div className=\"ar\">
              <p className=\"text-sm font-bold text-white\">كلاسيك</p>
              <p className=\"text-xs text-gray-500\">أول واحد صح ياخد نقطة، الباقي صفر</p>
            </div>
          </label>

          {/* Custom */}
          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${config.scoring_mode === 'custom' ? 'border-primary bg-primary/10' : 'border-gray-700 hover:border-gray-600'}`}>
            <input type=\"radio\" name=\"mode\" className=\"hidden\" checked={config.scoring_mode === 'custom'} onChange={() => apply('scoring_mode', 'custom')} />
            <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${config.scoring_mode === 'custom' ? 'border-primary' : 'border-gray-600'}`}>
              {config.scoring_mode === 'custom' && <div className=\"w-2 h-2 bg-primary rounded-full\" />}
            </div>
            <div className=\"ar\">
              <p className=\"text-sm font-bold text-white\">كاستوم</p>
              <p className=\"text-xs text-gray-500\">أول واحد صح N نقطة، الباقي الصح M نقطة</p>
            </div>
          </label>

          {config.scoring_mode === 'custom' && (
            <div className=\"flex gap-4 px-3 pb-1\">
              <div>
                <label className=\"text-xs text-gray-500 block mb-1\">أول واحد صح</label>
                <div className=\"flex items-center gap-1\">
                  <input type=\"number\" min={1} max={100} value={config.first_correct_points}
                    onChange={e => apply('first_correct_points', Math.max(1, Number(e.target.value)))}
                    className=\"w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-primary\" />
                  <span className=\"text-xs text-gray-500\">نقطة</span>
                </div>
              </div>
              <div>
                <label className=\"text-xs text-gray-500 block mb-1\">باقي الصح</label>
                <div className=\"flex items-center gap-1\">
                  <input type=\"number\" min={0} max={100} value={config.other_correct_points}
                    onChange={e => apply('other_correct_points', Math.max(0, Number(e.target.value)))}
                    className=\"w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-primary\" />
                  <span className=\"text-xs text-gray-500\">نقطة</span>
                </div>
              </div>
            </div>
          )}

          {/* Ranked */}
          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${config.scoring_mode === 'ranked' ? 'border-primary bg-primary/10' : 'border-gray-700 hover:border-gray-600'}`}>
            <input type=\"radio\" name=\"mode\" className=\"hidden\" checked={config.scoring_mode === 'ranked'} onChange={() => apply('scoring_mode', 'ranked')} />
            <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${config.scoring_mode === 'ranked' ? 'border-primary' : 'border-gray-600'}`}>
              {config.scoring_mode === 'ranked' && <div className=\"w-2 h-2 bg-primary rounded-full\" />}
            </div>
            <div className=\"ar\">
              <p className=\"text-sm font-bold text-white\">ترتيبي</p>
              <p className=\"text-xs text-gray-500\">الأول N، الثاني N−X، الثالث N−2X…</p>
            </div>
          </label>

          {config.scoring_mode === 'ranked' && (
            <div className=\"flex gap-4 px-3 pb-1\">
              <div>
                <label className=\"text-xs text-gray-500 block mb-1\">N (نقاط الأول)</label>
                <div className=\"flex items-center gap-1\">
                  <input type=\"number\" min={1} max={100} value={config.first_correct_points}
                    onChange={e => apply('first_correct_points', Math.max(1, Number(e.target.value)))}
                    className=\"w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-primary\" />
                  <span className=\"text-xs text-gray-500\">نقطة</span>
                </div>
              </div>
              <div>
                <label className=\"text-xs text-gray-500 block mb-1\">X (الفرق)</label>
                <div className=\"flex items-center gap-1\">
                  <input type=\"number\" min={1} max={50} value={config.points_decrement}
                    onChange={e => apply('points_decrement', Math.max(1, Number(e.target.value)))}
                    className=\"w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-primary\" />
                  <span className=\"text-xs text-gray-500\">نقطة</span>
                </div>
              </div>
              <div className=\"self-end pb-1.5\">
                <p className=\"text-xs text-gray-600 font-mono\">
                  {config.first_correct_points}، {Math.max(0, config.first_correct_points - config.points_decrement)}، {Math.max(0, config.first_correct_points - 2 * config.points_decrement)}…
                </p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ── Fisher-Yates shuffle ──────────────────────────────────────────────────────
function shuffleArray(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Main component ────────────────────────────────────────────────────────────
export default function HostGameRoom() {
  const { roomId }  = useParams()
  const { session } = useAuth()
  const navigate    = useNavigate()

  const [room, setRoom]         = useState(null)
  const [requests, setRequests] = useState([])
  const [players, setPlayers]   = useState([])
  const [presence, setPresence] = useState({})
  const [answers, setAnswers]   = useState([])
  const [revealResult, setRevealResult] = useState(null)
  const [isRevealing, setIsRevealing]   = useState(false)
  const [startingCountdown, setStartingCountdown] = useState(false)
  const [processingRequests, setProcessingRequests] = useState(new Set())
  const [endingGame, setEndingGame] = useState(false)

  const [gameConfig, setGameConfig] = useState({
    scoring_mode: 'classic',
    shuffle_choices: false,
    first_correct_points: 3,
    other_correct_points: 1,
    points_decrement: 1,
    timer_seconds: 30,
    auto_mode: false,
    auto_timer: 45,
    shuffle_questions: false,
    repeat_entry: 'allow',   // 'allow' | 'badge' | 'block'
  })
  const [playHistory, setPlayHistory] = useState({})  // { [uid]: count }

  const [toasts, setToasts]               = useState([])         // correct-answer notifications
  const [downloadingLogs, setDownloadingLogs] = useState(false)
  const notifiedAnswersRef = useRef(new Set())   // user_ids already toasted this question
  const roomStatusRef      = useRef(null)         // mirror of room.status for callbacks

  // ── Derived State ──────────────────────────────────────────────────────────
  const totalPlayers  = players.length
  const answeredCount = answers.length
  const config        = room?.config || { scoring_mode: 'classic' }
  const isRevealPhase = room?.status === 'revealing'
  const currentQ      = room?.questions?.questions?.[room?.current_question_index]

  // ── Host presence ─────────────────────────────────────────────────────────
  // Uses .info/connected so we register onDisconnect BEFORE writing online:true.
  // This prevents the race condition where the old connection's onDisconnect
  // fires on the server *after* the new connection already wrote online:true,
  // causing the banner to stay stuck on players' screens.
  useEffect(() => {
    if (!session) return
    const presRef = ref(rtdb, `rooms/${roomId}/presence/host`)
    const connRef = ref(rtdb, '.info/connected')

    const unsub = onValue(connRef, async (snap) => {
      if (!snap.val()) return   // not yet connected — wait
      // 1. Register onDisconnect first and wait for server ack
      await onDisconnect(presRef).set({ online: false, last_seen: Date.now() })
      // 2. Only then write online:true — guaranteed to land after old onDisconnect
      await set(presRef, { online: true, last_seen: Date.now() })
    })

    return () => {
      unsub()
      set(presRef, { online: false, last_seen: Date.now() })
    }
  }, [roomId, session])

  // ── Room subscription ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const unsubRoom = onValue(ref(rtdb, `rooms/${roomId}`), snap => {
      if (!snap.exists()) return
      const data = snap.val()
      roomStatusRef.current = data.status   // keep ref in sync for callbacks
      setRoom(prev => {
        if (prev && data.current_question_index !== prev.current_question_index) {
          setAnswers([]); setRevealResult(null)
        }
        if (data.status === 'finished' && prev?.status !== 'finished') {
          confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 } })
        }
        return data
      })
    })
    return () => unsubRoom()
  }, [roomId, session])

  // ── Requests, players, presence, answers ──────────────────────────────────
  useEffect(() => {
    if (!session) return
    const unsubReq = onValue(ref(rtdb, `rooms/${roomId}/join_requests`), snap => {
      if (!snap.exists()) { setRequests([]); return }
      setRequests(Object.entries(snap.val()).map(([key, val]) => ({ key, ...val })).filter(r => r.status === 'pending'))
    })
    return () => unsubReq()
  }, [roomId, session])

  // ── Fetch play history for pending requesters ──────────────────────────────
  useEffect(() => {
    if (!requests.length || !room?.question_set_id) return
    const qSetId = room.question_set_id
    const uids = requests.map(r => r.key).filter(uid => !(uid in playHistory))
    if (!uids.length) return
    Promise.all(uids.map(uid =>
      getDoc(doc(db, 'profiles', uid)).then(snap => ({
        uid,
        count: snap.exists() ? (snap.data().played_decks?.[qSetId] || 0) : 0
      }))
    )).then(results => {
      setPlayHistory(prev => {
        const next = { ...prev }
        results.forEach(({ uid, count }) => { next[uid] = count })
        return next
      })
    })
  }, [requests, room?.question_set_id])

  useEffect(() => {
    if (!session) return
    const unsubPlayers = onValue(ref(rtdb, `rooms/${roomId}/players`), snap => {
      if (!snap.exists()) { setPlayers([]); return }
      setPlayers(Object.values(snap.val()).sort((a, b) => b.score - a.score))
    })
    return () => unsubPlayers()
  }, [roomId, session])

  useEffect(() => {
    if (!session) return
    const unsubPres = onValue(ref(rtdb, `rooms/${roomId}/presence/players`), snap => {
      setPresence(snap.exists() ? snap.val() : {})
    })
    return () => unsubPres()
  }, [roomId, session])

  useEffect(() => {
    if (!session || room?.current_question_index === undefined) return
    const qIdx = room.current_question_index
    notifiedAnswersRef.current = new Set()   // reset for each new question
    const unsubAns = onValue(ref(rtdb, `rooms/${roomId}/answers/${qIdx}`), snap => {
      const all = snap.exists() ? Object.values(snap.val()) : []
      setAnswers(all)

      // Only toast during playing phase
      if (roomStatusRef.current !== 'playing') return
      all.filter(a => a.is_correct).forEach(a => {
        if (notifiedAnswersRef.current.has(a.user_id)) return
        notifiedAnswersRef.current.add(a.user_id)
        const id = `${Date.now()}-${a.user_id}`
        setToasts(prev => [...prev, { id, nickname: a.player_name, time_ms: a.reaction_time_ms }])
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
      })
    })
    return () => unsubAns()
  }, [roomId, session, room?.current_question_index])

  // ── Auto Mode: Reveal ───────────────────────────────────────────────────
  useEffect(() => {
    if (!room || room.status !== 'playing' || !gameConfig.auto_mode || isRevealing) return

    // Trigger 1: All Answered
    if (totalPlayers > 0 && answers.length >= totalPlayers) {
      console.log(\"Auto-Mode: All players answered. Revealing...\")
      revealAnswer()
      return
    }

    // Trigger 2: Mandatory Timer (Forced Timer)
    const checkTimer = setInterval(() => {
      if (!room.question_started_at) return
      const elapsed = (Date.now() - room.question_started_at) / 1000
      if (elapsed >= gameConfig.auto_timer) {
        console.log(\"Auto-Mode: Mandatory Timer expired. Revealing...\")
        revealAnswer()
        clearInterval(checkTimer)
      }
    }, 1000)

    return () => clearInterval(checkTimer)
  }, [room?.status, answers.length, totalPlayers, gameConfig.auto_mode, gameConfig.auto_timer, isRevealing])

  // ── Auto Mode: Next Question ───────────────────────────────────────────
  useEffect(() => {
    if (!room || room.status !== 'revealing' || !gameConfig.auto_mode) return

    const timer = setTimeout(() => {
      console.log(\"Auto-Mode: 8s delay finished. Moving to next question...\")
      nextQuestion()
    }, 8000)

    return () => clearTimeout(timer)
  }, [room?.status, gameConfig.auto_mode])

  // ── Handle join request ───────────────────────────────────────────────────
  const handleRequest = async (reqKey, action) => {
    setProcessingRequests(prev => new Set(prev).add(reqKey))
    try {
      if (action === 'approved') {
        const reqSnap = await get(ref(rtdb, `rooms/${roomId}/join_requests/${reqKey}`))
        if (!reqSnap.exists()) return
        const reqData = reqSnap.val()
        const currentQIdx = roomStatusRef.current === 'lobby' ? 0 : (room?.current_question_index ?? 0)
        await update(ref(rtdb), {
          [`rooms/${roomId}/join_requests/${reqKey}/status`]: 'approved',
          [`rooms/${roomId}/players/${reqKey}`]: {
            user_id: reqKey, nickname: reqData.player_name,
            avatar_url: reqData.player_avatar || null, score: 0, joined_at: Date.now(),
            joined_at_question_index: currentQIdx,
          }
        })
      } else {
        await update(ref(rtdb, `rooms/${roomId}/join_requests/${reqKey}`), { status: 'rejected' })
      }
    } catch (err) { alert('Error: ' + err.message) }
    finally { setProcessingRequests(prev => { const n = new Set(prev); n.delete(reqKey); return n }) }
  }

  // ── Start game ────────────────────────────────────────────────────────────
  const startGame = async () => {
    try {
      let questions = { ...room.questions }
      
      // Shuffle questions order if enabled
      if (gameConfig.shuffle_questions) {
        questions.questions = shuffleArray(questions.questions)
      }

      // Optionally shuffle choices for every question
      if (gameConfig.shuffle_choices) {
        questions = {
          ...questions,
          questions: questions.questions.map(q => {
            const indices = q.choices.map((_, i) => i)
            const shuffled = shuffleArray(indices)
            return {
              ...q,
              choices: shuffled.map(i => q.choices[i]),
              correct: shuffled.indexOf(q.correct),
            }
          })
        }
      }

      await update(ref(rtdb, `rooms/${roomId}`), {
        status: 'playing',
        current_question_index: 0,
        question_started_at: Date.now(),
        config: gameConfig,
        questions,
        countdown_started_at: null,
        countdown_duration: null,
      })
    } catch (err) { alert('Failed to start: ' + err.message) }
  }

  // ── End competition ───────────────────────────────────────────────────────
  const endCompetition = async () => {
    if (!window.confirm('إنهاء المسابقة الآن؟')) return
    setEndingGame(true)
    try {
      await update(ref(rtdb, `rooms/${roomId}`), { status: 'finished' })
      await set(ref(rtdb, `host_rooms/${session.uid}/active`), null)
    }
    catch (err) { alert('Error: ' + err.message) }
    finally { setEndingGame(false) }
  }

  // ── Reveal answer ─────────────────────────────────────────────────────────
  const revealAnswer = async () => {
    setIsRevealing(true)
    try {
      const config       = room.config || { scoring_mode: 'classic' }
      const qIdx         = room.current_question_index
      const correctChoice = room.questions.questions[qIdx].correct

      const answersSnap = await get(ref(rtdb, `rooms/${roomId}/answers/${qIdx}`))
      const allAnswers  = answersSnap.exists() ? Object.values(answersSnap.val()) : []
      const correct     = allAnswers
        .filter(a => a.selected_choice === correctChoice)
        .sort((a, b) => a.reaction_time_ms - b.reaction_time_ms)

      const winner = correct[0] || null

      // ── Calculate points per rank ─────────────────────────────────────────
      const getPoints = (rank0) => {   // rank0 = 0-indexed
        const { scoring_mode, first_correct_points: N = 3, other_correct_points: M = 1, points_decrement: X = 1 } = config
        if (scoring_mode === 'classic')  return rank0 === 0 ? 1 : 0
        if (scoring_mode === 'custom')   return rank0 === 0 ? N : M
        if (scoring_mode === 'ranked')   return Math.max(0, N - rank0 * X)
        return 0
      }

      // ── Build updates ─────────────────────────────────────────────────────
      const scoreUpdates  = {}
      const answerUpdates = {}

      // Batch-read all player scores we need to update
      const toUpdate = correct.filter((_, i) => getPoints(i) > 0)
      const scoreSnaps = await Promise.all(
        toUpdate.map(a => get(ref(rtdb, `rooms/${roomId}/players/${a.user_id}/score`)))
      )

      // Track new scores locally to build leaderboard without extra reads
      const newScoreById = {}
      players.forEach(p => { newScoreById[p.user_id] = p.score })

      toUpdate.forEach((a, idx) => {
        const pts = getPoints(correct.indexOf(a))
        const newScore = (scoreSnaps[idx].val() || 0) + pts
        scoreUpdates[`rooms/${roomId}/players/${a.user_id}/score`] = newScore
        answerUpdates[`rooms/${roomId}/answers/${qIdx}/${a.user_id}/points_earned`] = pts
        newScoreById[a.user_id] = newScore
      })

      // Rank + is_first_correct + is_correct for all correct answers
      correct.forEach((a, i) => {
        answerUpdates[`rooms/${roomId}/answers/${qIdx}/${a.user_id}/rank`]             = i + 1
        answerUpdates[`rooms/${roomId}/answers/${qIdx}/${a.user_id}/is_first_correct`] = i === 0
        answerUpdates[`rooms/${roomId}/answers/${qIdx}/${a.user_id}/is_correct`]       = true
      })

      // ── Build leaderboard summary (top 5 + each player's rank) ───────────
      // Sort players by new score (no extra DB read — uses live `players` state)
      const sortedPlayers = [...players]
        .map(p => ({ ...p, score: newScoreById[p.user_id] ?? p.score }))
        .sort((a, b) => b.score - a.score)

      const top5 = sortedPlayers.slice(0, 5).map((p, i) => ({
        rank:     i + 1,
        user_id:  p.user_id,
        nickname: p.nickname,
        score:    newScoreById[p.user_id] ?? p.score,
      }))

      const rankUpdates = { [`rooms/${roomId}/leaderboard/top5`]: top5 }
      sortedPlayers.forEach((p, i) => {
        rankUpdates[`rooms/${roomId}/players/${p.user_id}/rank`] = i + 1
      })

      const winners = correct
        .map((a, i) => ({
          user_id: a.user_id,
          nickname: a.player_name,
          time_ms: a.reaction_time_ms,
          points: getPoints(i),
          rank: i + 1
        }))
        .filter(w => w.points > 0);

      const revealData = {
        winner_nickname: winner?.player_name || null,
        winner_time_ms:  winner?.reaction_time_ms || null,
        winners:         winners,
        correct_count:   correct.length,
      }

      await update(ref(rtdb), {
        ...scoreUpdates,
        ...answerUpdates,
        ...rankUpdates,
        [`rooms/${roomId}/status`]:      'revealing',
        [`rooms/${roomId}/reveal_data`]: revealData,
      })
      setRevealResult(revealData)
    } catch (err) { alert('Reveal failed: ' + err.message) }
    finally { setIsRevealing(false) }
  }

  // ── Next question ─────────────────────────────────────────────────────────
  const nextQuestion = async () => {
    if (!room?.questions?.questions) return
    const isFinished = room.current_question_index + 1 >= room.questions.questions.length
    try {
      if (isFinished) {
        await update(ref(rtdb, `rooms/${roomId}`), { status: 'finished' })
        await set(ref(rtdb, `host_rooms/${session.uid}/active`), null)
      } else {
        await update(ref(rtdb, `rooms/${roomId}`), {
          status: 'playing',
          current_question_index: room.current_question_index + 1,
          question_started_at: Date.now(),
          reveal_data: null,
          countdown_started_at: null,
          countdown_duration: null,
        })
      }
      setRevealResult(null)
    } catch (err) { alert('Error: ' + err.message) }
  }

  // ── Start manual countdown ────────────────────────────────────────────────
  const startCountdown = async () => {
    setStartingCountdown(true)
    try {
      const dur = room.config?.timer_seconds || 30
      await update(ref(rtdb, `rooms/${roomId}`), {
        countdown_started_at: Date.now(),
        countdown_duration: dur,
      })
    } catch (err) { alert('Error: ' + err.message) }
    finally { setStartingCountdown(false) }
  }

  // ── Download game logs ────────────────────────────────────────────────────
  const downloadLogs = async () => {
    setDownloadingLogs(true)
    try {
      const questions = room.questions?.questions || []
      const lines = []
      const pad  = (s, n) => String(s).padEnd(n)

      lines.push('=== Mashrou3 Dactoor — Game Log ===')
      lines.push(`Room      : ${roomId}`)
      lines.push(`Date      : ${new Date().toLocaleString()}`)
      lines.push(`Players   : ${players.length}`)
      lines.push(`Questions : ${questions.length}`)
      lines.push(`Scoring   : ${room.config?.scoring_mode || 'classic'}`)
      lines.push('')

      for (let qi = 0; qi < questions.length; qi++) {
        const q = questions[qi]
        lines.push('═'.repeat(62))
        lines.push(`Q${qi + 1}: ${q.question}`)
        lines.push(`Correct: ${q.choices[q.correct] || '?'}`)
        lines.push('─'.repeat(62))

        const ansSnap = await get(ref(rtdb, `rooms/${roomId}/answers/${qi}`))
        const ansMap  = ansSnap.exists() ? ansSnap.val() : {}
        const answered = Object.values(ansMap)
        const answeredIds = new Set(answered.map(a => a.user_id))

        const correct  = answered.filter(a => a.is_correct ).sort((a, b) => a.reaction_time_ms - b.reaction_time_ms)
        const wrong    = answered.filter(a => !a.is_correct).sort((a, b) => a.reaction_time_ms - b.reaction_time_ms)
        const noAnswer = players.filter(p => !answeredIds.has(p.user_id))

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
      players.forEach((p, i) => {
        lines.push(`  #${pad(i + 1, 4)}${pad(p.nickname, 32)}${p.score} pts`)
      })

      const blob = new Blob(['\\uFEFF' + lines.join('\\n')], { type: 'text/plain;charset=utf-8' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `dactoor-${roomId}-${new Date().toISOString().slice(0, 10)}.txt`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Error downloading logs: ' + err.message)
    } finally {
      setDownloadingLogs(false)
    }
  }

  // Preload next question's image while players are answering current one
  const nextQImg = room?.questions?.questions?.[room?.current_question_index + 1]?.image_url
  useEffect(() => {
    if (!nextQImg) return
    const img = new Image()
    img.src = nextQImg
  }, [nextQImg])

  // ─────────────────────────────────────────────────────────────────────────
  if (!room) return (
    <div className=\"text-white p-6 flex items-center gap-3\">
      <div className=\"w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin\" />
      Loading Room...
    </div>
  )

  return (
    <div className=\"min-h-screen bg-background text-white p-6\">

      {/* ── Correct-answer toast notifications ─────────────────────────────── */}
      {toasts.length > 0 && (
        <div className=\"fixed right-5 top-20 z-[200] space-y-2 pointer-events-none max-w-[220px]\">
          {toasts.map(t => (
            <div key={t.id}
              className=\"flex items-center gap-2 bg-green-900/95 border border-green-500/60 text-green-100 px-3 py-2 rounded-xl shadow-2xl shadow-black/40\"
              style={{ animation: 'slideInRight .25s ease-out' }}
            >
              <CheckCircle size={14} className=\"text-green-400 flex-shrink-0\" />
              <span className=\"font-bold text-sm flex-1 truncate\">{t.nickname}</span>
              <span className=\"text-green-400 font-mono text-xs flex-shrink-0\">{t.time_ms}ms</span>
            </div>
          ))}
        </div>
      )}

      <div className=\"max-w-6xl mx-auto space-y-6\">

        {/* Header */}
        <div className=\"flex items-center justify-between bg-gray-900/50 p-5 rounded-2xl border border-gray-800\">
          <div>
            <h1 className=\"text-3xl font-display font-bold text-white\">{room.title}</h1>
            <p className=\"text-lg text-primary font-mono tracking-widest mt-1\">JOIN: {roomId}</p>
          </div>
          <div className=\"flex items-center gap-3\">
            {room.status !== 'finished' && (
              <button onClick={endCompetition} disabled={endingGame}
                className=\"flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors font-bold text-sm disabled:opacity-50\">
                <StopCircle size={15} /> {endingGame ? 'Ending...' : 'End'}
              </button>
            )}
            <div className=\"flex flex-col items-end gap-2\">
              <div className=\"flex items-center gap-3\">
                <button
                  onClick={() => setGameConfig(prev => ({ ...prev, auto_mode: !prev.auto_mode }))}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
                    gameConfig.auto_mode 
                      ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400 shadow-[0_0_15px_-5px_rgba(234,179,8,0.4)]' 
                      : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-400'
                  }`}
                  title=\"Toggle Auto-Progression\"
                >
                  <Zap size={14} className={gameConfig.auto_mode ? 'animate-pulse' : ''} />
                  <span className=\"text-xs font-bold ar\">تلقائي</span>
                </button>
                <div className=\"text-right\">
                  <div className=\"text-xl font-bold\">{totalPlayers} Players</div>
                </div>
              </div>
              <div className={`capitalize px-3 py-0.5 rounded-full inline-block text-xs font-bold ${
                room.status === 'playing'   ? 'bg-green-500/20 text-green-400' :
                room.status === 'revealing' ? 'bg-yellow-500/20 text-yellow-400' :
                room.status === 'finished'  ? 'bg-primary/20 text-primary' :
                'bg-gray-800 text-gray-400'}`}>
                {room.status}
              </div>
            </div>
          </div>
        </div>

        {/* ── LOBBY ──────────────────────────────────────────────────────── */}
        {room.status === 'lobby' && (
          <div className=\"grid grid-cols-1 lg:grid-cols-3 gap-6\">

            {/* Join Requests */}
            <div className=\"bg-gray-900/50 p-5 rounded-2xl border border-gray-800\">
              <h2 className=\"text-lg font-display font-bold mb-4 flex items-center gap-2\">
                Join Requests
                <span className=\"text-primary bg-primary/20 px-2 py-0.5 rounded-full text-xs\">{requests.length}</span>
              </h2>
              <div className=\"space-y-3 max-h-64 overflow-y-auto pr-1\">
                {requests.length === 0 && <p className=\"text-gray-500 italic text-sm\">No pending requests...</p>}
                {requests.map(req => {
                  const playCount  = playHistory[req.key] || 0
                  const isRepeater = playCount > 0
                  const isBlocked  = isRepeater && gameConfig.repeat_entry === 'block'
                  return (
                    <div key={req.key} className={`flex items-center justify-between p-3 bg-gray-800 rounded-xl border transition-colors ${isBlocked ? 'border-red-500/40' : 'border-gray-700'}`}>
                      <div>
                        <div className=\"font-bold text-sm flex items-center gap-2\">
                          {req.player_avatar && <img src={req.player_avatar} alt=\"\" className=\"w-5 h-5 rounded-full\" />}
                          {req.player_name}
                          {isRepeater && gameConfig.repeat_entry !== 'allow' && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full font-mono ${
                              isBlocked ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                            }`}>
                              {isBlocked ? '🚫' : '⚠️'} دخل {playCount}x
                            </span>
                          )}
                        </div>
                        <div className=\"text-xs text-gray-400\">{req.player_email}</div>
                      </div>
                      <div className=\"flex gap-1\">
                        {processingRequests.has(req.key) ? (
                          <Loader2 size={18} className=\"text-primary animate-spin\" />
                        ) : (
                          <>
                            <button
                              onClick={() => handleRequest(req.key, 'approved')}
                              disabled={isBlocked}
                              className=\"bg-green-500/20 text-green-500 hover:bg-green-500/30 p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed\"
                            ><CheckCircle size={16} /></button>
                            <button onClick={() => handleRequest(req.key, 'rejected')} className=\"bg-red-500/20 text-red-500 hover:bg-red-500/30 p-1.5 rounded-lg transition-colors\"><XCircle size={16} /></button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Players + Config + Start */}
            <div className=\"lg:col-span-2 space-y-4\">
              {/* Players */}
              <div className=\"bg-gray-900/50 p-5 rounded-2xl border border-gray-800\">
                <h2 className=\"text-lg font-display font-bold mb-3 flex items-center gap-2\">
                  Ready
                  <span className=\"text-secondary bg-secondary/20 px-2 py-0.5 rounded-full text-xs\">{totalPlayers}</span>
                </h2>
                <div className=\"grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-32 overflow-y-auto\">
                  {totalPlayers === 0 && <p className=\"text-gray-500 italic text-sm col-span-full\">Waiting...</p>}
                  {players.map(p => (
                    <div key={p.user_id} className=\"flex items-center gap-2 p-2 bg-gray-800 rounded-lg border border-gray-700\">
                      {p.avatar_url ? <img src={p.avatar_url} alt=\"\" className=\"w-6 h-6 rounded-full\" /> : <UserCheck size={14} className=\"text-gray-500\" />}
                      <span className=\"font-bold text-sm truncate flex-1\">{p.nickname}</span>
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${presence[p.user_id]?.online ? 'bg-green-400' : 'bg-gray-600'}`} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Config */}
              <GameConfigPanel config={gameConfig} onChange={setGameConfig} />

              {/* Start button */}
              <button onClick={startGame} disabled={totalPlayers === 0}
                className=\"w-full bg-primary text-background font-bold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-[#00D4FF] disabled:opacity-50 transition-colors active:scale-95 text-lg\">
                <Play size={22} fill=\"currentColor\" /> Start Game
              </button>
            </div>
          </div>
        )}

        {/* ── PLAYING & REVEALING ─────────────────────────────────────────── */}
        {(room.status === 'playing' || room.status === 'revealing') && currentQ && (
          <div className=\"space-y-5\">
            <div className=\"bg-gray-900/50 p-6 rounded-2xl border border-primary relative overflow-hidden\">
              {/* Progress strip */}
              <div className=\"absolute top-0 left-0 w-full h-1 bg-gray-800\">
                <div className=\"h-full bg-primary\" style={{ width: `${((room.current_question_index + 1) / room.questions.questions.length) * 100}%` }} />
              </div>

              <div className=\"flex justify-between items-center mb-4 text-sm text-gray-400\">
                <span className=\"font-bold text-primary\">Q {room.current_question_index + 1} / {room.questions.questions.length}</span>
                <div className=\"flex items-center gap-3\">
                  {/* Scoring badge */}
                  <span className=\"text-xs font-mono bg-gray-800 px-2 py-0.5 rounded\">
                    {config.scoring_mode === 'classic' ? '🏆 كلاسيك' :
                     config.scoring_mode === 'custom'  ? `✨ ${config.first_correct_points}/${config.other_correct_points} نقاط` :
                     `📊 ${config.first_correct_points}−${config.points_decrement} ترتيبي`}
                  </span>
                  <span className={`font-mono ${answeredCount === totalPlayers ? 'text-green-400 font-bold' : ''}`}>
                    {answeredCount} / {totalPlayers} answered
                  </span>
                </div>
              </div>

              {/* Countdown bar — shown when active (both playing & revealing) */}
              {room.countdown_started_at && (
                <div className=\"mb-4\">
                  <CountdownBar startedAt={room.countdown_started_at} duration={room.countdown_duration} />
                </div>
              )}

              <h2 className=\"text-2xl font-bold mb-6\">{currentQ.question}</h2>

              {currentQ.image_url && (
                <div className=\"mb-5\">
                  <QuestionImage src={currentQ.image_url} className=\"w-full max-h-56 object-contain rounded-xl border border-gray-700 bg-gray-900\" />
                </div>
              )}

              <div className=\"grid grid-cols-1 md:grid-cols-2 gap-3\">
                {currentQ.choices.map((choice, i) => {
                  const isCorrect = i === currentQ.correct
                  const count     = answers.filter(a => a.selected_choice === i).length
                  return (
                    <div key={i} className={`p-4 rounded-xl border flex justify-between items-center transition-colors ${
                      isRevealPhase
                        ? isCorrect ? 'border-primary bg-primary/10 shadow-[0_0_15px_rgba(0,255,255,0.15)]' : 'border-gray-700 bg-gray-800 opacity-50'
                        : 'border-gray-700 bg-gray-800'
                    }`}>
                      <span className={isRevealPhase && isCorrect ? 'font-bold text-primary' : ''}>{choice}</span>
                      <span className=\"font-mono text-lg font-bold ml-3 flex-shrink-0\">{count}</span>
                    </div>
                  )
                })}
              </div>

              {/* Reveal result - Question Honor Roll */}
              {isRevealPhase && revealResult && (
                <div className=\"mt-6 space-y-4\">
                  <div className=\"flex items-center justify-between border-b border-gray-800 pb-2\">
                    <h3 className=\"text-sm font-bold text-gray-400 flex items-center gap-2\">
                      <Star size={14} className=\"text-yellow-500\" /> لوحة شرف السؤال
                    </h3>
                    <span className=\"text-xs text-gray-500 font-mono\">{revealResult.correct_count} طالب أجابوا صح</span>
                  </div>

                  {revealResult.winners && revealResult.winners.length > 0 ? (
                    <div className=\"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar\">
                      {revealResult.winners.map((w, idx) => (
                        <div key={w.user_id} 
                          className={`relative flex items-center gap-3 p-3 rounded-xl border transition-all animate-in fade-in slide-in-from-bottom-2 duration-300`}
                          style={{ animationDelay: `${idx * 50}ms` }}
                        >
                          {/* Rank badge */}
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${
                            w.rank === 1 ? 'bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.3)]' :
                            w.rank === 2 ? 'bg-gray-300 text-black' :
                            w.rank === 3 ? 'bg-orange-400 text-black' :
                            'bg-gray-800 text-gray-400 border border-gray-700'
                          }`}>
                            {w.rank}
                          </div>

                          <div className=\"min-w-0 flex-1\">
                            <div className=\"font-bold text-sm truncate\">{w.nickname}</div>
                            <div className=\"flex items-center gap-2 text-[10px] text-gray-500 font-mono\">
                              <Timer size={10} /> {w.time_ms}ms
                            </div>
                          </div>

                          <div className=\"text-primary font-bold text-sm px-2 py-0.5 bg-primary/10 rounded-lg\">
                            +{w.points}
                          </div>
                          
                          {w.rank === 1 && (
                            <div className=\"absolute -top-1 -right-1\">
                              <Trophy size={14} className=\"text-yellow-500\" fill=\"currentColor\" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : revealResult.correct_count > 0 ? (
                    /* Fallback for old reveal data or cases where no points were earned but some were correct */
                    <div className=\"flex items-center gap-3 bg-gray-800/50 border border-gray-700 text-gray-300 px-5 py-3 rounded-xl\">
                      <CheckCircle size={18} className=\"text-green-500\" />
                      <span className=\"font-bold\">أول من أجاب: <span className=\"text-white\">{revealResult.winner_nickname}</span></span>
                      <span className=\"text-sm ml-auto opacity-70 font-mono\">{revealResult.winner_time_ms}ms</span>
                    </div>
                  ) : (
                    <div className=\"bg-gray-900/50 border border-gray-800 rounded-xl p-6 text-center\">
                      <XCircle size={32} className=\"mx-auto text-gray-700 mb-2\" />
                      <div className=\"text-gray-500 text-sm\">للأسف، ولا حد جابها صح!</div>
                    </div>
                  )}
                </div>
              )}

              {/* Controls */}
              <div className=\"mt-6 flex items-center justify-between gap-4 flex-wrap\">
                {/* Countdown button — only during playing phase */}
                {room.status === 'playing' && (
                  <button
                    onClick={startCountdown}
                    disabled={!!room.countdown_started_at || startingCountdown}
                    className=\"flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-default
                      border-primary/60 text-primary bg-primary/5 hover:bg-primary/15 active:scale-95\"
                  >
                    <Timer size={15} />
                    {room.countdown_started_at
                      ? `العد جاري...`
                      : `Start Countdown ${room.config?.timer_seconds || 30}s`}
                  </button>
                )}
                {room.status === 'revealing' && <div />}

                <div className=\"flex gap-3 ml-auto\">
                  {room.status === 'playing' && (
                    <button onClick={revealAnswer} disabled={isRevealing}
                      className=\"bg-yellow-500 text-black font-bold px-6 py-2.5 rounded-xl flex items-center gap-2 hover:bg-yellow-400 disabled:opacity-50 transition-colors active:scale-95\">
                      <Eye size={18} /> {isRevealing ? '...' : 'Reveal Answer'}
                    </button>
                  )}
                  {room.status === 'revealing' && (
                    <button onClick={nextQuestion}
                      className=\"bg-white text-black font-bold px-6 py-2.5 rounded-xl flex items-center gap-2 hover:bg-gray-200 transition-colors active:scale-95\">
                      Next <SkipForward size={18} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Live Leaderboard */}
            <div className=\"bg-gray-900/50 p-5 rounded-2xl border border-gray-800\">
              <h3 className=\"text-base font-bold mb-3 flex items-center gap-2\">
                <Trophy className=\"text-[#FFD700]\" size={16} /> Live Leaderboard
              </h3>
              <div className=\"grid grid-cols-2 md:grid-cols-4 gap-3\">
                {players.slice(0, 8).map((p, idx) => (
                  <div key={p.user_id} className=\"bg-gray-800 p-3 rounded-xl border border-gray-700 flex justify-between items-center\">
                    <div className=\"flex items-center gap-2 min-w-0\">
                      <span className=\"text-sm font-bold text-gray-500 flex-shrink-0\">#{idx + 1}</span>
                      <span className=\"font-bold text-sm truncate\">{p.nickname}</span>
                      {!presence[p.user_id]?.online && <WifiOff size={11} className=\"text-red-400 flex-shrink-0\" />}
                    </div>
                    <span className=\"font-mono text-primary font-bold text-sm flex-shrink-0 ml-1\">{p.score}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Late-join requests (mid-game) ───────────────────────────── */}
            {requests.length > 0 && (
              <div className=\"bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4\">
                <h3 className=\"text-sm font-bold text-orange-300 mb-3 flex items-center gap-2\">
                  <UserCheck size={15} />
                  طلبات دخول متأخر
                  <span className=\"bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full text-xs\">{requests.length}</span>
                  <span className=\"text-orange-400/60 text-xs font-normal mr-1\">— فاتهم {room.current_question_index} سؤال</span>
                </h3>
                <div className=\"space-y-2\">
                  {requests.map(req => (
                    <div key={req.key} className=\"flex items-center justify-between p-2.5 bg-gray-900/60 rounded-xl border border-gray-700/50\">
                      <div className=\"flex items-center gap-2 min-w-0\">
                        {req.player_avatar && <img src={req.player_avatar} alt=\"\" className=\"w-6 h-6 rounded-full flex-shrink-0\" />}
                        <div className=\"min-w-0\">
                          <div className=\"font-bold text-sm text-white truncate\">{req.player_name}</div>
                          <div className=\"text-xs text-gray-500 truncate\">{req.player_email}</div>
                        </div>
                      </div>
                      <div className=\"flex gap-1 flex-shrink-0 ml-2\">
                        {processingRequests.has(req.key) ? (
                          <Loader2 size={16} className=\"text-primary animate-spin\" />
                        ) : (
                          <>
                            <button onClick={() => handleRequest(req.key, 'approved')} className=\"bg-green-500/20 text-green-500 hover:bg-green-500/30 p-1.5 rounded-lg transition-colors\" title=\"قبول\"><CheckCircle size={14} /></button>
                            <button onClick={() => handleRequest(req.key, 'rejected')} className=\"bg-red-500/20 text-red-500 hover:bg-red-500/30 p-1.5 rounded-lg transition-colors\" title=\"رفض\"><XCircle size={14} /></button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}\n
        {/* ── FINISHED ──────────────────────────────────────────────────── */}
        {room.status === 'finished' && (
          <div className=\"bg-gray-900/50 p-12 rounded-2xl border border-gray-800 text-center\">
            <Trophy size={64} className=\"mx-auto text-[#FFD700] mb-6\" />
            <h2 className=\"text-5xl font-display font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary\">Game Over!</h2>
            <p className=\"text-xl text-gray-400 mb-10\">Final Leaderboard</p>
            <div className=\"max-w-2xl mx-auto space-y-3\">
              {players.map((p, idx) => (
                <div key={p.user_id} className={`flex items-center justify-between p-4 rounded-xl border ${idx === 0 ? 'bg-primary/20 border-primary' : 'bg-gray-800 border-gray-700'}`}>
                  <div className=\"flex items-center gap-4\">
                    <span className={`text-2xl font-bold ${idx === 0 ? 'text-primary' : 'text-gray-500'}`}>#{idx + 1}</span>
                    {p.avatar_url ? <img src={p.avatar_url} alt=\"\" className=\"w-9 h-9 rounded-full\" /> : <div className=\"w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center\"><UserCheck size={18} /></div>}
                    <span className=\"font-bold text-lg\">{p.nickname}</span>
                  </div>
                  <div className=\"text-2xl font-mono font-bold text-white\">{p.score} PTS</div>
                </div>
              ))}
            </div>
            <div className=\"mt-10 flex items-center justify-center gap-4 flex-wrap\">\n              <button
                onClick={downloadLogs}
                disabled={downloadingLogs}
                className=\"flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 font-bold px-6 py-3 rounded-xl transition-colors disabled:opacity-50\"
              >
                {downloadingLogs
                  ? <><Loader2 size={16} className=\"animate-spin\" /> جاري التحميل...</>
                  : <><Trophy size={16} className=\"text-[#FFD700]\" /> تحميل اللوجز (.txt)</>}
              </button>
              <button onClick={() => navigate('/host/dashboard')}
                className=\"bg-primary text-background font-bold px-8 py-3 rounded-xl hover:bg-[#00D4FF] transition-colors\">
                Back to Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
