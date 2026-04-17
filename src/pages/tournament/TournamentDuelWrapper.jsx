/**
 * TournamentDuelWrapper.jsx
 * Resolves tournament + match context and renders DuelGame with the correct
 * RTDB path (tournament_duels/{tournamentId}) and question duration.
 *
 * After the duel finishes, writes the result back to the bracket_match doc,
 * advances the winner to the next match, and redirects both players to the
 * tournament wait page.
 */
import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc, getDoc, updateDoc, serverTimestamp
} from 'firebase/firestore'
import { ref as rtdbRef, get } from 'firebase/database'
import { rtdb, db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { resolveMatchTie } from '../../utils/tournamentUtils'
import DuelGame from '../duel/DuelGame'
import { Loader2 } from 'lucide-react'

export default function TournamentDuelWrapper() {
  const { tournamentId, matchId } = useParams()
  const navigate   = useNavigate()
  const { session } = useAuth()

  const [ready,       setReady]       = useState(false)
  const [match,       setMatch]       = useState(null)
  const [tournament,  setTournament]  = useState(null)
  const [duelId,      setDuelId]      = useState(null)
  const [error,       setError]       = useState(null)

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

  // Called by DuelGame when the duel finishes
  const handleFinished = useCallback(async () => {
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
        // Forfeit — the other player wins
        loserUid  = duelData.forfeit_by
        winnerUid = playerUids.find(u => u !== loserUid)
        tieBreaker = null
      } else if (scoreA === scoreB) {
        // Tie — use resolution logic
        const result = resolveMatchTie(duelData, playerUids)
        winnerUid  = result.winnerUid
        loserUid   = result.loserUid
        tieBreaker = result.tieBreaker
      } else {
        winnerUid = scoreA > scoreB ? uidA : uidB
        loserUid  = winnerUid === uidA ? uidB : uidA
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

      // Advance winner to next match (if one exists)
      if (match.next_match_id) {
        const nextRef  = doc(db, 'tournaments', tournamentId, 'bracket_matches', match.next_match_id)
        const nextSnap = await getDoc(nextRef)
        if (nextSnap.exists()) {
          const nextMatch = nextSnap.data()
          const winnerName = match.winner_uid === match.player_a_uid
            ? match.player_a_name : match.player_b_name
          // Fill whichever slot is empty
          const updates = !nextMatch.player_a_uid
            ? { player_a_uid: winnerUid, player_a_name: winnerName }
            : { player_b_uid: winnerUid, player_b_name: winnerName }
          await updateDoc(nextRef, updates)
        }
      } else {
        // This was the final — update tournament winner
        await updateDoc(doc(db, 'tournaments', tournamentId), {
          winner_uid: winnerUid,
          status:     'finished',
        })
      }
    } catch (e) {
      console.error('Error writing match result:', e)
    }

    navigate(`/tournament/${tournamentId}/wait`, { replace: true })
  }, [match, duelId, tournament, tournamentId, matchId, navigate])

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

  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={32} className="text-primary animate-spin" />
      </div>
    )
  }

  return (
    <DuelGame
      duelPath={`tournament_duels/${tournamentId}`}
      questionDurationMs={tournament?.duel_question_duration || 30000}
      onFinished={handleFinished}
      // Override duelId via prop instead of URL param
      duelIdOverride={duelId}
    />
  )
}
