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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={28} className="text-primary animate-spin" />
      </div>
    )
  }

  const qi             = duel.current_question_index ?? 0
  const question       = duel.questions?.[qi]
  const answers        = duel.answers?.[qi] || {}
  const correctReveal  = answers.correct_reveal ?? null
  const isRevealing    = duel.status === 'revealing'
  const isFinished     = duel.status === 'finished'
  const playerUids     = Object.keys(duel.players || {})
  // Respect match order: player_a on the right, player_b on the left
  const uidA = match?.player_a_uid || playerUids[0]
  const uidB = match?.player_b_uid || playerUids[1]
  const playerA = duel.players?.[uidA]
  const playerB = duel.players?.[uidB]
  const ansA = answers[uidA]
  const ansB = answers[uidB]

  const renderPanel = (player, answer) => {
    if (!player) return <div className="flex-1" />
    const hasAnswered = answer?.selected_choice !== undefined && answer?.selected_choice !== null
    return (
      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
        {/* Player header */}
        <div className="flex items-center justify-center gap-2 px-2 py-1.5 bg-gray-800 rounded-xl">
          {player.avatar_url && (
            <img src={player.avatar_url} className="w-6 h-6 rounded-full flex-shrink-0" alt="" />
          )}
          <span className="ar font-bold text-white text-xs truncate">{player.nickname}</span>
          <span className="font-mono font-black text-primary text-sm tabular-nums flex-shrink-0">
            {player.score ?? 0}
          </span>
        </div>
        {/* Choices */}
        <div className="space-y-1">
          {question?.choices?.map((choice, idx) => {
            const isSelected = hasAnswered && answer.selected_choice === idx
            const isCorrect  = isRevealing && idx === correctReveal
            const isWrong    = isRevealing && isSelected && !isCorrect
            return (
              <div key={idx} className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs transition-all ${
                isCorrect  ? 'bg-green-500/20 border-green-500/50 text-green-300 font-bold' :
                isWrong    ? 'bg-red-500/20 border-red-500/50 text-red-400' :
                isSelected ? 'bg-primary/15 border-primary/40 text-primary font-bold' :
                'bg-gray-800/60 border-gray-700/40 text-gray-500'
              }`}>
                <span className={`w-5 h-5 rounded-md text-[10px] font-black flex items-center justify-center flex-shrink-0 ${
                  isCorrect ? 'bg-green-500 text-black' :
                  isWrong   ? 'bg-red-500 text-white' :
                  isSelected ? 'bg-primary text-background' :
                  'bg-gray-700 text-gray-400'
                }`}>
                  {String.fromCharCode(65 + idx)}
                </span>
                <span className="leading-tight truncate">{choice}</span>
              </div>
            )
          })}
        </div>
        {/* Status line */}
        <div className={`text-center text-[10px] font-bold py-1 rounded-lg ${
          hasAnswered
            ? isRevealing
              ? (ansA && uidA === Object.keys(duel.players)[playerUids.indexOf(uidA)]
                  ? (answers[uidA]?.selected_choice === correctReveal ? 'text-green-400' : 'text-red-400')
                  : 'text-gray-500')
              : 'text-primary'
            : 'text-gray-600 animate-pulse'
        }`}>
          {isFinished ? '🏁' : hasAnswered ? '✓ أجاب' : 'ينتظر…'}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-white flex flex-col" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900/80">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white text-xs font-bold transition-colors"
        >
          <ArrowRight size={14} />
          <span className="ar">الـ Bracket</span>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-yellow-400 font-bold ar">👁 مشاهدة المباراة</span>
          <span className="text-xs text-gray-600 font-mono">{qi + 1}/{duel.total_questions}</span>
        </div>
        <div className="flex items-center gap-1">
          <Timer size={12} className="text-gray-500" />
          <span className="text-xs text-gray-500 font-mono">
            {isRevealing ? '✓' : isFinished ? '🏁' : duel.status === 'waiting' ? '…' : ''}
          </span>
        </div>
      </div>

      {/* Question */}
      <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/40">
        <p className="ar text-white font-bold text-sm text-center leading-relaxed">
          {question?.question || '—'}
        </p>
        {question?.image_url && (
          <img
            src={question.image_url}
            alt=""
            className="mt-2 w-full max-h-32 object-contain rounded-xl border border-gray-700"
          />
        )}
      </div>

      {/* Split panels */}
      <div className="flex-1 flex gap-2 p-3 overflow-y-auto">
        {renderPanel(playerA, ansA)}
        <div className="w-px bg-gray-800 self-stretch mx-1" />
        {renderPanel(playerB, ansB)}
      </div>

      {/* Score footer */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-gray-800 bg-gray-900/80">
        <span className="font-mono font-black text-2xl text-primary tabular-nums">{playerA?.score ?? 0}</span>
        <span className="text-gray-600 font-bold text-sm">
          {isFinished ? '🏁 انتهت' : isRevealing ? '🔍 الإجابة' : '⚔️ جارية'}
        </span>
        <span className="font-mono font-black text-2xl text-primary tabular-nums">{playerB?.score ?? 0}</span>
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

  // Post-match results screen
  const [matchResult,    setMatchResult]    = useState(null) // set after finish → shows results
  const [autoNavSeconds, setAutoNavSeconds] = useState(null) // countdown to auto-navigate

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

        setTournament(t)
        setMatch(m)
        setDuelId(m.duel_id)
        setReady(true)
      } catch (e) {
        console.error(e)
        setError(e.message)
      }
    }
    load()
  }, [tournamentId, matchId])

  // Auto-navigate from results screen
  useEffect(() => {
    if (matchResult === null || autoNavSeconds === null) return
    if (autoNavSeconds <= 0) {
      navigate(`/tournament/${tournamentId}/wait`, { replace: true })
      return
    }
    const t = setTimeout(() => setAutoNavSeconds(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [matchResult, autoNavSeconds, tournamentId, navigate])

  // uid of the currently logged-in user
  const uid = session?.uid
  // Is this user one of the two players in this match (not an observer/host)?
  const isPlayerInMatch = ready && match &&
    (match.player_a_uid === uid || match.player_b_uid === uid)

  // Called by DuelGame when the duel finishes
  const handleFinished = useCallback(async () => {
    // Host-observer: go back to bracket without writing results.
    if (!isPlayerInMatch) {
      navigate(`/tournament/${tournamentId}/bracket`, { replace: true })
      return
    }

    if (!match || !duelId || !tournament) {
      navigate(`/tournament/${tournamentId}/wait`, { replace: true })
      return
    }

    try {
      // Read final duel state from RTDB
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
          // Both zero → use FFA rank (lower rank number = better seeding)
          // This is the last-resort fallback after all tiebreaker questions were used
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
          // Equal non-zero scores after tiebreaker questions exhausted → speed
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

      // Write result to Firestore match doc
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

      // Advance winner to next match — best-effort (bracket host button also handles this).
      // Players lack permission to update the next match until they're listed in it,
      // so permission errors here are expected and non-critical.
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
          // Expected: player not yet listed in next match → no write permission.
          // TournamentBracket "advance round" button propagates winners authoritatively.
          console.warn('[Bracket] Could not advance winner client-side:', e.code || e.message)
        }
      } else {
        // Final match — try to mark tournament finished.
        // Players lack update permission on the tournament doc; host's TournamentBracket
        // button is the authoritative path for status: 'finished'.
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

      // ── Write tournament game history for the current player ────────────────
      const myScore      = duelData.players?.[uid]?.score ?? 0
      const oppUid       = playerUids.find(u => u !== uid)
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

      // ── Write tournament_summary for players whose journey is now over ───────
      // Loser's journey always ends here. Winner's ends only at the final.
      const shouldWriteSummary = (uid === loserUid) || (!match.next_match_id && uid === winnerUid)
      if (shouldWriteSummary) {
        try {
          // Collect all this player's finished bracket matches for this tournament
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

          // FFA rank + score
          const ffaSnap = await getDoc(doc(db, 'tournaments', tournamentId, 'ffa_results', uid))
          const ffaData = ffaSnap.exists() ? ffaSnap.data() : {}
          const ffaAll  = await getDocs(collection(db, 'tournaments', tournamentId, 'ffa_results'))

          const tRounds     = tournament.total_rounds || Math.log2(tournament.actual_top_cut || 2)
          const highestRound = myMatches.length > 0 ? Math.max(...myMatches.map(m => m.round)) : null

          let finalResult
          if (!match.next_match_id && uid === winnerUid) {
            finalResult = 'champion'
          } else if (match.round === tRounds) {
            finalResult = 'finalist'
          } else if (match.round === tRounds - 1) {
            finalResult = 'semi_finalist'
          } else {
            finalResult = 'eliminated_bracket'
          }

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

      // ── Show results screen instead of immediate navigation ─────────────────
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

  // ── Error screen ─────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-6" dir="rtl">
        <p className="ar text-red-400 text-center">{error}</p>
        <button onClick={() => navigate(`/tournament/${tournamentId}/wait`)} className="ar px-6 py-2.5 rounded-xl bg-gray-800 text-white text-sm">
          عودة
        </button>
      </div>
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={32} className="text-primary animate-spin" />
      </div>
    )
  }

  // ── Post-match results screen ─────────────────────────────────────────────
  if (matchResult) {
    const roundLabel = getRoundLabel(matchResult.round, tournament?.total_rounds)
    const isWinner   = matchResult.isWinner
    const isFinal    = matchResult.isFinal

    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6" dir="rtl">
        <div className="w-full max-w-sm space-y-5">

          {/* Tournament + round label */}
          <div className="text-center">
            <p className="text-sm font-bold text-primary ar">🏆 {tournament?.title}</p>
            <p className="text-xs text-gray-500 ar mt-0.5">{roundLabel}</p>
          </div>

          {/* Outcome card */}
          <div className={`flex flex-col items-center gap-3 py-8 rounded-2xl border ${
            isWinner
              ? 'bg-yellow-500/10 border-yellow-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            {isWinner
              ? <Trophy size={52} className="text-yellow-400" />
              : <XCircle size={52} className="text-red-400" />
            }
            <p className={`text-2xl font-black ar ${isWinner ? 'text-yellow-400' : 'text-red-400'}`}>
              {isFinal
                ? (isWinner ? '🏆 أنت بطل البطولة!' : 'المركز الثاني 🥈')
                : (isWinner ? 'تأهلت للجولة القادمة! ✅' : 'خرجت من البطولة ❌')
              }
            </p>
            {matchResult.hadTiebreaker && !matchResult.tieBreaker && (
              <p className="text-xs text-orange-400 ar">⚡ تم البت بسؤال فاصل</p>
            )}
            {matchResult.tieBreaker === 'speed' && (
              <p className="text-xs text-gray-400 ar">⚡ فاز بالسرعة</p>
            )}
            {matchResult.tieBreaker === 'ffa_rank' && (
              <p className="text-xs text-gray-400 ar">🏅 فاز بترتيب مرحلة التصفيات</p>
            )}
            {matchResult.tieBreaker === 'random' && (
              <p className="text-xs text-gray-400 ar">🎲 فاز بالقرعة</p>
            )}
          </div>

          {/* Score comparison */}
          <div className="flex gap-3 items-stretch">
            <div className="flex-1 bg-gray-900 border border-gray-800 rounded-2xl p-4 text-center">
              <p className="text-xs text-gray-400 ar mb-1">أنت</p>
              <p className="text-4xl font-black font-mono text-primary tabular-nums">{matchResult.myScore}</p>
            </div>
            <div className="flex items-center text-gray-600 font-bold text-sm">vs</div>
            <div className="flex-1 bg-gray-900 border border-gray-800 rounded-2xl p-4 text-center">
              <p className="text-xs text-gray-400 ar mb-1 truncate">{matchResult.opponentName || 'خصمك'}</p>
              <p className="text-4xl font-black font-mono text-white tabular-nums">{matchResult.opponentScore}</p>
            </div>
          </div>

          {/* Continue button with countdown */}
          <button
            onClick={() => navigate(`/tournament/${tournamentId}/wait`, { replace: true })}
            className="w-full py-3.5 rounded-2xl bg-primary/10 border border-primary/30 text-primary font-bold ar text-sm active:scale-95 transition-all"
          >
            متابعة ({autoNavSeconds}ث)
          </button>
        </div>
      </div>
    )
  }

  // ── Host spectator: split-screen showing both players in real time ─────────
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
