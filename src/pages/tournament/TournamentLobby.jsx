/**
 * TournamentLobby.jsx — Host sees registrations in real time and launches FFA.
 * Generates the actual_top_cut, creates an RTDB room with tournament_id, then
 * navigates the host to the standard HostGameRoom.
 */
import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc, onSnapshot, updateDoc, getDocs,
  collection, getDoc
} from 'firebase/firestore'
import { ref as rtdbRef, onValue, set } from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { computeActualTopCut } from '../../utils/tournamentUtils'
import { Trophy, Users, Play, Loader2, Copy, Check } from 'lucide-react'

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function genRoomCode() {
  return Array.from({ length: 6 }, () => CHARSET[Math.floor(Math.random() * CHARSET.length)]).join('')
}

export default function TournamentLobby() {
  const { tournamentId } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()

  const [tournament,   setTournament]   = useState(null)
  const [registrations, setRegistrations] = useState([])
  const [launching,    setLaunching]    = useState(false)
  const [copied,       setCopied]       = useState(false)
  const [error,        setError]        = useState(null)

  // Subscribe to tournament doc
  useEffect(() => {
    if (!tournamentId) return
    const unsub = onSnapshot(doc(db, 'tournaments', tournamentId), snap => {
      if (snap.exists()) setTournament({ id: snap.id, ...snap.data() })
    })
    return () => unsub()
  }, [tournamentId])

  // Subscribe to RTDB registrations for live count
  useEffect(() => {
    if (!tournamentId) return
    const unsub = onValue(rtdbRef(rtdb, `tournament_registrations/${tournamentId}`), snap => {
      setRegistrations(snap.exists() ? Object.values(snap.val()) : [])
    })
    return () => unsub()
  }, [tournamentId])

  // Redirect host if FFA has already started
  useEffect(() => {
    if (!tournament) return
    if (tournament.status === 'ffa' && tournament.ffa_room_id) {
      navigate(`/host/game/${tournament.ffa_room_id}`, { replace: true })
    }
    if (['transition', 'bracket', 'finished'].includes(tournament.status)) {
      navigate(`/tournament/${tournamentId}/bracket`, { replace: true })
    }
  }, [tournament, tournamentId, navigate])

  const copyCode = useCallback(() => {
    if (!tournament?.code) return
    navigator.clipboard.writeText(tournament.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [tournament?.code])

  const launchFFA = useCallback(async () => {
    if (!tournament || launching || registrations.length < 2) return
    setLaunching(true)
    setError(null)

    try {
      const actualTopCut = computeActualTopCut(registrations.length, tournament.top_cut)

      // Fetch deck questions
      const deckDoc = await getDoc(doc(db, 'question_sets', tournament.deck_id))
      const deckData = deckDoc.data()

      // Generate a unique 6-char room code (collision extremely rare — just generate one)
      const roomCode = genRoomCode()

      const timerSeconds = Math.round(tournament.ffa_question_duration / 1000)

      // Write the RTDB game room (same schema as a regular room + tournament_id)
      await set(rtdbRef(rtdb, `rooms/${roomCode}`), {
        code:                   roomCode,
        host_id:                session.uid,
        question_set_id:        tournament.deck_id,
        title:                  tournament.title + ' — FFA',
        questions:              deckData.questions,
        force_rtl:              deckData.force_rtl || false,
        tournament_id:          tournamentId,
        status:                 'lobby',
        current_question_index: 0,
        question_started_at:    null,
        reveal_data:            null,
        config: {
          scoring_mode:          'ranked',
          first_correct_points:  3,
          points_decrement:      1,
          timer_seconds:         timerSeconds,
          auto_accept:           true,
          shuffle_questions:     true,
        },
        created_at: Date.now(),
      })

      // Update Firestore tournament doc
      await updateDoc(doc(db, 'tournaments', tournamentId), {
        status:         'ffa',
        actual_top_cut: actualTopCut,
        total_rounds:   Math.log2(actualTopCut),
        ffa_room_id:    roomCode,
      })

      // Redirect host to the standard game room
      navigate(`/host/game/${roomCode}`)
    } catch (e) {
      console.error(e)
      setError(e.message || 'حصل خطأ أثناء الإطلاق')
      setLaunching(false)
    }
  }, [tournament, launching, registrations.length, session?.uid, tournamentId, navigate])

  if (!tournament) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={32} className="text-primary animate-spin" />
      </div>
    )
  }

  const actualTopCut = registrations.length >= 2
    ? computeActualTopCut(registrations.length, tournament.top_cut)
    : null

  return (
    <div className="min-h-screen bg-background text-white p-4 max-w-lg mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 mt-4">
        <Trophy size={22} className="text-primary" />
        <h1 className="ar text-xl font-bold flex-1">{tournament.title}</h1>
      </div>

      {/* Code card */}
      <div className="bg-gray-900 rounded-2xl p-5 mb-5 text-center border border-gray-800">
        <p className="ar text-xs text-gray-500 mb-2">كود التسجيل في البطولة</p>
        <div className="flex items-center justify-center gap-3">
          <span className="text-4xl font-black text-primary tracking-widest">{tournament.code}</span>
          <button onClick={copyCode} className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-gray-400 hover:text-white">
            {copied ? <Check size={18} className="text-green-400" /> : <Copy size={18} />}
          </button>
        </div>
        <p className="ar text-xs text-gray-600 mt-2">شاركه مع المشاركين ليتمكنوا من التسجيل</p>
      </div>

      {/* Registrations */}
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
              {registrations.length} مشارك → أقرب قوة لـ 2 ≤ {tournament.top_cut}
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

      {/* Timing summary */}
      <div className="bg-gray-900 rounded-xl p-4 mb-5 border border-gray-800 text-xs text-gray-400 space-y-1.5">
        {[
          ['مدة سؤال FFA',        tournament.ffa_question_duration  / 1000 + 'ث'],
          ['مدة سؤال Duel',       tournament.duel_question_duration / 1000 + 'ث'],
          ['انتظار قبل الـ Bracket', tournament.phase_transition_wait / 1000 + 'ث'],
          ['استراحة بين الجولات', tournament.round_break_time       / 1000 + 'ث'],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between ar"><span>{k}</span><span className="text-gray-300 font-semibold">{v}</span></div>
        ))}
      </div>

      {error && <p className="ar text-red-400 text-sm text-center mb-4">{error}</p>}

      <button
        onClick={launchFFA}
        disabled={launching || registrations.length < 2}
        className="w-full py-4 rounded-2xl bg-primary text-background font-black text-lg ar flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#00D4FF] active:scale-95 transition-all"
      >
        {launching
          ? <><Loader2 size={20} className="animate-spin" /><span>جاري الإطلاق…</span></>
          : <><Play size={20} /><span>ابدأ مرحلة FFA</span></>
        }
      </button>

      {registrations.length < 2 && (
        <p className="ar text-center text-xs text-gray-600 mt-2">يلزم مشاركان على الأقل لبدء البطولة</p>
      )}
    </div>
  )
}
