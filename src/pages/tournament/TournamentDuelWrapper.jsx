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
  doc, getDoc, updateDoc, setDoc, serverTimestamp
} from 'firebase/firestore'
import { ref as rtdbRef, get } from 'firebase/database'
import { rtdb, db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { resolveMatchTie } from '../../utils/tournamentUtils'
import DuelGame from '../duel/DuelGame'
import { Loader2, Trophy, XCircle } from 'lucide-react'

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

      // Advance winner to next match (if one exists)
      if (match.next_match_id) {
        const nextRef  = doc(db, 'tournaments', tournamentId, 'bracket_matches', match.next_match_id)
        const nextSnap = await getDoc(nextRef)
        if (nextSnap.exists()) {
          const nextMatch = nextSnap.data()
          const updates = !nextMatch.player_a_uid
            ? { player_a_uid: winnerUid, player_a_name: winnerName }
            : { player_b_uid: winnerUid, player_b_name: winnerName }
          await updateDoc(nextRef, updates)
        }
      } else {
        // Final match — mark tournament finished (store winner_name for player wait page)
        await updateDoc(doc(db, 'tournaments', tournamentId), {
          winner_uid:  winnerUid,
          winner_name: winnerName,
          status:      'finished',
        })
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

  // ── Game ──────────────────────────────────────────────────────────────────
  const roundLabel = getRoundLabel(match?.round, tournament?.total_rounds)
  const badge = tournament ? `${tournament.title} — ${roundLabel}` : null

  return (
    <DuelGame
      duelPath={`tournament_duels/${tournamentId}`}
      questionDurationMs={tournament?.duel_question_duration || 30000}
      onFinished={handleFinished}
      duelIdOverride={duelId}
      isObserver={!isPlayerInMatch}
      tournamentBadge={badge}
    />
  )
}
