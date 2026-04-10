import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ref as rtdbRef, onValue, update, remove } from 'firebase/database'
import { rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { Loader2, Copy, Check, Swords, Users } from 'lucide-react'

export default function DuelLobby() {
  const { duelId } = useParams()
  const navigate = useNavigate()
  const { session, profile } = useAuth()

  const [duel, setDuel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)

  const uid = session?.uid

  // Subscribe to duel
  useEffect(() => {
    if (!duelId) return
    const duelRef = rtdbRef(rtdb, `duels/${duelId}`)
    const unsub = onValue(duelRef, snap => {
      const data = snap.val()
      setDuel(data)
      setLoading(false)
      if (data?.status === 'playing' || data?.status === 'revealing') {
        navigate(`/duel/game/${duelId}`, { replace: true })
      }
      if (data?.status === 'finished') {
        navigate(`/duel/results/${duelId}`, { replace: true })
      }
    }, err => {
      console.error(err)
      setError('فشل تحميل الدويل')
      setLoading(false)
    })
    return () => unsub()
  }, [duelId, navigate])

  const inviteLink = `${window.location.origin}/duel/lobby/${duelId}`

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [inviteLink])

  const joinDuel = useCallback(async () => {
    if (!duel || joining || !uid) return
    setJoining(true)
    setError(null)
    try {
      await update(rtdbRef(rtdb, `duels/${duelId}`), {
        [`players/${uid}`]: {
          uid,
          nickname: profile?.display_name || 'لاعب',
          avatar_url: profile?.avatar_url || '',
          score: 0,
        },
        status: 'playing',
        question_started_at: Date.now(),
      })
      // Remove creator from queue
      await remove(rtdbRef(rtdb, `duel_queue/${duel.deck_id}/${duel.creator_uid}`))
      // Navigation happens via onValue listener
    } catch (e) {
      console.error(e)
      setError('فشل الانضمام. حاول مرة أخرى.')
      setJoining(false)
    }
  }, [duel, joining, uid, duelId, profile])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  if (!duel) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-gray-400" dir="rtl">
        <div className="text-center space-y-3">
          <p className="text-lg font-bold">الدويل غير موجود</p>
          <button
            onClick={() => navigate('/player/decks')}
            className="text-primary text-sm hover:underline"
          >
            العودة للـ Decks
          </button>
        </div>
      </div>
    )
  }

  const players = duel.players || {}
  const playerUids = Object.keys(players)
  const isCreator = duel.creator_uid === uid
  const isInDuel = uid && playerUids.includes(uid)
  const isVisitor = uid && !isInDuel

  return (
    <div className="min-h-screen bg-background text-white flex flex-col items-center justify-center p-6" dir="rtl">
      <div className="w-full max-w-sm space-y-6">

        {/* Deck info */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-primary/10 border border-primary/20 rounded-2xl flex items-center justify-center mx-auto">
            <Swords size={28} className="text-primary" />
          </div>
          <h1 className="text-xl font-bold font-display">{duel.deck_title}</h1>
          <p className="text-gray-400 text-sm font-mono">{duel.total_questions} سؤال · دويل 1v1</p>
        </div>

        {/* Players */}
        <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-gray-400 text-sm font-bold">
            <Users size={14} />
            اللاعبون
          </div>
          {playerUids.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-2">لا يوجد لاعبون بعد</p>
          ) : (
            playerUids.map(pUid => {
              const p = players[pUid]
              return (
                <div key={pUid} className="flex items-center gap-3">
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-gray-700" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-500 text-sm font-bold">
                      {(p.nickname || '?')[0]}
                    </div>
                  )}
                  <span className="text-white text-sm font-bold">{p.nickname}</span>
                  {pUid === duel.creator_uid && (
                    <span className="text-xs text-primary font-mono bg-primary/10 px-2 py-0.5 rounded-full">مُنشئ</span>
                  )}
                </div>
              )
            })
          )}
          {/* Waiting slot */}
          {playerUids.length < 2 && (
            <div className="flex items-center gap-3 opacity-40">
              <div className="w-9 h-9 rounded-full bg-gray-800 border border-dashed border-gray-600 flex items-center justify-center">
                <Loader2 size={14} className="animate-spin text-gray-500" />
              </div>
              <span className="text-gray-500 text-sm">في انتظار الخصم...</span>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        {/* Actions */}
        {isVisitor && duel.status === 'waiting' && (
          <button
            onClick={joinDuel}
            disabled={joining}
            className="w-full flex items-center justify-center gap-3 bg-primary text-background font-bold py-4 rounded-2xl text-lg hover:bg-[#00D4FF] transition-colors active:scale-95 disabled:opacity-60"
          >
            {joining ? (
              <><Loader2 size={20} className="animate-spin" /> جاري الانضمام...</>
            ) : (
              <><Swords size={20} /> الانضمام للدويل</>
            )}
          </button>
        )}

        {isInDuel && duel.status === 'waiting' && (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 py-3 text-gray-400">
              <Loader2 size={16} className="animate-spin text-primary" />
              <span className="text-sm">في انتظار خصم...</span>
            </div>

            {isCreator && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 text-center">شارك الرابط مع صديقك</p>
                <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3">
                  <span className="flex-1 text-xs text-gray-400 font-mono truncate">{inviteLink}</span>
                  <button
                    onClick={copyLink}
                    className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${copied ? 'text-green-400 bg-green-500/10' : 'text-gray-400 hover:text-primary hover:bg-primary/10'}`}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
                {copied && <p className="text-xs text-green-400 text-center font-mono">تم النسخ!</p>}
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => navigate('/player/decks')}
          className="w-full py-3 text-gray-600 hover:text-gray-400 transition-colors text-sm font-bold"
        >
          العودة للـ Decks
        </button>
      </div>
    </div>
  )
}
