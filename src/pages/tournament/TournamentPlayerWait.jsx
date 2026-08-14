import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  doc, onSnapshot, collection, getDoc, getDocs, setDoc, serverTimestamp,
} from 'firebase/firestore'
import { ref as rtdbRef, get as rtdbGet, set as rtdbSet } from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { removeActiveTournamentId } from '../../utils/activeTournament'
import { sortPlayers } from '../../utils/gameRunner'
import BracketTree from '../../components/tournament/BracketTree'
import { Loader2, Trophy, ChevronDown, ChevronUp } from 'lucide-react'

const STATUS_LABELS = {
  registration: 'Registration',
  ffa:          'Phase I — FFA',
  transition:   'Transitioning to Bracket',
  bracket:      'Bracket Phase',
  finished:     'Tournament Finished',
}

export default function TournamentPlayerWait() {
  const { tournamentId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useAuth()

  const [tournament,    setTournament]    = useState(null)
  const [allMatches,    setAllMatches]    = useState([])
  const [myMatch,       setMyMatch]       = useState(null)
  const [myResult,      setMyResult]      = useState(null)
  const [ffaEliminated, setFfaEliminated] = useState(false)
  const [ffaResults,    setFfaResults]    = useState([])
  // Open by default — the bracket is the thing players want to see while waiting.
  const [showBracket,   setShowBracket]   = useState(location.state?.showBracket !== false)
  const [showFfaTable,  setShowFfaTable]  = useState(false)
  const [now,           setNow]           = useState(Date.now())

  const uid = session?.uid
  const ffaCheckedRef = useRef(false)

  // Live tick for the phase countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  // Phase countdown: FFA → bracket (round 1) or between rounds — shared with
  // the host's bracket page so participants feel the pace too.
  const phaseStart    = tournament?.phase_started_at || 0
  const isRoundOne    = (tournament?.current_round || 1) === 1
  const phaseWaitMs   = tournament
    ? (isRoundOne ? (tournament.phase_transition_wait || 0) : (tournament.round_break_time || 0))
    : 0
  const remainingMs   = (phaseStart && phaseWaitMs) ? Math.max(0, phaseStart + phaseWaitMs - now) : 0
  const inPhaseWait   = tournament?.status === 'bracket' && remainingMs > 0

  const formatCountdown = (ms) => {
    const total = Math.ceil(ms / 1000)
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  useEffect(() => {
    if (!tournamentId || !uid) return
    const presRef = rtdbRef(rtdb, `tournament_presence/${tournamentId}/${uid}`)
    rtdbSet(presRef, { connected: true, joined_at: Date.now() }).catch(() => {})
    return () => rtdbSet(presRef, { connected: false }).catch(() => {})
  }, [tournamentId, uid])

  useEffect(() => {
    if (!tournamentId) return
    const unsub = onSnapshot(doc(db, 'tournaments', tournamentId), snap => {
      if (snap.exists()) setTournament({ id: snap.id, ...snap.data() })
    })
    return () => unsub()
  }, [tournamentId])

  useEffect(() => {
    if (!tournamentId || !uid) return
    if (ffaCheckedRef.current) return
    if (!tournament || !['bracket', 'finished'].includes(tournament.status)) return

    ffaCheckedRef.current = true
    getDoc(doc(db, 'tournaments', tournamentId, 'ffa_results', uid))
      .then(snap => {
        if (!snap.exists()) return
        const data = snap.data()
        if (data.advanced === false) {
          setFfaEliminated(true)
          getDocs(collection(db, 'tournaments', tournamentId, 'ffa_results'))
            .then(allSnap =>
              setDoc(
                doc(db, 'profiles', uid, 'game_history', `t_${tournamentId}_summary`),
                {
                  type:              'tournament_summary',
                  tournament_id:     tournamentId,
                  tournament_title:  tournament?.title || '',
                  played_at:         serverTimestamp(),
                  ffa_rank:          data.rank          ?? null,
                  ffa_score:         data.score         ?? 0,
                  ffa_total_players: allSnap.size,
                  advanced_from_ffa: false,
                  bracket_matches:   [],
                  final_result:      'eliminated_ffa',
                  reached_round:     null,
                  total_rounds:      tournament?.total_rounds ?? null,
                }
              )
            )
            .catch(e => console.error('[TournamentWait] Failed to write non-advancer summary:', e))
        }
      })
      .catch(console.error)
  }, [tournamentId, uid, tournament?.status])

  // Subscribe as soon as we have a tournament id. This used to be gated on
  // tournament.current_round, so a tournament whose round had not been written
  // yet left the player on a bracket tree that spun forever.
  useEffect(() => {
    if (!tournamentId) return
    const unsub = onSnapshot(
      collection(db, 'tournaments', tournamentId, 'bracket_matches'),
      snap => setAllMatches(snap.docs.map(d => ({ match_id: d.id, ...d.data() }))),
      e => console.error('[TournamentWait] bracket listener:', e)
    )
    return () => unsub()
  }, [tournamentId])

  useEffect(() => {
    if (!uid) return
    const currentRound = tournament?.current_round || 1
    const mine = allMatches.find(m =>
      m.round === currentRound &&
      (m.player_a_uid === uid || m.player_b_uid === uid)
    )
    setMyMatch(mine || null)

    const myFinished = allMatches
      .filter(m =>
        m.round <= currentRound &&
        (m.player_a_uid === uid || m.player_b_uid === uid) &&
        m.status === 'finished'
      )
      .sort((a, b) => a.round - b.round)
    if (myFinished.length > 0) {
      const last = myFinished[myFinished.length - 1]
      setMyResult(last.winner_uid === uid ? 'advanced' : 'eliminated')
    }
  }, [allMatches, uid, tournament?.current_round])

  // FFA results (rank + advanced) — visible to every player so they can see
  // where they finished in the qualifiers phase.
  useEffect(() => {
    if (!tournamentId || !['bracket', 'finished'].includes(tournament?.status)) return
    getDocs(collection(db, 'tournaments', tournamentId, 'ffa_results'))
      .then(snap => {
        const results = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
        const sorted = [...results].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
        setFfaResults(sorted)
      })
      .catch(() => {})
  }, [tournamentId, tournament?.status])

  useEffect(() => {
    if (myMatch?.status === 'active' && myMatch?.duel_id) {
      navigate(`/tournament/${tournamentId}/duel/${myMatch.match_id}`, { replace: true })
    }
  }, [myMatch, tournamentId, navigate])

  useEffect(() => {
    if (!tournament) return
    if (tournament.status === 'ffa' && tournament.ffa_room_id) {
      rtdbGet(rtdbRef(rtdb, `rooms/${tournament.ffa_room_id}/status`))
        .then(snap => {
          const roomStatus = snap.val()
          if (roomStatus && roomStatus !== 'finished') {
            navigate(`/player/game/${tournament.ffa_room_id}`, { replace: true })
          }
        })
        .catch(() => {})
    }
    if (tournament.status === 'finished') {
      removeActiveTournamentId(tournamentId)
    }
  }, [tournament?.status, tournament?.ffa_room_id, navigate])

  /* ── Loading ────────────────────────────────────────────────────────────── */
  if (!tournament) {
    return (
      <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="48" height="48" viewBox="0 0 100 100" fill="none"
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

  const isEliminated = ffaEliminated || myResult === 'eliminated'
  const isFinished   = tournament.status === 'finished'
  const amChampion   = isFinished && tournament.winner_uid === uid

  // Right after the FFA (the round-1 transition window) it is the headline;
  // after that it stays out of the way until the tournament is over.
  const justAfterFfa      = tournament.status === 'bracket' && isRoundOne && inPhaseWait
  const showFfaStandings  = ffaResults.length > 0 && (justAfterFfa || isFinished)
  const ffaTableOpen      = justAfterFfa || (isFinished && showFfaTable)

  return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)',
        padding: '13px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span className="folio" style={{ flex: 1 }}>Tournament</span>
        <svg width={28} height={28} viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>
        <span className="folio" style={{ flex: 1, textAlign: 'right' }}>
          {STATUS_LABELS[tournament.status] || tournament.status}
        </span>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>

          {/* Tournament title */}
          <p className="folio" style={{ marginBottom: 14, letterSpacing: '0.2em' }}>
            {tournament.title.toUpperCase()}
          </p>

          {/* ── ELIMINATED (FFA) ─────────────────────────────────────── */}
          {isEliminated && (
            <>
              <h1 style={{
                fontFamily: 'var(--serif)', fontWeight: 400,
                fontSize: 'clamp(34px, 8vw, 60px)', lineHeight: 1.0,
                letterSpacing: '-0.025em', margin: '0 0 24px', color: 'var(--ink)',
              }}>
                {ffaEliminated ? 'Did not' : 'Eliminated.'}<br />
                {ffaEliminated && <em style={{ fontWeight: 300, color: 'var(--alert)' }}>advance.</em>}
              </h1>
              <div style={{
                border: '1px solid var(--alert)', background: 'rgba(180,48,57,0.06)',
                padding: '16px 20px', marginBottom: 32,
              }}>
                <p className="ar" style={{ fontSize: 14, color: 'var(--alert)', fontWeight: 600, margin: '0 0 4px' }}>
                  {ffaEliminated ? 'لم تكن ضمن المتأهلين' : 'خرجت من البطولة'}
                </p>
                <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
                  {ffaEliminated ? 'شكراً على مشاركتك!' : 'كانت تجربة رائعة 🎉'}
                </p>
              </div>
              <button
                onClick={() => navigate('/player/dashboard')}
                style={{
                  padding: '13px 28px', background: 'var(--ink)', color: 'var(--paper)',
                  border: '1px solid var(--ink)', fontFamily: 'var(--arabic)', fontSize: 14, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                عودة للرئيسية
              </button>
            </>
          )}

          {/* ── CHAMPION ─────────────────────────────────────────────── */}
          {isFinished && amChampion && !isEliminated && (
            <>
              <h1 style={{
                fontFamily: 'var(--serif)', fontWeight: 400,
                fontSize: 'clamp(44px, 10vw, 72px)', lineHeight: 1.0,
                letterSpacing: '-0.025em', margin: '0 0 24px', color: 'var(--ink)',
              }}>
                Champion.<br />
                <em style={{ fontWeight: 300, color: 'var(--gold)' }}>أنت البطل!</em>
              </h1>
              <div style={{
                border: '1px solid var(--gold)', background: 'rgba(176,137,68,0.06)',
                padding: '16px 20px', marginBottom: 32,
              }}>
                <p className="ar" style={{ fontSize: 15, color: 'var(--gold)', fontWeight: 600, margin: 0 }}>
                  🏆 أنت بطل {tournament.title}
                </p>
              </div>
              <button
                onClick={() => navigate('/player/dashboard')}
                style={{
                  padding: '13px 28px', background: 'var(--ink)', color: 'var(--paper)',
                  border: '1px solid var(--ink)', fontFamily: 'var(--arabic)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                عودة للرئيسية
              </button>
            </>
          )}

          {/* ── FINISHED (not champion) ───────────────────────────────── */}
          {isFinished && !amChampion && !isEliminated && (
            <>
              <h1 style={{
                fontFamily: 'var(--serif)', fontWeight: 400,
                fontSize: 'clamp(34px, 8vw, 60px)', lineHeight: 1.0,
                letterSpacing: '-0.025em', margin: '0 0 24px', color: 'var(--ink)',
              }}>
                انتهت<br />
                <em style={{ fontWeight: 300, color: 'var(--gold)' }}>البطولة.</em>
              </h1>
              {tournament.winner_name && (
                <div style={{
                  border: '1px solid var(--gold)', background: 'rgba(176,137,68,0.06)',
                  padding: '14px 20px', marginBottom: 32,
                }}>
                  <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 4px' }}>البطل</p>
                  <p className="ar" style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold)', margin: 0 }}>
                    {tournament.winner_name}
                  </p>
                </div>
              )}
              <button
                onClick={() => navigate('/player/dashboard')}
                style={{
                  padding: '13px 28px', background: 'var(--ink)', color: 'var(--paper)',
                  border: '1px solid var(--ink)', fontFamily: 'var(--arabic)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                عودة للرئيسية
              </button>
            </>
          )}

          {/* ── BRACKET — match card ─────────────────────────────────── */}
          {!isEliminated && !isFinished && tournament.status === 'bracket' && (
            <>
              {myMatch ? (
                <>
                  <h1 style={{
                    fontFamily: 'var(--serif)', fontWeight: 400,
                    fontSize: 'clamp(30px, 7vw, 48px)', lineHeight: 1.0,
                    letterSpacing: '-0.025em', margin: '0 0 28px', color: 'var(--ink)',
                  }}>
                    Round {tournament.current_round}<br />
                    <em style={{ fontWeight: 300, color: 'var(--burgundy)' }}>your match.</em>
                  </h1>

                  <div style={{ border: '1px solid var(--rule)', marginBottom: 28 }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span className="folio" style={{ letterSpacing: '0.18em' }}>MATCH</span>
                      <span className="folio" style={{ color: 'var(--ink-4)' }}>ROUND {tournament.current_round}</span>
                    </div>
                    <div style={{ padding: '20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                      <span style={{ fontFamily: 'var(--serif)', fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>
                        {myMatch.player_a_name}
                      </span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>VS</span>
                      <span style={{ fontFamily: 'var(--serif)', fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>
                        {myMatch.player_b_name}
                      </span>
                    </div>
                    {myMatch.status === 'pending' && (
                      <div style={{
                        borderTop: '1px solid var(--rule)', padding: '12px 16px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', animation: 'mr-dot-pulse 1.6s ease-in-out infinite' }} />
                        <span className="ar" style={{ fontSize: 13, color: 'var(--ink-3)' }}>في انتظار بدء المباراة…</span>
                        <style>{`@keyframes mr-dot-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.6)} }`}</style>
                      </div>
                    )}
                    {myMatch.status === 'finished' && (
                      <div style={{
                        borderTop: '1px solid var(--rule)', padding: '12px 16px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      }}>
                        <span className="ar" style={{ fontSize: 13, color: myMatch.winner_uid === uid ? 'var(--burgundy)' : 'var(--ink-3)' }}>
                          {myMatch.winner_uid === uid ? 'تأهلت للجولة القادمة! 🎉' : 'خرجت من هذه الجولة'}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <h1 style={{
                    fontFamily: 'var(--serif)', fontWeight: 400,
                    fontSize: 'clamp(30px, 7vw, 48px)', lineHeight: 1.0,
                    letterSpacing: '-0.025em', margin: '0 0 28px', color: 'var(--ink)',
                  }}>
                    Awaiting<br />
                    <em style={{ fontWeight: 300, color: 'var(--burgundy)' }}>your bracket.</em>
                  </h1>
                  <p className="ar" style={{ fontSize: 14, color: 'var(--ink-3)', margin: 0 }}>
                    في انتظار تحديد المباريات…
                  </p>
                </>
              )}
            </>
          )}

          {/* ── FFA / TRANSITION waiting ───────────────────────────────── */}
          {!isEliminated && !isFinished && (tournament.status === 'ffa' || tournament.status === 'transition') && (
            <>
              {/* Pulsing monogram */}
              <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto 32px' }}>
                <svg width="80" height="80" viewBox="0 0 100 100" fill="none"
                  style={{ animation: 'mr-spin-slow 10s linear infinite' }}>
                  <circle cx="50" cy="50" r="46" stroke="var(--rule)" strokeWidth="1" />
                  <circle cx="50" cy="50" r="36" stroke="var(--ink)" strokeWidth="1.5" />
                  <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
                    fontFamily="Fraunces, Georgia, serif" fontSize="22" fontWeight="500" fill="var(--ink)">MR</text>
                </svg>
                <div style={{
                  position: 'absolute', inset: -10,
                  border: '1px solid var(--rule)', borderRadius: '50%',
                  animation: 'mr-ring-pulse 2.6s ease-in-out infinite',
                }} />
                <style>{`
                  @keyframes mr-spin-slow  { to { transform: rotate(360deg); } }
                  @keyframes mr-ring-pulse { 0%,100%{transform:scale(1);opacity:0.6} 50%{transform:scale(1.1);opacity:0.15} }
                `}</style>
              </div>

              <h1 style={{
                fontFamily: 'var(--serif)', fontWeight: 400,
                fontSize: 'clamp(30px, 7vw, 48px)', lineHeight: 1.0,
                letterSpacing: '-0.025em', margin: '0 0 20px', color: 'var(--ink)',
              }}>
                {tournament.status === 'ffa' ? 'Awaiting' : 'Preparing'}<br />
                <em style={{ fontWeight: 300, color: 'var(--burgundy)' }}>
                  {tournament.status === 'ffa' ? 'results.' : 'bracket.'}
                </em>
              </h1>

              <p className="ar" style={{ fontSize: 14, color: 'var(--ink-3)', margin: 0 }}>
                {tournament.status === 'ffa'
                  ? 'انتظر حتى تنتهي مرحلة التصفيات…'
                  : 'جاري الاستعداد لمرحلة الـ Bracket…'}
              </p>
            </>
          )}

          {/* ── Tournament progress: FFA results + bracket (EVERY player) ── */}
          {(tournament.status === 'bracket' || tournament.status === 'finished') && (
            <div style={{ marginTop: 16, textAlign: 'right' }}>

              {/* ── Phase countdown (the suspense moment) ─────────────── */}
              {inPhaseWait && (
                <div style={{
                  border: '1px solid var(--gold)', borderTop: '3px solid var(--gold)',
                  background: 'rgba(176,137,68,0.06)', padding: '24px 20px', marginBottom: 16,
                  textAlign: 'center',
                }}>
                  <p className="folio" style={{ color: 'var(--gold)', letterSpacing: '0.22em', marginBottom: 10 }}>
                    {/* current_round is already the round that is about to
                        start — the CF bumps it before the break begins. */}
                    {isRoundOne ? 'PHASE II · BRACKET STARTS IN' : `ROUND ${tournament.current_round || 1} STARTS IN`}
                  </p>
                  <p style={{
                    fontFamily: 'var(--mono)', fontSize: 56, fontWeight: 700, color: 'var(--ink)',
                    lineHeight: 1, margin: '0 0 8px', letterSpacing: '0.06em',
                  }}>
                    {formatCountdown(remainingMs)}
                  </p>
                  <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
                    {isRoundOne ? 'استعدوا — مباريات الإقصاء على وشك البدء! ⚡' : 'استعد للمباراة القادمة!'}
                  </p>
                </div>
              )}

              {/* ── FFA standings ──────────────────────────────────────────
                  Shown once, right after the qualifiers end, and again at the
                  very end of the tournament — collapsed and labelled, so it is
                  never mistaken for the final ranking. It used to sit on screen
                  through every round break, which made the FFA leader look like
                  the tournament leader. */}
              {showFfaStandings && (
                <div style={{
                  border: `1px solid ${isFinished ? 'var(--rule)' : 'var(--gold)'}`,
                  marginBottom: 16,
                }}>
                  <button
                    onClick={() => isFinished && setShowFfaTable(v => !v)}
                    style={{
                      width: '100%', padding: '10px 14px',
                      borderBottom: ffaTableOpen ? '1px solid var(--rule)' : 'none',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: isFinished ? 'var(--paper-2)' : 'rgba(176,137,68,0.06)',
                      border: 'none', cursor: isFinished ? 'pointer' : 'default',
                      textAlign: 'right',
                    }}
                  >
                    <span className="folio" style={{
                      letterSpacing: '0.18em',
                      color: isFinished ? 'var(--ink-3)' : 'var(--gold)',
                    }}>
                      {isFinished ? 'ترتيب التصفيات — ليس الترتيب النهائي' : 'نتيجة التصفيات — المتأهلون'}
                    </span>
                    <span className="folio" style={{ color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {ffaResults.length} لاعب
                      {isFinished && (ffaTableOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                    </span>
                  </button>

                  {ffaTableOpen && isFinished && (
                    <p className="ar" style={{
                      fontSize: 11, color: 'var(--ink-4)', margin: 0,
                      padding: '8px 14px', borderBottom: '1px solid var(--rule)', lineHeight: 1.7,
                    }}>
                      ده ترتيب مرحلة التصفيات بس. البطل بيتحدد من مباريات الـ Bracket، مش من الجدول ده.
                    </p>
                  )}

                  {ffaTableOpen && ffaResults.slice(0, 8).map((r, i) => {
                    const isMe = r.uid === uid
                    return (
                      <div key={r.uid} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 14px', borderBottom: '1px solid var(--rule)',
                        background: isMe ? 'var(--paper-2)' : 'var(--paper)',
                      }}>
                        <span style={{
                          fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700,
                          color: i < 3 ? 'var(--gold)' : 'var(--ink-4)', minWidth: 26,
                        }}>#{r.rank}</span>
                        <span style={{
                          fontFamily: 'var(--serif)', fontSize: 14, fontWeight: isMe ? 700 : 500,
                          color: 'var(--ink)', flex: 1,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{r.nickname}{isMe ? ' (أنت)' : ''}</span>
                        {r.advanced && (
                          <span className="folio" style={{ color: 'var(--success)', fontSize: 9, border: '1px solid var(--success)', padding: '1px 6px' }}>
                            تأهل
                          </span>
                        )}
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>{r.score}</span>
                      </div>
                    )
                  })}
                  {ffaTableOpen && ffaResults.length > 8 && (
                    <p className="folio" style={{ textAlign: 'center', padding: 8, color: 'var(--ink-4)', fontSize: 9 }}>
                      +{ffaResults.length - 8} آخرين
                    </p>
                  )}
                </div>
              )}

              {/* Bracket tree */}
              <button
                onClick={() => setShowBracket(v => !v)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', border: '1px solid var(--rule)', background: 'var(--paper-2)',
                  cursor: 'pointer', color: 'var(--ink)', fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                <span className="ar" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Trophy size={14} style={{ color: 'var(--gold)' }} />
                  شجرة البطولة
                </span>
                {showBracket ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>

              {showBracket && (
                <div style={{ overflowX: 'auto', marginBottom: 24, direction: 'ltr' }}>
                  {allMatches.length > 0 ? (
                    <BracketTree
                      matches={allMatches}
                      totalRounds={tournament.total_rounds || Math.log2(tournament.actual_top_cut || 8)}
                      tournamentTitle={tournament.title}
                    />
                  ) : (
                    <div style={{ textAlign: 'center', padding: 24, color: 'var(--ink-4)' }}>
                      <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px', display: 'block' }} />
                      <span className="ar folio">جاري تجهيز الشجرة…</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid var(--rule)', padding: '12px 20px',
        display: 'flex', justifyContent: 'center',
      }}>
        <span className="folio">Player · Tournament Wait</span>
      </footer>

    </div>
  )
}
