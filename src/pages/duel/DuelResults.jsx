import React, { useEffect, useState } from 'react'
import MathText from '../../components/common/MathText'
import { useParams, useNavigate } from 'react-router-dom'
import { ref as rtdbRef, get as rtdbGet } from 'firebase/database'
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { rtdb, db } from '../../lib/firebase'
import { recordPlayedQuestions } from '../../utils/duelUtils'
import { useAuth } from '../../hooks/useAuth'
import { X } from 'lucide-react'

// ── Review Modal ──────────────────────────────────────────────────────────────
function ReviewModal({ duel, uid, onClose }) {
  const players = duel.players || {}
  const playerUids = Object.keys(players)
  const opponentUid = playerUids.find(p => p !== uid)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{
        position: 'relative', marginTop: 40,
        background: 'var(--paper)', borderTop: '3px double var(--rule-strong)',
        display: 'flex', flexDirection: 'column', maxHeight: '92vh',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--rule)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <span className="folio" style={{ letterSpacing: '0.2em' }}>ANSWER REVIEW</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', alignItems: 'center' }}>
            <X size={18} />
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px' }}>
          {Array.from({ length: duel.total_questions }).map((_, qi) => {
            const question = duel.questions?.[qi]
            if (!question) return null
            const answers = duel.answers?.[qi] || {}
            const myAnswer = answers[uid]
            const opponentAnswer = opponentUid ? answers[opponentUid] : null
            const correctIdx = answers.correct_reveal ?? question.correct
            const correctChoice = question.choices?.[correctIdx]

            return (
              <div key={qi} style={{
                border: '1px solid var(--rule)', marginBottom: 14,
                background: 'var(--paper)',
              }}>
                {/* Question header */}
                <div style={{
                  padding: '10px 14px', borderBottom: '1px solid var(--rule)',
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                }}>
                  <span style={{
                    minWidth: 22, height: 22, border: '1px solid var(--rule)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)',
                  }}>{qi + 1}</span>
                  <p dir={duel.force_rtl ? 'rtl' : 'auto'} style={{ fontFamily: 'var(--serif)', fontSize: 14, color: 'var(--ink)', margin: 0, lineHeight: 1.5, flex: 1 }}>
                    <MathText text={question.question} dir={duel.force_rtl ? 'rtl' : 'auto'} />
                  </p>
                </div>

                {/* Correct answer */}
                <div style={{
                  padding: '8px 14px', borderBottom: '1px solid var(--rule)',
                  background: 'rgba(34,197,94,0.06)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#22c55e', fontWeight: 700 }}>✓</span>
                  <span dir={duel.force_rtl ? 'rtl' : 'auto'} style={{ fontFamily: 'var(--serif)', fontSize: 13, color: 'var(--ink)', flex: 1 }}>
                    <MathText text={correctChoice} dir={duel.force_rtl ? 'rtl' : 'auto'} />
                  </span>
                  <span className="folio" style={{ color: '#22c55e', letterSpacing: '0.12em', fontSize: 9 }}>CORRECT</span>
                </div>

                {/* My answer vs opponent */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: 'none' }}>
                  {[
                    { label: 'أنت', answer: myAnswer },
                    { label: 'خصمك', answer: opponentAnswer },
                  ].map(({ label, answer }, idx) => (
                    <div key={idx} style={{ padding: '10px 14px', borderRight: idx === 0 ? '1px solid var(--rule)' : 'none' }}>
                      <p className="ar" style={{ fontSize: 11, color: 'var(--ink-4)', margin: '0 0 6px' }}>{label}</p>
                      {answer ? (
                        <div style={{
                          padding: '7px 10px',
                          border: `1px solid ${answer.is_correct ? '#22c55e' : 'var(--alert)'}`,
                          background: answer.is_correct ? 'rgba(34,197,94,0.05)' : 'rgba(180,48,57,0.05)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: answer.is_correct ? '#22c55e' : 'var(--alert)', fontWeight: 700 }}>
                              {answer.is_correct ? '✓' : '✗'}
                            </span>
                            <span dir={duel.force_rtl ? 'rtl' : 'auto'} style={{ fontFamily: 'var(--serif)', fontSize: 12, color: 'var(--ink)' }}>
                              <MathText text={question.choices?.[answer.selected_choice] ?? '—'} dir={duel.force_rtl ? 'rtl' : 'auto'} />
                            </span>
                          </div>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)' }}>
                            {answer.reaction_time_ms}ms
                          </span>
                        </div>
                      ) : (
                        <div style={{ padding: '7px 10px', border: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
                          <span className="ar" style={{ fontSize: 12, color: 'var(--ink-4)' }}>لم يجب</span>
                        </div>
                      )}
                    </div>
                  ))}
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

  const [duel, setDuel]               = useState(null)
  const [loading, setLoading]         = useState(true)
  const [showReview, setShowReview]   = useState(false)
  const [playerProfiles, setPlayerProfiles] = useState({})

  useEffect(() => {
    if (!duelId) return
    rtdbGet(rtdbRef(rtdb, `duels/${duelId}`)).then(async snap => {
      const data = snap.val()
      setDuel(data)
      setLoading(false)

      if (data?.players) {
        const missingUids = Object.entries(data.players)
          .filter(([, p]) => !p?.nickname)
          .map(([u]) => u)
        if (missingUids.length > 0) {
          const fetched = {}
          await Promise.all(missingUids.map(async u => {
            try {
              const snap = await getDoc(doc(db, 'profiles', u))
              if (snap.exists()) fetched[u] = snap.data()
            } catch { /* ignore */ }
          }))
          setPlayerProfiles(fetched)
        }
      }

      if (data && uid && data.deck_id && Array.isArray(data.questions)) {
        const playedTexts = data.questions.map(q => q.question).filter(Boolean)
        recordPlayedQuestions(uid, data.deck_id, playedTexts)
      }

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
          if (data.surrender_by) outcome = 'draw_surrender'

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

  /* ── Loading ────────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="40" height="40" viewBox="0 0 100 100" fill="none" style={{ animation: 'mr-spin-slow 10s linear infinite' }}>
          <circle cx="50" cy="50" r="46" stroke="var(--rule)" strokeWidth="1" />
          <circle cx="50" cy="50" r="36" stroke="var(--ink)" strokeWidth="1.5" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="22" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>
        <style>{`@keyframes mr-spin-slow { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  /* ── Not found ──────────────────────────────────────────────────────────── */
  if (!duel) {
    return (
      <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <p className="folio" style={{ letterSpacing: '0.28em' }}>DUEL · RESULTS</p>
        <p className="ar" style={{ fontSize: 14, color: 'var(--ink-3)' }}>النتيجة غير متوفرة</p>
        <button onClick={() => navigate('/player/dashboard')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
          ← الرئيسية
        </button>
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
  if (duel.forfeit_by === opponentUid) outcome = 'win_forfeit'
  if (duel.forfeit_by === uid) outcome = 'lose_forfeit'
  if (duel.surrender_by) outcome = 'draw_surrender'

  const outcomeConfig = {
    win:           { headline: 'Victory.',   sub: 'فزت!',            color: 'var(--gold)',    folio: 'WIN' },
    lose:          { headline: 'Defeat.',    sub: 'خسرت.',           color: 'var(--alert)',   folio: 'LOSE' },
    tie:           { headline: 'Draw.',      sub: 'تعادل!',          color: 'var(--navy)',    folio: 'DRAW' },
    win_forfeit:   { headline: 'Victory.',   sub: 'فزت بالانسحاب',  color: 'var(--gold)',    folio: 'WIN — FORFEIT' },
    lose_forfeit:  { headline: 'Defeat.',    sub: 'خسرت بالانسحاب', color: 'var(--alert)',   folio: 'LOSE — FORFEIT' },
    draw_surrender:{ headline: 'Draw.',      sub: 'تعادل بالاستسلام', color: 'var(--navy)',  folio: 'DRAW — SURRENDER' },
  }[outcome] ?? { headline: 'Finished.', sub: 'انتهت اللعبة', color: 'var(--ink-3)', folio: 'END' }

  function PlayerPanel({ player, playerUid, score, isMe }) {
    if (!player && !playerUid) return null
    const prof      = playerProfiles[playerUid] || {}
    const nickname  = player?.nickname || prof.display_name || 'لاعب'
    const avatarUrl = player?.avatar_url || prof.avatar_url || ''
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        padding: '16px 12px', border: `1px solid ${isMe ? 'var(--ink)' : 'var(--rule)'}`,
        background: isMe ? 'var(--paper-2)' : 'var(--paper)',
      }}>
        <button
          onClick={() => playerUid && !isMe && navigate(`/player/profile/${playerUid}`)}
          style={{ cursor: !isMe && playerUid ? 'pointer' : 'default', background: 'none', border: 'none', padding: 0 }}
        >
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            border: `2px solid ${isMe ? 'var(--ink)' : 'var(--rule)'}`,
            overflow: 'hidden', background: 'var(--paper-3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 500, color: 'var(--ink)' }}>
                  {nickname[0]}
                </span>
            }
          </div>
        </button>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 500, color: 'var(--ink)', margin: 0, textAlign: 'center', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nickname}
        </p>
        <p style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 700, color: 'var(--ink)', margin: 0, lineHeight: 1 }}>
          {score}
        </p>
        {isMe && <span className="folio" style={{ color: 'var(--ink-3)', letterSpacing: '0.15em', fontSize: 9 }}>YOU</span>}
      </div>
    )
  }

  return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)',
        padding: '13px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span className="folio" style={{ flex: 1 }}>Duel · Results</span>
        <svg width={28} height={28} viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>
        <span className="folio" style={{ flex: 1, textAlign: 'right', color: outcomeConfig.color }}>{outcomeConfig.folio}</span>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>

          {/* Headline */}
          <h1 style={{
            fontFamily: 'var(--serif)', fontWeight: 400,
            fontSize: 'clamp(44px, 10vw, 72px)', lineHeight: 1.0,
            letterSpacing: '-0.025em', margin: '0 0 6px', textAlign: 'center',
            color: 'var(--ink)',
          }}>
            {outcomeConfig.headline}
          </h1>
          <p className="ar" style={{ textAlign: 'center', fontSize: 14, color: outcomeConfig.color, fontWeight: 600, marginBottom: 28 }}>
            {outcomeConfig.sub}
          </p>

          {/* ── Player panels ──────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
            <PlayerPanel player={me} playerUid={uid} score={myScore} isMe={true} />
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 10px', background: 'var(--paper)', border: '1px solid var(--rule)', borderLeft: 'none', borderRight: 'none' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>vs</span>
            </div>
            <PlayerPanel player={opponent} playerUid={opponentUid} score={opponentScore} isMe={false} />
          </div>

          {/* Deck info */}
          <p className="folio" style={{ textAlign: 'center', marginBottom: 24, letterSpacing: '0.15em', color: 'var(--ink-4)' }}>
            {duel.deck_title} · {duel.total_questions} QUESTIONS
          </p>

          {/* ── Actions ──────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={() => setShowReview(true)}
              style={{
                width: '100%', padding: '13px 20px',
                background: 'var(--paper-2)', color: 'var(--ink)',
                border: '1px solid var(--rule)', borderBottomWidth: 2,
                fontFamily: 'var(--arabic)', fontSize: 14, cursor: 'pointer',
              }}
            >
              مراجعة الإجابات
            </button>
            <button
              onClick={() => navigate('/player/dashboard')}
              style={{
                width: '100%', padding: '13px 20px',
                background: 'var(--ink)', color: 'var(--paper)',
                border: '1px solid var(--ink)',
                fontFamily: 'var(--arabic)', fontSize: 14, cursor: 'pointer',
              }}
            >
              الرئيسية
            </button>
            <button
              onClick={() => navigate('/player/decks')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'var(--ink-4)', padding: '8px 0',
              }}
            >
              تصفح Decks أخرى →
            </button>
          </div>

        </div>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid var(--rule)', padding: '12px 20px',
        display: 'flex', justifyContent: 'center',
      }}>
        <span className="folio">Player · Duel Results</span>
      </footer>

      {/* Review modal */}
      {showReview && <ReviewModal duel={duel} uid={uid} onClose={() => setShowReview(false)} />}

    </div>
  )
}
