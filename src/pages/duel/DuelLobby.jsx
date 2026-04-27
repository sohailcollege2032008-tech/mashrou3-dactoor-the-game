import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ref as rtdbRef, onValue, update, remove } from 'firebase/database'
import { doc, getDoc } from 'firebase/firestore'
import { rtdb, db } from '../../lib/firebase'
import { fetchPlayedQuestions, applyDuelConfig, stripCorrectForRtdb } from '../../utils/duelUtils'
import { useAuth } from '../../hooks/useAuth'
import { Copy, Check } from 'lucide-react'

export default function DuelLobby() {
  const { duelId } = useParams()
  const navigate = useNavigate()
  const { session, profile } = useAuth()

  const [duel, setDuel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)

  const uid = session?.uid

  useEffect(() => {
    if (!duelId) return
    const unsub = onValue(rtdbRef(rtdb, `duels/${duelId}`), snap => {
      const data = snap.val()
      setDuel(data)
      setLoading(false)
      const isPlayer = uid && data?.players && uid in (data?.players || {})
      if (isPlayer && (data?.status === 'playing' || data?.status === 'revealing')) {
        navigate(`/duel/game/${duelId}`, { replace: true })
      }
      if (isPlayer && data?.status === 'finished') {
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
      const deckDoc = await getDoc(doc(db, 'question_sets', duel.deck_id))
      const rawQuestions = deckDoc.data()?.questions?.questions || []

      const [creatorPlayed, joinerPlayed] = await Promise.all([
        fetchPlayedQuestions(duel.creator_uid, duel.deck_id),
        fetchPlayedQuestions(uid, duel.deck_id),
      ])
      const allPlayed = [...new Set([...creatorPlayed, ...joinerPlayed])]
      const creatorPlayedSet = new Set(creatorPlayed)
      const joinerPlayedSet  = new Set(joinerPlayed)

      const questions = applyDuelConfig(rawQuestions, duel.config || {}, allPlayed)
        .map(q => ({
          ...q,
          played_by_uids: [
            ...(creatorPlayedSet.has(q.question) ? [duel.creator_uid] : []),
            ...(joinerPlayedSet.has(q.question)  ? [uid]              : []),
          ],
        }))

      if (questions.length === 0) throw new Error('لا توجد أسئلة متاحة بعد تطبيق الإعدادات')

      const safeQuestions = await stripCorrectForRtdb(questions, duelId)

      await update(rtdbRef(rtdb, `duels/${duelId}`), {
        [`players/${uid}`]: {
          uid,
          nickname: profile?.display_name || 'لاعب',
          avatar_url: profile?.avatar_url || '',
          score: 0,
        },
        questions: safeQuestions,
        total_questions: safeQuestions.length,
        status: 'playing',
        question_started_at: Date.now(),
      })
      await remove(rtdbRef(rtdb, `duel_queue/${duel.deck_id}/${duel.creator_uid}`))
    } catch (e) {
      console.error(e)
      setError(e.message || 'فشل الانضمام. حاول مرة أخرى.')
      setJoining(false)
    }
  }, [duel, joining, uid, duelId, profile])

  const cancelDuel = useCallback(async () => {
    if (!duel || cancelling || !uid) return
    setCancelling(true)
    try {
      await remove(rtdbRef(rtdb, `duel_queue/${duel.deck_id}/${uid}`))
      await remove(rtdbRef(rtdb, `duels/${duelId}`))
      navigate('/player/decks', { replace: true })
    } catch (e) {
      console.error(e)
      setCancelling(false)
    }
  }, [duel, cancelling, uid, duelId, navigate])

  /* ── Loading ────────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <svg width="48" height="48" viewBox="0 0 100 100" fill="none"
            style={{ animation: 'mr-spin-slow 10s linear infinite' }}>
            <circle cx="50" cy="50" r="46" stroke="var(--rule)" strokeWidth="1" />
            <circle cx="50" cy="50" r="36" stroke="var(--ink)" strokeWidth="1.5" />
            <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
              fontFamily="Fraunces, Georgia, serif" fontSize="22" fontWeight="500" fill="var(--ink)">MR</text>
          </svg>
          <style>{`@keyframes mr-spin-slow { to { transform: rotate(360deg); } }`}</style>
          <span className="folio">Loading…</span>
        </div>
      </div>
    )
  }

  /* ── Not found ─────────────────────────────────────────────────────────── */
  if (!duel) {
    return (
      <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24, textAlign: 'center' }}>
        <p className="folio" style={{ letterSpacing: '0.28em' }}>DUEL · NOT FOUND</p>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(32px, 7vw, 52px)', fontWeight: 400, lineHeight: 1.0, letterSpacing: '-0.025em', margin: 0, color: 'var(--ink)' }}>
          This duel<br /><em style={{ fontWeight: 300, color: 'var(--alert)' }}>doesn't exist.</em>
        </h1>
        <button onClick={() => navigate('/player/decks')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
          ← Back to Decks
        </button>
      </div>
    )
  }

  const players    = duel.players || {}
  const playerUids = Object.keys(players)
  const isCreator  = duel.creator_uid === uid
  const isInDuel   = uid && playerUids.includes(uid)
  const isVisitor  = uid && !isInDuel

  /* ── Visitor arrived after game started ─────────────────────────────────── */
  if (isVisitor && duel.status !== 'waiting') {
    return (
      <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 24, textAlign: 'center' }}>
        <svg width="56" height="56" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="46" stroke="var(--rule)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="36" stroke="var(--ink)" strokeWidth="1" opacity="0.4" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="26" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>
        <p className="folio" style={{ letterSpacing: '0.28em' }}>DUEL · IN PROGRESS</p>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(32px, 7vw, 52px)', fontWeight: 400, lineHeight: 1.0, letterSpacing: '-0.025em', margin: 0, color: 'var(--ink)' }}>
          انتهت<br /><em style={{ fontWeight: 300, color: 'var(--alert)' }}>صلاحية الرابط.</em>
        </h1>
        <p className="ar" style={{ fontSize: 14, color: 'var(--ink-3)', margin: 0 }}>
          المباراة بدأت بالفعل ولا يمكن الانضمام
        </p>
        <button
          onClick={() => navigate('/player/decks')}
          style={{
            padding: '12px 24px', background: 'var(--ink)', color: 'var(--paper)',
            border: '1px solid var(--ink)', fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}
        >
          ابدأ دويل جديد
        </button>
      </div>
    )
  }

  /* ── Main lobby ─────────────────────────────────────────────────────────── */
  return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)',
        padding: '13px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button
          onClick={() => navigate('/player/decks')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}
        >
          ← Back
        </button>

        <svg width={28} height={28} viewBox="0 0 100 100" fill="none" aria-label="Med Royale">
          <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>

        <span className="folio" style={{ textAlign: 'right' }}>Duel · Lobby</span>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ width: '100%', maxWidth: 400 }}>

          {/* Chapter label */}
          <p className="folio" style={{ textAlign: 'center', marginBottom: 16, letterSpacing: '0.28em' }}>— CHAPTER I · DUEL —</p>

          {/* Headline */}
          <h1 style={{
            fontFamily: 'var(--serif)', fontWeight: 400,
            fontSize: 'clamp(30px, 7vw, 52px)', lineHeight: 1.0,
            letterSpacing: '-0.025em', margin: '0 0 8px', textAlign: 'center',
            color: 'var(--ink)',
          }}>
            Head to<br />
            <em style={{ fontWeight: 300, color: 'var(--burgundy)' }}>head.</em>
          </h1>

          {/* Deck title */}
          <p dir={duel.force_rtl ? 'rtl' : 'auto'} style={{
            fontFamily: 'var(--serif)', fontSize: 15, color: 'var(--ink-2)',
            textAlign: 'center', margin: '0 0 36px', lineHeight: 1.5,
          }}>
            {duel.deck_title}
          </p>

          {/* ── Player panels ──────────────────────────────────────────── */}
          <div style={{ border: '1px solid var(--rule)', borderBottom: 'none', marginBottom: 28 }}>

            {/* Section header */}
            <div style={{
              padding: '8px 14px',
              borderBottom: '1px solid var(--rule)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span className="folio" style={{ letterSpacing: '0.2em' }}>PLAYERS</span>
              <span className="folio" style={{ color: 'var(--ink-4)' }}>{playerUids.length} / 2</span>
            </div>

            {/* Player rows */}
            {playerUids.map(pUid => {
              const p = players[pUid]
              return (
                <div key={pUid} style={{
                  padding: '14px',
                  borderBottom: '1px solid var(--rule)',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  {/* Avatar */}
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    border: '1px solid var(--ink)',
                    overflow: 'hidden', flexShrink: 0,
                    background: 'var(--paper-3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {p.avatar_url
                      ? <img src={p.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                          {(p.nickname || '?')[0]}
                        </span>
                    }
                  </div>

                  <span style={{ fontFamily: 'var(--serif)', fontSize: 15, color: 'var(--ink)', flex: 1 }}>{p.nickname}</span>

                  {pUid === duel.creator_uid && (
                    <span className="folio" style={{ color: 'var(--burgundy)', letterSpacing: '0.15em' }}>HOST</span>
                  )}
                </div>
              )
            })}

            {/* Waiting slot */}
            {playerUids.length < 2 && (
              <div style={{
                padding: '14px',
                borderBottom: '1px solid var(--rule)',
                display: 'flex', alignItems: 'center', gap: 12,
                opacity: 0.4,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  border: '1px dashed var(--rule)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 18, color: 'var(--ink-3)' }}>?</span>
                </div>
                <span className="ar" style={{ fontSize: 13, color: 'var(--ink-3)' }}>في انتظار الخصم…</span>
              </div>
            )}
          </div>

          {/* ── Error ──────────────────────────────────────────────────── */}
          {error && (
            <div style={{
              border: '1px solid var(--alert)', background: 'rgba(180,48,57,0.06)',
              padding: '12px 16px', marginBottom: 16,
            }}>
              <p className="ar" style={{ fontSize: 13, color: 'var(--alert)', margin: 0 }}>{error}</p>
            </div>
          )}

          {/* ── Visitor: join button ────────────────────────────────────── */}
          {isVisitor && duel.status === 'waiting' && (
            <button
              onClick={joinDuel}
              disabled={joining}
              style={{
                width: '100%', padding: '14px 20px',
                background: 'var(--ink)', color: 'var(--paper)',
                border: '1px solid var(--ink)',
                fontFamily: 'var(--arabic)', fontSize: 16, fontWeight: 600,
                cursor: joining ? 'not-allowed' : 'pointer',
                opacity: joining ? 0.5 : 1,
                marginBottom: 12,
              }}
            >
              {joining ? 'جاري الانضمام…' : 'الانضمام للدويل'}
            </button>
          )}

          {/* ── Creator: waiting state ──────────────────────────────────── */}
          {isInDuel && duel.status === 'waiting' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Pulsing waiting indicator */}
              <div style={{
                border: '1px solid var(--rule)',
                padding: '16px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--burgundy)',
                  animation: 'mr-dot-pulse 1.6s ease-in-out infinite',
                }} />
                <span className="ar" style={{ fontSize: 13, color: 'var(--ink-3)' }}>في انتظار خصم…</span>
                <style>{`@keyframes mr-dot-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.6)} }`}</style>
              </div>

              {/* Invite link */}
              {isCreator && (
                <div>
                  <div className="folio" style={{ marginBottom: 8 }}>Invite Link</div>
                  <div style={{
                    border: '1px solid var(--rule)', borderBottomWidth: 2, borderColor: 'var(--ink)',
                    background: 'var(--paper-2)',
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px',
                  }}>
                    <span style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inviteLink}
                    </span>
                    <button
                      onClick={copyLink}
                      title="Copy"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
                        color: copied ? 'var(--burgundy)' : 'var(--ink-3)',
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                  </div>
                  {copied && (
                    <p className="folio" style={{ marginTop: 6, color: 'var(--burgundy)', letterSpacing: '0.18em' }}>COPIED ✓</p>
                  )}
                </div>
              )}

              {/* Cancel */}
              {isCreator && (
                <button
                  onClick={cancelDuel}
                  disabled={cancelling}
                  style={{
                    width: '100%', padding: '11px 20px',
                    background: 'transparent', color: 'var(--alert)',
                    border: '1px solid var(--alert)',
                    fontFamily: 'var(--arabic)', fontSize: 14,
                    cursor: cancelling ? 'not-allowed' : 'pointer',
                    opacity: cancelling ? 0.5 : 1,
                  }}
                >
                  {cancelling ? 'جاري الإلغاء…' : 'إلغاء الدويل'}
                </button>
              )}
            </div>
          )}

          {/* Back link */}
          <button
            onClick={() => navigate('/player/decks')}
            style={{
              marginTop: 20, background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: 'var(--ink-4)', display: 'block', width: '100%', textAlign: 'center',
            }}
          >
            ← Back to Decks
          </button>

        </div>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid var(--rule)', padding: '12px 20px',
        display: 'flex', justifyContent: 'center',
      }}>
        <span className="folio">Player · Duel Lobby</span>
      </footer>

    </div>
  )
}
