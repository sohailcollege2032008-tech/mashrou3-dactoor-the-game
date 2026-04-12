import React, { useEffect, useState, useRef, useCallback } from 'react'
import MathText from '../../components/common/MathText'
import { useParams, useNavigate } from 'react-router-dom'
import { ref, onValue, update, get, set, onDisconnect } from 'firebase/database'
import { doc, getDoc } from 'firebase/firestore'
import { rtdb, db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import {
  Play, UserCheck, XCircle, CheckCircle, SkipForward, Trophy,
  Eye, Timer, Loader2, WifiOff, StopCircle, Shuffle, Star, Zap, Settings, Layers, Shield,
  X, Phone, Mail, User
} from 'lucide-react'
import confetti from 'canvas-confetti'
import QuestionImage from '../../components/QuestionImage'
import { generateCorrectAnswerHash, verifyAnswerHash } from '../../utils/crypto'
import HostGameReport from '../../components/HostGameReport'
import ActivityLogViewer from '../../components/ActivityLogViewer'

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
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
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

/**
 * Converts MathML/HTML to a human-readable text format for plain-text logs.
 */
function formatFormulaForLog(html) {
  if (!html) return '';
  let text = html
    // Fractions: (top)/(bottom)
    .replace(/<mfrac>\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*<\/mfrac>/gi, '($1)/($2)')
    // Powers: base^(exp)
    .replace(/<msup>\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*<\/msup>/gi, '($1)^($2)')
    // Subscripts: base_(sub)
    .replace(/<msub>\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*<\/msub>/gi, '($1)_($2)')
    // Square roots: sqrt(content)
    .replace(/<msqrt>\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*<\/msqrt>/gi, 'sqrt($1)');

  // Strip remaining HTML tags
  const temp = document.createElement('div');
  temp.innerHTML = text;
  const plain = temp.textContent || temp.innerText || "";
  return plain.replace(/\s+/g, ' ').trim();
}

// ── Config panel ──────────────────────────────────────────────────────────────
function GameConfigPanel({ config, onChange }) {
  const apply = (key, val) => onChange({ ...config, [key]: val })

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5 space-y-5">
      <h3 className="text-base font-bold text-white flex items-center gap-2">
        <Settings size={16} className="text-primary" /> إعدادات الجيم
      </h3>

      {/* Timer duration */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer size={15} className="text-gray-400" />
          <span className="ar text-sm text-gray-200 font-medium">وقت العد التنازلي</span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="number" min={5} max={300}
            value={config.timer_seconds}
            onChange={e => apply('timer_seconds', Math.max(5, Number(e.target.value)))}
            className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-primary text-center"
          />
          <span className="text-xs text-gray-500">ث</span>
        </div>
      </div>

      {/* Auto Mode toggle */}
      <div className="space-y-3 pt-1 border-t border-gray-800">
        <label className="flex items-center justify-between cursor-pointer select-none">
          <div className="flex items-center gap-2">
            <Zap size={15} className="text-yellow-400" />
            <span className="ar text-sm text-gray-200 font-medium">وضع تلقائي (Auto Mode)</span>
          </div>
          <button
            onClick={() => apply('auto_mode', !config.auto_mode)}
            className={`relative w-11 h-6 rounded-full transition-colors ${config.auto_mode ? 'bg-yellow-500' : 'bg-gray-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.auto_mode ? 'translate-x-5' : ''}`} />
          </button>
        </label>

        {config.auto_mode && (
          <div className="flex items-center justify-between pl-7 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center gap-2">
              <Timer size={14} className="text-gray-500" />
              <span className="ar text-xs text-gray-400">تايمر إجباري (ثانية)</span>
            </div>
            <input
              type="number" min={5} max={600}
              value={config.auto_timer}
              onChange={e => apply('auto_timer', Math.max(5, Number(e.target.value)))}
              className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:border-yellow-500/50 text-center"
            />
          </div>
        )}
      </div>

      {/* Shuffle Choices toggle */}
      <label className="flex items-center justify-between cursor-pointer select-none">
        <div className="flex items-center gap-2">
          <Shuffle size={15} className="text-gray-400" />
          <span className="ar text-sm text-gray-200 font-medium">ترتيب الاختيارات عشوائي</span>
        </div>
        <button
          onClick={() => apply('shuffle_choices', !config.shuffle_choices)}
          className={`relative w-11 h-6 rounded-full transition-colors ${config.shuffle_choices ? 'bg-primary' : 'bg-gray-700'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.shuffle_choices ? 'translate-x-5' : ''}`} />
        </button>
      </label>

      {/* Shuffle Questions toggle */}
      <label className="flex items-center justify-between cursor-pointer select-none">
        <div className="flex items-center gap-2">
          <Layers size={15} className="text-gray-400" />
          <span className="ar text-sm text-gray-200 font-medium">ترتيب الأسئلة عشوائي</span>
        </div>
        <button
          onClick={() => apply('shuffle_questions', !config.shuffle_questions)}
          className={`relative w-11 h-6 rounded-full transition-colors ${config.shuffle_questions ? 'bg-secondary' : 'bg-gray-700'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.shuffle_questions ? 'translate-x-5' : ''}`} />
        </button>
      </label>

      {/* Repeat entry */}
      <div className="pt-1 border-t border-gray-800 space-y-2">
        <p className="ar text-xs text-gray-500 font-bold">الدخول المتكرر للـ Deck</p>
        <div className="grid grid-cols-3 gap-1.5">
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
        <p className="text-xs text-gray-600 font-mono ar">
          {config.repeat_entry === 'allow' && 'الجميع يقدر يدخل بغض النظر عن التاريخ'}
          {config.repeat_entry === 'badge' && 'يُسمح بالدخول وتظهر إشارة "دخل قبل كده"'}
          {config.repeat_entry === 'block' && 'زر الموافقة معطّل للي دخل قبل كده'}
        </p>
      </div>

      {/* Scoring mode */}
      <div>
        <p className="ar text-xs text-gray-500 font-bold mb-3">نظام التقييم</p>
        <div className="space-y-2">

          {/* Classic */}
          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${config.scoring_mode === 'classic' ? 'border-primary bg-primary/10' : 'border-gray-700 hover:border-gray-600'}`}>
            <input type="radio" name="mode" className="hidden" checked={config.scoring_mode === 'classic'} onChange={() => apply('scoring_mode', 'classic')} />
            <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${config.scoring_mode === 'classic' ? 'border-primary' : 'border-gray-600'}`}>
              {config.scoring_mode === 'classic' && <div className="w-2 h-2 bg-primary rounded-full" />}
            </div>
            <div className="ar">
              <p className="text-sm font-bold text-white">كلاسيك</p>
              <p className="text-xs text-gray-500">أول واحد صح ياخد نقطة، الباقي صفر</p>
            </div>
          </label>

          {/* Custom */}
          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${config.scoring_mode === 'custom' ? 'border-primary bg-primary/10' : 'border-gray-700 hover:border-gray-600'}`}>
            <input type="radio" name="mode" className="hidden" checked={config.scoring_mode === 'custom'} onChange={() => apply('scoring_mode', 'custom')} />
            <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${config.scoring_mode === 'custom' ? 'border-primary' : 'border-gray-600'}`}>
              {config.scoring_mode === 'custom' && <div className="w-2 h-2 bg-primary rounded-full" />}
            </div>
            <div className="ar">
              <p className="text-sm font-bold text-white">كاستوم</p>
              <p className="text-xs text-gray-500">أول واحد صح N نقطة، الباقي الصح M نقطة</p>
            </div>
          </label>

          {config.scoring_mode === 'custom' && (
            <div className="flex gap-4 px-3 pb-1">
              <div>
                <label className="text-xs text-gray-500 block mb-1">أول واحد صح</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={1} max={100} value={config.first_correct_points}
                    onChange={e => apply('first_correct_points', Math.max(1, Number(e.target.value)))}
                    className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-primary" />
                  <span className="text-xs text-gray-500">نقطة</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">باقي الصح</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={0} max={100} value={config.other_correct_points}
                    onChange={e => apply('other_correct_points', Math.max(0, Number(e.target.value)))}
                    className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-primary" />
                  <span className="text-xs text-gray-500">نقطة</span>
                </div>
              </div>
            </div>
          )}

          {/* Ranked */}
          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${config.scoring_mode === 'ranked' ? 'border-primary bg-primary/10' : 'border-gray-700 hover:border-gray-600'}`}>
            <input type="radio" name="mode" className="hidden" checked={config.scoring_mode === 'ranked'} onChange={() => apply('scoring_mode', 'ranked')} />
            <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${config.scoring_mode === 'ranked' ? 'border-primary' : 'border-gray-600'}`}>
              {config.scoring_mode === 'ranked' && <div className="w-2 h-2 bg-primary rounded-full" />}
            </div>
            <div className="ar">
              <p className="text-sm font-bold text-white">ترتيبي</p>
              <p className="text-xs text-gray-500">الأول N، الثاني N−X، الثالث N−2X…</p>
            </div>
          </label>

          {config.scoring_mode === 'ranked' && (
            <div className="flex gap-4 px-3 pb-1">
              <div>
                <label className="text-xs text-gray-500 block mb-1">N (نقاط الأول)</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={1} max={100} value={config.first_correct_points}
                    onChange={e => apply('first_correct_points', Math.max(1, Number(e.target.value)))}
                    className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-primary" />
                  <span className="text-xs text-gray-500">نقطة</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">X (الفرق)</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={1} max={50} value={config.points_decrement}
                    onChange={e => apply('points_decrement', Math.max(1, Number(e.target.value)))}
                    className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-primary" />
                  <span className="text-xs text-gray-500">نقطة</span>
                </div>
              </div>
              <div className="self-end pb-1.5">
                <p className="text-xs text-gray-600 font-mono">
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

// ── Player Profile Modal ──────────────────────────────────────────────────────
function PlayerProfileModal({ player, onClose }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!player?.user_id) return
    getDoc(doc(db, 'profiles', player.user_id))
      .then(snap => { setProfile(snap.exists() ? snap.data() : null) })
      .finally(() => setLoading(false))
  }, [player?.user_id])

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-[#0D1321] border border-gray-700 rounded-2xl shadow-2xl p-6 space-y-4">

        <button onClick={onClose} className="absolute top-4 left-4 text-gray-500 hover:text-white transition-colors">
          <X size={18} />
        </button>

        {/* Avatar + name */}
        <div className="flex items-center gap-4">
          {player.avatar_url ? (
            <img src={player.avatar_url} alt="" className="w-16 h-16 rounded-full border-2 border-primary object-cover flex-shrink-0" />
          ) : (
            <div className="w-16 h-16 rounded-full border-2 border-gray-700 bg-gray-800 flex items-center justify-center flex-shrink-0">
              <User size={28} className="text-gray-500" />
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-white font-bold text-lg truncate">{player.nickname}</h3>
            {player.score > 0 && (
              <p className="text-primary font-mono font-bold">{player.score} pts</p>
            )}
          </div>
        </div>

        <div className="border-t border-gray-800 pt-4 space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Loader2 size={14} className="animate-spin" /> جاري التحميل...
            </div>
          ) : profile ? (
            <>
              <div className="flex items-center gap-3 text-sm">
                <Mail size={14} className="text-gray-500 flex-shrink-0" />
                <span className="text-gray-300 font-mono truncate">{profile.email || '—'}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Phone size={14} className="text-gray-500 flex-shrink-0" />
                <span className={`font-mono ${profile.phone ? 'text-gray-300' : 'text-gray-600 italic'}`}>
                  {profile.phone || 'لم يُضف رقم هاتف'}
                </span>
              </div>
            </>
          ) : (
            <p className="text-gray-600 text-sm italic">لا توجد بيانات إضافية</p>
          )}
        </div>
      </div>
    </div>
  )
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
  const [gameResults, setGameResults] = useState(null)  // collected results for HostGameReport
  const [resultTab, setResultTab]     = useState('leaderboard') // 'leaderboard' | 'security'
  const [selectedPlayer, setSelectedPlayer] = useState(null) // for ActivityLogViewer
  const [profileModal, setProfileModal]   = useState(null)   // { player_id, nickname, avatar_url, score }
  const notifiedAnswersRef = useRef(new Set())   // user_ids already toasted this question
  const roomStatusRef      = useRef(null)         // mirror of room.status for callbacks

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

  // ── Requests, players, presence, answers ──────────────────────────────────
  useEffect(() => {
    if (!session) return
    const unsubReq = onValue(ref(rtdb, `rooms/${roomId}/join_requests`), snap => {
      if (!snap.exists()) { setRequests([]); return }
      setRequests(Object.entries(snap.val()).map(([key, val]) => ({ key, ...val })).filter(r => r.status === 'pending'))
    })
    return () => unsubReq()
  }, [roomId, session])

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
    const totalPlayers = players.length
    if (totalPlayers > 0 && answers.length >= totalPlayers) {
      console.log("Auto-Mode: All players answered. Revealing...")
      revealAnswer()
      return
    }

    // Trigger 2: Mandatory Timer (Forced Timer)
    const checkTimer = setInterval(() => {
      if (!room.question_started_at) return
      const elapsed = (Date.now() - room.question_started_at) / 1000
      if (elapsed >= gameConfig.auto_timer) {
        console.log("Auto-Mode: Mandatory Timer expired. Revealing...")
        revealAnswer()
        clearInterval(checkTimer)
      }
    }, 1000)

    return () => clearInterval(checkTimer)
  }, [room?.status, answers.length, players.length, gameConfig.auto_mode, gameConfig.auto_timer, isRevealing])

  // ── Auto Mode: Next Question ───────────────────────────────────────────
  useEffect(() => {
    if (!room || room.status !== 'revealing' || !gameConfig.auto_mode) return

    const timer = setTimeout(() => {
      console.log("Auto-Mode: 8s delay finished. Moving to next question...")
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
      // Generate secret key from room ID and created_at
      const secretKey = `${roomId}:${room.created_at}`

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

      // Generate hashes for correct answers and remove plain correct field
      const secureQuestions = {
        ...questions,
        questions: questions.questions.map(async (q, qIdx) => {
          const correctHash = await generateCorrectAnswerHash(
            q.correct,
            `${roomId}-q${qIdx}`,
            roomId,
            secretKey
          )
          // Return question without the correct field
          const { correct, ...qWithoutCorrect } = q
          return {
            ...qWithoutCorrect,
            correct_hash: correctHash,
          }
        })
      }

      // Wait for all hashes to be generated
      const secureQuestionsArray = await Promise.all(secureQuestions.questions)
      const finalQuestions = {
        ...questions,
        questions: secureQuestionsArray
      }

      await update(ref(rtdb, `rooms/${roomId}`), {
        status: 'playing',
        current_question_index: 0,
        question_started_at: Date.now(),
        config: gameConfig,
        questions: finalQuestions,
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
      const currentQuestion = room.questions.questions[qIdx]
      const correctHash = currentQuestion.correct_hash

      const answersSnap = await get(ref(rtdb, `rooms/${roomId}/answers/${qIdx}`))
      const allAnswers  = answersSnap.exists() ? Object.values(answersSnap.val()) : []

      // Generate secret key for hash verification
      const secretKey = `${roomId}:${room.created_at}`

      // Verify each answer against the correct hash
      const correct = []
      for (const answer of allAnswers) {
        const isCorrect = await verifyAnswerHash(
          answer.selected_choice,
          correctHash,
          `${roomId}-q${qIdx}`,
          roomId,
          secretKey
        )
        if (isCorrect) {
          correct.push(answer)
        }
      }
      correct.sort((a, b) => a.reaction_time_ms - b.reaction_time_ms)

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

      const winners = correct.map((a, i) => {
        const pts = getPoints(i)
        return {
          user_id: a.user_id,
          nickname: a.player_name || 'Unknown',
          time_ms: a.reaction_time_ms,
          points: pts,
          rank: i + 1
        }
      })

      const revealData = {
        winner_nickname: winner?.player_name || null,
        winner_time_ms:  winner?.reaction_time_ms || null,
        correct_count:   correct.length,
        winners:         winners,
      }

      // Store the correct answer for reveal after game ends
      // (secretKey already declared at line 437)
      let correctIdx = -1
      for (let i = 0; i < currentQuestion.choices.length; i++) {
        const isMatch = await verifyAnswerHash(
          i, 
          currentQuestion.correct_hash, 
          `${roomId}-q${qIdx}`, 
          roomId, 
          secretKey
        )
        if (isMatch) {
          correctIdx = i
          break
        }
      }

      const correctAnswerText = currentQuestion.choices[correctIdx] || 'Not available'

      await update(ref(rtdb), {
        ...scoreUpdates,
        ...answerUpdates,
        ...rankUpdates,
        [`rooms/${roomId}/status`]:      'revealing',
        [`rooms/${roomId}/reveal_data`]: revealData,
        [`rooms/${roomId}/revealed_answers/${qIdx}`]: correctAnswerText,
        [`rooms/${roomId}/revealed_correct_index`]:   correctIdx,
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
          revealed_correct_index: null,
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

      lines.push('=== Med Royale — Game Log ===')
      lines.push(`Room      : ${roomId}`)
      lines.push(`Date      : ${new Date().toLocaleString()}`)
      lines.push(`Players   : ${players.length}`)
      lines.push(`Questions : ${questions.length}`)
      lines.push(`Scoring   : ${room.config?.scoring_mode || 'classic'}`)
      lines.push('')

      for (let qi = 0; qi < questions.length; qi++) {
        const q = questions[qi]
        lines.push('═'.repeat(62))
        lines.push(`Q${qi + 1}: ${formatFormulaForLog(q.question)}`)
        let correctIdx = -1
        // secretKey handled per question loop if needed, but we can declare it once
        const sessionSecret = `${roomId}:${room.created_at}`
        for (let i = 0; i < q.choices.length; i++) {
          const isMatch = await verifyAnswerHash(
            i, 
            q.correct_hash, 
            `${roomId}-q${qi}`, 
            roomId, 
            sessionSecret
          )
          if (isMatch) {
            correctIdx = i
            break
          }
        }
         lines.push(`Correct: ${formatFormulaForLog(q.choices[correctIdx] || '?')}`)
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
          const chosen = formatFormulaForLog(q.choices[a.selected_choice] || '?')
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

      const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/plain;charset=utf-8' })
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

  // ── Collect game results for HostGameReport ───────────────────────────────
  const collectGameResults = async () => {
    try {
      const questions = room.questions?.questions || []
      const results = []

      // Collect data for each player
      for (const player of players) {
        const playerAnswers = []
        let activityLog = []

        // Collect answers for all questions
        for (let qIdx = 0; qIdx < questions.length; qIdx++) {
          const ansSnap = await get(ref(rtdb, `rooms/${roomId}/answers/${qIdx}/${player.user_id}`))
          if (ansSnap.exists()) {
            const ansData = ansSnap.val()
            playerAnswers.push({
              question_index: qIdx,
              is_correct: ansData.is_correct || false,
              reaction_time: ansData.reaction_time_ms || 0,
              selected_choice: ansData.selected_choice,
              points_earned: ansData.points_earned || 0,
              rank: ansData.rank || null,
              is_first_correct: ansData.is_first_correct || false,
            })
          }
        }

        // Try to get activity log if available
        const activitySnap = await get(ref(rtdb, `rooms/${roomId}/activity_log/${player.user_id}`))
        if (activitySnap.exists()) {
          activityLog = Object.values(activitySnap.val()) || []
        }

        results.push({
          userId: player.user_id,
          username: player.nickname || 'Unknown',
          score: player.score || 0,
          answers: playerAnswers,
          activityLog: activityLog,
          avatar_url: player.avatar_url || null,
        })
      }

      setGameResults(results)
    } catch (err) {
      console.error('Error collecting game results:', err)
      alert('Error collecting game results: ' + err.message)
    }
  }

  // ── Effect: Collect results when game finishes ──────────────────────────
  useEffect(() => {
    if (room?.status === 'finished' && !gameResults) {
      collectGameResults()
    }
  }, [room?.status, room?.questions, gameResults, roomId, players])


  // Preload next question's image while players are answering current one
  const nextQImg = room?.questions?.questions?.[room?.current_question_index + 1]?.image_url
  useEffect(() => {
    if (!nextQImg) return
    const img = new Image()
    img.src = nextQImg
  }, [nextQImg])

  // ─────────────────────────────────────────────────────────────────────────
  if (!room) return (
    <div className="text-white p-6 flex items-center gap-3">
      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      Loading Room...
    </div>
  )

  const currentQ    = room.questions?.questions?.[room.current_question_index]
  const isRevealPhase = room.status === 'revealing'
  const totalPlayers  = players.length
  const answeredCount = answers.length
  const config        = room.config || { scoring_mode: 'classic' }

  const openPlayerProfile = (p) => setProfileModal(p)

  return (
    <div className="min-h-screen bg-background text-white p-6">

      {/* ── Player Profile Modal ────────────────────────────────────────────── */}
      {profileModal && (
        <PlayerProfileModal player={profileModal} onClose={() => setProfileModal(null)} />
      )}

      {/* ── Correct-answer toast notifications ─────────────────────────────── */}
      {toasts.length > 0 && (
        <div className="fixed right-5 top-20 z-[200] space-y-2 pointer-events-none max-w-[220px]">
          {toasts.map(t => (
            <div key={t.id}
              className="flex items-center gap-2 bg-green-900/95 border border-green-500/60 text-green-100 px-3 py-2 rounded-xl shadow-2xl shadow-black/40"
              style={{ animation: 'slideInRight .25s ease-out' }}
            >
              <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
              <span className="font-bold text-sm flex-1 truncate">{t.nickname}</span>
              <span className="text-green-400 font-mono text-xs flex-shrink-0">{t.time_ms}ms</span>
            </div>
          ))}
        </div>
      )}

      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between bg-gray-900/50 p-5 rounded-2xl border border-gray-800">
          <div>
            <h1 dir={room.force_rtl ? 'rtl' : 'auto'} className="text-3xl font-display font-bold text-white">{room.title}</h1>
            <p className="text-lg text-primary font-mono tracking-widest mt-1">JOIN: {roomId}</p>
          </div>
          <div className="flex items-center gap-3">
            {room.status !== 'finished' && (
              <button onClick={endCompetition} disabled={endingGame}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors font-bold text-sm disabled:opacity-50">
                <StopCircle size={15} /> {endingGame ? 'Ending...' : 'End'}
              </button>
            )}
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setGameConfig(prev => ({ ...prev, auto_mode: !prev.auto_mode }))}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
                    gameConfig.auto_mode 
                      ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400 shadow-[0_0_15px_-5px_rgba(234,179,8,0.4)]' 
                      : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-400'
                  }`}
                  title="Toggle Auto-Progression"
                >
                  <Zap size={14} className={gameConfig.auto_mode ? 'animate-pulse' : ''} />
                  <span className="text-xs font-bold ar">تلقائي</span>
                </button>
                <div className="text-right">
                  <div className="text-xl font-bold">{totalPlayers} Players</div>
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Join Requests */}
            <div className="bg-gray-900/50 p-5 rounded-2xl border border-gray-800">
              <h2 className="text-lg font-display font-bold mb-4 flex items-center gap-2">
                Join Requests
                <span className="text-primary bg-primary/20 px-2 py-0.5 rounded-full text-xs">{requests.length}</span>
              </h2>
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {requests.length === 0 && <p className="text-gray-500 italic text-sm">No pending requests...</p>}
                {requests.map(req => {
                  const playCount  = playHistory[req.key] || 0
                  const isRepeater = playCount > 0
                  const isBlocked  = isRepeater && gameConfig.repeat_entry === 'block'
                  return (
                    <div key={req.key} className={`flex items-center justify-between p-3 bg-gray-800 rounded-xl border transition-colors ${isBlocked ? 'border-red-500/40' : 'border-gray-700'}`}>
                      <div>
                        <div className="font-bold text-sm flex items-center gap-2">
                          {req.player_avatar && <img src={req.player_avatar} alt="" className="w-5 h-5 rounded-full" />}
                          {req.player_name}
                          {isRepeater && gameConfig.repeat_entry !== 'allow' && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full font-mono ${
                              isBlocked ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                            }`}>
                              {isBlocked ? '🚫' : '⚠️'} دخل {playCount}x
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400">{req.player_email}</div>
                      </div>
                      <div className="flex gap-1">
                        {processingRequests.has(req.key) ? (
                          <Loader2 size={18} className="text-primary animate-spin" />
                        ) : (
                          <>
                            <button
                              onClick={() => handleRequest(req.key, 'approved')}
                              disabled={isBlocked}
                              className="bg-green-500/20 text-green-500 hover:bg-green-500/30 p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            ><CheckCircle size={16} /></button>
                            <button onClick={() => handleRequest(req.key, 'rejected')} className="bg-red-500/20 text-red-500 hover:bg-red-500/30 p-1.5 rounded-lg transition-colors"><XCircle size={16} /></button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Players + Config + Start */}
            <div className="lg:col-span-2 space-y-4">
              {/* Players */}
              <div className="bg-gray-900/50 p-5 rounded-2xl border border-gray-800">
                <h2 className="text-lg font-display font-bold mb-3 flex items-center gap-2">
                  Ready
                  <span className="text-secondary bg-secondary/20 px-2 py-0.5 rounded-full text-xs">{totalPlayers}</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-32 overflow-y-auto">
                  {totalPlayers === 0 && <p className="text-gray-500 italic text-sm col-span-full">Waiting...</p>}
                  {players.map(p => (
                    <div key={p.user_id} onClick={() => openPlayerProfile(p)} className="flex items-center gap-2 p-2 bg-gray-800 rounded-lg border border-gray-700 cursor-pointer hover:border-primary/40 transition-colors">
                      {p.avatar_url ? <img src={p.avatar_url} alt="" className="w-6 h-6 rounded-full" /> : <UserCheck size={14} className="text-gray-500" />}
                      <span className="font-bold text-sm truncate flex-1">{p.nickname}</span>
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${presence[p.user_id]?.online ? 'bg-green-400' : 'bg-gray-600'}`} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Config */}
              <GameConfigPanel config={gameConfig} onChange={setGameConfig} />

              {/* Start button */}
              <button onClick={startGame} disabled={totalPlayers === 0}
                className="w-full bg-primary text-background font-bold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-[#00D4FF] disabled:opacity-50 transition-colors active:scale-95 text-lg">
                <Play size={22} fill="currentColor" /> Start Game
              </button>
            </div>
          </div>
        )}

        {/* ── PLAYING & REVEALING ─────────────────────────────────────────── */}
        {(room.status === 'playing' || room.status === 'revealing') && currentQ && (
          <div className="space-y-5">
            <div className="bg-gray-900/50 p-6 rounded-2xl border border-primary relative overflow-hidden">
              {/* Progress strip */}
              <div className="absolute top-0 left-0 w-full h-1 bg-gray-800">
                <div className="h-full bg-primary" style={{ width: `${((room.current_question_index + 1) / room.questions.questions.length) * 100}%` }} />
              </div>

              <div className="flex justify-between items-center mb-4 text-sm text-gray-400">
                <span className="font-bold text-primary">Q {room.current_question_index + 1} / {room.questions.questions.length}</span>
                <div className="flex items-center gap-3">
                  {/* Scoring badge */}
                  <span className="text-xs font-mono bg-gray-800 px-2 py-0.5 rounded">
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
                <div className="mb-4">
                  <CountdownBar startedAt={room.countdown_started_at} duration={room.countdown_duration} />
                </div>
              )}

              <h2 dir={room.force_rtl ? 'rtl' : 'auto'} className="text-2xl font-bold mb-6">
                <MathText text={currentQ.question} dir={room.force_rtl ? 'rtl' : 'auto'} />
              </h2>

              {currentQ.image_url && (
                <div className="mb-5">
                  <QuestionImage src={currentQ.image_url} className="w-full max-h-56 object-contain rounded-xl border border-gray-700 bg-gray-900" />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {currentQ.choices.map((choice, i) => {
                  const isCorrect = i === room.revealed_correct_index
                  const count     = answers.filter(a => a.selected_choice === i).length
                  return (
                    <div key={i} className={`p-4 rounded-xl border flex justify-between items-center transition-colors ${
                      isRevealPhase
                        ? isCorrect ? 'border-primary bg-primary/10 shadow-[0_0_15px_rgba(0,255,255,0.15)]' : 'border-gray-700 bg-gray-800 opacity-50'
                        : 'border-gray-700 bg-gray-800'
                    }`}>
                      <span dir={room.force_rtl ? 'rtl' : 'auto'} className={isRevealPhase && isCorrect ? 'font-bold text-primary' : ''}>
                        <MathText text={choice} dir={room.force_rtl ? 'rtl' : 'auto'} />
                      </span>
                      <span className="font-mono text-lg font-bold ml-3 flex-shrink-0">{count}</span>
                    </div>
                  )
                })}
              </div>

              {/* Question Honor Roll */}
              {isRevealPhase && revealResult && (
                <div className="mt-5 bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-800 pb-3">
                    <h3 className="text-sm font-bold text-gray-400 flex items-center gap-2 uppercase tracking-wider">
                      <Star size={14} className="text-yellow-500" /> لوحة شرف السؤال
                    </h3>
                    <span className="text-xs font-mono text-gray-500">{revealResult.correct_count} إجابة صحيحة</span>
                  </div>

                  {revealResult.winners && revealResult.winners.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                      {revealResult.winners.map((w) => (
                        <div key={w.user_id} className="flex items-center gap-3 bg-gray-800/50 border border-gray-700 p-3 rounded-xl hover:border-primary/30 transition-colors group">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${
                            w.rank === 1 ? 'bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.4)]' :
                            w.rank === 2 ? 'bg-gray-300 text-black' :
                            w.rank === 3 ? 'bg-orange-400 text-black' :
                            'bg-gray-700 text-gray-400'
                          }`}>
                            {w.rank}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-sm truncate text-white">{w.nickname}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Timer size={10} className="text-gray-500" />
                              <span className="text-[10px] font-mono text-gray-500">{w.time_ms}ms</span>
                            </div>
                          </div>
                          <div className="bg-primary/10 text-primary px-2 py-1 rounded-lg text-xs font-bold font-mono">
                            +{w.points}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <XCircle size={32} className="mx-auto text-gray-700 mb-2" />
                      <p className="text-gray-500 font-medium">ما حدش أجاب صح في السؤال ده!</p>
                    </div>
                  )}
                </div>
              )}

              {/* Controls */}
              <div className="mt-6 flex items-center justify-between gap-4 flex-wrap">
                {/* Countdown button — only during playing phase */}
                {room.status === 'playing' && (
                  <button
                    onClick={startCountdown}
                    disabled={!!room.countdown_started_at || startingCountdown}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-default
                      border-primary/60 text-primary bg-primary/5 hover:bg-primary/15 active:scale-95"
                  >
                    <Timer size={15} />
                    {room.countdown_started_at
                      ? `العد جاري...`
                      : `Start Countdown ${room.config?.timer_seconds || 30}s`}
                  </button>
                )}
                {room.status === 'revealing' && <div />}

                <div className="flex gap-3 ml-auto">
                  {room.status === 'playing' && (
                    <button onClick={revealAnswer} disabled={isRevealing}
                      className="bg-yellow-500 text-black font-bold px-6 py-2.5 rounded-xl flex items-center gap-2 hover:bg-yellow-400 disabled:opacity-50 transition-colors active:scale-95">
                      <Eye size={18} /> {isRevealing ? '...' : 'Reveal Answer'}
                    </button>
                  )}
                  {room.status === 'revealing' && (
                    <button onClick={nextQuestion}
                      className="bg-white text-black font-bold px-6 py-2.5 rounded-xl flex items-center gap-2 hover:bg-gray-200 transition-colors active:scale-95">
                      Next <SkipForward size={18} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Live Leaderboard */}
            <div className="bg-gray-900/50 p-5 rounded-2xl border border-gray-800">
              <h3 className="text-base font-bold mb-3 flex items-center gap-2">
                <Trophy className="text-[#FFD700]" size={16} /> Live Leaderboard
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {players.slice(0, 8).map((p, idx) => (
                  <div key={p.user_id} onClick={() => openPlayerProfile(p)} className="bg-gray-800 p-3 rounded-xl border border-gray-700 flex justify-between items-center cursor-pointer hover:border-primary/40 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-bold text-gray-500 flex-shrink-0">#{idx + 1}</span>
                      <span className="font-bold text-sm truncate">{p.nickname}</span>
                      {!presence[p.user_id]?.online && <WifiOff size={11} className="text-red-400 flex-shrink-0" />}
                    </div>
                    <span className="font-mono text-primary font-bold text-sm flex-shrink-0 ml-1">{p.score}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Late-join requests (mid-game) ───────────────────────────── */}
            {requests.length > 0 && (
              <div className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-orange-300 mb-3 flex items-center gap-2">
                  <UserCheck size={15} />
                  طلبات دخول متأخر
                  <span className="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full text-xs">{requests.length}</span>
                  <span className="text-orange-400/60 text-xs font-normal mr-1">— فاتهم {room.current_question_index} سؤال</span>
                </h3>
                <div className="space-y-2">
                  {requests.map(req => (
                    <div key={req.key} className="flex items-center justify-between p-2.5 bg-gray-900/60 rounded-xl border border-gray-700/50">
                      <div className="flex items-center gap-2 min-w-0">
                        {req.player_avatar && <img src={req.player_avatar} alt="" className="w-6 h-6 rounded-full flex-shrink-0" />}
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-white truncate">{req.player_name}</div>
                          <div className="text-xs text-gray-500 truncate">{req.player_email}</div>
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0 ml-2">
                        {processingRequests.has(req.key) ? (
                          <Loader2 size={16} className="text-primary animate-spin" />
                        ) : (
                          <>
                            <button onClick={() => handleRequest(req.key, 'approved')} className="bg-green-500/20 text-green-500 hover:bg-green-500/30 p-1.5 rounded-lg transition-colors" title="قبول"><CheckCircle size={14} /></button>
                            <button onClick={() => handleRequest(req.key, 'rejected')} className="bg-red-500/20 text-red-500 hover:bg-red-500/30 p-1.5 rounded-lg transition-colors" title="رفض"><XCircle size={14} /></button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── FINISHED ──────────────────────────────────────────────────── */}
        {room.status === 'finished' && (
          <div className="space-y-6">
            {/* Header Tabs */}
            <div className="flex justify-center mb-8">
              <div className="inline-flex p-1.5 bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-800 shadow-2xl">
                <button
                  onClick={() => setResultTab('leaderboard')}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    resultTab === 'leaderboard'
                      ? 'bg-primary text-background shadow-lg shadow-primary/20'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <Trophy size={16} />
                  <span className="ar">ترتيب الأبطال</span>
                </button>
                <button
                  onClick={() => setResultTab('security')}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    resultTab === 'security'
                      ? 'bg-red-500 text-white shadow-lg shadow-red-500/20'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <Shield size={16} />
                  <span className="ar">التحقيق الأمني</span>
                </button>
              </div>
            </div>

            {/* Tab Content */}
            {selectedPlayer ? (
              <div className="bg-gray-900/50 p-8 rounded-2xl border border-gray-800 animate-in fade-in zoom-in-95 duration-300">
                <button
                  onClick={() => setSelectedPlayer(null)}
                  className="mb-6 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors text-sm font-semibold flex items-center gap-2"
                >
                  <SkipForward size={14} className="rotate-180" /> <span className="ar">العودة للتقرير</span>
                </button>
                <ActivityLogViewer
                  username={selectedPlayer.username}
                  activityLog={selectedPlayer.activityLog}
                  suspicionIndicators={selectedPlayer.indicators || []}
                />
              </div>
            ) : resultTab === 'leaderboard' ? (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Podium / Top 3 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {players.slice(0, 3).map((p, idx) => {
                    const colors = [
                      'from-yellow-400 to-amber-600', // Gold
                      'from-slate-300 to-slate-500', // Silver
                      'from-orange-400 to-amber-800', // Bronze
                    ]
                    const medals = ['🥇', '🥈', '🥉']
                    return (
                      <div key={p.user_id} className={`relative p-6 rounded-3xl border border-white/10 bg-gradient-to-br ${colors[idx]} shadow-2xl overflow-hidden`}>
                        <div className="absolute top-[-20px] right-[-20px] opacity-10">
                          <Trophy size={120} />
                        </div>
                        <div className="relative z-10 flex flex-col items-center text-center">
                          <span className="text-4xl mb-2">{medals[idx]}</span>
                          <h3 className="text-xl font-bold text-white mb-1 truncate w-full">{p.nickname}</h3>
                          <div className="bg-black/20 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10">
                            <span className="font-mono text-2xl font-black text-white">{p.score}</span>
                            <span className="text-xs text-white/70 ml-1 ml-1 ar">نقطة</span>
                          </div>
                          <p className="text-xs text-white/50 mt-3 ar font-medium">المركز {idx === 0 ? 'الأول' : idx === 1 ? 'الثاني' : 'الثالث'}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Rest of Players */}
                <div className="bg-gray-900/50 rounded-3xl border border-gray-800 overflow-hidden">
                  <table className="w-full ar">
                    <thead className="bg-gray-800/50">
                      <tr>
                        <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-widest">التصنيف</th>
                        <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-widest">اللاعب</th>
                        <th className="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase tracking-widest">النقاط</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {players.map((p, idx) => (
                        <tr key={p.user_id} onClick={() => openPlayerProfile(p)} className={`hover:bg-white/5 transition-colors cursor-pointer ${idx < 3 ? 'bg-primary/5' : ''}`}>
                          <td className="px-6 py-4 bg-transparent">
                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg font-mono font-bold ${
                              idx < 3 ? 'text-primary' : 'text-gray-500'
                            }`}>
                              #{idx + 1}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              {p.avatar_url ? (
                                <img src={p.avatar_url} className="w-8 h-8 rounded-full border border-gray-700" alt="" />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-500">
                                  {p.nickname?.[0]}
                                </div>
                              )}
                              <span className="font-bold text-white">{p.nickname}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="font-mono font-bold text-primary">{p.score}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                {gameResults ? (
                  <HostGameReport
                    gameResults={gameResults}
                    onViewDetails={setSelectedPlayer}
                  />
                ) : (
                  <div className="bg-gray-900/50 p-12 rounded-2xl border border-gray-800 text-center">
                    <Loader2 size={48} className="mx-auto text-primary animate-spin mb-4" />
                    <p className="text-gray-400 ar">جاري تحضير تقرير التحقيق...</p>
                  </div>
                )}
              </div>
            )}

            {/* Footer Actions */}
            <div className="flex items-center justify-center gap-4 flex-wrap pt-8 border-t border-gray-800">
              <button
                onClick={downloadLogs}
                disabled={downloadingLogs}
                className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 font-bold px-6 py-3 rounded-xl transition-colors disabled:opacity-50"
              >
                {downloadingLogs
                  ? <><Loader2 size={16} className="animate-spin" /> <span className="ar">جاري التحميل...</span></>
                  : <><Trophy size={16} className="text-[#FFD700]" /> <span className="ar">تحميل اللوجز (.txt)</span></>}
              </button>
              <button onClick={() => navigate('/host/dashboard')}
                className="bg-primary text-background font-bold px-8 py-3 rounded-xl hover:bg-[#00D4FF] transition-all shadow-lg shadow-primary/20">
                <span className="ar text-base">العودة للرئيسية</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
