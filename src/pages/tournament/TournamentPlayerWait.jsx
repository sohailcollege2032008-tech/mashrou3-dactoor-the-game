/**
 * TournamentPlayerWait.jsx — Player waiting room between tournament phases/matches.
 * Shows tournament status, their bracket position, and auto-navigates when their
 * match duel is ready.
 */
import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc, onSnapshot, collection, getDoc,
} from 'firebase/firestore'
import { ref as rtdbRef, get as rtdbGet } from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { Trophy, Loader2, Swords, CheckCircle, XCircle } from 'lucide-react'

const STATUS_LABELS = {
  registration: 'قيد التسجيل',
  ffa:          'المرحلة الأولى — FFA',
  transition:   'الانتقال إلى الـ Bracket',
  bracket:      'مرحلة الـ Bracket',
  finished:     'انتهت البطولة',
}

export default function TournamentPlayerWait() {
  const { tournamentId } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()

  const [tournament,    setTournament]    = useState(null)
  const [myMatch,       setMyMatch]       = useState(null)
  const [myResult,      setMyResult]      = useState(null)   // 'advanced' | 'eliminated'
  const [ffaEliminated, setFfaEliminated] = useState(false)  // didn't advance from FFA

  const uid = session?.uid
  // Track if we already checked FFA result to avoid repeat fetches
  const ffaCheckedRef = useRef(false)

  // Subscribe to tournament doc
  useEffect(() => {
    if (!tournamentId) return
    const unsub = onSnapshot(doc(db, 'tournaments', tournamentId), snap => {
      if (snap.exists()) setTournament({ id: snap.id, ...snap.data() })
    })
    return () => unsub()
  }, [tournamentId])

  // Check FFA result once tournament enters bracket phase
  useEffect(() => {
    if (!tournamentId || !uid) return
    if (ffaCheckedRef.current) return
    if (!tournament || !['bracket', 'finished'].includes(tournament.status)) return

    ffaCheckedRef.current = true
    getDoc(doc(db, 'tournaments', tournamentId, 'ffa_results', uid))
      .then(snap => {
        if (snap.exists()) {
          const data = snap.data()
          if (data.advanced === false) setFfaEliminated(true)
        }
      })
      .catch(console.error)
  }, [tournamentId, uid, tournament?.status])

  // Subscribe to my active match in current round
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

        // Check if I've been eliminated (lost in a previous bracket round)
        const pastMatches = all.filter(m =>
          m.round < currentRound &&
          (m.player_a_uid === uid || m.player_b_uid === uid) &&
          m.status === 'finished'
        )
        if (pastMatches.length > 0) {
          const lastMatch = pastMatches[pastMatches.length - 1]
          setMyResult(lastMatch.winner_uid === uid ? 'advanced' : 'eliminated')
        }
      }
    )
    return () => unsub()
  }, [tournamentId, uid, tournament?.current_round])

  // Auto-navigate when my match becomes active
  useEffect(() => {
    if (myMatch?.status === 'active' && myMatch?.duel_id) {
      navigate(`/tournament/${tournamentId}/duel/${myMatch.match_id}`, { replace: true })
    }
  }, [myMatch, tournamentId, navigate])

  // Redirect to FFA room ONLY if the room is still running (not finished)
  // This prevents the loop where pressing "متابعة البطولة" after FFA ends keeps
  // bouncing the player back to the (now-finished) FFA game room.
  useEffect(() => {
    if (!tournament) return

    if (tournament.status === 'ffa' && tournament.ffa_room_id) {
      rtdbGet(rtdbRef(rtdb, `rooms/${tournament.ffa_room_id}/status`))
        .then(snap => {
          const roomStatus = snap.val()
          if (roomStatus && roomStatus !== 'finished') {
            navigate(`/player/game/${tournament.ffa_room_id}`, { replace: true })
          }
          // If room is finished, stay on this page — tournament will transition soon
        })
        .catch(() => {
          // If we can't read the room, don't redirect — safer to stay
        })
    }

    // Clear localStorage when tournament finishes
    if (tournament.status === 'finished') {
      localStorage.removeItem('activeTournamentId')
    }
  }, [tournament?.status, tournament?.ffa_room_id, navigate])

  if (!tournament) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={32} className="text-primary animate-spin" />
      </div>
    )
  }

  const isEliminated = ffaEliminated || myResult === 'eliminated'
  const isFinished   = tournament.status === 'finished'

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center" dir="rtl">
      <div className="w-full max-w-sm space-y-6">
        {/* Trophy icon */}
        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
          {isEliminated
            ? <XCircle size={40} className="text-red-400" />
            : isFinished
            ? <Trophy size={40} className="text-yellow-400" />
            : <Swords size={40} className="text-primary" />
          }
        </div>

        {/* Tournament name */}
        <div>
          <h2 className="ar text-2xl font-black text-white">{tournament.title}</h2>
          <p className="ar text-sm text-primary font-semibold mt-1">
            {STATUS_LABELS[tournament.status] || tournament.status}
          </p>
        </div>

        {/* State messaging */}
        {isEliminated && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-5">
            <p className="ar text-lg font-bold text-red-400 mb-1">
              {ffaEliminated ? 'لم تتأهل للمرحلة الثانية' : 'خرجت من البطولة'}
            </p>
            <p className="ar text-sm text-gray-400">
              {ffaEliminated
                ? 'لم تكن ضمن المتأهلين من مرحلة التصفيات. شكراً على مشاركتك! 🎉'
                : 'شكراً على مشاركتك! كانت تجربة رائعة 🎉'}
            </p>
            <button
              onClick={() => navigate('/player/dashboard')}
              className="ar mt-4 px-6 py-2.5 rounded-xl bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 transition-colors"
            >
              عودة للرئيسية
            </button>
          </div>
        )}

        {isFinished && !isEliminated && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-5 space-y-2">
            <p className="ar text-xl font-black text-yellow-400">🏆 انتهت البطولة!</p>
            {tournament.winner_uid === uid ? (
              <p className="ar text-lg font-black text-yellow-300">أنت البطل! 🎉🎉🎉</p>
            ) : tournament.winner_name ? (
              <p className="ar text-sm text-gray-300">
                البطل: <span className="font-bold text-yellow-400">{tournament.winner_name}</span>
              </p>
            ) : null}
            <button
              onClick={() => navigate('/player/dashboard')}
              className="ar mt-2 w-full py-2.5 rounded-xl bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 transition-colors"
            >
              عودة للرئيسية
            </button>
          </div>
        )}

        {!isEliminated && !isFinished && tournament.status === 'bracket' && (
          <>
            {myMatch ? (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
                <p className="ar text-sm text-gray-400">مبارتك في الجولة {tournament.current_round}</p>
                <div className="flex items-center justify-center gap-3">
                  <span className="ar font-bold text-white">{myMatch.player_a_name}</span>
                  <span className="text-primary font-black">VS</span>
                  <span className="ar font-bold text-white">{myMatch.player_b_name}</span>
                </div>
                {myMatch.status === 'pending' && (
                  <div className="flex items-center justify-center gap-2 text-yellow-400">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="ar text-sm">في انتظار بدء المباراة من المضيف…</span>
                  </div>
                )}
                {myMatch.status === 'finished' && (
                  <div className="flex items-center justify-center gap-2 text-green-400">
                    <CheckCircle size={16} />
                    <span className="ar text-sm">
                      {myMatch.winner_uid === uid ? 'تأهلت للجولة القادمة!' : 'خرجت من هذه الجولة'}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-gray-500">
                <Loader2 size={24} className="animate-spin text-primary" />
                <p className="ar text-sm">في انتظار تحديد المباريات…</p>
              </div>
            )}
          </>
        )}

        {/* Waiting for FFA to finish or transition */}
        {!isEliminated && !isFinished && (tournament.status === 'ffa' || tournament.status === 'transition') && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={24} className="animate-spin text-primary" />
            <p className="ar text-sm text-gray-400">
              {tournament.status === 'ffa'
                ? 'انتظر حتى تنتهي مرحلة التصفيات…'
                : 'جاري الاستعداد لمرحلة الـ Bracket…'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
