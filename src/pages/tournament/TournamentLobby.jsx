/**
 * TournamentLobby.jsx — Host registration lobby.
 * • Live registration list
 * • Round-by-round question assignment
 * • Optional scheduled-start countdown → auto-triggers launchFFA
 * • Cancel tournament (deletes Firestore doc + RTDB registrations)
 */
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc, onSnapshot, updateDoc, getDoc, deleteDoc
} from 'firebase/firestore'
import { ref as rtdbRef, onValue, set, remove } from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { computeActualTopCut } from '../../utils/tournamentUtils'
import {
  Trophy, Users, Play, Loader2, Copy, Check,
  Settings, Calendar, AlertTriangle, Trash2
} from 'lucide-react'
import QuestionAssignmentPanel from '../../components/tournament/QuestionAssignmentPanel'

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function genRoomCode() {
  return Array.from({ length: 6 }, () => CHARSET[Math.floor(Math.random() * CHARSET.length)]).join('')
}

function getRoundName(round, totalRounds) {
  if (round === totalRounds)     return 'النهائي'
  if (round === totalRounds - 1) return 'نصف النهائي'
  if (round === totalRounds - 2) return 'ربع النهائي'
  return `الجولة ${round}`
}

function formatCountdown(secs) {
  if (secs <= 0) return 'جاري البدء…'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const parts = []
  if (h > 0) parts.push(`${h}س`)
  if (m > 0 || h > 0) parts.push(`${String(m).padStart(2, '0')}د`)
  parts.push(`${String(s).padStart(2, '0')}ث`)
  return parts.join(' ')
}

