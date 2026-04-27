/**
 * TournamentLobby.jsx — Host registration lobby.
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
import { Copy, Check, Settings } from 'lucide-react'
import QuestionAssignmentPanel from '../../components/tournament/QuestionAssignmentPanel'

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function genRoomCode() {
  return Array.from({ length: 6 }, () => CHARSET[Math.floor(Math.random() * CHARSET.length)]).join('')
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

  const [showQPanel, setShowQPanel] = useState(false)

  const [timeLeft,      setTimeLeft]      = useState(null)
  const autoLaunchedRef = useRef(false)

  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelling,        setCancelling]        = useState(false)

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

  useEffect(() => {
    if (!tournament) return
    if (tournament.status === 'ffa' && tournament.ffa_room_id)
      navigate(`/host/game/${tournament.ffa_room_id}`, { replace: true })
    if (['transition', 'bracket', 'finished'].includes(tournament.status))
      navigate(`/tournament/${tournamentId}/bracket`, { replace: true })
  }, [tournament, tournamentId, navigate])

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

  useEffect(() => {
    if (timeLeft === null || timeLeft > 0) return
    if (autoLaunchedRef.current || launching) return
    if (registrations.length < 2) return
    autoLaunchedRef.current = true
    launchFFA()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft])

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
      try { await remove(rtdbRef(rtdb, `tournament_registrations/${tournamentId}`)) }
      catch (rtdbErr) { console.warn('RTDB registrations removal failed (non-fatal):', rtdbErr) }
      await deleteDoc(doc(db, 'tournaments', tournamentId))
      navigate('/host/dashboard', { replace: true })
    } catch (e) {
      console.error('cancelTournament error:', e)
      setError('فشل حذف البطولة: ' + (e.message || 'خطأ غير معروف'))
      setCancelling(false)
    }
  }, [cancelling, tournamentId, navigate])

  const launchFFA = useCallback(async () => {
    if (!tournament || launching || registrations.length < 2) return
    setLaunching(true)
    setError(null)
    try {
      const desiredCap = (tournament.is_auto_top_cut || !tournament.top_cut)
        ? registrations.length : tournament.top_cut
      const actualTopCut = computeActualTopCut(registrations.length, desiredCap)

      const deckDoc = await getDoc(doc(db, 'question_sets', tournament.deck_id))
      const deckData = deckDoc.data()
      const roomCode = genRoomCode()
      const timerSeconds = Math.round(tournament.ffa_question_duration / 1000)

      const ffaIdxs = tournament.round_questions?.ffa
      let roomQuestions = deckData.questions
      if (ffaIdxs?.length > 0) {
        const allQs = deckData.questions?.questions || []
        roomQuestions = {
          ...deckData.questions,
          questions: ffaIdxs.map(i => allQs[i]).filter(Boolean),
        }
      }

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

  /* ── Loading ────────────────────────────────────────────────────────────── */
  if (!tournament) {
    return (
      <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="40" height="40" viewBox="0 0 100 100" fill="none"
          style={{ animation: 'mr-spin-slow 10s linear infinite' }}>
          <circle cx="50" cy="50" r="46" stroke="var(--rule)" strokeWidth="1" />
          <circle cx="50" cy="50" r="36" stroke="var(--ink)" strokeWidth="1.5" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="22" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>
        <style>{`@keyframes mr-spin-slow { to { transform: rotate(360deg); } }`}</style>
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

  return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Question assignment panel (full-screen overlay) ─────────── */}
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

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)',
        padding: '13px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button
          onClick={() => navigate('/host/dashboard')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}
        >
          ← Back
        </button>
        <svg width={28} height={28} viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>
        <span className="folio">Tournament · Lobby</span>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, padding: '24px 20px 32px', maxWidth: 480, margin: '0 auto', width: '100%' }}>

        {/* Title */}
        <h1 style={{
          fontFamily: 'var(--serif)', fontWeight: 400,
          fontSize: 'clamp(22px, 5vw, 34px)', lineHeight: 1.1,
          letterSpacing: '-0.02em', color: 'var(--ink)', margin: '0 0 24px',
        }}>
          {tournament.title}
        </h1>

        {/* ── Scheduled countdown ─────────────────────────────────────── */}
        {isScheduled && timeLeft !== null && timeLeft > 0 && (
          <div style={{
            border: `1px solid ${countdownUrgent ? 'var(--alert)' : 'var(--gold)'}`,
            background: countdownUrgent ? 'rgba(180,48,57,0.06)' : 'rgba(176,137,68,0.06)',
            padding: '16px 20px', marginBottom: 20, textAlign: 'center',
          }}>
            <p className="folio" style={{ marginBottom: 8, color: countdownUrgent ? 'var(--alert)' : 'var(--gold)', letterSpacing: '0.2em' }}>
              AUTO-START IN
            </p>
            <p style={{
              fontFamily: 'var(--mono)', fontSize: 32, fontWeight: 700,
              color: countdownUrgent ? 'var(--alert)' : 'var(--gold)', margin: '0 0 4px',
              letterSpacing: '0.08em',
            }}>
              {formatCountdown(timeLeft)}
            </p>
            <p className="ar" style={{ fontSize: 11, color: 'var(--ink-4)', margin: 0 }}>
              ستبدأ البطولة تلقائياً — أو اضغط "ابدأ" الآن
            </p>
          </div>
        )}

        {/* ── Code card ───────────────────────────────────────────────── */}
        <div style={{ border: '1px solid var(--rule)', borderBottomWidth: 2, borderColor: 'var(--ink)', marginBottom: 20 }}>
          <div style={{
            padding: '8px 14px', borderBottom: '1px solid var(--rule)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span className="folio" style={{ letterSpacing: '0.2em' }}>REGISTRATION CODE</span>
            <button
              onClick={copyCode}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--burgundy)' : 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span className="folio" style={{ letterSpacing: '0.12em', color: 'inherit' }}>{copied ? 'COPIED' : 'COPY'}</span>
            </button>
          </div>
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <span style={{ fontFamily: 'var(--serif)', fontSize: 44, fontWeight: 500, letterSpacing: '0.2em', color: 'var(--ink)' }}>
              {tournament.code}
            </span>
            <p className="ar" style={{ fontSize: 12, color: 'var(--ink-4)', margin: '8px 0 0' }}>شاركه مع المشاركين</p>
          </div>
        </div>

        {/* ── Registrations ───────────────────────────────────────────── */}
        <div style={{ border: '1px solid var(--rule)', marginBottom: 16 }}>
          <div style={{
            padding: '8px 14px', borderBottom: '1px solid var(--rule)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span className="folio" style={{ letterSpacing: '0.2em' }}>REGISTERED</span>
            <span style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 500, color: 'var(--ink)' }}>
              {registrations.length}
            </span>
          </div>

          {actualTopCut && (
            <div style={{
              padding: '10px 14px', borderBottom: '1px solid var(--rule)',
              background: 'var(--paper-2)', textAlign: 'center',
            }}>
              <span className="folio" style={{ color: 'var(--gold)', letterSpacing: '0.18em' }}>
                TOP CUT → {actualTopCut} players · {tentativeRounds} rounds
              </span>
            </div>
          )}

          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {registrations.length === 0 && (
              <p className="ar" style={{ padding: '16px', textAlign: 'center', fontSize: 13, color: 'var(--ink-4)' }}>
                لا يوجد مشاركون بعد…
              </p>
            )}
            {registrations.map((r, i) => (
              <div key={r.uid} style={{
                padding: '10px 14px', borderBottom: '1px solid var(--rule)',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span className="folio" style={{ color: 'var(--ink-4)', minWidth: 20 }}>{i + 1}</span>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--rule)',
                  overflow: 'hidden', flexShrink: 0, background: 'var(--paper-3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {r.avatar_url
                    ? <img src={r.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontFamily: 'var(--serif)', fontSize: 11, color: 'var(--ink-3)' }}>{r.nickname?.[0] || '?'}</span>
                  }
                </div>
                <span className="ar" style={{ fontSize: 14, color: 'var(--ink)', flex: 1 }}>{r.nickname}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Round question assignment ────────────────────────────────── */}
        <button
          onClick={() => setShowQPanel(true)}
          style={{
            width: '100%', padding: '12px 16px',
            background: 'var(--paper)', color: 'var(--ink)',
            border: '1px solid var(--rule)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={14} style={{ color: 'var(--ink-3)' }} />
            <span className="ar" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>تخصيص أسئلة الجولات</span>
          </div>
          <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>
            {Object.values(tournament.round_questions || {}).some(a => a.length > 0)
              ? `${Object.values(tournament.round_questions).flat().length} ASSIGNED`
              : 'AUTO'}
          </span>
        </button>

        {/* ── Timing summary ───────────────────────────────────────────── */}
        <div style={{ border: '1px solid var(--rule)', marginBottom: 20 }}>
          {[
            ['مدة سؤال FFA',           tournament.ffa_question_duration  / 1000 + 'ث'],
            ['مدة سؤال Duel',          tournament.duel_question_duration / 1000 + 'ث'],
            ['انتظار قبل الـ Bracket', tournament.phase_transition_wait  / 1000 + 'ث'],
            ['استراحة بين الجولات',    tournament.round_break_time       / 1000 + 'ث'],
          ].map(([k, v], i) => (
            <div key={k} style={{
              padding: '9px 14px', borderBottom: i < 3 ? '1px solid var(--rule)' : 'none',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span className="ar" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{k}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{ border: '1px solid var(--alert)', background: 'rgba(180,48,57,0.06)', padding: '10px 14px', marginBottom: 16 }}>
            <p className="ar" style={{ fontSize: 13, color: 'var(--alert)', margin: 0 }}>{error}</p>
          </div>
        )}

        {/* ── Launch FFA ───────────────────────────────────────────────── */}
        <button
          onClick={launchFFA}
          disabled={launching || registrations.length < 2}
          style={{
            width: '100%', padding: '15px 20px',
            background: launching || registrations.length < 2 ? 'var(--rule)' : 'var(--ink)',
            color: launching || registrations.length < 2 ? 'var(--ink-4)' : 'var(--paper)',
            border: '1px solid var(--ink)', fontFamily: 'var(--arabic)', fontSize: 16, fontWeight: 700,
            cursor: launching || registrations.length < 2 ? 'not-allowed' : 'pointer',
            marginBottom: 8, transition: 'opacity 150ms',
          }}
        >
          {launching ? 'جاري الإطلاق…' : 'ابدأ مرحلة FFA'}
        </button>

        {registrations.length < 2 && (
          <p className="ar" style={{ textAlign: 'center', fontSize: 11, color: 'var(--ink-4)', marginBottom: 16 }}>
            يلزم مشاركان على الأقل
          </p>
        )}

        {/* ── Cancel tournament ────────────────────────────────────────── */}
        {!showCancelConfirm ? (
          <button
            onClick={() => setShowCancelConfirm(true)}
            style={{
              width: '100%', padding: '11px 20px',
              background: 'transparent', color: 'var(--alert)',
              border: '1px solid var(--alert)', fontFamily: 'var(--arabic)', fontSize: 14,
              cursor: 'pointer', marginTop: 4,
            }}
          >
            إلغاء البطولة وحذفها
          </button>
        ) : (
          <div style={{ border: '1px solid var(--alert)', background: 'rgba(180,48,57,0.06)', padding: '16px 20px', marginTop: 4 }}>
            <p className="ar" style={{ fontSize: 13, color: 'var(--alert)', marginBottom: 14, lineHeight: 1.65 }}>
              هتحذف البطولة بالكامل وكل التسجيلات — مش هترجعها. هل أنت متأكد؟
            </p>
            {error && (
              <p className="ar" style={{ fontSize: 12, color: 'var(--alert)', marginBottom: 10 }}>⚠ {error}</p>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setShowCancelConfirm(false); setError(null) }}
                disabled={cancelling}
                style={{
                  flex: 1, padding: '10px', background: 'var(--paper-2)',
                  border: '1px solid var(--rule)', color: 'var(--ink)',
                  fontFamily: 'var(--arabic)', fontSize: 13, cursor: 'pointer',
                  opacity: cancelling ? 0.5 : 1,
                }}
              >
                تراجع
              </button>
              <button
                onClick={cancelTournament}
                disabled={cancelling}
                style={{
                  flex: 1, padding: '10px', background: 'transparent',
                  border: '1px solid var(--alert)', color: 'var(--alert)',
                  fontFamily: 'var(--arabic)', fontSize: 13, fontWeight: 700,
                  cursor: cancelling ? 'not-allowed' : 'pointer',
                  opacity: cancelling ? 0.5 : 1,
                }}
              >
                {cancelling ? 'جاري الحذف…' : 'نعم، احذف'}
              </button>
            </div>
          </div>
        )}

      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid var(--rule)', padding: '12px 20px',
        display: 'flex', justifyContent: 'center',
      }}>
        <span className="folio">Host · Tournament Lobby</span>
      </footer>

    </div>
  )
}
