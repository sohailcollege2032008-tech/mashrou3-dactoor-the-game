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
  doc, onSnapshot, updateDoc, getDoc,
  collection, writeBatch
} from 'firebase/firestore'
import { ref as rtdbRef, onValue, update, set, remove, runTransaction } from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import {
  generateBracketMatches, getQuestionsForRound
} from '../../utils/tournamentUtils'
import { splitAnswerKey } from '../../utils/duelUtils'
import BracketTree from '../../components/tournament/BracketTree'
import TournamentCountdown from '../../components/tournament/TournamentCountdown'
import { soundManager } from '../../utils/soundManager'
import SoundToggle from '../../components/common/SoundToggle'
import { Trophy, Download, Play, Loader2, ChevronRight, Settings, Flag, AlertTriangle } from 'lucide-react'
import html2canvas from 'html2canvas'
import QuestionAssignmentPanel from '../../components/tournament/QuestionAssignmentPanel'
import BracketBoard from '../../components/tournament/BracketBoard'
import useIsNarrow from '../../hooks/useIsNarrow'

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
  const bracketRef = useRef(null)
  const narrow     = useIsNarrow()

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
  const [announceText, setAnnounceText] = useState('')
  const [announcing,   setAnnouncing]   = useState(false)
  const [showQPanel,      setShowQPanel]      = useState(false)
  const [showEndConfirm,  setShowEndConfirm]  = useState(false)
  const [ending,          setEnding]          = useState(false)
  const [confirmForce,    setConfirmForce]    = useState(null)
  const [forcing,         setForcing]         = useState(false)
  const [liveDuels,       setLiveDuels]       = useState({})
  const [waitingPresence, setWaitingPresence] = useState({})
  const [nowTick,         setNowTick]         = useState(() => Date.now())

  // Drives the phase countdown label; without it the number freezes between
  // Firestore snapshots.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  const autoLaunchedRef   = useRef(new Set())
  const autoFinishedRef   = useRef(false)
  const autoTransitionRef = useRef(null)

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

  // Live, not one-shot: a getDocs() here used to run before the FFA results were
  // written, leaving ffaResults empty forever — which silently blocked bracket
  // generation even with this page open.
  useEffect(() => {
    if (!tournamentId) return
    const unsub = onSnapshot(
      collection(db, 'tournaments', tournamentId, 'ffa_results'),
      snap => setFfaResults(
        snap.docs
          .map(d => ({ uid: d.id, ...d.data() }))
          .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
      ),
      console.error
    )
    return () => unsub()
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
      onValue(rtdbRef(rtdb, `tournament_duels/${tournamentId}/${m.duel_id}`), snap => {
        const d = snap.val()
        setLiveDuels(prev => ({
          ...prev,
          [m.duel_id]: {
            players: d?.players || {},
            status:  d?.status  || null,
            qi:      d?.current_question_index ?? 0,
            total:   d?.total_questions ?? 0,
          },
        }))
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

  // ── Phase clock ────────────────────────────────────────────────────────────
  // Host and server must agree on when a round starts, otherwise this tab can
  // launch a round the instant the previous one ends while players are still
  // watching a break countdown. Both read the same value: launch_after on the
  // match, or phase_started_at + the configured wait for its round.
  const launchDueAt = useCallback((match) => {
    if (!tournament) return 0
    if (match?.launch_after) return match.launch_after
    const start = tournament.phase_started_at || 0
    if (!start) return 0
    const rnd   = match?.round || 1
    const total = tournament.total_rounds || 0
    const wait  = rnd === 1
      ? (tournament.phase_transition_wait || 0)
      : (total && rnd === total)
        ? (tournament.final_break_time || tournament.round_break_time || 0)
        : (tournament.round_break_time || 0)
    return start + wait
  }, [tournament])

  const currentRoundNo = tournament?.current_round || 1
  const phaseRemainingMs = (() => {
    if (!tournament || tournament.status !== 'bracket') return 0
    const start = tournament.phase_started_at || 0
    if (!start) return 0
    const total = tournament.total_rounds || 0
    const wait  = currentRoundNo === 1
      ? (tournament.phase_transition_wait || 0)
      : (total && currentRoundNo === total)
        ? (tournament.final_break_time || tournament.round_break_time || 0)
        : (tournament.round_break_time || 0)
    return Math.max(0, start + wait - nowTick)
  })()

  useEffect(() => {
    if (!launchablePendingKey || !tournament || tournament.status !== 'bracket') return
    const toAutoLaunch = matches.filter(m =>
      m.status === 'pending' &&
      m.player_a_uid &&
      m.player_b_uid &&
      m.round === currentRoundNo &&
      !autoLaunchedRef.current.has(m.match_id)
    )
    if (!toAutoLaunch.length) return

    const timers = toAutoLaunch.map(m => {
      const delay = Math.max(1500, launchDueAt(m) - Date.now() + 500)
      return setTimeout(() => {
        autoLaunchedRef.current.add(m.match_id)
        launchMatch(m)
      }, delay)
    })
    return () => timers.forEach(clearTimeout)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchablePendingKey, tournament?.status, currentRoundNo, tournament?.phase_started_at])

  // ── Phase countdown overlay (same clock the players see) ───────────────────
  useEffect(() => {
    if (!tournament || tournament.status !== 'bracket') return
    if (phaseRemainingMs <= 0) return
    const key = `r${currentRoundNo}`
    if (autoTransitionRef.current === key) return
    autoTransitionRef.current = key
    setCountdownLabel(currentRoundNo === 1
      ? 'الانتقال لمرحلة الـ Bracket'
      : `استراحة قبل الجولة ${currentRoundNo}`)
    setCountdownMs(phaseRemainingMs)
    setShowCountdown(true)
  }, [tournament?.status, currentRoundNo, phaseRemainingMs])

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

  const prevRoundRef = useRef(tournament?.current_round)
  useEffect(() => {
    if (tournament?.current_round && prevRoundRef.current && tournament.current_round > prevRoundRef.current) {
      soundManager.playStageStart()
    }
    prevRoundRef.current = tournament?.current_round
  }, [tournament?.current_round])

  const generateBracket = useCallback(async () => {
    if (generating || ffaResults.length < 2) return
    setGenerating(true)
    try {
      const topN     = tournament.actual_top_cut || 0
      const ranked   = [...ffaResults].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
      let advanced   = ranked.filter(p => p.advanced)
      if (advanced.length === 0) advanced = ranked.slice(0, topN || ranked.length)
      if (topN) advanced = advanced.slice(0, topN)

      // A bracket needs a power-of-two field — trim to the largest that fits.
      let size = 1
      while (size * 2 <= advanced.length) size *= 2
      if (size < 2) throw new Error('عدد المتأهلين غير كافٍ لتوليد الـ Bracket')
      advanced = advanced.slice(0, size)

      const newMatches = generateBracketMatches(advanced)

      // Pin each round-1 match's start time so the server launcher and this tab
      // agree on it (see launchDueAt).
      const phaseStart     = tournament.phase_started_at || Date.now()
      const roundOneLaunch = phaseStart + (tournament.phase_transition_wait || 0)

      const batch = writeBatch(db)
      newMatches.forEach(m => {
        const ref = doc(db, 'tournaments', tournamentId, 'bracket_matches', m.match_id)
        batch.set(ref, m.round === 1 ? { ...m, launch_after: roundOneLaunch } : m)
      })

      // Keep the tournament doc consistent with the bracket we actually built.
      const rounds = Math.log2(size)
      const patch  = {}
      if (tournament.actual_top_cut !== size)  patch.actual_top_cut = size
      if (tournament.total_rounds   !== rounds) patch.total_rounds  = rounds
      if (!tournament.current_round)           patch.current_round  = 1
      if (!tournament.phase_started_at)        patch.phase_started_at = phaseStart
      if (Object.keys(patch).length > 0) {
        batch.update(doc(db, 'tournaments', tournamentId), patch)
      }

      await batch.commit()
    } catch (e) {
      console.error(e)
      setError(e.message || 'فشل توليد الـ Bracket')
    } finally {
      setGenerating(false)
    }
  }, [generating, ffaResults, tournament, tournamentId])

  // Manual override — the server advances rounds on its own, this is the host's
  // "skip the break, go now" button. Seeds winners, opens the round and clears
  // the wait so the next matches launch immediately.
  const doAdvanceRound = useCallback(async (currentRnd, roundMatchList) => {
    const now   = Date.now()
    const batch = writeBatch(db)
    for (const m of roundMatchList) {
      if (m.status !== 'finished' || !m.winner_uid || !m.next_match_id) continue
      const winnerName = m.winner_uid === m.player_a_uid
        ? m.player_a_name : m.player_b_name
      const nextRef = doc(db, 'tournaments', tournamentId, 'bracket_matches', m.next_match_id)
      const isOdd = m.match_number % 2 === 1
      batch.update(nextRef, isOdd
        ? { player_a_uid: m.winner_uid, player_a_name: winnerName, launch_after: now }
        : { player_b_uid: m.winner_uid, player_b_name: winnerName, launch_after: now }
      )
    }
    batch.update(doc(db, 'tournaments', tournamentId), {
      current_round:    currentRnd + 1,
      phase_started_at: now,
    })
    await batch.commit()
  }, [tournamentId])

  const handleCountdownComplete = useCallback(() => setShowCountdown(false), [])

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

    // The duel key is the match_id, not a push() id. That makes creation
    // idempotent: this tab and the Cloud Function can both try to launch the
    // same match and exactly one write lands.
    const duelId  = match.match_id
    const duelRef = rtdbRef(rtdb, `tournament_duels/${tournamentId}/${duelId}`)

    try {
      const deckSnap    = await getDoc(doc(db, 'question_sets', tournament.deck_id))
      const deckData    = deckSnap.data() || {}
      const freshDeckQs = deckData.questions?.questions || []
      if (freshDeckQs.length === 0) throw new Error('لا توجد أسئلة في الـ Deck')

      const questions = getQuestionsForRound(match.round, tournament, freshDeckQs, 5)
      if (questions.length === 0) throw new Error('لا توجد أسئلة لهذه الجولة')

      const usedTexts = new Set(questions.map(q => q?.question).filter(Boolean))
      const unusedQs  = freshDeckQs.filter(q => q && !usedTexts.has(q.question))
        .sort(() => Math.random() - 0.5)
      const tiebreakerQuestions = unusedQs.length > 0
        ? unusedQs.slice(0, 3)
        : [...freshDeckQs].sort(() => Math.random() - 0.5).slice(0, 3)

      // Split main + reserve in one pass: a tiebreaker is appended to `questions`
      // at index questions.length + n, which is exactly where its key sits in
      // the reserve list. The answers themselves never enter the duel node —
      // they go to `duel_keys`, which no client can read, so only the Cloud
      // Functions can decide whether an answer is right.
      const { safe: allSafe, key: allKey } = splitAnswerKey([...questions, ...tiebreakerQuestions])
      const safeQuestions   = allSafe.slice(0, questions.length)
      const safeTiebreakers = allSafe.slice(questions.length)
      const mainKey         = allKey.slice(0, questions.length)
      const tbKey           = allKey.slice(questions.length)

      const payload = {
        tournament_id:        tournamentId,
        match_id:             match.match_id,
        round:                match.round,
        question_duration_ms: tournament.duel_question_duration || 30000,
        creator_uid:          match.player_a_uid,
        host_uid:             tournament.host_id ?? null,   // RTDB rejects undefined; the rules need this to let the host write
        deck_id:              tournament.deck_id,
        deck_title:           tournament.deck_title,
        questions:            safeQuestions,
        total_questions:      safeQuestions.length,
        tiebreaker_questions: safeTiebreakers,
        tiebreaker_used:      0,
        is_tiebreaker:        false,
        config:               { questionCount: safeQuestions.length, shuffleQuestions: false, shuffleAnswers: false },
        force_rtl:            deckData.force_rtl || false,
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
        created_at: Date.now(),
      }

      const created = await runTransaction(duelRef, current => (current === null ? payload : undefined))

      // Only the launcher that actually created the node writes the key: the
      // Cloud Function shuffles its own reserve questions, so a key from the
      // launcher that lost the race would not match the questions in the node.
      if (created.committed) {
        await set(rtdbRef(rtdb, `duel_keys/${tournamentId}/${duelId}`), {
          main: mainKey, tb: tbKey, at: Date.now(),
        })
      }

      await updateDoc(
        doc(db, 'tournaments', tournamentId, 'bracket_matches', match.match_id),
        { duel_id: duelId, status: 'active' }
      )
    } catch (e) {
      console.error(e)
      setError(e.message || 'فشل إطلاق المباراة')
    }
  }, [tournament, tournamentId, ffaResults])

  // Rescue a duel that nobody opened: it stays 'waiting' until a player's tab
  // starts it, so a match with two absent players would sit frozen while the
  // bracket showed it as LIVE.
  const forceStartMatch = useCallback(async (match) => {
    if (!match?.duel_id) return
    try {
      await update(rtdbRef(rtdb, `tournament_duels/${tournamentId}/${match.duel_id}`), {
        status: 'playing',
        question_started_at: Date.now(),
      })
    } catch (e) {
      console.error(e)
      setError(e.message || 'فشل بدء المباراة')
    }
  }, [tournamentId])

  const doForceFinish = useCallback(async (match, winningPlayerUid) => {
    if (!match || !tournamentId || forcing) return
    setForcing(true)
    const winnerUid = winningPlayerUid || match.player_a_uid
    const winnerName = winnerUid === match.player_a_uid ? match.player_a_name : match.player_b_name

    try {
      const batch = writeBatch(db)

      const matchRef = doc(db, 'tournaments', tournamentId, 'bracket_matches', match.match_id)
      batch.update(matchRef, {
        status: 'finished',
        winner_uid: winnerUid,
        player_a_score: winnerUid === match.player_a_uid ? 1 : 0,
        player_b_score: winnerUid === match.player_b_uid ? 1 : 0,
        finished_at: Date.now(),
        forced_by_host: true,
      })

      if (match.next_match_id) {
        const nextRef = doc(db, 'tournaments', tournamentId, 'bracket_matches', match.next_match_id)
        const isOdd = match.match_number % 2 === 1
        batch.update(nextRef, isOdd
          ? { player_a_uid: winnerUid, player_a_name: winnerName }
          : { player_b_uid: winnerUid, player_b_name: winnerName }
        )
      }

      await batch.commit()

      if (match.duel_id) {
        await update(rtdbRef(rtdb, `tournament_duels/${tournamentId}/${match.duel_id}`), {
          status: 'finished',
          forfeit_by: winnerUid === match.player_a_uid ? match.player_b_uid : match.player_a_uid,
        })
      }
    } catch (e) {
      console.error(e)
      setError(e.message || 'فشل حسم المباراة')
    } finally {
      setForcing(false)
      setConfirmForce(null)
    }
  }, [tournamentId, forcing])

  // Cut the break short and start the current round's matches right now.
  // The break was a fixed number chosen at creation time. In a live room the
  // host is the only one who can see that people are not ready yet, so give
  // them the other direction too — and move BOTH clocks, or the host's
  // countdown and the launcher would disagree about when the round starts.
  const extendBreak = useCallback(async (deltaMs) => {
    if (!tournament || tournament.status !== 'bracket') return
    const round   = tournament.current_round || 1
    const pending = matches.filter(m =>
      m.round === round && m.status === 'pending' && m.player_a_uid && m.player_b_uid
    )
    try {
      const batch = writeBatch(db)
      pending.forEach(m => batch.update(
        doc(db, 'tournaments', tournamentId, 'bracket_matches', m.match_id),
        { launch_after: Math.max(launchDueAt(m), Date.now()) + deltaMs }
      ))
      if (tournament.phase_started_at) {
        batch.update(doc(db, 'tournaments', tournamentId),
          { phase_started_at: tournament.phase_started_at + deltaMs })
      }
      await batch.commit()
      setShowCountdown(false)
    } catch (e) {
      console.error(e)
      setError(e.message || 'فشل تمديد الاستراحة')
    }
  }, [tournament, matches, tournamentId, launchDueAt])

  // One line from the host to everyone watching the live tree. Written to the
  // spectator mirror (the only node players are subscribed to), where the rule
  // lets the tournament's own host — and nobody else — write it.
  const postAnnouncement = useCallback(async (text) => {
    if (announcing) return
    setAnnouncing(true)
    const path = `bracket_live/${tournamentId}/meta/announcement`
    try {
      if (text) await update(rtdbRef(rtdb, path), { text: text.slice(0, 200), at: Date.now() })
      else      await remove(rtdbRef(rtdb, path))
      setAnnounceText('')
    } catch (e) {
      console.error(e)
      setError(e.message || 'فشل إرسال الإعلان')
    } finally {
      setAnnouncing(false)
    }
  }, [announcing, tournamentId])

  const startRoundNow = useCallback(async () => {
    const now     = Date.now()
    const pending = matches.filter(m =>
      m.round === (tournament?.current_round || 1) &&
      m.status === 'pending' && m.player_a_uid && m.player_b_uid
    )
    if (!pending.length) return
    try {
      const batch = writeBatch(db)
      pending.forEach(m => batch.update(
        doc(db, 'tournaments', tournamentId, 'bracket_matches', m.match_id),
        { launch_after: now }
      ))
      // phase_started_at: 0 clears the countdown for the players too.
      batch.update(doc(db, 'tournaments', tournamentId), { phase_started_at: 0 })
      await batch.commit()
      setShowCountdown(false)
      pending.forEach(m => {
        autoLaunchedRef.current.add(m.match_id)
        launchMatch(m)
      })
    } catch (e) {
      console.error(e)
      setError(e.message || 'فشل بدء الجولة')
    }
  }, [matches, tournament?.current_round, tournamentId, launchMatch])

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
          topCut={tournament.actual_top_cut || 8}
          editableTopCut={false}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SoundToggle showPreviewBtn={true} />
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

        {/* Announcement — the host's only channel to everyone at once. Lands on
            the live tree, which is where players sit during a break. */}
        <div style={{
          marginTop: 16, border: '1px solid var(--rule)', padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <span className="folio" style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--ink-4)' }}>
              إعلان للاعبين
            </span>
            <button
              onClick={() => postAnnouncement('')}
              disabled={announcing}
              style={{
                background: 'none', border: 'none', cursor: announcing ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--ink-4)', letterSpacing: '0.06em',
              }}
            >
              CLEAR
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={announceText}
              onChange={e => setAnnounceText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && announceText.trim()) postAnnouncement(announceText.trim()) }}
              maxLength={200}
              placeholder="مثال: استراحة ٥ دقايق — استنونا"
              className="ar"
              style={{
                flex: 1, fontFamily: 'var(--arabic)', fontSize: 13, padding: '8px 12px',
                background: 'var(--paper-2)', border: '1px solid var(--rule)',
                borderRadius: 0, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box',
              }}
            />
            <button
              onClick={() => announceText.trim() && postAnnouncement(announceText.trim())}
              disabled={announcing || !announceText.trim()}
              style={{
                padding: '8px 16px', border: '1px solid var(--ink)', borderRadius: 0,
                background: announceText.trim() ? 'var(--ink)' : 'transparent',
                color: announceText.trim() ? 'var(--paper)' : 'var(--ink-4)',
                fontFamily: 'var(--sans)', fontSize: 13,
                cursor: announcing || !announceText.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              <span className="ar">إرسال</span>
            </button>
          </div>
        </div>

        {/* Bracket tree */}
        <div style={{ marginTop: 24, marginBottom: 24 }}>
          {generating ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', gap: 16 }}>
              <Loader2 size={32} className="animate-spin" style={{ color: 'var(--ink-3)' }} />
              <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 14, color: 'var(--ink-3)' }}>جاري توليد الـ Bracket…</p>
            </div>
          ) : matches.length > 0 ? (
            <>
              {/* On a phone the column tree is a sideways scroller, so the host
                  reads the same round-by-round board the players get. The tree
                  itself stays mounted either way — it is the element the image
                  export renders, so it is parked off-screen rather than
                  unmounted (display:none would give html2canvas nothing). */}
              {narrow && (
                <div style={{
                  marginBottom: 20, padding: 12,
                  background: '#14120E', border: '1px solid #3A362C',
                }}>
                  <BracketBoard
                    matches={matches}
                    totalRounds={totalRounds}
                    currentRound={tournament.current_round || null}
                    tone="dark"
                  />
                </div>
              )}
              {/* A 32-player tree is ~2000px tall, and an absolutely positioned
                  element still extends the document's scrollable area — which
                  gave the phone a page that scrolled far past its own content.
                  A zero-height clipping parent takes it out of the scroll while
                  leaving the tree its natural size for the export to render. */}
              <div style={narrow
                ? { position: 'relative', height: 0, overflow: 'hidden' }
                : undefined}
                aria-hidden={narrow ? 'true' : undefined}
              >
                <div style={narrow
                  ? { position: 'absolute', top: 0, left: 0, width: 'max-content', pointerEvents: 'none' }
                  : { overflowX: 'auto' }}
                >
                  <BracketTree
                    matches={matches}
                    totalRounds={totalRounds}
                    bracketRef={bracketRef}
                    tournamentTitle={tournament.title}
                  />
                </div>
              </div>
            </>
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

            {/* Break in progress — matches start on their own, this skips ahead */}
            {phaseRemainingMs > 0 && roundMatches.some(m => m.status === 'pending') && (
              <div style={{
                padding: '10px 16px', borderBottom: '1px solid var(--rule)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                background: 'color-mix(in srgb, var(--gold) 6%, var(--paper))',
              }}>
                <span className="ar folio" style={{ color: 'var(--gold)', fontSize: 9 }}>
                  تبدأ خلال {Math.ceil(phaseRemainingMs / 1000)}ث
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() => extendBreak(30_000)}
                    title="زوّد الاستراحة 30 ثانية"
                    style={{
                      padding: '6px 10px', border: '1px solid var(--rule)', borderRadius: 4,
                      background: 'transparent', color: 'var(--ink-3)',
                      fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    +30ث
                  </button>
                  <button
                    onClick={() => extendBreak(60_000)}
                    title="زوّد الاستراحة دقيقة"
                    style={{
                      padding: '6px 10px', border: '1px solid var(--rule)', borderRadius: 4,
                      background: 'transparent', color: 'var(--ink-3)',
                      fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    +1د
                  </button>
                  <button
                    onClick={startRoundNow}
                    style={{
                      padding: '6px 14px', border: '1px solid var(--gold)', borderRadius: 4,
                      background: 'transparent', color: 'var(--gold)',
                      fontFamily: 'var(--sans)', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    <span className="ar">ابدأ الجولة الآن</span>
                  </button>
                </div>
              </div>
            )}

            {/* Match list */}
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {roundMatches.map(match => {
                const live = match.duel_id ? (liveDuels[match.duel_id] || {}) : {}
                const liveA = live.players?.[match.player_a_uid]
                const liveB = live.players?.[match.player_b_uid]
                const hasLive = match.status === 'active' && (liveA || liveB)
                const isIdle  = match.status === 'active' && live.status === 'waiting'

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
                      {isIdle && (
                        <button
                          onClick={() => forceStartMatch(match)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '5px 12px', border: '1px solid var(--alert)',
                            borderRadius: 4, background: 'color-mix(in srgb, var(--alert) 8%, var(--paper))',
                            color: 'var(--alert)', fontFamily: 'var(--sans)', fontSize: 12, cursor: 'pointer',
                          }}
                        >
                          <Play size={11} />
                          <span className="ar">بدء إجباري</span>
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
                      {(match.status === 'active' || match.status === 'pending') && match.player_a_uid && match.player_b_uid && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button
                            onClick={() => setConfirmForce({ match, winnerUid: match.player_a_uid, winnerName: match.player_a_name })}
                            title={`حسم وتأهيل ${match.player_a_name}`}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 3,
                              padding: '5px 8px', border: '1px solid var(--success)',
                              borderRadius: 4, background: 'color-mix(in srgb, var(--success) 10%, var(--paper))',
                              color: 'var(--success)', fontFamily: 'var(--sans)', fontSize: 11, cursor: 'pointer',
                            }}
                          >
                            <span className="ar">⚡ حسم لـ {match.player_a_name ? match.player_a_name.split(' ')[0] : 'أ'}</span>
                          </button>
                          <button
                            onClick={() => setConfirmForce({ match, winnerUid: match.player_b_uid, winnerName: match.player_b_name })}
                            title={`حسم وتأهيل ${match.player_b_name}`}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 3,
                              padding: '5px 8px', border: '1px solid var(--success)',
                              borderRadius: 4, background: 'color-mix(in srgb, var(--success) 10%, var(--paper))',
                              color: 'var(--success)', fontFamily: 'var(--sans)', fontSize: 11, cursor: 'pointer',
                            }}
                          >
                            <span className="ar">⚡ حسم لـ {match.player_b_name ? match.player_b_name.split(' ')[0] : 'ب'}</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Force-finish confirm (two-step, same pattern as end-tournament) */}
                    {confirmForce?.match?.match_id === match.match_id && (
                      <div style={{
                        borderTop: '1px solid var(--rule)', padding: '14px 16px',
                        background: 'color-mix(in srgb, var(--success) 5%, var(--paper))',
                        display: 'flex', flexDirection: 'column', gap: 12,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <AlertTriangle size={14} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />
                          <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>
                            هتحسم ماتش <span style={{ fontWeight: 700 }}>{match.match_id}</span> فوراً وتأهّل{' '}
                            <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{confirmForce.winnerName || 'اللاعب'}</span>
                            {' '}بدون أي إمكانية للتراجع. هل أنت متأكد؟
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => setConfirmForce(null)}
                            disabled={forcing}
                            style={{
                              flex: 1, padding: '10px 0', border: '1px solid var(--rule)', borderRadius: 4,
                              background: 'var(--paper-2)', color: 'var(--ink-3)',
                              fontFamily: 'var(--sans)', fontSize: 13, cursor: 'pointer',
                              opacity: forcing ? 0.4 : 1,
                            }}
                          >
                            <span className="ar">تراجع</span>
                          </button>
                          <button
                            onClick={() => doForceFinish(confirmForce.match, confirmForce.winnerUid)}
                            disabled={forcing}
                            style={{
                              flex: 1, padding: '10px 0',
                              border: '1px solid var(--success)', borderRadius: 4,
                              background: 'color-mix(in srgb, var(--success) 10%, var(--paper))',
                              color: 'var(--success)', fontFamily: 'var(--sans)', fontSize: 13,
                              cursor: forcing ? 'not-allowed' : 'pointer',
                              opacity: forcing ? 0.6 : 1,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            }}
                          >
                            {forcing ? <Loader2 size={13} className="animate-spin" /> : null}
                            <span className="ar">نعم، حسِم الماتش</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Live duel state — makes a frozen match obvious instead of
                        showing a permanent "LIVE" badge on a duel nobody opened. */}
                    {match.status === 'active' && (
                      <div style={{
                        borderTop: '1px solid var(--rule)', padding: '6px 14px',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <span className="folio" style={{
                          fontSize: 9,
                          color: isIdle ? 'var(--alert)' : 'var(--ink-4)',
                        }}>
                          {isIdle ? 'DUEL IDLE — NO PLAYER JOINED' : `DUEL ${(live.status || '…').toUpperCase()}`}
                        </span>
                        {live.total > 0 && (
                          <span className="folio" style={{ fontSize: 9, color: 'var(--ink-4)' }}>
                            Q{(live.qi ?? 0) + 1}/{live.total}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Who is actually here — by name. A count told the host that someone
                was missing but not who, which is the only thing they can act on
                (extend the break, or settle the match). Absent players first. */}
            {(() => {
              const roster = []
              const seen   = new Set()
              roundMatches.forEach(m => {
                [[m.player_a_uid, m.player_a_name], [m.player_b_uid, m.player_b_name]]
                  .forEach(([puid, pname]) => {
                    if (!puid || seen.has(puid)) return
                    seen.add(puid)
                    roster.push({ uid: puid, name: pname || '—', here: !!waitingPresence[puid]?.connected })
                  })
              })
              if (roster.length === 0) return null
              roster.sort((a, b) => (a.here === b.here ? 0 : a.here ? 1 : -1))
              const hereCount = roster.filter(p => p.here).length

              return (
                <div style={{
                  borderTop: '1px solid var(--rule)', padding: '8px 16px',
                  background: 'var(--paper-2)',
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 8, marginBottom: roster.length ? 6 : 0,
                  }}>
                    <span className="ar folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>
                      متصلين {hereCount} / {roster.length} في الجولة
                    </span>
                    {hereCount < roster.length && (
                      <span className="ar folio" style={{ color: 'var(--alert)', fontSize: 9 }}>
                        {roster.length - hereCount} غايب
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {roster.map(p => (
                      <span key={p.uid} className="ar" style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        fontSize: 11, padding: '2px 7px',
                        border: `1px solid ${p.here ? 'var(--rule)' : 'var(--alert)'}`,
                        color: p.here ? 'var(--ink-2)' : 'var(--alert)',
                      }}>
                        <span style={{
                          width: 5, height: 5, borderRadius: '50%',
                          background: p.here ? 'var(--success)' : 'var(--alert)',
                        }} />
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Advance to next round */}
            {allRoundDone && currentRound < totalRounds && !showCountdown && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--rule)' }}>
                <button
                  onClick={() => {
                    setShowCountdown(false)
                    doAdvanceRound(currentRound, matches.filter(m => m.round === currentRound))
                      .catch(e => { console.error(e); setError(e.message || 'فشل الانتقال للجولة القادمة') })
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