export default function TournamentLobby() {
  const { tournamentId } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()

  const [tournament,    setTournament]    = useState(null)
  const [registrations, setRegistrations] = useState([])
  const [deckQs,        setDeckQs]        = useState([])
  const [launching,     setLaunching]     = useState(false)
  const [copied,        setCopied]        = useState(false)
  const [error,         setError]         = useState(null)

  // Round question assignment panel
  const [showQPanel, setShowQPanel] = useState(false)

  // Scheduled countdown
  const [timeLeft,      setTimeLeft]      = useState(null)  // seconds
  const autoLaunchedRef = useRef(false)

  // Cancel confirmation
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelling,        setCancelling]        = useState(false)

  // ── Subscriptions ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tournamentId) return
    const unsub = onSnapshot(doc(db, 'tournaments', tournamentId), snap => {
      if (snap.exists()) setTournament({ id: snap.id, ...snap.data() })
    })
    return () => unsub()
  }, [tournamentId])

  useEffect(() => {
    if (!tournamentId) return
    const unsub = onValue(rtdbRef(rtdb, `tournament_registrations/${tournamentId}`), snap => {
      setRegistrations(snap.exists() ? Object.values(snap.val()) : [])
    })
    return () => unsub()
  }, [tournamentId])

  useEffect(() => {
    if (!tournament?.deck_id) return
    getDoc(doc(db, 'question_sets', tournament.deck_id))
      .then(d => setDeckQs(d.data()?.questions?.questions || []))
      .catch(console.error)
  }, [tournament?.deck_id])

  // Redirect if FFA / bracket already started
  useEffect(() => {
    if (!tournament) return
    if (tournament.status === 'ffa' && tournament.ffa_room_id)
      navigate(`/host/game/${tournament.ffa_room_id}`, { replace: true })
    if (['transition', 'bracket', 'finished'].includes(tournament.status))
      navigate(`/tournament/${tournamentId}/bracket`, { replace: true })
  }, [tournament, tournamentId, navigate])

  // ── Scheduled countdown ──────────────────────────────────────────────────
  useEffect(() => {
    if (!tournament?.scheduled_start_at) return
    const getTargetMs = () => {
      const t = tournament.scheduled_start_at
      if (t?.toDate)         return t.toDate().getTime()
      if (typeof t === 'number') return t
      return null
    }
    const targetMs = getTargetMs()
    if (!targetMs) return

    const tick = () => {
      const remaining = Math.ceil((targetMs - Date.now()) / 1000)
      setTimeLeft(remaining)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tournament?.scheduled_start_at])

  // Auto-launch when countdown reaches 0
  useEffect(() => {
    if (timeLeft === null || timeLeft > 0) return
    if (autoLaunchedRef.current || launching) return
    if (registrations.length < 2) return
    autoLaunchedRef.current = true
    launchFFA()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft])

  // ── Callbacks ────────────────────────────────────────────────────────────
  const copyCode = useCallback(() => {
    if (!tournament?.code) return
    navigator.clipboard.writeText(tournament.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [tournament?.code])

  const saveAssignment = useCallback(async (newAssignments) => {
    try {
      await updateDoc(doc(db, 'tournaments', tournamentId), { round_questions: newAssignments })
    } catch (e) { console.error(e) }
    setShowQPanel(false)
  }, [tournamentId])

  const cancelTournament = useCallback(async () => {
    if (cancelling) return
    setCancelling(true)
    setError(null)
    try {
      // Remove RTDB registrations — ignore if path doesn't exist or permission fails
      try {
        await remove(rtdbRef(rtdb, `tournament_registrations/${tournamentId}`))
      } catch (rtdbErr) {
        console.warn('RTDB registrations removal failed (non-fatal):', rtdbErr)
      }
      // Delete the Firestore tournament document
      await deleteDoc(doc(db, 'tournaments', tournamentId))
      navigate('/host/dashboard', { replace: true })
    } catch (e) {
      console.error('cancelTournament error:', e)
      setError('فشل حذف البطولة: ' + (e.message || 'خطأ غير معروف'))
      setCancelling(false)
      // Keep confirm panel open so user sees the error
    }
  }, [cancelling, tournamentId, navigate])

  const launchFFA = useCallback(async () => {
    if (!tournament || launching || registrations.length < 2) return
    setLaunching(true)
    setError(null)
    try {
      const desiredCap = (tournament.is_auto_top_cut || !tournament.top_cut)
        ? registrations.length
        : tournament.top_cut
      const actualTopCut = computeActualTopCut(registrations.length, desiredCap)

      const deckDoc = await getDoc(doc(db, 'question_sets', tournament.deck_id))
      const deckData = deckDoc.data()
      const roomCode = genRoomCode()
      const timerSeconds = Math.round(tournament.ffa_question_duration / 1000)

      // Use FFA-assigned questions if host specified them, otherwise full deck
      const ffaIdxs = tournament.round_questions?.ffa
      let roomQuestions = deckData.questions
      if (ffaIdxs?.length > 0) {
        const allQs = deckData.questions?.questions || []
        roomQuestions = {
          ...deckData.questions,
          questions: ffaIdxs.map(i => allQs[i]).filter(Boolean),
        }
      }

      // Pre-populate ALL registered players so they can enter the game
      // directly without going through the normal join-request flow.
      const playersObj = {}
      for (const reg of registrations) {
        playersObj[reg.uid] = {
          user_id:    reg.uid,
          nickname:   reg.nickname,
          avatar_url: reg.avatar_url || null,
          score:      0,
        }
      }

      await set(rtdbRef(rtdb, `rooms/${roomCode}`), {
        code:                   roomCode,
        host_id:                session.uid,
        question_set_id:        tournament.deck_id,
        title:                  tournament.title + ' — FFA',
        questions:              roomQuestions,
        force_rtl:              deckData.force_rtl || false,
        tournament_id:          tournamentId,
        status:                 'lobby',
        current_question_index: 0,
        question_started_at:    null,
        reveal_data:            null,
        players:                playersObj,
        config: {
          scoring_mode:         'ranked',
          first_correct_points: 3,
          points_decrement:     1,
          timer_seconds:        timerSeconds,
          auto_accept:          true,
          shuffle_questions:    true,
        },
        created_at: Date.now(),
      })

      await updateDoc(doc(db, 'tournaments', tournamentId), {
        status:         'ffa',
        actual_top_cut: actualTopCut,
        total_rounds:   Math.log2(actualTopCut),
        ffa_room_id:    roomCode,
      })

      navigate(`/host/game/${roomCode}`)
    } catch (e) {
      console.error(e)
      setError(e.message || 'حصل خطأ أثناء الإطلاق')
      setLaunching(false)
      autoLaunchedRef.current = false
    }
  }, [tournament, launching, registrations.length, session?.uid, tournamentId, navigate])

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!tournament) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={32} className="text-primary animate-spin" />
      </div>
    )
  }

  const renderDesiredCap = (tournament.is_auto_top_cut || !tournament.top_cut)
    ? registrations.length : tournament.top_cut
  const actualTopCut = registrations.length >= 2
    ? computeActualTopCut(registrations.length, renderDesiredCap) : null
  const tentativeRounds = actualTopCut ? Math.log2(actualTopCut) : null

  const isScheduled = !!tournament.scheduled_start_at
  const countdownUrgent = timeLeft !== null && timeLeft <= 60

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background text-white p-4 max-w-lg mx-auto" dir="rtl">

      {/* ── Question assignment full-screen panel ─────────────────────── */}
      {showQPanel && (
        <QuestionAssignmentPanel
          deckQs={deckQs}
          roundQuestions={tournament.round_questions || {}}
          totalRounds={tentativeRounds}
          isAutoMode={!!(tournament.is_auto_top_cut || !tournament.top_cut)}
          lockedRounds={[]}
          onSave={saveAssignment}
          onClose={() => setShowQPanel(false)}
        />
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6 mt-4">
        <Trophy size={22} className="text-primary" />
        <h1 className="ar text-xl font-bold flex-1">{tournament.title}</h1>
      </div>

      {/* ── Scheduled countdown ───────────────────────────────────────────── */}
      {isScheduled && timeLeft !== null && timeLeft > 0 && (
        <div className={`rounded-2xl p-4 mb-5 border text-center ${
          countdownUrgent
            ? 'bg-red-500/10 border-red-500/40'
            : 'bg-yellow-500/10 border-yellow-500/30'
        }`}>
          <div className="flex items-center justify-center gap-2 mb-1">
            <Calendar size={14} className={countdownUrgent ? 'text-red-400' : 'text-yellow-400'} />
            <p className="ar text-xs text-gray-400">موعد البدء التلقائي</p>
          </div>
          <p className={`text-3xl font-black font-mono tracking-wider ${
            countdownUrgent ? 'text-red-400' : 'text-yellow-400'
          }`}>
            {formatCountdown(timeLeft)}
          </p>
          <p className="ar text-[10px] text-gray-600 mt-1">
            ستبدأ البطولة تلقائياً — أو اضغط "ابدأ" الآن
          </p>
        </div>
      )}

      {/* ── Code card ─────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 rounded-2xl p-5 mb-5 text-center border border-gray-800">
        <p className="ar text-xs text-gray-500 mb-2">كود التسجيل في البطولة</p>
        <div className="flex items-center justify-center gap-3">
          <span className="text-4xl font-black text-primary tracking-widest">{tournament.code}</span>
          <button
            onClick={copyCode}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
          >
            {copied ? <Check size={18} className="text-green-400" /> : <Copy size={18} />}
          </button>
        </div>
        <p className="ar text-xs text-gray-600 mt-2">شاركه مع المشاركين ليتمكنوا من التسجيل</p>
      </div>

      {/* ── Registrations ─────────────────────────────────────────────────── */}
      <div className="bg-gray-900 rounded-2xl p-4 mb-5 border border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-primary" />
            <span className="ar text-sm font-semibold">المسجلون</span>
          </div>
          <span className="text-2xl font-black text-primary">{registrations.length}</span>
        </div>

        {actualTopCut && (
          <div className="bg-primary/10 border border-primary/30 rounded-xl p-3 mb-3 text-center">
            <p className="ar text-xs text-gray-400">Top Cut المتوقع</p>
            <p className="ar text-lg font-black text-primary">أفضل {actualTopCut} لاعب</p>
            <p className="ar text-[10px] text-gray-500">
              {registrations.length} مشارك → أقرب قوة لـ 2
              {(tournament.is_auto_top_cut || !tournament.top_cut)
                ? ' (وضع تلقائي)' : ` ≤ ${tournament.top_cut}`}
            </p>
          </div>
        )}

        <div className="max-h-48 overflow-y-auto space-y-1">
          {registrations.length === 0 && (
            <p className="ar text-center text-gray-600 text-sm py-4">لا يوجد مشاركون بعد…</p>
          )}
          {registrations.map((r, i) => (
            <div key={r.uid} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-gray-800">
              <span className="text-xs text-gray-600 w-5 text-center">{i + 1}</span>
              {r.avatar_url
                ? <img src={r.avatar_url} className="w-7 h-7 rounded-full object-cover" alt="" />
                : <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-primary">{r.nickname?.[0] || '?'}</div>
              }
              <span className="ar text-sm text-gray-200">{r.nickname}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Round Question Assignment ──────────────────────────────────────── */}
      <button
        onClick={() => setShowQPanel(true)}
        className="w-full flex items-center justify-between bg-gray-900 border border-gray-800 hover:border-primary/50 rounded-2xl px-4 py-3.5 mb-5 transition-all group"
      >
        <div className="flex items-center gap-2">
          <Settings size={15} className="text-primary" />
          <span className="ar text-sm font-bold text-white">تخصيص أسئلة الجولات</span>
        </div>
        <div className="flex items-center gap-2">
          {Object.values(tournament.round_questions || {}).some(a => a.length > 0) ? (
            <span className="ar text-[11px] text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
              {Object.values(tournament.round_questions).flat().length} سؤال مخصص
            </span>
          ) : (
            <span className="ar text-[11px] text-gray-600">تلقائي</span>
          )}
          <span className="text-gray-600 group-hover:text-primary transition-colors text-xs">←</span>
        </div>
      </button>

      {/* ── Timing summary ────────────────────────────────────────────────── */}
      <div className="bg-gray-900 rounded-xl p-4 mb-5 border border-gray-800 text-xs text-gray-400 space-y-1.5">
        {[
          ['مدة سؤال FFA',           tournament.ffa_question_duration  / 1000 + 'ث'],
          ['مدة سؤال Duel',          tournament.duel_question_duration / 1000 + 'ث'],
          ['انتظار قبل الـ Bracket', tournament.phase_transition_wait  / 1000 + 'ث'],
          ['استراحة بين الجولات',    tournament.round_break_time       / 1000 + 'ث'],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between ar">
            <span>{k}</span><span className="text-gray-300 font-semibold">{v}</span>
          </div>
        ))}
      </div>

      {error && <p className="ar text-red-400 text-sm text-center mb-4">{error}</p>}

      {/* ── Launch FFA ────────────────────────────────────────────────────── */}
      <button
        onClick={launchFFA}
        disabled={launching || registrations.length < 2}
        className="w-full py-4 rounded-2xl bg-primary text-background font-black text-lg ar flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#00D4FF] active:scale-95 transition-all mb-3"
      >
        {launching
          ? <><Loader2 size={20} className="animate-spin" /><span>جاري الإطلاق…</span></>
          : <><Play size={20} /><span>ابدأ مرحلة FFA</span></>
        }
      </button>

      {registrations.length < 2 && (
        <p className="ar text-center text-xs text-gray-600 mb-4">يلزم مشاركان على الأقل لبدء البطولة</p>
      )}

      {/* ── Cancel tournament ─────────────────────────────────────────────── */}
      {!showCancelConfirm ? (
        <button
          onClick={() => setShowCancelConfirm(true)}
          className="w-full py-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-bold ar flex items-center justify-center gap-2 hover:bg-red-500/20 transition-colors"
        >
          <Trash2 size={15} />
          إلغاء البطولة وحذفها
        </button>
      ) : (
        <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="ar text-sm text-red-300 leading-relaxed">
              هتحذف البطولة بالكامل وكل التسجيلات — مش هترجعها.
              هل أنت متأكد؟
            </p>
          </div>
          {error && (
            <p className="ar text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
              ⚠ {error}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => { setShowCancelConfirm(false); setError(null) }}
              disabled={cancelling}
              className="flex-1 py-2.5 rounded-xl bg-gray-800 text-gray-300 text-sm ar font-bold hover:bg-gray-700 transition-colors disabled:opacity-40"
            >
              تراجع
            </button>
            <button
              onClick={cancelTournament}
              disabled={cancelling}
              className="flex-1 py-2.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 text-sm ar font-bold hover:bg-red-500/30 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {cancelling
                ? <Loader2 size={14} className="animate-spin" />
                : <Trash2 size={14} />
              }
              نعم، احذف
            </button>
          </div>
        </div>
      )}

      <div className="h-8" />
    </div>
  )
}
