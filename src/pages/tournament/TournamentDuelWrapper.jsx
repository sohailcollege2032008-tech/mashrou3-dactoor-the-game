/**
 * TournamentDuelWrapper.jsx
 * Resolves tournament + match context and renders DuelGame with the correct
 * RTDB path (tournament_duels/{tournamentId}) and question duration.
 *
 * After the duel finishes:
 *   1. Waits for the Cloud Function's verdict on the bracket match — the result,
 *      the advancement and the champion are all written server-side; a player
 *      can no longer write a match doc at all
 *   2. Writes a tournament_match entry to the player's own game history
 *   3. Shows a post-match results screen (auto-navigates to wait after 15 s)
 */
import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import {
  doc, getDoc, setDoc, serverTimestamp, getDocs, collection, onSnapshot
} from 'firebase/firestore'
import { ref as rtdbRef, get, onValue } from 'firebase/database'
import { rtdb, db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { soundManager } from '../../utils/soundManager'
import DuelGame from '../duel/DuelGame'
import { Loader2, Trophy, XCircle, Timer, ArrowRight } from 'lucide-react'

// ── Host split-screen spectator view ─────────────────────────────────────────
function HostSpectatorView({ tournamentId, duelId, match, onBack }) {
  const [duel, setDuel] = useState(null)

  useEffect(() => {
    if (!tournamentId || !duelId) return
    const unsub = onValue(
      rtdbRef(rtdb, `tournament_duels/${tournamentId}/${duelId}`),
      snap => { if (snap.exists()) setDuel(snap.val()) }
    )
    return () => unsub()
  }, [tournamentId, duelId])

  if (!duel) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--ink-3)' }} />
      </div>
    )
  }

  const qi            = duel.current_question_index ?? 0
  const question      = duel.questions?.[qi]
  const answers       = duel.answers?.[qi] || {}
  const correctReveal = answers.correct_reveal ?? null
  const isRevealing   = duel.status === 'revealing'
  const isFinished    = duel.status === 'finished'
  const playerUids    = Object.keys(duel.players || {})
  const uidA = match?.player_a_uid || playerUids[0]
  const uidB = match?.player_b_uid || playerUids[1]
  const playerA = duel.players?.[uidA]
  const playerB = duel.players?.[uidB]
  const ansA = answers[uidA]
  const ansB = answers[uidB]

  const renderPanel = (player, answer) => {
    if (!player) return <div style={{ flex: 1 }} />
    const hasAnswered = answer?.selected_choice !== undefined && answer?.selected_choice !== null
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        {/* Player header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '8px 10px', border: '1px solid var(--rule)', background: 'var(--paper-2)',
          borderRadius: 4,
        }}>
          {player.avatar_url && (
            <img src={player.avatar_url} style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0 }} alt="" />
          )}
          <span className="ar" style={{ fontFamily: 'var(--serif)', fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {player.nickname}
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, color: 'var(--navy)', flexShrink: 0 }}>
            {player.score ?? 0}
          </span>
        </div>

        {/* Choices */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {question?.choices?.map((choice, idx) => {
            const isSelected = hasAnswered && answer.selected_choice === idx
            const isCorrect  = isRevealing && idx === correctReveal
            const isWrong    = isRevealing && isSelected && !isCorrect

            let borderColor = 'var(--rule)'
            let bg = 'var(--paper-2)'
            let textColor = 'var(--ink-3)'

            if (isCorrect)       { borderColor = 'var(--success)'; bg = 'color-mix(in srgb, var(--success) 10%, var(--paper))'; textColor = 'var(--success)' }
            else if (isWrong)    { borderColor = 'var(--alert)';   bg = 'color-mix(in srgb, var(--alert) 8%, var(--paper))';   textColor = 'var(--alert)' }
            else if (isSelected) { borderColor = 'var(--navy)';    bg = 'color-mix(in srgb, var(--navy) 8%, var(--paper))';   textColor = 'var(--navy)' }

            return (
              <div key={idx} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', border: `1px solid ${borderColor}`,
                background: bg, borderRadius: 4, transition: 'all 150ms',
              }}>
                <span style={{
                  width: 20, height: 20, borderRadius: 2, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
                  background: isCorrect ? 'var(--success)' : isWrong ? 'var(--alert)' : isSelected ? 'var(--navy)' : 'var(--rule)',
                  color: (isCorrect || isWrong || isSelected) ? 'white' : 'var(--ink-4)',
                }}>
                  {String.fromCharCode(65 + idx)}
                </span>
                <span style={{ fontFamily: 'var(--sans)', fontSize: 12, color: textColor, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {choice}
                </span>
              </div>
            )
          })}
        </div>

        {/* Status */}
        <div className="folio" style={{
          textAlign: 'center', fontSize: 9, padding: '4px 0',
          color: isFinished ? 'var(--ink-4)' : hasAnswered ? 'var(--success)' : 'var(--ink-4)',
        }}>
          {isFinished ? 'DONE' : hasAnswered ? 'ANSWERED' : 'WAITING…'}
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', display: 'flex', flexDirection: 'column' }} dir="rtl">
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid var(--rule)',
        background: 'var(--paper-2)',
      }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-3)',
          }}
        >
          <ArrowRight size={14} />
          <span className="ar">الـ Bracket</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="ar folio" style={{ color: 'var(--gold)', fontSize: 9 }}>SPECTATING</span>
          <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}><span dir="ltr">{qi + 1}/{duel.total_questions}</span></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Timer size={12} style={{ color: 'var(--ink-4)' }} />
          <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>
            {isRevealing ? 'REVEAL' : isFinished ? 'DONE' : duel.status === 'waiting' ? 'WAIT' : 'LIVE'}
          </span>
        </div>
      </div>

      {/* Question */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
        <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 500, color: 'var(--ink)', textAlign: 'center', lineHeight: 1.6, margin: 0 }}>
          {question?.question || '—'}
        </p>
        {question?.image_url && (
          <img
            src={question.image_url}
            alt=""
            style={{
              marginTop: 10, width: '100%', maxHeight: 130,
              objectFit: 'contain', border: '1px solid var(--rule)', borderRadius: 4,
            }}
          />
        )}
      </div>

      {/* Split panels */}
      <div style={{ flex: 1, display: 'flex', gap: 10, padding: 14, overflowY: 'auto' }}>
        {renderPanel(playerA, ansA)}
        <div style={{ width: 1, background: 'var(--rule)', alignSelf: 'stretch', flexShrink: 0 }} />
        {renderPanel(playerB, ansB)}
      </div>

      {/* Score footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px', borderTop: '1px solid var(--rule)', background: 'var(--paper-2)',
      }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 700, color: 'var(--navy)' }}>{playerA?.score ?? 0}</span>
        <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>
          {isFinished ? 'FINISHED' : isRevealing ? 'REVEAL' : 'LIVE'}
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 700, color: 'var(--navy)' }}>{playerB?.score ?? 0}</span>
      </div>
    </div>
  )
}

// ── Round label helper ────────────────────────────────────────────────────────
function getRoundLabel(round, totalRounds) {
  if (!round) return ''
  if (!totalRounds) return `الجولة ${round}`
  if (round === totalRounds)     return 'النهائي'
  if (round === totalRounds - 1) return 'نصف النهائي'
  if (round === totalRounds - 2) return 'ربع النهائي'
  return `الجولة ${round}`
}

/**
 * Wait for the Cloud Function's verdict on this match.
 *
 * Resolves with the finalised match doc, or null if it has not landed in time —
 * the caller then falls back to the wait screen rather than inventing a result.
 * `_finalize_match` runs off the duel node's status write, and that trigger has
 * been warm all match long (it fires on every question), so this is normally a
 * second or two.
 */
function awaitVerdict(tournamentId, matchId, timeoutMs = 45000) {
  return new Promise(resolve => {
    let unsub = null
    let done  = false
    const finish = v => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (unsub) unsub()
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    unsub = onSnapshot(
      doc(db, 'tournaments', tournamentId, 'bracket_matches', matchId),
      snap => {
        const m = snap.data()
        if (m?.status === 'finished' && m.winner_uid) finish(m)
      },
      e => { console.error('[Bracket] verdict listener:', e); finish(null) },
    )
  })
}

export default function TournamentDuelWrapper() {
  const { tournamentId, matchId } = useParams()
  const navigate   = useNavigate()
  const { session, profile } = useAuth()

  const [ready,       setReady]       = useState(false)
  const [match,       setMatch]       = useState(null)
  const [tournament,  setTournament]  = useState(null)
  const [duelId,      setDuelId]      = useState(null)
  const [error,       setError]       = useState(null)
  const [matchResult,    setMatchResult]    = useState(null)
  const [autoNavSeconds, setAutoNavSeconds] = useState(null)
  const [nextOpponent,   setNextOpponent]   = useState(null)
  const [settling,       setSettling]       = useState(false)

  // Live subscription rather than a single read: arriving a moment before the
  // duel_id is written used to dead-end on "لم تبدأ المباراة بعد" with no retry.
  useEffect(() => {
    if (!tournamentId || !matchId) return
    let cancelled = false

    getDoc(doc(db, 'tournaments', tournamentId))
      .then(tSnap => {
        if (cancelled) return
        if (!tSnap.exists()) return setError('لم يتم العثور على البطولة')
        setTournament({ id: tSnap.id, ...tSnap.data() })
      })
      .catch(e => { console.error(e); setError(e.message) })

    const unsub = onSnapshot(
      doc(db, 'tournaments', tournamentId, 'bracket_matches', matchId),
      snap => {
        if (!snap.exists()) return setError('لم يتم العثور على المباراة')
        const m = { match_id: snap.id, ...snap.data() }
        setMatch(m)
        if (m.duel_id) {
          setDuelId(m.duel_id)
          setError(null)
          setReady(true)
        }
      },
      e => { console.error(e); setError(e.message) }
    )
    return () => { cancelled = true; unsub() }
  }, [tournamentId, matchId])

  useEffect(() => {
    if (matchResult === null || autoNavSeconds === null) return
    if (autoNavSeconds <= 0) {
      navigate(`/tournament/${tournamentId}/wait`, { replace: true })
      return
    }
    const t = setTimeout(() => setAutoNavSeconds(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [matchResult, autoNavSeconds, tournamentId, navigate])

  // Resolve the next-round opponent for the winner screen. Single Firestore read
  // on the next match (not an RTDB tournament_duels subscription): after both
  // sibling matches finish, one slot is the advancing winner and the other is
  // their next opponent.
  useEffect(() => {
    if (!matchResult || !match?.next_match_id) return
    let cancelled = false
    getDoc(doc(db, 'tournaments', tournamentId, 'bracket_matches', match.next_match_id))
      .then(snap => {
        if (cancelled || !snap.exists()) return
        const nm      = snap.data()
        const mySlot   = (match.match_number ?? 1) % 2 === 1 ? 'player_a' : 'player_b'
        const oppSlot  = mySlot === 'player_a' ? 'player_b' : 'player_a'
        const oppName  = nm[oppSlot + '_name']
        setNextOpponent(oppName && oppName !== 'TBD' ? oppName : null)
      })
      .catch(() => { if (!cancelled) setNextOpponent(null) })
    return () => { cancelled = true }
  }, [matchResult, match, tournamentId])

  const uid = session?.uid
  const isHostOrOwner = ready && tournament &&
    (tournament.host_id === uid || profile?.role === 'owner')
  const isPlayerInMatch = ready && match &&
    (match.player_a_uid === uid || match.player_b_uid === uid)

  const handleFinished = useCallback(async () => {
    if (!isPlayerInMatch) {
      navigate(`/tournament/${tournamentId}/bracket`, { replace: true })
      return
    }
    if (!match || !duelId || !tournament) {
      navigate(`/tournament/${tournamentId}/wait`, { replace: true })
      return
    }

    try {
      const duelSnap = await get(rtdbRef(rtdb, `tournament_duels/${tournamentId}/${duelId}`))
      const duelData = duelSnap.val()

      const playerUids = Object.keys(duelData?.players || {})
      if (playerUids.length < 2) throw new Error('بيانات اللاعبين غير مكتملة')

      // The verdict belongs to the server. A player used to work out the winner
      // right here and write it onto the bracket match — which put crowning
      // yourself one updateDoc away. `_finalize_match` resolves it the moment
      // the duel node turns 'finished', and the rules now let only the host and
      // the owner write a match, so we wait for the server's answer instead.
      setSettling(true)
      const verdict = await awaitVerdict(tournamentId, matchId)
      setSettling(false)
      if (!verdict) {
        // Nothing is lost: the reconciler runs every minute, and the wait
        // screen shows the outcome the moment it lands.
        navigate(`/tournament/${tournamentId}/wait`, { replace: true })
        return
      }

      const winnerUid  = verdict.winner_uid
      const loserUid   = verdict.loser_uid || playerUids.find(u => u !== winnerUid) || null
      const tieBreaker = verdict.tie_broken_by ?? null
      const iAmA       = uid === match.player_a_uid

      const myScore       = (iAmA ? verdict.player_a_score : verdict.player_b_score) ?? 0
      const opponentScore = (iAmA ? verdict.player_b_score : verdict.player_a_score) ?? 0
      const oppUid        = playerUids.find(u => u !== uid)
      const opponentName  = iAmA ? match.player_b_name : match.player_a_name

      try {
        await setDoc(
          doc(db, 'profiles', uid, 'game_history', `t_${tournamentId}_${matchId}`),
          {
            type:             'tournament_match',
            tournament_id:    tournamentId,
            tournament_title: tournament.title,
            round:            match.round,
            deck_id:          tournament.deck_id   || null,
            deck_title:       tournament.deck_title || '',
            opponent_uid:     oppUid               || null,
            opponent_name:    opponentName         || 'لاعب',
            my_score:         myScore,
            opponent_score:   opponentScore,
            outcome:          winnerUid === uid ? 'win' : 'lose',
            total_questions:  duelData.total_questions || 0,
            played_at:        serverTimestamp(),
          }
        )
      } catch (e) {
        console.error('Failed to write tournament match history:', e)
      }

      const shouldWriteSummary = (uid === loserUid) || (!match.next_match_id && uid === winnerUid)
      if (shouldWriteSummary) {
        try {
          const allMatchesSnap = await getDocs(
            collection(db, 'tournaments', tournamentId, 'bracket_matches')
          )
          const myMatches = allMatchesSnap.docs
            .map(d => d.data())
            .filter(m =>
              m.status === 'finished' &&
              (m.player_a_uid === uid || m.player_b_uid === uid)
            )
            .sort((a, b) => a.round - b.round)

          const bracketMatchList = myMatches.map(m => {
            const isA = m.player_a_uid === uid
            return {
              round:          m.round,
              round_label:    getRoundLabel(m.round, tournament.total_rounds),
              opponent_uid:   isA ? m.player_b_uid  : m.player_a_uid,
              opponent_name:  isA ? m.player_b_name : m.player_a_name,
              my_score:       isA ? (m.player_a_score ?? 0) : (m.player_b_score ?? 0),
              opponent_score: isA ? (m.player_b_score ?? 0) : (m.player_a_score ?? 0),
              outcome:        m.winner_uid === uid ? 'win' : 'lose',
              tie_broken_by:  m.tie_broken_by ?? null,
            }
          })

          const ffaSnap = await getDoc(doc(db, 'tournaments', tournamentId, 'ffa_results', uid))
          const ffaData = ffaSnap.exists() ? ffaSnap.data() : {}
          const ffaAll  = await getDocs(collection(db, 'tournaments', tournamentId, 'ffa_results'))

          const tRounds     = tournament.total_rounds || Math.log2(tournament.actual_top_cut || 2)
          const highestRound = myMatches.length > 0 ? Math.max(...myMatches.map(m => m.round)) : null

          let finalResult
          if (!match.next_match_id && uid === winnerUid) finalResult = 'champion'
          else if (match.round === tRounds)              finalResult = 'finalist'
          else if (match.round === tRounds - 1)          finalResult = 'semi_finalist'
          else                                           finalResult = 'eliminated_bracket'

          await setDoc(
            doc(db, 'profiles', uid, 'game_history', `t_${tournamentId}_summary`),
            {
              type:              'tournament_summary',
              tournament_id:     tournamentId,
              tournament_title:  tournament.title,
              played_at:         serverTimestamp(),
              ffa_rank:          ffaData.rank  ?? null,
              ffa_score:         ffaData.score ?? 0,
              ffa_total_players: ffaAll.size,
              advanced_from_ffa: true,
              bracket_matches:   bracketMatchList,
              final_result:      finalResult,
              reached_round:     highestRound,
              total_rounds:      tRounds,
            }
          )
        } catch (e) {
          console.error('Failed to write tournament summary:', e)
        }
      }

      setMatchResult({
        isWinner:      winnerUid === uid,
        myScore,
        opponentScore,
        opponentName,
        round:         match.round,
        isFinal:       !match.next_match_id,
        tieBreaker,
        hadTiebreaker: duelData.is_tiebreaker === true,
      })
      setAutoNavSeconds(15)

      // ── Sound: match outcome (champion / win / lose) ───────────────────
      if (!match.next_match_id && winnerUid === uid) soundManager.playChampion()
      else if (winnerUid === uid) soundManager.playVictory()
      else soundManager.playDefeat()

    } catch (e) {
      console.error('Error writing match result:', e)
      navigate(`/tournament/${tournamentId}/wait`, { replace: true })
    }
  }, [isPlayerInMatch, match, duelId, tournament, tournamentId, matchId, navigate, uid])

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--paper)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 16, padding: 24,
      }} dir="rtl">
        <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 15, color: 'var(--alert)', textAlign: 'center' }}>{error}</p>
        <button
          onClick={() => navigate(`/tournament/${tournamentId}/wait`)}
          style={{
            padding: '10px 24px', border: '1px solid var(--rule)', borderRadius: 4,
            background: 'var(--paper-2)', color: 'var(--ink-3)',
            fontFamily: 'var(--sans)', fontSize: 14, cursor: 'pointer',
          }}
        >
          <span className="ar">عودة</span>
        </button>
      </div>
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (!ready || !tournament) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--ink-3)' }} />
      </div>
    )
  }

  // ── Awaiting the official verdict ─────────────────────────────────────────
  // The scores are in but the result is not the players' to declare. This beat
  // belongs to the server, so it is shown as one: the judgement is being sealed.
  if (settling) {
    return (
      <div className="paper-grain" style={{
        minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 18, padding: 24,
      }} dir="rtl">
        <div className="folio" style={{ color: 'var(--ink-4)' }}>FINAL VERDICT</div>
        <Loader2 size={26} className="animate-spin" style={{ color: 'var(--gold)' }} />
        <p className="ar" style={{
          fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 500,
          color: 'var(--ink)', margin: 0, textAlign: 'center',
        }}>
          جاري اعتماد النتيجة
        </p>
        <p className="ar" style={{
          fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--ink-3)',
          margin: 0, textAlign: 'center', maxWidth: 260, lineHeight: 1.7,
        }}>
          النتيجة بتتحسب على السيرفر — ثواني وتظهر
        </p>
      </div>
    )
  }

  // ── Post-match results screen ─────────────────────────────────────────────
  if (matchResult) {
    const roundLabel = getRoundLabel(matchResult.round, tournament?.total_rounds)
    const isWinner   = matchResult.isWinner
    const isFinal    = matchResult.isFinal

    const outcomeColor    = isWinner ? 'var(--gold)' : 'var(--alert)'
    const outcomeBorder   = isWinner ? 'var(--gold)' : 'var(--alert)'
    const outcomeBg       = isWinner
      ? 'color-mix(in srgb, var(--gold) 6%, var(--paper))'
      : 'color-mix(in srgb, var(--alert) 6%, var(--paper))'

    const outcomeText = isFinal
      ? (isWinner ? 'أنت بطل البطولة' : 'المركز الثاني')
      : (isWinner ? 'تأهلت للجولة القادمة' : 'خرجت من البطولة')

    return (
      <div className="paper-grain" style={{
        minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }} dir="rtl">
        <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Tournament label */}
          <div style={{ textAlign: 'center' }}>
            <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 4 }}>TOURNAMENT</div>
            <p className="ar" style={{ fontFamily: 'var(--serif)', fontSize: 16, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
              {tournament?.title}
            </p>
            <p className="ar folio" style={{ color: 'var(--ink-4)', marginTop: 4, fontSize: 9 }}>{roundLabel}</p>
          </div>

          {/* Outcome card */}
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            padding: '32px 24px', border: `1px solid ${outcomeBorder}`, borderTop: `3px solid ${outcomeBorder}`,
            background: outcomeBg, borderRadius: 4,
          }}>
            {isWinner
              ? <Trophy size={48} style={{ color: outcomeColor }} />
              : <XCircle size={48} style={{ color: outcomeColor }} />
            }
            <p className="ar" style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 500, color: outcomeColor, margin: 0, textAlign: 'center' }}>
              {outcomeText}
            </p>
            {matchResult.hadTiebreaker && !matchResult.tieBreaker && (
              <p className="ar folio" style={{ color: 'var(--gold)', fontSize: 9 }}>تم البت بسؤال فاصل</p>
            )}
            {matchResult.tieBreaker === 'speed' && (
              <p className="ar folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>فاز بالسرعة</p>
            )}
            {matchResult.tieBreaker === 'ffa_rank' && (
              <p className="ar folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>فاز بترتيب مرحلة التصفيات</p>
            )}
            {matchResult.tieBreaker === 'random' && (
              <p className="ar folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>فاز بالقرعة</p>
            )}
          </div>

          {/* Next-round opponent (winner, non-final) */}
          {isWinner && !isFinal && match?.next_match_id && (
            <div style={{
              border: '1px solid var(--rule)', borderRadius: 4, padding: '14px 16px',
              background: 'var(--paper-2)', textAlign: 'center',
            }}>
              <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-2)', margin: 0 }}>
                {nextOpponent
                  ? <>جولتك الجاية ضد: <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{nextOpponent}</span></>
                  : 'في انتظار نتيجة الماتش التاني'}
              </p>
            </div>
          )}

          {/* Score comparison */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 12 }}>
            <div style={{
              flex: 1, border: '1px solid var(--rule)', borderRadius: 4,
              padding: '16px 12px', textAlign: 'center', background: 'var(--paper-2)',
            }}>
              <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 8, fontSize: 9 }}>أنت</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 40, fontWeight: 700, color: 'var(--ink)' }}>
                {matchResult.myScore}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>VS</span>
            </div>
            <div style={{
              flex: 1, border: '1px solid var(--rule)', borderRadius: 4,
              padding: '16px 12px', textAlign: 'center', background: 'var(--paper-2)',
            }}>
              <div className="ar folio" style={{ color: 'var(--ink-4)', marginBottom: 8, fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {matchResult.opponentName || 'خصمك'}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 40, fontWeight: 700, color: 'var(--ink)' }}>
                {matchResult.opponentScore}
              </div>
            </div>
          </div>

          {/* Continue button */}
          <button
            onClick={() => navigate(`/tournament/${tournamentId}/wait`, { replace: true })}
            style={{
              width: '100%', padding: '14px 0',
              border: '1px solid var(--rule)', borderRadius: 4,
              background: 'var(--paper-2)', color: 'var(--ink-2)',
              fontFamily: 'var(--sans)', fontSize: 14, cursor: 'pointer',
              transition: 'all 150ms',
            }}
          >
            <span className="ar">متابعة ({autoNavSeconds}ث)</span>
          </button>
          <button
            onClick={() => navigate(`/tournament/${tournamentId}/wait`, { replace: true, state: { showBracket: true } })}
            style={{
              width: '100%', padding: '13px 0',
              background: 'transparent', color: 'var(--ink-3)',
              border: '1px solid var(--rule)', borderRadius: 4,
              fontFamily: 'var(--sans)', fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <Trophy size={14} style={{ color: 'var(--gold)' }} />
            <span className="ar">شاهد شجرة البطولة</span>
          </button>
        </div>
      </div>
    )
  }

  // ── Host spectator view ───────────────────────────────────────────────────
  // Only the tournament host (or the owner) may spectate — this route shows the
  // full live question, and every match in a round runs the same questions in
  // parallel. Anyone else who is not a player here is bounced to the wait room
  // instead of leaking the question text.
  if (!isPlayerInMatch && isHostOrOwner) {
    return (
      <HostSpectatorView
        tournamentId={tournamentId}
        duelId={duelId}
        match={match}
        tournament={tournament}
        onBack={() => navigate(`/tournament/${tournamentId}/bracket`, { replace: true })}
      />
    )
  }

  if (!isPlayerInMatch) {
    return <Navigate to={`/tournament/${tournamentId}/wait`} replace />
  }

  // ── Game (player view) ────────────────────────────────────────────────────
  const roundLabel = getRoundLabel(match?.round, tournament?.total_rounds)
  const badge = tournament ? `${tournament.title} — ${roundLabel}` : null

  return (
    <DuelGame
      duelPath={`tournament_duels/${tournamentId}`}
      questionDurationMs={tournament?.duel_question_duration || 30000}
      onFinished={handleFinished}
      duelIdOverride={duelId}
      isObserver={false}
      tournamentBadge={badge}
    />
  )
}
