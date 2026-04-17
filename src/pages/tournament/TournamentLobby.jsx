/**
 * TournamentLobby.jsx — Host sees live registrations and configures the tournament
 * before launching FFA. Includes round-by-round question assignment.
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
import {
  Trophy, Users, Play, Loader2, Copy, Check,
  Settings, ChevronDown, Lock, BookOpen
} from 'lucide-react'

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

  // Round question assignment
  const [showQMgmt,     setShowQMgmt]     = useState(false)
  const [assignRound,   setAssignRound]   = useState(null)   // null = panel closed
  const [selectedQIdxs, setSelectedQIdxs] = useState([])

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

  // Fetch deck questions once we have the tournament doc
  useEffect(() => {
    if (!tournament?.deck_id) return
    getDoc(doc(db, 'question_sets', tournament.deck_id))
      .then(d => setDeckQs(d.data()?.questions?.questions || []))
      .catch(console.error)
  }, [tournament?.deck_id])

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

  // Save question assignment for a specific round to Firestore
  const saveAssignment = useCallback(async () => {
    if (assignRound === null) return
    const updated = {
      ...((tournament?.round_questions) || {}),
      [String(assignRound)]: selectedQIdxs,
    }
    try {
      await updateDoc(doc(db, 'tournaments', tournamentId), { round_questions: updated })
    } catch (e) {
      console.error(e)
    }
    setAssignRound(null)
    setSelectedQIdxs([])
  }, [assignRound, selectedQIdxs, tournament?.round_questions, tournamentId])

  const launchFFA = useCallback(async () => {
    if (!tournament || launching || registrations.length < 2) return
    setLaunching(true)
    setError(null)

    try {
      const desiredCap   = (tournament.is_auto_top_cut || !tournament.top_cut)
        ? registrations.length
        : tournament.top_cut
      const actualTopCut = computeActualTopCut(registrations.length, desiredCap)

      const deckDoc = await getDoc(doc(db, 'question_sets', tournament.deck_id))
      const deckData = deckDoc.data()
      const roomCode = genRoomCode()
      const timerSeconds = Math.round(tournament.ffa_question_duration / 1000)

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
    }
  }, [tournament, launching, registrations.length, session?.uid, tournamentId, navigate])

  if (!tournament) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={32} className="text-primary animate-spin" />
      </div>
    )
  }

  // Compute tentative round count for question assignment
  const renderDesiredCap = (tournament.is_auto_top_cut || !tournament.top_cut)
    ? registrations.length
    : tournament.top_cut
  const actualTopCut = registrations.length >= 2
    ? computeActualTopCut(registrations.length, renderDesiredCap)
    : null
  const tentativeRounds = actualTopCut ? Math.log2(actualTopCut) : null

  return (
    <div className="min-h-screen bg-background text-white p-4 max-w-lg mx-auto" dir="rtl">

      {/* ── Round question assignment modal ─────────────────────────────── */}
      {assignRound !== null && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-full max-w-md flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between mb-1">
              <h3 className="ar font-bold text-white text-base">
                أسئلة {tentativeRounds ? getRoundName(assignRound, tentativeRounds) : `الجولة ${assignRound}`}
              </h3>
              <span className="ar text-xs text-primary font-mono bg-primary/10 px-2 py-0.5 rounded-full">
                {selectedQIdxs.length} مختار
              </span>
            </div>
            <p className="ar text-xs text-gray-500 mb-3">
              اختر الأسئلة لهذه الجولة — اتركها فارغة للاختيار التلقائي من غير المستخدمة
            </p>

            {/* Quick actions */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setSelectedQIdxs(deckQs.map((_, i) => i))}
                className="ar text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors"
              >
                تحديد الكل
              </button>
              <button
                onClick={() => setSelectedQIdxs([])}
                className="ar text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors"
              >
                إلغاء الكل
              </button>
            </div>

            {/* Question list */}
            <div className="flex-1 overflow-y-auto space-y-1 mb-4 border border-gray-800 rounded-xl p-2">
              {deckQs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-gray-600">
                  <BookOpen size={28} />
                  <p className="ar text-sm">لا توجد أسئلة في هذه المجموعة</p>
                </div>
              ) : (
                deckQs.map((q, i) => {
                  const isChecked = selectedQIdxs.includes(i)
                  // Check if this question is assigned to another round
                  const usedInRound = Object.entries(tournament.round_questions || {})
                    .find(([r, idxs]) => Number(r) !== assignRound && idxs.includes(i))
                  return (
                    <label
                      key={i}
                      className={`flex items-start gap-3 p-2.5 rounded-xl cursor-pointer transition-colors ${
                        isChecked ? 'bg-primary/10 border border-primary/30' : 'hover:bg-gray-800 border border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={e => setSelectedQIdxs(prev =>
                          e.target.checked ? [...prev, i] : prev.filter(x => x !== i)
                        )}
                        className="mt-0.5 accent-primary flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="ar text-sm text-gray-200 leading-snug">{i + 1}. {q.question}</span>
                        {usedInRound && (
                          <p className="ar text-[10px] text-yellow-500 mt-0.5">
                            ⚠ مستخدم في {tentativeRounds
                              ? getRoundName(Number(usedInRound[0]), tentativeRounds)
                              : `الجولة ${usedInRound[0]}`}
                          </p>
                        )}
                      </div>
                    </label>
                  )
                })
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => { setAssignRound(null); setSelectedQIdxs([]) }}
                className="flex-1 py-2.5 rounded-xl bg-gray-800 text-gray-300 text-sm ar hover:bg-gray-700 transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={saveAssignment}
                className="flex-1 py-2.5 rounded-xl bg-primary text-background font-bold text-sm ar hover:bg-[#00D4FF] transition-colors"
              >
                حفظ التخصيص
              </button>
            </div>
          </div>
        </div>
      )}

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
              {registrations.length} مشارك → أقرب قوة لـ 2
              {(tournament.is_auto_top_cut || !tournament.top_cut)
                ? ' (وضع تلقائي)'
                : ` ≤ ${tournament.top_cut}`}
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

      {/* ── Round Question Assignment ──────────────────────────────────── */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 mb-5 overflow-hidden">
        <button
          onClick={() => setShowQMgmt(v => !v)}
          className="flex items-center justify-between w-full px-4 py-3.5 hover:bg-gray-800 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings size={15} className="text-primary" />
            <span className="ar text-sm font-bold text-white">تخصيص أسئلة الجولات</span>
          </div>
          <ChevronDown
            size={16}
            className={`text-gray-400 transition-transform duration-200 ${showQMgmt ? 'rotate-180' : ''}`}
          />
        </button>

        {showQMgmt && (
          <div className="border-t border-gray-800 px-4 pb-4 pt-3 space-y-2">
            {!tentativeRounds ? (
              <p className="ar text-xs text-gray-500 text-center py-3">
                يلزم مشاركان على الأقل لمعرفة هيكل الجولات
              </p>
            ) : (
              <>
                <p className="ar text-xs text-gray-500 mb-3">
                  اترك الجولة فارغة للاختيار التلقائي من الأسئلة غير المستخدمة
                </p>
                {Array.from({ length: tentativeRounds }, (_, i) => i + 1).map(round => {
                  const assigned = tournament.round_questions?.[String(round)] || []
                  return (
                    <div key={round} className="flex items-center gap-3 bg-gray-800 rounded-xl px-3 py-2.5">
                      <div className="flex-1">
                        <p className="ar text-sm font-semibold text-white">
                          {getRoundName(round, tentativeRounds)}
                        </p>
                        <p className="ar text-xs text-gray-500 mt-0.5">
                          {assigned.length > 0
                            ? `${assigned.length} سؤال مخصص`
                            : 'تلقائي (عشوائي)'}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setAssignRound(round)
                          setSelectedQIdxs(assigned)
                        }}
                        className="flex items-center gap-1 text-xs text-primary hover:text-[#00D4FF] transition-colors font-bold ar"
                      >
                        <Settings size={12} />
                        تعديل
                      </button>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>

      {/* Timing summary */}
      <div className="bg-gray-900 rounded-xl p-4 mb-5 border border-gray-800 text-xs text-gray-400 space-y-1.5">
        {[
          ['مدة سؤال FFA',           tournament.ffa_question_duration  / 1000 + 'ث'],
          ['مدة سؤال Duel',          tournament.duel_question_duration / 1000 + 'ث'],
          ['انتظار قبل الـ Bracket', tournament.phase_transition_wait  / 1000 + 'ث'],
          ['استراحة بين الجولات',    tournament.round_break_time       / 1000 + 'ث'],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between ar">
            <span>{k}</span>
            <span className="text-gray-300 font-semibold">{v}</span>
          </div>
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
