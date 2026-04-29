/**
 * TournamentDuelWrapper.jsx
 * Resolves tournament + match context and renders DuelGame with the correct
 * RTDB path (tournament_duels/{tournamentId}) and question duration.
 *
 * After the duel finishes:
 *   1. Reads final RTDB state, computes winner
 *   2. Writes result to bracket_match doc
 *   3. Advances winner to next match (or marks tournament finished)
 *   4. Writes tournament_match entry to player's game history
 *   5. Shows a post-match results screen (auto-navigates to wait after 8 s)
 */
import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc, getDoc, updateDoc, setDoc, serverTimestamp, getDocs, collection
} from 'firebase/firestore'
import { ref as rtdbRef, get, onValue } from 'firebase/database'
import { rtdb, db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { resolveMatchTie } from '../../utils/tournamentUtils'
import DuelGame from '../duel/DuelGame'
import { Loader2, Trophy, XCircle, Timer, ArrowRight } from 'lucide-react'

// ── Host split-screen spectator view ─────────────────────────────────────────
function HostSpectatorView({ tournamentId, duelId, match, tournament, onBack }) {
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
          <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>{qi + 1}/{duel.total_questions}</span>
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

export default function TournamentDuelWrapper() {
  const { tournamentId, matchId } = useParams()
  const navigate   = useNavigate()
  const { session } = useAuth()

  const [ready,       setReady]       = useState(false)
  const [match,       setMatch]       = useState(null)
  const [tournament,  setTournament]  = useState(null)
  const [duelId,      setDuelId]      = useState(null)
  const [error,       setError]       = useState(null)
  const [matchResult,    setMatchResult]    = useState(null)
  const [autoNavSeconds, setAutoNavSeconds] = useState(null)

  useEffect(() => {
    if (!tournamentId || !matchId) return
    const load = async () => {
      try {
        const [tSnap, mSnap] = await Promise.all([
          getDoc(doc(db, 'tournaments', tournamentId)),
          getDoc(doc(db, 'tournaments', tournamentId, 'bracket_matches', matchId)),
        ])
        if (!tSnap.exists() || !mSnap.exists()) throw new Error('لم يتم العثور على المباراة')

        const t = { id: tSnap.id, ...tSnap.data() }
        const m = { match_id: mSnap.id, ...mSnap.data() }
        if (!m.duel_id) throw new Error('لم تبدأ المباراة بعد')

        setTournament(t); setMatch(m); setDuelId(m.duel_id); setReady(true)
      } catch (e) {
        console.error(e); setError(e.message)
      }
    }
    load()
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

  const uid = session?.uid
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

      const [uidA, uidB] = playerUids
      const scoreA = duelData.players?.[uidA]?.score ?? 0
      const scoreB = duelData.players?.[uidB]?.score ?? 0

      let winnerUid, loserUid, tieBreaker

      if (duelData.forfeit_by) {
        loserUid   = duelData.forfeit_by
        winnerUid  = playerUids.find(u => u !== loserUid)
        tieBreaker = null
      } else if (scoreA === scoreB) {
        if (scoreA === 0) {
          const [ffaA, ffaB] = await Promise.all([
            getDoc(doc(db, 'tournaments', tournamentId, 'ffa_results', uidA)),
            getDoc(doc(db, 'tournaments', tournamentId, 'ffa_results', uidB)),
          ])
          const rankA = ffaA.data()?.rank ?? Infinity
          const rankB = ffaB.data()?.rank ?? Infinity
          winnerUid  = rankA <= rankB ? uidA : uidB
          loserUid   = winnerUid === uidA ? uidB : uidA
          tieBreaker = 'ffa_rank'
        } else {
          const result = resolveMatchTie(duelData, playerUids)
          winnerUid  = result.winnerUid
          loserUid   = result.loserUid
          tieBreaker = result.tieBreaker
        }
      } else {
        winnerUid  = scoreA > scoreB ? uidA : uidB
        loserUid   = winnerUid === uidA ? uidB : uidA
        tieBreaker = null
      }

      const matchRef = doc(db, 'tournaments', tournamentId, 'bracket_matches', matchId)
      await updateDoc(matchRef, {
        status:         'finished',
        winner_uid:     winnerUid,
        loser_uid:      loserUid,
        player_a_score: duelData.players?.[match.player_a_uid]?.score ?? 0,
        player_b_score: duelData.players?.[match.player_b_uid]?.score ?? 0,
        tie_broken_by:  tieBreaker,
        finished_at:    serverTimestamp(),
      })

      const winnerName = winnerUid === match.player_a_uid
        ? match.player_a_name : match.player_b_name

      if (match.next_match_id) {
        try {
          const nextRef  = doc(db, 'tournaments', tournamentId, 'bracket_matches', match.next_match_id)
          const nextSnap = await getDoc(nextRef)
          if (nextSnap.exists()) {
            const nextMatch = nextSnap.data()
            const updates = !nextMatch.player_a_uid
              ? { player_a_uid: winnerUid, player_a_name: winnerName }
              : { player_b_uid: winnerUid, player_b_name: winnerName }
            await updateDoc(nextRef, updates)
          }
        } catch (e) {
          console.warn('[Bracket] Could not advance winner client-side:', e.code || e.message)
        }
      } else {
        try {
          await updateDoc(doc(db, 'tournaments', tournamentId), {
            winner_uid:  winnerUid,
            winner_name: winnerName,
            status:      'finished',
          })
        } catch (e) {
          console.warn('[Bracket] Could not update tournament status client-side:', e.code || e.message)
        }
      }

      const myScore       = duelData.players?.[uid]?.score ?? 0
      const oppUid        = playerUids.find(u => u !== uid)
      const opponentScore = duelData.players?.[oppUid]?.score ?? 0
      const opponentName  = uid === match.player_a_uid
        ? match.player_b_name : match.player_a_name

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
      setAutoNavSeconds(8)

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
  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--ink-3)' }} />
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
        </div>
      </div>
    )
  }

  // ── Host spectator view ───────────────────────────────────────────────────
  if (!isPlayerInMatch) {
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
