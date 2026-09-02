import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  doc, onSnapshot, collection, getDoc, getDocs, setDoc, serverTimestamp,
} from 'firebase/firestore'
import { ref as rtdbRef, onValue as rtdbOnValue, get as rtdbGet, set as rtdbSet } from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import BracketBoard from '../../components/tournament/BracketBoard'
import HonoursBoard from '../../components/tournament/HonoursBoard'
import { soundManager } from '../../utils/soundManager'
import SoundToggle from '../../components/common/SoundToggle'
import { Loader2, Trophy, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'

const STATUS_LABELS = {
  registration: 'Registration',
  ffa:          'Phase I — FFA',
  transition:   'Transitioning to Bracket',
  bracket:      'Bracket Phase',
  finished:     'Tournament Finished',
}

function getRoundLabel(round, totalRounds) {
  if (!round) return ''
  if (!totalRounds) return `الجولة ${round}`
  if (round === totalRounds)     return 'النهائي'
  if (round === totalRounds - 1) return 'نصف النهائي'
  if (round === totalRounds - 2) return 'ربع النهائي'
  return `الجولة ${round}`
}

export default function TournamentPlayerWait() {
  const { tournamentId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useAuth()

  const [tournament,    setTournament]    = useState(null)
  const [allMatches,    setAllMatches]    = useState([])
  const [ffaEliminated, setFfaEliminated] = useState(false)
  const [ffaResults,    setFfaResults]    = useState([])
  const [showBracket,   setShowBracket]   = useState(location.state?.showBracket !== false)
  const [showFfaTable,  setShowFfaTable]  = useState(null)
  const [now,           setNow]           = useState(0)
  const [registrationCount, setRegistrationCount] = useState(0)
  const [registrationNames, setRegistrationNames] = useState([])
  const [copied, setCopied] = useState(false)
  const [isRegistered, setIsRegistered] = useState(false)
  const bracketElRef = useRef(null)

  const uid = session?.uid
  const ffaCheckedRef = useRef(false)
  const ffaResultsFetchedRef = useRef(false)
  const confettiFiredRef = useRef(false)
  const bracketWillOpenRef = useRef(false)

  const prefersReducedMotion = typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

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

  const formatFutureCountdown = (ms) => {
    if (ms <= 0) return null
    const total = Math.ceil(ms / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
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
    if (!tournamentId || !['bracket', 'finished'].includes(tournament?.status)) return
    if (ffaResultsFetchedRef.current) return
    ffaResultsFetchedRef.current = true
    getDocs(collection(db, 'tournaments', tournamentId, 'ffa_results'))
      .then(snap => {
        const results = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
        const sorted = [...results].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
        setFfaResults(sorted)
      })
      .catch(() => { ffaResultsFetchedRef.current = false })
  }, [tournamentId, tournament?.status])

  useEffect(() => {
    if (!tournamentId) return
    const regRef = rtdbRef(rtdb, `tournament_registrations/${tournamentId}`)
    const unsub = rtdbOnValue(regRef, snap => {
      const val = snap.val()
      if (!val) { setRegistrationCount(0); setRegistrationNames([]); setIsRegistered(false); return }
      setIsRegistered(Boolean(uid && val[uid]))
      const entries = Object.values(val)
      setRegistrationCount(entries.length)
      setRegistrationNames(entries.slice(0, 12).map(e => e.nickname || e.display_name || '—'))
    })
    return () => unsub()
  }, [tournamentId, uid])

  const myCurrentRound = tournament?.current_round || 1
  const myMatch = uid
    ? (allMatches.find(m =>
        m.round === myCurrentRound &&
        (m.player_a_uid === uid || m.player_b_uid === uid)
      ) || null)
    : null
  const myFinishedLast = uid
    ? allMatches
        .filter(m =>
          m.round <= myCurrentRound &&
          (m.player_a_uid === uid || m.player_b_uid === uid) &&
          m.status === 'finished'
        )
        .sort((a, b) => a.round - b.round)
        .at(-1)
    : undefined
  const myResult = myFinishedLast
    ? (myFinishedLast.winner_uid === uid ? 'advanced' : 'eliminated')
    : undefined

  const bracketEliminated = myResult === 'eliminated'
  const isEliminated = ffaEliminated || bracketEliminated
  const isFinished   = tournament?.status === 'finished'
  const amChampion   = isFinished && tournament?.winner_uid === uid

  const isRunnerUp = isFinished && !amChampion && bracketEliminated &&
    myFinishedLast?.round === tournament?.total_rounds

  const isSemiFinalist = isFinished && !amChampion && bracketEliminated &&
    myFinishedLast?.round === (tournament?.total_rounds || 0) - 1 &&
    !isRunnerUp

  const championWins = isFinished && amChampion
    ? allMatches
        .filter(m => m.winner_uid === uid && m.status === 'finished')
        .sort((a, b) => a.round - b.round)
    : []

  const championOpponents = championWins.map(m =>
    m.player_a_uid === uid ? (m.player_b_name || '—') : (m.player_a_name || '—')
  )

  const runnerUpOpponent = isRunnerUp && tournament?.winner_name
    ? tournament.winner_name
    : isRunnerUp && allMatches
        .filter(m => m.round === tournament?.total_rounds && m.status === 'finished')
        .at(0)?.winner_name || null

  const roundLostLabel = (isRunnerUp || isSemiFinalist) && myFinishedLast
    ? getRoundLabel(myFinishedLast.round, tournament?.total_rounds)
    : ''

  const ffaRevealDone = phaseStart > 0 && (now - phaseStart) > 12000
  const showFfaStandings  = ffaResults.length > 0

  const advancedCount = ffaResults.filter(r => r.advanced).length
  const isRevealActive = !ffaRevealDone && isRoundOne && tournament?.status === 'bracket' && showFfaStandings && advancedCount > 0

  // Staggered qualifier reveal, derived from the server-written phase timestamp
  // (not a local timer): every device reveals the same name at the same moment,
  // and anyone opening the page late sees the finished table straight away.
  const revealedCount = isRevealActive
    ? Math.min(advancedCount, Math.floor(Math.max(0, now - phaseStart) / 800))
    : advancedCount

  const activeRoundMatches = isFinished
    ? []
    : allMatches.filter(m => m.round === myCurrentRound && m.status === 'active')

  useEffect(() => {
    if (myMatch?.status === 'active' && myMatch?.duel_id) {
      soundManager.playMatchAlert()
      navigate(`/tournament/${tournamentId}/duel/${myMatch.match_id}`, { replace: true })
    }
  }, [myMatch, tournamentId, navigate])

  useEffect(() => {
    if (!showBracket || !bracketElRef.current) return
    if (bracketWillOpenRef.current) {
      bracketWillOpenRef.current = false
      bracketElRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [showBracket])

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
  }, [tournament?.status, tournament?.ffa_room_id, navigate])

  const transitionPlayedRef = useRef(null)
  useEffect(() => {
    if (!inPhaseWait || !phaseStart) return
    if (transitionPlayedRef.current === phaseStart) return
    transitionPlayedRef.current = phaseStart
    soundManager.playStageStart()
  }, [inPhaseWait, phaseStart])

  const lastTickSecRef = useRef(null)
  useEffect(() => {
    if (!inPhaseWait) { lastTickSecRef.current = null; return }
    const secs = Math.ceil(remainingMs / 1000)
    if (secs <= 5 && secs >= 1 && lastTickSecRef.current !== secs) {
      lastTickSecRef.current = secs
      soundManager.playTick()
    }
  }, [remainingMs, inPhaseWait])

  useEffect(() => {
    if (amChampion) {
      soundManager.playChampion()
    } else if (isEliminated) {
      soundManager.playEliminated()
    }
  }, [amChampion, isEliminated])

  useEffect(() => {
    if (!amChampion || confettiFiredRef.current || prefersReducedMotion) return
    confettiFiredRef.current = true
    confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 } })
  }, [amChampion, prefersReducedMotion])

  const justAfterFfa      = tournament?.status === 'bracket' && isRoundOne && inPhaseWait
  const ffaTableDefaultOpen = justAfterFfa || isFinished
  const ffaTableOpen      = showFfaTable === null ? ffaTableDefaultOpen : showFfaTable

  // Every "watch the bracket" CTA goes to the live tree: it updates by itself,
  // shows running scores, and costs no Firestore reads. The snapshot overlay
  // below is kept only for the host's exportable image.
  const openBracket = () => navigate(`/tournament/${tournamentId}/live`)

  if (!tournament) {
    return (
      <div dir="rtl" className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

  return (
    <div dir="rtl" className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)',
        padding: '13px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="folio">Tournament</span>
          <SoundToggle showPreviewBtn={true} />
        </div>
        <svg width={28} height={28} viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>
        <span className="folio" style={{ flex: 1, textAlign: 'left' }}>
          {STATUS_LABELS[tournament.status] || tournament.status}
        </span>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>

          <p className="folio" style={{ marginBottom: 14, letterSpacing: '0.2em' }}>
            {tournament.title.toUpperCase()}
          </p>

          {/* ── REGISTRATION ──────────────────────────────────────────── */}
          {tournament.status === 'registration' && (
            <>
              <h1 style={{
                fontFamily: 'var(--serif)', fontWeight: 400,
                fontSize: 'clamp(34px, 8vw, 56px)', lineHeight: 1.0,
                letterSpacing: '-0.025em', margin: '0 0 20px', color: 'var(--ink)',
              }}>
                {isRegistered ? 'تم تسجيلك' : 'باب التسجيل'}<br />
                <em style={{ fontWeight: 300, color: isRegistered ? 'var(--success)' : 'var(--gold)' }}>{isRegistered ? '✓' : 'مفتوح.'}</em>
              </h1>

              <div style={{
                border: isRegistered ? '1px solid var(--success)' : '1px solid var(--rule)',
                background: isRegistered ? 'rgba(34,139,34,0.06)' : 'var(--paper-2)',
                padding: '14px 20px', marginBottom: 20,
              }}>
                <p className="ar" style={{ fontSize: 14, color: isRegistered ? 'var(--success)' : 'var(--ink-3)', fontWeight: 600, margin: 0 }}>
                  {isRegistered ? 'أنت مسجّل في البطولة' : 'إنت بتتفرج — مش مسجّل في البطولة دي'}
                </p>
              </div>

              {tournament.code && (
                <div style={{
                  border: '1px solid var(--rule)', padding: '12px 16px', marginBottom: 20,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span className="ar" style={{ fontSize: 13, color: 'var(--ink-3)' }}>كود البطولة</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, color: 'var(--ink)', letterSpacing: '0.08em' }}>
                      {tournament.code}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(tournament.code).catch(() => {})
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                      }}
                      style={{
                        background: 'none', border: '1px solid var(--rule)', cursor: 'pointer',
                        padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4,
                        color: 'var(--ink-3)', fontSize: 11,
                      }}
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      <span className="folio">{copied ? 'تم' : 'نسخ'}</span>
                    </button>
                  </div>
                </div>
              )}

              <div style={{ border: '1px solid var(--rule)', padding: '12px 16px', marginBottom: 20, textAlign: 'right' }}>
                <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 8px' }}>
                  المسجّلين: <strong style={{ color: 'var(--ink)' }}>{registrationCount}</strong> لاعب
                </p>
                {registrationNames.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {registrationNames.map((name, i) => (
                      <span key={i} className="ar" style={{
                        fontSize: 12, color: name.includes('أنت') || name === (session?.displayName) ? 'var(--burgundy)' : 'var(--ink-3)',
                        background: 'var(--paper-2)', padding: '2px 8px',
                        border: '1px solid var(--rule)',
                      }}>
                        {name}
                      </span>
                    ))}
                    {registrationCount > 12 && (
                      <span className="ar" style={{ fontSize: 11, color: 'var(--ink-4)', padding: '2px 6px' }}>
                        +{registrationCount - 12} آخرين
                      </span>
                    )}
                  </div>
                )}
              </div>

              {tournament.top_cut && (
                <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 20, margin: '0 0 20px' }}>
                  المتأهلون للبراكيت: أول <strong style={{ color: 'var(--gold)' }}>{tournament.top_cut}</strong>
                </p>
              )}

              {tournament.scheduled_start_at ? (
                (() => {
                  const startMs = typeof tournament.scheduled_start_at === 'number'
                    ? tournament.scheduled_start_at
                    : tournament.scheduled_start_at?.toMillis?.() || 0
                  const diff = Math.max(0, startMs - now)
                  const countdown = formatFutureCountdown(diff)
                  return countdown ? (
                    <div style={{
                      border: '1px solid var(--gold)', borderTop: '3px solid var(--gold)',
                      background: 'rgba(176,137,68,0.06)', padding: '20px 16px',
                    }}>
                      <p className="folio" style={{ color: 'var(--gold)', letterSpacing: '0.22em', marginBottom: 8, fontSize: 11 }}>
                        البدء خلال
                      </p>
                      <p style={{
                        fontFamily: 'var(--mono)', fontSize: 44, fontWeight: 700, color: 'var(--ink)',
                        lineHeight: 1, margin: 0, letterSpacing: '0.06em',
                      }}>
                        {countdown}
                      </p>
                    </div>
                  ) : null
                })()
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--gold)',
                    animation: 'mr-dot-pulse 1.6s ease-in-out infinite',
                  }} />
                  <span className="ar" style={{ fontSize: 14, color: 'var(--ink-3)' }}>
                    في انتظار الهوست يبدأ…
                  </span>
                  <style>{`@keyframes mr-dot-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.6)} }`}</style>
                </div>
              )}
            </>
          )}

          {/* ── CHAMPION ──────────────────────────────────────────────── */}
          {isFinished && amChampion && (
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
                padding: '16px 20px', marginBottom: 28,
              }}>
                <p className="ar" style={{ fontSize: 15, color: 'var(--gold)', fontWeight: 600, margin: 0 }}>
                  🏆 أنت بطل {tournament.title}
                </p>
              </div>
              {championOpponents.length > 0 && (
                <div style={{ marginBottom: 32, textAlign: 'center' }}>
                  <p className="folio" style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--ink-4)', marginBottom: 10 }}>
                    THE ROAD TO THE TITLE
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {championOpponents.map((name, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        fontSize: 13, color: 'var(--ink-3)',
                      }}>
                        <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 10, minWidth: 16 }}>
                          R{i + 1}
                        </span>
                        <span className="ar" style={{ color: 'var(--ink)' }}>{name}</span>
                        <span style={{ color: 'var(--success)', fontSize: 12 }}>✓</span>
                      </div>
                    ))}
                  </div>
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

          {/* ── RUNNER-UP ──────────────────────────────────────────────── */}
          {isRunnerUp && (
            <>
              <h1 style={{
                fontFamily: 'var(--serif)', fontWeight: 400,
                fontSize: 'clamp(34px, 8vw, 56px)', lineHeight: 1.0,
                letterSpacing: '-0.025em', margin: '0 0 24px', color: 'var(--ink)',
              }}>
                المركز الثاني<br />
                <em style={{ fontWeight: 300, color: 'var(--gold)' }}>🥈</em>
              </h1>
              <div style={{
                border: '1px solid var(--rule)', background: 'rgba(176,137,68,0.06)',
                padding: '16px 20px', marginBottom: 32,
              }}>
                <p className="ar" style={{ fontSize: 14, color: 'var(--ink)', margin: 0, lineHeight: 1.8 }}>
                  خسرت النهائي أمام{' '}
                  <strong style={{ color: 'var(--gold)' }}>{runnerUpOpponent}</strong>
                </p>
              </div>
              <button
                onClick={openBracket}
                style={{
                  padding: '13px 28px', background: 'var(--ink)', color: 'var(--paper)',
                  border: '1px solid var(--ink)', fontFamily: 'var(--arabic)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  display: 'block', margin: '0 auto 12px',
                }}
              >
                شاهد شجرة البطولة
              </button>
              <button
                onClick={() => navigate('/player/dashboard')}
                style={{ background: 'none', border: 'none', color: 'var(--ink-3)', fontFamily: 'var(--arabic)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', display: 'block', margin: '0 auto' }}
              >
                عودة للرئيسية
              </button>
            </>
          )}

          {/* ── SEMI-FINALIST ──────────────────────────────────────────── */}
          {isSemiFinalist && (
            <>
              <h1 style={{
                fontFamily: 'var(--serif)', fontWeight: 400,
                fontSize: 'clamp(34px, 8vw, 56px)', lineHeight: 1.0,
                letterSpacing: '-0.025em', margin: '0 0 24px', color: 'var(--ink)',
              }}>
                المركز 3–4
              </h1>
              <div style={{
                border: '1px solid var(--rule)', padding: '16px 20px', marginBottom: 32,
              }}>
                <p className="ar" style={{ fontSize: 14, color: 'var(--ink)', margin: 0 }}>
                  وصلت {roundLostLabel} وخرجت من البطولة
                </p>
              </div>
              <button
                onClick={openBracket}
                style={{
                  padding: '13px 28px', background: 'var(--ink)', color: 'var(--paper)',
                  border: '1px solid var(--ink)', fontFamily: 'var(--arabic)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  display: 'block', margin: '0 auto 12px',
                }}
              >
                شاهد شجرة البطولة
              </button>
              <button
                onClick={() => navigate('/player/dashboard')}
                style={{ background: 'none', border: 'none', color: 'var(--ink-3)', fontFamily: 'var(--arabic)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', display: 'block', margin: '0 auto' }}
              >
                عودة للرئيسية
              </button>
            </>
          )}

          {/* ── ELIMINATED (FFA or bracket, not runner-up/semi) ──────── */}
          {isFinished && !amChampion && !isRunnerUp && !isSemiFinalist && (
            <>
              <h1 style={{
                fontFamily: 'var(--serif)', fontWeight: 400,
                fontSize: 'clamp(34px, 8vw, 56px)', lineHeight: 1.0,
                letterSpacing: '-0.025em', margin: '0 0 16px', color: 'var(--ink)',
              }}>
                {!isEliminated ? 'Tournament' : ffaEliminated ? 'Did not' : 'Eliminated.'}<br />
                {!isEliminated
                  ? <em style={{ fontWeight: 300, color: 'var(--gold)' }}>finished.</em>
                  : ffaEliminated && <em style={{ fontWeight: 300, color: 'var(--alert)' }}>advance.</em>}
              </h1>
              {tournament.winner_name && (
                <p className="ar" style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold)', marginBottom: 16 }}>
                  البطل: {tournament.winner_name}
                </p>
              )}
              <div style={{
                border: `1px solid ${ffaEliminated ? 'var(--alert)' : 'var(--rule)'}`,
                background: ffaEliminated ? 'rgba(180,48,57,0.06)' : 'transparent',
                padding: '16px 20px', marginBottom: 32,
              }}>
                <p className="ar" style={{ fontSize: 14, color: ffaEliminated ? 'var(--alert)' : 'var(--ink-3)', fontWeight: 600, margin: '0 0 4px' }}>
                  {!isEliminated ? 'انتهت البطولة' : ffaEliminated ? 'لم تكن ضمن المتأهلين' : 'خرجت من البطولة'}
                </p>
                <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
                  {!isEliminated ? 'شكراً على المتابعة 🎉' : ffaEliminated ? 'شكراً على مشاركتك!' : 'كانت تجربة رائعة 🎉'}
                </p>
              </div>
              <button
                onClick={openBracket}
                style={{
                  padding: '13px 28px', background: 'var(--ink)', color: 'var(--paper)',
                  border: '1px solid var(--ink)', fontFamily: 'var(--arabic)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  display: 'block', margin: '0 auto 12px',
                }}
              >
                شاهد شجرة البطولة
              </button>
              <button
                onClick={() => navigate('/player/dashboard')}
                style={{ background: 'none', border: 'none', color: 'var(--ink-3)', fontFamily: 'var(--arabic)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', display: 'block', margin: '0 auto' }}
              >
                عودة للرئيسية
              </button>
            </>
          )}

          {/* ── ELIMINATED mid-bracket (still running) ────────────────── */}
          {!isFinished && bracketEliminated && (
            <>
              <h1 style={{
                fontFamily: 'var(--serif)', fontWeight: 400,
                fontSize: 'clamp(34px, 8vw, 56px)', lineHeight: 1.0,
                letterSpacing: '-0.025em', margin: '0 0 24px', color: 'var(--ink)',
              }}>
                Eliminated.<br />
                <em style={{ fontWeight: 300, color: 'var(--burgundy)' }}>الجولة {myCurrentRound}</em>
              </h1>
              <div style={{
                border: '1px solid var(--rule)', padding: '16px 20px', marginBottom: 32,
              }}>
                <p className="ar" style={{ fontSize: 14, color: 'var(--ink)', margin: 0 }}>
                  خرجت من {getRoundLabel(myCurrentRound, tournament?.total_rounds)}
                </p>
              </div>
              <button
                onClick={openBracket}
                style={{
                  padding: '13px 28px', background: 'var(--ink)', color: 'var(--paper)',
                  border: '1px solid var(--ink)', fontFamily: 'var(--arabic)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  display: 'block', margin: '0 auto 12px',
                }}
              >
                شاهد شجرة البطولة
              </button>
              <button
                onClick={() => navigate('/player/dashboard')}
                style={{ background: 'none', border: 'none', color: 'var(--ink-3)', fontFamily: 'var(--arabic)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', display: 'block', margin: '0 auto' }}
              >
                عودة للرئيسية
              </button>
            </>
          )}

          {/* ── HONOURS — every end state passes through here ────────── */}
          {isFinished && tournament.awards?.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <HonoursBoard awards={tournament.awards} myUid={uid} compact />
            </div>
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

          {/* ── SILENCE GAP: waiting for round matches to finish ────── */}
          {!isFinished && !isEliminated && tournament.status === 'bracket' && !inPhaseWait &&
           activeRoundMatches.length > 0 && (!myMatch || myMatch.status !== 'active') && (
            <div style={{
              border: '1px solid var(--rule)', borderTop: '3px solid var(--gold)',
              background: 'rgba(176,137,68,0.04)', padding: '20px 16px', marginBottom: 16,
              textAlign: 'center',
            }}>
              <p className="ar" style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600, margin: '0 0 12px' }}>
                مستني نتيجة باقي ماتشات الجولة…
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {activeRoundMatches.map(m => (
                  <div key={m.match_id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    fontSize: 13, color: 'var(--ink-3)',
                  }}>
                    <span className="ar">{m.player_a_name} vs {m.player_b_name}</span>
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.06em',
                      color: 'var(--gold)', border: '1px solid var(--gold)', padding: '1px 6px',
                    }}>LIVE</span>
                  </div>
                ))}
              </div>
              <p className="ar" style={{ fontSize: 12, color: 'var(--ink-4)', margin: 0 }}>
                الجولة الجاية هتبدأ لما كل الماتشات تخلص
              </p>
            </div>
          )}

          {/* ── FFA / TRANSITION waiting ──────────────────────────────── */}
          {!isEliminated && !isFinished && (tournament.status === 'ffa' || tournament.status === 'transition') && (
            <>
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

          {/* ── Tournament progress: FFA results + bracket ──────────── */}
          {(tournament.status === 'bracket' || tournament.status === 'finished') && (
            <div style={{ marginTop: 16, textAlign: 'right' }}>

              {/* Phase countdown */}
              {inPhaseWait && (
                <div style={{
                  border: '1px solid var(--gold)', borderTop: '3px solid var(--gold)',
                  background: 'rgba(176,137,68,0.06)', padding: '24px 20px', marginBottom: 16,
                  textAlign: 'center',
                }}>
                  <p className="folio" style={{ color: 'var(--gold)', letterSpacing: '0.22em', marginBottom: 10 }}>
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

              {/* ── FFA standings ──────────────────────────────────────── */}
              {showFfaStandings && (
                <div style={{
                  border: `1px solid ${isFinished ? 'var(--rule)' : 'var(--gold)'}`,
                  marginBottom: 16,
                }}>
                  <button
                    onClick={() => setShowFfaTable(v => !(v === null ? ffaTableDefaultOpen : v))}
                    style={{
                      width: '100%', padding: '10px 14px',
                      borderBottom: ffaTableOpen ? '1px solid var(--rule)' : 'none',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: isFinished ? 'var(--paper-2)' : 'rgba(176,137,68,0.06)',
                      border: 'none', cursor: 'pointer',
                      textAlign: 'right',
                    }}
                  >
                    <span className="folio" style={{
                      letterSpacing: '0.18em',
                      color: isFinished ? 'var(--ink-3)' : 'var(--gold)',
                    }}>
                      {isFinished ? 'ترتيب التصفيات — ليس الترتيب النهائي' : 'ترتيب التصفيات'}
                    </span>
                    <span className="folio" style={{ color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {ffaResults.length} لاعب
                      {ffaTableOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
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

                  {ffaTableOpen && (() => {
                    const visible = ffaResults.slice(0, 8)
                    const qCount = Math.min(advancedCount, visible.length)

                    return (
                      <>
                        {visible.slice(0, qCount).map((r, i) => {
                          const isMe = r.uid === uid
                          const revealOrder = advancedCount - i
                          const hidden = isRevealActive && revealedCount < revealOrder
                          if (hidden) return null
                          return (
                            <motion.div
                              key={r.uid}
                              initial={isRevealActive ? { opacity: 0, x: -8 } : false}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.3 }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '8px 14px', borderBottom: '1px solid var(--rule)',
                                background: isMe ? 'var(--paper-2)' : 'var(--paper)',
                              }}
                            >
                              <span style={{
                                fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700,
                                color: i < 3 ? 'var(--gold)' : 'var(--ink-4)', minWidth: 26,
                              }}>#{r.rank}</span>
                              <span style={{
                                fontFamily: 'var(--serif)', fontSize: 14, fontWeight: isMe ? 700 : 500,
                                color: 'var(--ink)', flex: 1,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>{r.nickname}{isMe ? ' (أنت)' : ''}</span>
                              <span className="folio" style={{ color: 'var(--success)', fontSize: 9, border: '1px solid var(--success)', padding: '1px 6px' }}>
                                تأهل ✓
                              </span>
                              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>{r.score}</span>
                            </motion.div>
                          )
                        })}

                        {isRevealActive && revealedCount >= 1 && qCount < visible.length && (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 14px', borderBottom: '1px solid var(--rule)',
                            background: 'var(--paper-2)',
                          }}>
                            <span style={{ flex: 1, height: 1, background: 'var(--rule-strong)' }} />
                            <span className="ar folio" style={{ color: 'var(--ink-4)', fontSize: 9, whiteSpace: 'nowrap' }}>
                              حتى هنا التأهل — الباقي خرج من التصفيات
                            </span>
                            <span style={{ flex: 1, height: 1, background: 'var(--rule-strong)' }} />
                          </div>
                        )}

                        {visible.slice(qCount).map((r, i) => {
                          const isMe = r.uid === uid
                          const last = qCount + i === visible.length - 1
                          return (
                            <div key={r.uid} style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '8px 14px', borderBottom: last ? 'none' : '1px solid var(--rule)',
                              background: isMe ? 'var(--paper-2)' : 'var(--paper)',
                            }}>
                              <span style={{
                                fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700,
                                color: 'var(--ink-4)', minWidth: 26,
                              }}>#{r.rank}</span>
                              <span style={{
                                fontFamily: 'var(--serif)', fontSize: 14, fontWeight: isMe ? 700 : 500,
                                color: 'var(--ink)', flex: 1,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>{r.nickname}{isMe ? ' (أنت)' : ''}</span>
                              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>{r.score}</span>
                            </div>
                          )
                        })}
                      </>
                    )
                  })()}
                  {ffaTableOpen && ffaResults.length > 8 && (
                    <p className="folio" style={{ textAlign: 'center', padding: 8, color: 'var(--ink-4)', fontSize: 9 }}>
                      +{ffaResults.length - 8} آخرين
                    </p>
                  )}
                </div>
              )}

              {/* Bracket tree */}
              <button
                ref={bracketElRef}
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
                <div style={{
                  marginBottom: 24, padding: 12,
                  background: '#14120E', border: '1px solid #3A362C',
                }}>
                  {allMatches.length > 0 ? (
                    <BracketBoard
                      matches={allMatches}
                      totalRounds={tournament.total_rounds || Math.log2(tournament.actual_top_cut || 8)}
                      myUid={uid}
                      currentRound={tournament.current_round || null}
                      tone="dark"
                      emptyNote="الشجرة لسه ماتعملتش"
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
