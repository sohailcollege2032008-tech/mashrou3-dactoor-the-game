/**
 * TournamentBracket.jsx — Host view of the bracket.
 * • Shows bracket tree with live match statuses
 * • Allows host to assign deck questions to each round
 * • Image export via html2canvas
 * • Shows phase-transition and round-break countdowns
 * • Launches individual bracket duels
 */
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc, onSnapshot, updateDoc, getDocs, getDoc,
  collection, writeBatch, serverTimestamp, setDoc
} from 'firebase/firestore'
import { ref as rtdbRef, set, onValue, push } from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import {
  generateBracketMatches, getQuestionsForRound,
  sortPlayers, resolveMatchTie
} from '../../utils/tournamentUtils'
import { stripCorrectForRtdb } from '../../utils/duelUtils'
import BracketTree from '../../components/tournament/BracketTree'
import TournamentCountdown from '../../components/tournament/TournamentCountdown'
import { Trophy, Download, Play, Loader2, ChevronRight, Settings, Flag, AlertTriangle } from 'lucide-react'
import html2canvas from 'html2canvas'
import QuestionAssignmentPanel from '../../components/tournament/QuestionAssignmentPanel'

function getRoundName(round, totalRounds) {
  if (round === totalRounds)     return 'النهائي'
  if (round === totalRounds - 1) return 'نصف النهائي'
  if (round === totalRounds - 2) return 'ربع النهائي'
  return `الجولة ${round}`
}

function MatchStatusBadge({ status, winnerName }) {
  if (status === 'finished') return (
    <span style={{
      fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--success)',
      border: '1px solid var(--success)', padding: '2px 8px',
    }} className="ar">
      فاز {winnerName}
    </span>
  )
  if (status === 'active') return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em',
      textTransform: 'uppercase', color: 'var(--gold)',
      border: '1px solid var(--gold)', padding: '2px 8px',
    }}>
      LIVE
    </span>
  )
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em',
      textTransform: 'uppercase', color: 'var(--ink-4)',
      border: '1px solid var(--rule)', padding: '2px 8px',
    }}>
      PENDING
    </span>
  )
}

