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
  // Round question assignment panel
  const [showQPanel,      setShowQPanel]      = useState(false)
  // End tournament confirmation
  const [showEndConfirm,  setShowEndConfirm]  = useState(false)
  const [ending,          setEnding]          = useState(false)
  // Live scores for active bracket duels: { [duelId]: { [uid]: { score, nickname } } }
  const [liveDuels,       setLiveDuels]       = useState({})

  // Subscribe to tournament
  useEffect(() => {
    if (!tournamentId) return
    const unsub = onSnapshot(doc(db, 'tournaments', tournamentId), snap => {
      if (snap.exists()) setTournament({ id: snap.id, ...snap.data() })
    })
    return () => unsub()
  }, [tournamentId])

  // Subscribe to bracket matches
  useEffect(() => {
    if (!tournamentId) return
    const unsub = onSnapshot(
      collection(db, 'tournaments', tournamentId, 'bracket_matches'),
      snap => setMatches(snap.docs.map(d => ({ match_id: d.id, ...d.data() })))
    )
    return () => unsub()
  }, [tournamentId])

  // Fetch FFA results once
  useEffect(() => {
    if (!tournamentId) return
    getDocs(collection(db, 'tournaments', tournamentId, 'ffa_results'))
      .then(snap => setFfaResults(sortPlayers(snap.docs.map(d => ({ uid: d.id, ...d.data() })))))
      .catch(console.error)
  }, [tournamentId])

  // Fetch deck questions
  useEffect(() => {
    if (!tournament?.deck_id) return
    getDoc(doc(db, 'question_sets', tournament.deck_id))
      .then(d => setDeckQs(d.data()?.questions?.questions || []))
      .catch(console.error)
  }, [tournament?.deck_id])

  // Subscribe to live player scores for active matches in current round
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

  // Generate bracket when we have FFA results and no matches yet
  useEffect(() => {
    if (!tournament || matches.length > 0 || ffaResults.length < 2 || generating) return
    if (tournament.status !== 'bracket') return
    generateBracket()
  }, [tournament, matches.length, ffaResults.length])

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

  const handleCountdownComplete = useCallback(() => {
    setShowCountdown(false)
  }, [])

  // Export bracket as image
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

  // Launch a specific match duel
  const launchMatch = useCallback(async (match) => {
    if (!match || match.status !== 'pending') return
    if (!match.player_a_uid || !match.player_b_uid) return setError('لاعب غير محدد في هذه المباراة')

    try {
      const questions = getQuestionsForRound(
        match.round, tournament, deckQs, 5
      )
      if (questions.length === 0) throw new Error('لا توجد أسئلة لهذه الجولة')

      // Reserve tiebreaker questions: up to 3 extra questions not used in main set.
      // These are appended on-the-fly by DuelGame if a tie occurs at the end.
      const usedTexts = new Set(questions.map(q => q?.question).filter(Boolean))
      const tiebreakerQuestions = (deckQs || [])
        .filter(q => q && !usedTexts.has(q.question))
        .sort(() => Math.random() - 0.5)
        .slice(0, 3)

      // Create duel in RTDB under tournament_duels/
      const newDuelRef = push(rtdbRef(rtdb, `tournament_duels/${tournamentId}`))
      const duelId = newDuelRef.key

      await set(newDuelRef, {
        tournament_id:        tournamentId,
        match_id:             match.match_id,
        round:                match.round,
        question_duration_ms: tournament.duel_question_duration || 30000,
        creator_uid:          match.player_a_uid,
        deck_id:              tournament.deck_id,
        deck_title:           tournament.deck_title,
        questions,
        total_questions:      questions.length,
        // Tiebreaker reserve — used by DuelGame when equal non-zero scores at end
        tiebreaker_questions: tiebreakerQuestions,
        tiebreaker_used:      0,
        is_tiebreaker:        false,
        config:               { questionCount: questions.length, shuffleQuestions: false, shuffleAnswers: false },
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

      // Update match status in Firestore
      await updateDoc(
        doc(db, 'tournaments', tournamentId, 'bracket_matches', match.match_id),
        { duel_id: duelId, status: 'active' }
      )
    } catch (e) {
      console.error(e)
      setError(e.message || 'فشل إطلاق المباراة')
    }
  }, [tournament, deckQs, tournamentId, ffaResults])

  // End tournament manually
  const endTournament = useCallback(async () => {
    if (ending) return
    setEnding(true)
    setError(null)
    try {
      // Compute totalRounds inline to avoid TDZ (it's declared later in render)
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

  // Save round question assignment
  const saveAssignment = useCallback(async (newAssignments) => {
    try {
      await updateDoc(doc(db, 'tournaments', tournamentId), { round_questions: newAssignments })
    } catch (e) { console.error(e) }
    setShowQPanel(false)
  }, [tournamentId])

  if (!tournament) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={32} className="text-primary animate-spin" />
      </div>
    )
  }

  const totalRounds = tournament.total_rounds || Math.log2(tournament.actual_top_cut || 8)
  const currentRound = tournament.current_round || 1
  const roundMatches = matches.filter(m => m.round === currentRound)
  const pendingMatches = roundMatches.filter(m => m.status === 'pending')
  const allRoundDone = roundMatches.length > 0 && roundMatches.every(m => m.status === 'finished')

  return (
    <div className="min-h-screen bg-background text-white" dir="rtl">
      {/* Phase-transition countdown overlay */}
      {showCountdown && (
        <TournamentCountdown
          durationMs={countdownMs}
          label={countdownLabel}
          onComplete={handleCountdownComplete}
        />
      )}

      {/* Round question assignment full-screen panel */}
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

      <div className="p-4 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 mt-4">
          <div className="flex items-center gap-3">
            <Trophy size={22} className="text-primary" />
            <h1 className="ar text-xl font-bold">{tournament.title}</h1>
            <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full font-semibold">
              الجولة {currentRound} / {totalRounds}
            </span>
          </div>
          <button
            onClick={exportImage}
            disabled={exporting || matches.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:border-primary/50 transition-all text-sm disabled:opacity-40"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            <span className="ar">تصدير صورة</span>
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4 text-center">
            <p className="ar text-red-400 text-sm">{error}</p>
            <button onClick={() => setError(null)} className="ar text-xs text-red-500 mt-1">إغلاق</button>
          </div>
        )}

        {/* Bracket tree */}
        {generating ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 size={40} className="text-primary animate-spin" />
            <p className="ar text-gray-400">جاري توليد الـ Bracket…</p>
          </div>
        ) : matches.length > 0 ? (
          <div className="overflow-x-auto mb-6">
            <BracketTree
              matches={matches}
              totalRounds={totalRounds}
              bracketRef={bracketRef}
              tournamentTitle={tournament.title}
            />
          </div>
        ) : (
          <div className="text-center py-12 text-gray-600 ar">
            جاري تحميل نتائج FFA لتوليد الـ Bracket…
          </div>
        )}

        {/* Round Question Management */}
        {tournament.status === 'bracket' && totalRounds > 0 && (
          <button
            onClick={() => setShowQPanel(true)}
            className="w-full flex items-center justify-between bg-gray-900 border border-gray-800 hover:border-primary/50 rounded-2xl px-5 py-4 mb-4 transition-all group"
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
        )}

        {/* ── End Tournament ────────────────────────────────────────────── */}
        {tournament.status !== 'finished' && (
          <div className="mt-4 mb-2">
            {!showEndConfirm ? (
              <button
                onClick={() => setShowEndConfirm(true)}
                className="w-full py-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-bold ar flex items-center justify-center gap-2 hover:bg-red-500/20 transition-colors"
              >
                <Flag size={15} />
                إنهاء البطولة يدوياً
              </button>
            ) : (
              <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="ar text-sm text-red-300 leading-relaxed">
                    هتنهي البطولة الآن وتحولها لـ "منتهية". اللاعبون لن يتمكنوا من الاستمرار. هل أنت متأكد؟
                  </p>
                </div>
                {error && (
                  <p className="ar text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
                    ⚠ {error}
                  </p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowEndConfirm(false); setError(null) }}
                    disabled={ending}
                    className="flex-1 py-2.5 rounded-xl bg-gray-800 text-gray-300 text-sm ar font-bold hover:bg-gray-700 transition-colors disabled:opacity-40"
                  >
                    تراجع
                  </button>
                  <button
                    onClick={endTournament}
                    disabled={ending}
                    className="flex-1 py-2.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 text-sm ar font-bold hover:bg-red-500/30 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {ending
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Flag size={14} />
                    }
                    نعم، أنهِ البطولة
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Round controls */}
        {tournament.status === 'bracket' && matches.length > 0 && (
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-4">
            <h2 className="ar font-bold text-white">مباريات {getRoundName(currentRound, totalRounds)}</h2>

            <div className="space-y-2">
              {roundMatches.map(match => {
                const live = match.duel_id ? (liveDuels[match.duel_id] || {}) : {}
                const liveA = live[match.player_a_uid]
                const liveB = live[match.player_b_uid]
                const hasLive = match.status === 'active' && (liveA || liveB)

                return (
                  <div key={match.match_id} className="bg-gray-800 rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      {/* Player names + live scores */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white text-sm truncate">{match.player_a_name || 'TBD'}</span>
                          {hasLive && (
                            <span className="font-mono text-xs font-black text-primary bg-primary/10 border border-primary/30 px-1.5 py-0.5 rounded-lg tabular-nums">
                              {liveA?.score ?? 0}
                            </span>
                          )}
                          <span className="text-gray-600 text-xs">vs</span>
                          {hasLive && (
                            <span className="font-mono text-xs font-black text-primary bg-primary/10 border border-primary/30 px-1.5 py-0.5 rounded-lg tabular-nums">
                              {liveB?.score ?? 0}
                            </span>
                          )}
                          <span className="font-semibold text-white text-sm truncate">{match.player_b_name || 'TBD'}</span>
                        </div>
                      </div>

                      <StatusBadge status={match.status} winnerName={
                        match.winner_uid === match.player_a_uid ? match.player_a_name : match.player_b_name
                      } />

                      {match.status === 'pending' && match.player_a_uid && match.player_b_uid && (
                        <button
                          onClick={() => launchMatch(match)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/20 text-primary border border-primary/40 text-xs font-bold hover:bg-primary/30 transition-colors ar"
                        >
                          <Play size={12} /> ابدأ
                        </button>
                      )}
                      {match.status === 'active' && match.duel_id && (
                        <button
                          onClick={() => navigate(`/tournament/${tournamentId}/duel/${match.match_id}`)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 text-xs font-bold ar"
                        >
                          <ChevronRight size={12} /> شاهد
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Advance to next round */}
            {allRoundDone && currentRound < totalRounds && (
              <button
                onClick={async () => {
                  setCountdownLabel(`استراحة قبل الجولة ${currentRound + 1}`)
                  setCountdownMs(tournament.round_break_time || 30000)
                  setShowCountdown(true)
                  await updateDoc(doc(db, 'tournaments', tournamentId), {
                    current_round: currentRound + 1,
                  })
                }}
                className="w-full py-3 rounded-xl bg-primary text-background font-black ar flex items-center justify-center gap-2 hover:bg-[#00D4FF] active:scale-95 transition-all"
              >
                <ChevronRight size={18} />
                انتقل للجولة {currentRound + 1}
              </button>
            )}

            {allRoundDone && currentRound === totalRounds && (() => {
              const finalMatch = matches.find(m => m.round === totalRounds && m.status === 'finished')
              const winnerName = finalMatch
                ? (finalMatch.winner_uid === finalMatch.player_a_uid
                    ? finalMatch.player_a_name
                    : finalMatch.player_b_name)
                : 'البطل'
              return (
                <div className="text-center py-4">
                  <Trophy size={40} className="text-yellow-400 mx-auto mb-2" />
                  <p className="ar text-xl font-black text-yellow-400">🏆 {winnerName}</p>
                  <p className="ar text-gray-400 text-sm mt-1">انتهت البطولة!</p>
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status, winnerName }) {
  if (status === 'finished') return (
    <span className="ar text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
      ✓ {winnerName} فاز
    </span>
  )
  if (status === 'active') return (
    <span className="ar text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full animate-pulse">
      🔴 جارية
    </span>
  )
  return (
    <span className="ar text-xs bg-gray-700 text-gray-500 px-2 py-0.5 rounded-full">
      انتظار
    </span>
  )
}
