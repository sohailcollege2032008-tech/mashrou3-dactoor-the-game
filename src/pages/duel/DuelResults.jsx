import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ref as rtdbRef, get as rtdbGet } from 'firebase/database'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { rtdb, db } from '../../lib/firebase'
import { recordPlayedQuestions } from '../../utils/duelUtils'
import { useAuth } from '../../hooks/useAuth'
import { Home, ClipboardList, X, Trophy, Minus } from 'lucide-react'

// ── Log Review Modal ──────────────────────────────────────────────────────────
function ReviewModal({ duel, uid, onClose }) {
  const players = duel.players || {}
  const playerUids = Object.keys(players)
  const opponentUid = playerUids.find(p => p !== uid)

  return (
    <div className="fixed inset-0 z-50 flex flex-col" dir="rtl">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative flex flex-col bg-[#0A0E1A] border-t border-gray-700 rounded-t-2xl mt-12 max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <h2 className="text-lg font-bold font-display text-white">مراجعة الإجابات</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable list */}
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {Array.from({ length: duel.total_questions }).map((_, qi) => {
            const question = duel.questions?.[qi]
            if (!question) return null
            const answers = duel.answers?.[qi] || {}
            const myAnswer = answers[uid]
            const opponentAnswer = opponentUid ? answers[opponentUid] : null
            const correctChoice = question.choices?.[question.correct]

            return (
              <div key={qi} className="bg-gray-900/60 border border-gray-800 rounded-2xl p-4 space-y-3">
                {/* Question header */}
                <div className="flex items-start gap-2">
                  <span className="w-6 h-6 rounded-full bg-gray-800 text-gray-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {qi + 1}
                  </span>
                  <p className="text-white text-sm font-medium leading-snug">{question.question}</p>
                </div>

                {/* Correct answer */}
                <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-xl">
                  <span className="text-green-500 font-bold text-sm">✓</span>
                  <span className="text-green-300 text-sm font-medium">{correctChoice}</span>
                  <span className="text-xs text-green-600 font-mono mr-auto">الإجابة الصحيحة</span>
                </div>

                {/* My answer */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500 font-bold">أنت</p>
                    {myAnswer ? (
                      <div className={`px-3 py-2 rounded-xl border text-sm ${myAnswer.is_correct ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold">{myAnswer.is_correct ? '✓' : '✗'}</span>
                          <span className="leading-snug truncate">{question.choices?.[myAnswer.selected_choice] ?? '—'}</span>
                        </div>
                        <p className="text-xs font-mono mt-0.5 opacity-60">{myAnswer.reaction_time_ms}ms</p>
                      </div>
                    ) : (
                      <div className="px-3 py-2 rounded-xl border border-gray-700 bg-gray-800/40 text-gray-600 text-sm">
                        لم تجب
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500 font-bold">خصمك</p>
                    {opponentAnswer ? (
                      <div className={`px-3 py-2 rounded-xl border text-sm ${opponentAnswer.is_correct ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold">{opponentAnswer.is_correct ? '✓' : '✗'}</span>
                          <span className="leading-snug truncate">{question.choices?.[opponentAnswer.selected_choice] ?? '—'}</span>
                        </div>
                        <p className="text-xs font-mono mt-0.5 opacity-60">{opponentAnswer.reaction_time_ms}ms</p>
                      </div>
                    ) : (
                      <div className="px-3 py-2 rounded-xl border border-gray-700 bg-gray-800/40 text-gray-600 text-sm">
                        لم يجب
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DuelResults() {
  const { duelId } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const uid = session?.uid

  const [duel, setDuel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showReview, setShowReview] = useState(false)

  useEffect(() => {
    if (!duelId) return
    rtdbGet(rtdbRef(rtdb, `duels/${duelId}`)).then(async snap => {
      const data = snap.val()
      setDuel(data)
      setLoading(false)

      // ── Record played questions in Firestore (cross-device) ─────────────────
      if (data && uid && data.deck_id && Array.isArray(data.questions)) {
        const playedTexts = data.questions.map(q => q.question).filter(Boolean)
        recordPlayedQuestions(uid, data.deck_id, playedTexts)
      }

      // ── Write game history entry to Firestore ─────────────────────────────
      if (data && uid && duelId) {
        try {
          const players = data.players || {}
          const playerUids = Object.keys(players)
          const myPlayer = players[uid]
          const oppUid = playerUids.find(p => p !== uid)
          const opponent = oppUid ? players[oppUid] : null
          const myScore = myPlayer?.score ?? 0
          const opponentScore = opponent?.score ?? 0
          let outcome = 'tie'
          if (myScore > opponentScore) outcome = 'win'
          else if (myScore < opponentScore) outcome = 'lose'
          if (data.forfeit_by === oppUid) outcome = 'win_forfeit'
          if (data.forfeit_by === uid) outcome = 'lose_forfeit'

          // Use duelId as document ID to prevent duplicate history entries
          await setDoc(doc(db, 'profiles', uid, 'game_history', duelId), {
            type: 'duel',
            deck_id: data.deck_id || null,
            deck_title: data.deck_title || '',
            played_at: serverTimestamp(),
            opponent_uid: oppUid || null,
            opponent_name: opponent?.nickname || 'لاعب',
            my_score: myScore,
            opponent_score: opponentScore,
            outcome,
            total_questions: data.total_questions || 0,
          })
        } catch (e) {
          console.error('Failed to write duel history:', e)
        }
      }
    }).catch(e => {
      console.error(e)
      setLoading(false)
    })
  }, [duelId, uid])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!duel) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-gray-400" dir="rtl">
        <div className="text-center space-y-3">
          <p>النتيجة غير متوفرة</p>
          <button onClick={() => navigate('/player/dashboard')} className="text-primary text-sm hover:underline">
            الرئيسية
          </button>
        </div>
      </div>
    )
  }

  const players = duel.players || {}
  const playerUids = Object.keys(players)
  const me = uid ? players[uid] : null
  const opponentUid = playerUids.find(p => p !== uid)
  const opponent = opponentUid ? players[opponentUid] : null

  const myScore = me?.score ?? 0
  const opponentScore = opponent?.score ?? 0

  let outcome = 'tie'
  if (me && opponent) {
    if (myScore > opponentScore) outcome = 'win'
    else if (myScore < opponentScore) outcome = 'lose'
  }

  const outcomeConfig = {
    win:  { label: 'فزت! 🏆', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
    lose: { label: 'خسرت 😔', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30' },
    tie:  { label: 'تعادل!',   color: 'text-primary',    bg: 'bg-primary/10 border-primary/30' },
  }[outcome]

  function PlayerCard({ player, score, isMe }) {
    if (!player) return null
    return (
      <div className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-2xl border ${isMe ? 'bg-primary/5 border-primary/20' : 'bg-gray-900/60 border-gray-800'}`}>
        {player.avatar_url ? (
          <img src={player.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-gray-700" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center text-xl font-bold text-gray-400">
            {(player.nickname || '?')[0]}
          </div>
        )}
        <p className="text-white text-sm font-bold text-center max-w-full truncate px-1">{player.nickname}</p>
        <p className={`text-2xl font-bold font-mono ${isMe ? 'text-primary' : 'text-white'}`}>{score}</p>
        {isMe && <p className="text-xs text-gray-500">أنت</p>}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-white flex flex-col items-center justify-center p-6" dir="rtl">
      <div className="w-full max-w-sm space-y-6">

        {/* Outcome badge */}
        <div className={`flex items-center justify-center gap-2 py-4 rounded-2xl border ${outcomeConfig.bg}`}>
          {outcome === 'win' && <Trophy size={24} className="text-yellow-400" />}
          {outcome === 'tie' && <Minus size={24} className="text-primary" />}
          <span className={`text-2xl font-bold font-display ${outcomeConfig.color}`}>
            {outcomeConfig.label}
          </span>
        </div>

        {/* Players side by side */}
        <div className="flex gap-3">
          <PlayerCard player={me} score={myScore} isMe={true} />
          <div className="flex items-center text-gray-600 font-bold text-lg">vs</div>
          <PlayerCard player={opponent} score={opponentScore} isMe={false} />
        </div>

        {/* Deck info */}
        <p className="text-center text-gray-500 text-sm font-mono">{duel.deck_title} · {duel.total_questions} سؤال</p>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={() => setShowReview(true)}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-gray-800 hover:bg-gray-700 text-white font-bold rounded-2xl transition-colors"
          >
            <ClipboardList size={18} />
            مراجعة الإجابات
          </button>
          <button
            onClick={() => navigate('/player/dashboard')}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary/10 border border-primary/30 hover:bg-primary/20 text-primary font-bold rounded-2xl transition-colors"
          >
            <Home size={18} />
            الرئيسية
          </button>
          <button
            onClick={() => navigate('/player/decks')}
            className="w-full py-3 text-gray-600 hover:text-gray-400 transition-colors text-sm font-bold"
          >
            تصفح Decks أخرى
          </button>
        </div>
      </div>

      {/* Review modal */}
      {showReview && (
        <ReviewModal duel={duel} uid={uid} onClose={() => setShowReview(false)} />
      )}
    </div>
  )
}
