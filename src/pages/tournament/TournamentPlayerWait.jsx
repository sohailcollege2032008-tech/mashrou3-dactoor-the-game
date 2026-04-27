import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc, onSnapshot, collection, getDoc, getDocs, setDoc, serverTimestamp,
} from 'firebase/firestore'
import { ref as rtdbRef, get as rtdbGet, set as rtdbSet } from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'

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
  const { session } = useAuth()

  const [tournament,    setTournament]    = useState(null)
  const [myMatch,       setMyMatch]       = useState(null)
  const [myResult,      setMyResult]      = useState(null)
  const [ffaEliminated, setFfaEliminated] = useState(false)

  const uid = session?.uid
  const ffaCheckedRef = useRef(false)

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

  useEffect(() => {
    if (!tournamentId || !uid || !tournament?.current_round) return
    const unsub = onSnapshot(
      collection(db, 'tournaments', tournamentId, 'bracket_matches'),
      snap => {
        const all = snap.docs.map(d => ({ match_id: d.id, ...d.data() }))
        const currentRound = tournament.current_round
        const mine = all.find(m =>
          m.round === currentRound &&
          (m.player_a_uid === uid || m.player_b_uid === uid)
        )
        setMyMatch(mine || null)

        const myFinishedMatches = all.filter(m =>
          m.round <= currentRound &&
          (m.player_a_uid === uid || m.player_b_uid === uid) &&
          m.status === 'finished'
        )
        if (myFinishedMatches.length > 0) {
          const lastMatch = myFinishedMatches[myFinishedMatches.length - 1]
          setMyResult(lastMatch.winner_uid === uid ? 'advanced' : 'eliminated')
        }
      }
    )
    return () => unsub()
  }, [tournamentId, uid, tournament?.current_round])

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
      localStorage.removeItem('activeTournamentId')
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