export default function TournamentBracket() {
  const { tournamentId } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const bracketRef = useRef(null)

  const [tournament,  setTournament]  = useState(null)
  const [matches,     setMatches]     = useState([])
  const [ffaResults,  setFfaResults]  = useState([])
  const [deckQs,      setDeckQs]      = useState([])
  const [generating,  setGenerating]  = useState(false)
  const [exporting,   setExporting]   = useState(false)
  const [showCountdown, setShowCountdown] = useState(false)
  const [countdownLabel, setCountdownLabel] = useState('')
  const [countdownMs, setCountdownMs] = useState(0)
  const [error,       setError]       = useState(null)
  const [showQPanel,      setShowQPanel]      = useState(false)
  const [showEndConfirm,  setShowEndConfirm]  = useState(false)
  const [ending,          setEnding]          = useState(false)
  const [liveDuels,       setLiveDuels]       = useState({})
  const [waitingPresence, setWaitingPresence] = useState({})

  const autoLaunchedRef   = useRef(new Set())
  const autoAdvancedRef   = useRef(null)
  const autoFinishedRef   = useRef(false)

  useEffect(() => {
    if (!tournamentId) return
    const unsub = onSnapshot(doc(db, 'tournaments', tournamentId), snap => {
      if (snap.exists()) setTournament({ id: snap.id, ...snap.data() })
    })
    return () => unsub()
  }, [tournamentId])

  useEffect(() => {
    if (!tournamentId) return
    const unsub = onSnapshot(
      collection(db, 'tournaments', tournamentId, 'bracket_matches'),
      snap => setMatches(snap.docs.map(d => ({ match_id: d.id, ...d.data() })))
    )
    return () => unsub()
  }, [tournamentId])

  useEffect(() => {
    if (!tournamentId) return
    const unsub = onValue(rtdbRef(rtdb, `tournament_presence/${tournamentId}`), snap => {
      setWaitingPresence(snap.val() || {})
    })
    return () => unsub()
  }, [tournamentId])

  useEffect(() => {
    if (!tournamentId) return
    getDocs(collection(db, 'tournaments', tournamentId, 'ffa_results'))
      .then(snap => setFfaResults(sortPlayers(snap.docs.map(d => ({ uid: d.id, ...d.data() })))))
      .catch(console.error)
  }, [tournamentId])

  useEffect(() => {
    if (!tournament?.deck_id) return
    getDoc(doc(db, 'question_sets', tournament.deck_id))
      .then(d => setDeckQs(d.data()?.questions?.questions || []))
      .catch(console.error)
  }, [tournament?.deck_id])

  useEffect(() => {
    const activeMatches = matches.filter(
      m => m.status === 'active' && m.duel_id &&
           m.round === (tournament?.current_round || 1)
    )
    if (!activeMatches.length) { setLiveDuels({}); return }

    const unsubs = activeMatches.map(m =>
      onValue(rtdbRef(rtdb, `tournament_duels/${tournamentId}/${m.duel_id}/players`), snap => {
        setLiveDuels(prev => ({ ...prev, [m.duel_id]: snap.val() || {} }))
      })
    )
    return () => unsubs.forEach(u => u())
  }, [matches, tournament?.current_round, tournamentId])

  useEffect(() => {
    if (!tournament || matches.length > 0 || ffaResults.length < 2 || generating) return
    if (tournament.status !== 'bracket') return
    generateBracket()
  }, [tournament, matches.length, ffaResults.length])

  const launchablePendingKey = matches
    .filter(m => m.status === 'pending' && m.player_a_uid && m.player_b_uid)
    .map(m => m.match_id).sort().join(',')

  useEffect(() => {
    if (!launchablePendingKey || !tournament || tournament.status !== 'bracket') return
    const toAutoLaunch = matches.filter(m =>
      m.status === 'pending' &&
      m.player_a_uid &&
      m.player_b_uid &&
      !autoLaunchedRef.current.has(m.match_id)
    )
    if (!toAutoLaunch.length) return

    const t = setTimeout(() => {
      toAutoLaunch.forEach(m => {
        autoLaunchedRef.current.add(m.match_id)
        launchMatch(m)
      })
    }, 1500)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchablePendingKey, tournament?.status])

  useEffect(() => {
    if (!tournament || tournament.status !== 'bracket') return
    const tRounds    = tournament.total_rounds || Math.log2(tournament.actual_top_cut || 8)
    const cRound     = tournament.current_round || 1
    const rMatches   = matches.filter(m => m.round === cRound)
    const allDone    = rMatches.length > 0 && rMatches.every(m => m.status === 'finished')

    if (!allDone || cRound >= tRounds) return
    if (autoAdvancedRef.current === cRound) return
    if (showCountdown) return

    autoAdvancedRef.current = cRound
    setCountdownLabel(`استراحة قبل الجولة ${cRound + 1}`)
    setCountdownMs(tournament.round_break_time || 30000)
    setShowCountdown(true)
  }, [
    matches.map(m => m.match_id + m.status).join(','),
    tournament?.current_round,
    tournament?.status,
    showCountdown,
  ])

  useEffect(() => {
    if (!tournament || tournament.status !== 'bracket') return
    if (tournament.winner_uid) return
    const tRounds  = tournament.total_rounds || Math.log2(tournament.actual_top_cut || 8)
    const cRound   = tournament.current_round || 1
    if (cRound !== tRounds) return
    const finalMatch = matches.find(m => m.round === tRounds && m.status === 'finished')
    if (!finalMatch?.winner_uid) return
    if (autoFinishedRef.current) return

    autoFinishedRef.current = true
    const winnerName = finalMatch.winner_uid === finalMatch.player_a_uid
      ? finalMatch.player_a_name : finalMatch.player_b_name
    updateDoc(doc(db, 'tournaments', tournamentId), {
      status:      'finished',
      winner_uid:  finalMatch.winner_uid,
      winner_name: winnerName,
    }).catch(console.error)
  }, [
    matches.map(m => m.match_id + m.status + (m.winner_uid || '')).join(','),
    tournament?.current_round,
    tournament?.status,
    tournament?.winner_uid,
  ])

  const generateBracket = useCallback(async () => {
    if (generating || ffaResults.length < 2) return
    setGenerating(true)
    try {
      const topN     = tournament.actual_top_cut
      const advanced = ffaResults.filter(p => p.advanced).slice(0, topN)
      const newMatches = generateBracketMatches(advanced)

      const batch = writeBatch(db)
      newMatches.forEach(m => {
        const ref = doc(db, 'tournaments', tournamentId, 'bracket_matches', m.match_id)
        batch.set(ref, m)
      })
      await batch.commit()
    } catch (e) {
      console.error(e)
      setError('فشل توليد الـ Bracket')
    } finally {
      setGenerating(false)
    }
  }, [generating, ffaResults, tournament, tournamentId])

  const doAdvanceRound = useCallback(async (currentRnd, roundMatchList) => {
    const batch = writeBatch(db)
    for (const m of roundMatchList) {
      if (m.status !== 'finished' || !m.winner_uid || !m.next_match_id) continue
      const winnerName = m.winner_uid === m.player_a_uid
        ? m.player_a_name : m.player_b_name
      const nextRef = doc(db, 'tournaments', tournamentId, 'bracket_matches', m.next_match_id)
      const isOdd = m.match_number % 2 === 1
      batch.update(nextRef, isOdd
        ? { player_a_uid: m.winner_uid, player_a_name: winnerName }
        : { player_b_uid: m.winner_uid, player_b_name: winnerName }
      )
    }
    batch.update(doc(db, 'tournaments', tournamentId), { current_round: currentRnd + 1 })
    await batch.commit()
  }, [tournamentId])

  const handleCountdownComplete = useCallback(() => {
    setShowCountdown(false)
    if (autoAdvancedRef.current !== null) {
      const rnd = autoAdvancedRef.current
      doAdvanceRound(rnd, matches.filter(m => m.round === rnd))
        .catch(console.error)
    }
  }, [doAdvanceRound, matches])

  const exportImage = useCallback(async () => {
    if (!bracketRef.current || exporting) return
    setExporting(true)
    try {
      const canvas = await html2canvas(bracketRef.current, {
        backgroundColor: '#0A0E1A',
        scale: 2,
        useCORS: true,
        logging: false,
      })
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `bracket-${tournamentId}-r${tournament?.current_round || 1}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (e) {
      console.error('Export failed:', e)
      setError('فشل تصدير الصورة')
    } finally {
      setExporting(false)
    }
  }, [bracketRef, exporting, tournamentId, tournament?.current_round])

  const launchMatch = useCallback(async (match) => {
    if (!match || match.status !== 'pending') return
    if (!match.player_a_uid || !match.player_b_uid) return setError('لاعب غير محدد في هذه المباراة')

    try {
      const deckSnap    = await getDoc(doc(db, 'question_sets', tournament.deck_id))
      const freshDeckQs = deckSnap.data()?.questions?.questions || []
      if (freshDeckQs.length === 0) throw new Error('لا توجد أسئلة في الـ Deck')

      const questions = getQuestionsForRound(match.round, tournament, freshDeckQs, 5)
      if (questions.length === 0) throw new Error('لا توجد أسئلة لهذه الجولة')

      const usedTexts = new Set(questions.map(q => q?.question).filter(Boolean))
      const unusedQs  = freshDeckQs.filter(q => q && !usedTexts.has(q.question))
        .sort(() => Math.random() - 0.5)
      const tiebreakerQuestions = unusedQs.length > 0
        ? unusedQs.slice(0, 3)
        : [...freshDeckQs].sort(() => Math.random() - 0.5).slice(0, 3)

      const newDuelRef = push(rtdbRef(rtdb, `tournament_duels/${tournamentId}`))
      const duelId = newDuelRef.key
      const safeQuestions    = await stripCorrectForRtdb(questions, duelId)
      const safeTiebreakers  = await stripCorrectForRtdb(tiebreakerQuestions, duelId)

      await set(newDuelRef, {
        tournament_id:        tournamentId,
        match_id:             match.match_id,
        round:                match.round,
        question_duration_ms: tournament.duel_question_duration || 30000,
        creator_uid:          match.player_a_uid,
        deck_id:              tournament.deck_id,
        deck_title:           tournament.deck_title,
        questions:            safeQuestions,
        total_questions:      safeQuestions.length,
        tiebreaker_questions: safeTiebreakers,
        tiebreaker_used:      0,
        is_tiebreaker:        false,
        config:               { questionCount: safeQuestions.length, shuffleQuestions: false, shuffleAnswers: false },
        force_rtl:            false,
        status:               'waiting',
        current_question_index: 0,
        question_started_at:  null,
        reveal_started_at:    null,
        forfeit_by:           null,
        surrender_by:         null,
        players: {
          [match.player_a_uid]: {
            uid:        match.player_a_uid,
            nickname:   match.player_a_name,
            avatar_url: ffaResults.find(p => p.uid === match.player_a_uid)?.avatar_url || '',
            score:      0,
          },
          [match.player_b_uid]: {
            uid:        match.player_b_uid,
            nickname:   match.player_b_name,
            avatar_url: ffaResults.find(p => p.uid === match.player_b_uid)?.avatar_url || '',
            score:      0,
          },
        },
        answers: {},
      })

      await updateDoc(
        doc(db, 'tournaments', tournamentId, 'bracket_matches', match.match_id),
        { duel_id: duelId, status: 'active' }
      )
    } catch (e) {
      console.error(e)
      setError(e.message || 'فشل إطلاق المباراة')
    }
  }, [tournament, tournamentId, ffaResults])

  const endTournament = useCallback(async () => {
    if (ending) return
    setEnding(true); setError(null)
    try {
      const tRounds    = tournament?.total_rounds || Math.log2(tournament?.actual_top_cut || 8)
      const finalMatch = matches.find(m => m.round === tRounds && m.status === 'finished')
      const winnerUid  = finalMatch?.winner_uid || tournament?.winner_uid || null
      await updateDoc(doc(db, 'tournaments', tournamentId), {
        status:     'finished',
        winner_uid: winnerUid,
      })
      navigate('/host/dashboard', { replace: true })
    } catch (e) {
      console.error(e)
      setError(e.message || 'فشل إنهاء البطولة')
      setEnding(false)
    }
  }, [ending, matches, tournament, tournamentId, navigate])

  const saveAssignment = useCallback(async (newAssignments) => {
    try {
      await updateDoc(doc(db, 'tournaments', tournamentId), { round_questions: newAssignments })
    } catch (e) { console.error(e) }
    setShowQPanel(false)
  }, [tournamentId])

  // Loading
  if (!tournament) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--ink-3)' }} />
      </div>
    )
  }

  const totalRounds  = tournament.total_rounds || Math.log2(tournament.actual_top_cut || 8)
  const currentRound = tournament.current_round || 1
  const roundMatches = matches.filter(m => m.round === currentRound)
  const allRoundDone = roundMatches.length > 0 && roundMatches.every(m => m.status === 'finished')

  return (
    <div className="paper-grain" style={{ minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)' }} dir="rtl">
      {showCountdown && (
        <TournamentCountdown
          durationMs={countdownMs}
          label={countdownLabel}
          onComplete={handleCountdownComplete}
        />
      )}
      {showQPanel && (
        <QuestionAssignmentPanel
          deckQs={deckQs}
          roundQuestions={tournament.round_questions || {}}
          totalRounds={totalRounds}
          isAutoMode={false}
          lockedRounds={Array.from({ length: currentRound - 1 }, (_, i) => i + 1)}
          ffaLocked={true}
          onSave={saveAssignment}
          onClose={() => setShowQPanel(false)}
        />
      )}

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 20px 64px' }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '24px 0 18px', borderBottom: '2px solid var(--ink)',
          flexWrap: 'wrap', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <Trophy size={18} style={{ color: 'var(--gold)', flexShrink: 0 }} />
            <div>
              <h1 className="ar" style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0, letterSpacing: '-0.01em' }}>
                {tournament.title}
              </h1>
              <div className="folio" style={{ color: 'var(--ink-4)', marginTop: 2, fontSize: 9 }}>
                الجولة {currentRound} / {totalRounds}
              </div>
            </div>
          </div>
          <button
            onClick={exportImage}
            disabled={exporting || matches.length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', border: '1px solid var(--rule)', borderRadius: 4,
              background: 'none', cursor: exporting || matches.length === 0 ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--ink-3)', opacity: exporting || matches.length === 0 ? 0.4 : 1,
              transition: 'all 150ms',
            }}
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            تصدير صورة
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            border: '1px solid var(--alert)', borderRadius: 4, padding: '12px 16px',
            background: 'color-mix(in srgb, var(--alert) 6%, var(--paper))',
            marginTop: 16, textAlign: 'center',
          }}>
            <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 14, color: 'var(--alert)', marginBottom: 6 }}>{error}</p>
            <button onClick={() => setError(null)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--alert)', letterSpacing: '0.06em',
            }}>
              DISMISS
            </button>
          </div>
        )}

        {/* Bracket tree */}
        <div style={{ marginTop: 24, marginBottom: 24 }}>
          {generating ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', gap: 16 }}>
              <Loader2 size={32} className="animate-spin" style={{ color: 'var(--ink-3)' }} />
              <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 14, color: 'var(--ink-3)' }}>جاري توليد الـ Bracket…</p>
            </div>
          ) : matches.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <BracketTree
                matches={matches}
                totalRounds={totalRounds}
                bracketRef={bracketRef}
                tournamentTitle={tournament.title}
              />
            </div>
          ) : (
            <p className="ar" style={{ textAlign: 'center', padding: '48px 0', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-3)', fontSize: 15 }}>
              جاري تحميل نتائج FFA لتوليد الـ Bracket…
            </p>
          )}
        </div>

        {/* Round question assignment */}
        {tournament.status === 'bracket' && totalRounds > 0 && (
          <button
            onClick={() => setShowQPanel(true)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px', border: '1px solid var(--rule)',
              background: 'var(--paper-2)', cursor: 'pointer',
              borderRadius: 4, marginBottom: 12, transition: 'all 150ms',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Settings size={14} style={{ color: 'var(--ink-3)' }} />
              <span className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 14, color: 'var(--ink)' }}>تخصيص أسئلة الجولات</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {Object.values(tournament.round_questions || {}).some(a => a.length > 0) ? (
                <span className="ar folio" style={{ color: 'var(--navy)', border: '1px solid var(--navy)', padding: '1px 8px', fontSize: 9 }}>
                  {Object.values(tournament.round_questions).flat().length} مخصص
                </span>
              ) : (
                <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>AUTO</span>
              )}
              <ChevronRight size={14} style={{ color: 'var(--ink-4)' }} />
            </div>
          </button>
        )}

        {/* End tournament */}
        {tournament.status !== 'finished' && (
          <div style={{ marginBottom: 20 }}>
            {!showEndConfirm ? (
              <button
                onClick={() => setShowEndConfirm(true)}
                style={{
                  width: '100%', padding: '12px 0',
                  border: '1px solid var(--alert)', borderRadius: 4,
                  background: 'color-mix(in srgb, var(--alert) 5%, var(--paper))',
                  cursor: 'pointer', color: 'var(--alert)',
                  fontFamily: 'var(--sans)', fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'all 150ms',
                }}
              >
                <Flag size={14} />
                <span className="ar">إنهاء البطولة يدوياً</span>
              </button>
            ) : (
              <div style={{
                border: '1px solid var(--alert)', borderRadius: 4, padding: '16px',
                background: 'color-mix(in srgb, var(--alert) 5%, var(--paper))',
                display: 'flex', flexDirection: 'column', gap: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <AlertTriangle size={14} style={{ color: 'var(--alert)', flexShrink: 0, marginTop: 2 }} />
                  <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>
                    هتنهي البطولة الآن وتحولها لـ "منتهية". اللاعبون لن يتمكنوا من الاستمرار. هل أنت متأكد؟
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => { setShowEndConfirm(false); setError(null) }}
                    disabled={ending}
                    style={{
                      flex: 1, padding: '10px 0', border: '1px solid var(--rule)', borderRadius: 4,
                      background: 'var(--paper-2)', color: 'var(--ink-3)',
                      fontFamily: 'var(--sans)', fontSize: 13, cursor: 'pointer',
                      opacity: ending ? 0.4 : 1,
                    }}
                  >
                    <span className="ar">تراجع</span>
                  </button>
                  <button
                    onClick={endTournament}
                    disabled={ending}
                    style={{
                      flex: 1, padding: '10px 0',
                      border: '1px solid var(--alert)', borderRadius: 4,
                      background: 'color-mix(in srgb, var(--alert) 10%, var(--paper))',
                      color: 'var(--alert)', fontFamily: 'var(--sans)', fontSize: 13,
                      cursor: ending ? 'not-allowed' : 'pointer',
                      opacity: ending ? 0.6 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    {ending ? <Loader2 size={13} className="animate-spin" /> : <Flag size={13} />}
                    <span className="ar">نعم، أنهِ البطولة</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Round controls */}
        {tournament.status === 'bracket' && matches.length > 0 && (
          <div style={{ border: '1px solid var(--rule)', borderRadius: 4, overflow: 'hidden' }}>
            {/* Round header */}
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid var(--rule)',
              background: 'var(--paper-2)',
            }}>
              <h2 className="ar" style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 17, margin: 0 }}>
                مباريات {getRoundName(currentRound, totalRounds)}
              </h2>
            </div>

            {/* Match list */}
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {roundMatches.map(match => {
                const live = match.duel_id ? (liveDuels[match.duel_id] || {}) : {}
                const liveA = live[match.player_a_uid]
                const liveB = live[match.player_b_uid]
                const hasLive = match.status === 'active' && (liveA || liveB)

                return (
                  <div key={match.match_id} style={{ border: '1px solid var(--rule)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                      background: 'var(--paper-2)',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'var(--serif)', fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>
                            {match.player_a_name || 'TBD'}
                          </span>
                          {hasLive && (
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>
                              {liveA?.score ?? 0}
                            </span>
                          )}
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-4)' }}>vs</span>
                          {hasLive && (
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>
                              {liveB?.score ?? 0}
                            </span>
                          )}
                          <span style={{ fontFamily: 'var(--serif)', fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>
                            {match.player_b_name || 'TBD'}
                          </span>
                        </div>
                      </div>

                      <MatchStatusBadge status={match.status} winnerName={
                        match.winner_uid === match.player_a_uid ? match.player_a_name : match.player_b_name
                      } />

                      {match.status === 'pending' && match.player_a_uid && match.player_b_uid && (
                        <button
                          onClick={() => launchMatch(match)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '5px 12px', border: '1px solid var(--ink)',
                            borderRadius: 4, background: 'var(--ink)', color: 'var(--paper)',
                            fontFamily: 'var(--sans)', fontSize: 12, cursor: 'pointer',
                          }}
                        >
                          <Play size={11} />
                          <span className="ar">ابدأ</span>
                        </button>
                      )}
                      {match.status === 'active' && match.duel_id && (
                        <button
                          onClick={() => navigate(`/tournament/${tournamentId}/duel/${match.match_id}`)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '5px 12px', border: '1px solid var(--gold)',
                            borderRadius: 4, background: 'color-mix(in srgb, var(--gold) 8%, var(--paper))',
                            color: 'var(--gold)', fontFamily: 'var(--sans)', fontSize: 12, cursor: 'pointer',
                          }}
                        >
                          <ChevronRight size={11} />
                          <span className="ar">شاهد</span>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Player presence */}
            {(() => {
              const connected = Object.values(waitingPresence).filter(p => p.connected).length
              const expected  = tournament.actual_top_cut || 0
              if (!connected) return null
              return (
                <div style={{
                  borderTop: '1px solid var(--rule)', padding: '8px 16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  background: 'var(--paper-2)',
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
                  <span className="ar folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>
                    {connected} {expected ? `/ ${expected}` : ''} لاعب في غرفة الانتظار
                  </span>
                </div>
              )
            })()}

            {/* Advance to next round */}
            {allRoundDone && currentRound < totalRounds && !showCountdown && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--rule)' }}>
                <button
                  onClick={() => {
                    autoAdvancedRef.current = currentRound
                    setCountdownLabel(`استراحة قبل الجولة ${currentRound + 1}`)
                    setCountdownMs(tournament.round_break_time || 30000)
                    setShowCountdown(true)
                  }}
                  style={{
                    width: '100%', padding: '12px 0',
                    background: 'var(--ink)', color: 'var(--paper)',
                    border: '1px solid var(--ink)', borderRadius: 4,
                    fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 14,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    transition: 'all 150ms',
                  }}
                >
                  <ChevronRight size={16} />
                  <span className="ar">انتقل للجولة {currentRound + 1}</span>
                </button>
              </div>
            )}

            {/* Final winner display */}
            {allRoundDone && currentRound === totalRounds && (() => {
              const finalMatch = matches.find(m => m.round === totalRounds && m.status === 'finished')
              const winnerName = finalMatch
                ? (finalMatch.winner_uid === finalMatch.player_a_uid
                    ? finalMatch.player_a_name : finalMatch.player_b_name)
                : 'البطل'
              return (
                <div style={{
                  borderTop: '1px solid var(--rule)', padding: '28px 16px',
                  textAlign: 'center', background: 'color-mix(in srgb, var(--gold) 5%, var(--paper))',
                }}>
                  <Trophy size={36} style={{ color: 'var(--gold)', margin: '0 auto 12px' }} />
                  <p className="ar" style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 500, color: 'var(--gold)', margin: '0 0 4px' }}>
                    {winnerName}
                  </p>
                  <p className="ar folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>
                    {tournament.status === 'finished' ? 'انتهت البطولة' : 'جاري إنهاء البطولة…'}
                  </p>
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
