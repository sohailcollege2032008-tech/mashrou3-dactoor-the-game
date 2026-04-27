import React, { useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ref, get, set, update } from 'firebase/database'
import { rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'

export default function JoinGame() {
  const { profile, session } = useAuth()
  const [code, setCode]         = useState('')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading]   = useState(false)
  const [previewStatus, setPreviewStatus] = useState(null)
  const navigate = useNavigate()
  const inputRef = useRef(null)

  React.useEffect(() => {
    if (profile?.display_name && !nickname)
      setNickname(profile.display_name)
  }, [profile?.display_name])

  React.useEffect(() => {
    if (code.length !== 6) { setPreviewStatus(null); return }
    let cancelled = false
    get(ref(rtdb, `rooms/${code.toUpperCase()}/status`)).then(snap => {
      if (!cancelled) setPreviewStatus(snap.exists() ? snap.val() : 'not_found')
    }).catch(() => {})
    return () => { cancelled = true }
  }, [code])

  const handleJoin = async (e) => {
    e.preventDefault()
    if (!code || code.length !== 6) return
    setLoading(true)
    const roomCode = code.toUpperCase()
    try {
      const roomSnap = await get(ref(rtdb, `rooms/${roomCode}`))
      if (!roomSnap.exists()) { alert('Invalid Room Code'); setLoading(false); return }
      const roomData = roomSnap.val()
      if (roomData.status === 'finished') { alert('هذه المسابقة انتهت بالفعل'); setLoading(false); return }
      const userId = session.uid
      const playerSnap = await get(ref(rtdb, `rooms/${roomCode}/players/${userId}`))
      if (playerSnap.exists()) { navigate(`/player/game/${roomCode}`); return }
      const existingSnap = await get(ref(rtdb, `rooms/${roomCode}/join_requests/${userId}`))
      if (existingSnap.exists()) {
        const existing = existingSnap.val()
        if (existing.status === 'approved') {
          navigate(`/player/game/${roomCode}`)
        } else if (existing.status === 'rejected') {
          await update(ref(rtdb, `rooms/${roomCode}/join_requests/${userId}`), { status: 'pending', created_at: Date.now() })
          navigate(`/player/waiting/${roomCode}`)
        } else {
          navigate(`/player/waiting/${roomCode}`)
        }
      } else {
        await set(ref(rtdb, `rooms/${roomCode}/join_requests/${userId}`), {
          player_id:     userId,
          player_email:  profile.email,
          player_name:   nickname.trim() || profile.display_name || profile.email,
          player_avatar: profile.avatar_url || null,
          status:        'pending',
          created_at:    Date.now(),
        })
        navigate(`/player/waiting/${roomCode}`)
      }
    } catch (err) {
      alert('Error joining: ' + err.message)
    }
    setLoading(false)
  }

  const gameInProgress = previewStatus === 'playing' || previewStatus === 'revealing'

  return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)',
        padding: '13px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Link to="/player/dashboard" style={{
          fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--ink-3)', textDecoration: 'none',
        }}>← Back</Link>

        <svg width={28} height={28} viewBox="0 0 100 100" fill="none" aria-label="Med Royale">
          <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>

        <span className="folio">Join · Room</span>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>

          {/* Chapter label */}
          <p className="folio" style={{ textAlign: 'center', marginBottom: 16, letterSpacing: '0.28em' }}>— CHAPTER II · ADMISSION —</p>

          {/* Headline */}
          <h1 style={{
            fontFamily: 'var(--serif)', fontWeight: 400,
            fontSize: 'clamp(30px, 7vw, 52px)', lineHeight: 1.0,
            letterSpacing: '-0.025em', margin: '0 0 40px', textAlign: 'center',
            color: 'var(--ink)',
          }}>
            What is the<br />
            <em style={{ fontWeight: 300 }}>room code?</em>
          </h1>

          <form onSubmit={handleJoin}>

            {/* ── Character boxes ───────────────────────────────────── */}
            <div
              style={{ position: 'relative', marginBottom: 12, cursor: 'text' }}
              onClick={() => inputRef.current?.focus()}
            >
              <div style={{ display: 'flex', justifyContent: 'center', gap: 5, pointerEvents: 'none' }}>
                {[0, 1, 2, null, 3, 4, 5].map((charIdx, i) => {
                  if (charIdx === null) return (
                    <div key="sep" style={{
                      width: 14, display: 'flex', alignItems: 'flex-end',
                      paddingBottom: 14, justifyContent: 'center',
                      fontFamily: 'var(--mono)', fontSize: 18, color: 'var(--rule)',
                    }}>—</div>
                  )
                  const ch = code[charIdx] || ''
                  return (
                    <div key={i} style={{
                      width: 44, height: 68,
                      border: '1px solid var(--ink)', borderBottomWidth: 2,
                      background: ch ? 'var(--paper-2)' : 'var(--paper)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--serif)', fontSize: 30, fontWeight: 500,
                      color: 'var(--ink)', transition: 'background 120ms',
                    }}>{ch}</div>
                  )
                })}
              </div>
              <input
                ref={inputRef}
                type="text"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
                style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'text' }}
                autoComplete="off"
                autoFocus
              />
            </div>

            <p style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--ink-4)', textAlign: 'center', marginBottom: 32 }}>
              Ask your host for the 6-character code.
            </p>

            {/* ── Nickname ─────────────────────────────────────────── */}
            <div style={{ marginBottom: 16 }}>
              <div className="folio" style={{ marginBottom: 8 }}>Nickname</div>
              <input
                type="text"
                placeholder="اسمك في اللعبة"
                maxLength={30}
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                dir="rtl"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: '1px solid var(--rule)', borderBottomWidth: '2px',
                  borderColor: 'var(--ink)', background: 'var(--paper-2)',
                  color: 'var(--ink)', fontFamily: 'var(--arabic)', fontSize: 15,
                  padding: '11px 14px', outline: 'none',
                  transition: 'border-color 150ms',
                }}
              />
            </div>

            {/* ── Game-in-progress notice ───────────────────────────── */}
            {gameInProgress && (
              <div style={{
                border: '1px solid var(--gold)', background: 'rgba(176,137,68,0.06)',
                padding: '12px 16px', marginBottom: 16,
              }}>
                <p className="ar" style={{ fontWeight: 600, fontSize: 13, color: 'var(--gold)', margin: 0 }}>الجيم شغال دلوقتى!</p>
                <p className="ar" style={{ fontSize: 12, color: 'var(--ink-3)', margin: '4px 0 0' }}>لو الهوست قبلك هتدخل وتحل الأسئلة الباقية.</p>
              </div>
            )}

            {/* ── Submit ───────────────────────────────────────────── */}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '14px 20px', background: 'var(--ink)', color: 'var(--paper)',
                border: '1px solid var(--ink)', fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 500,
                cursor: loading || code.length !== 6 ? 'not-allowed' : 'pointer',
                opacity: loading || code.length !== 6 ? 0.4 : 1,
                transition: 'opacity 150ms',
              }}
            >
              {loading ? 'Requesting…' : gameInProgress ? 'اطلب الدخول' : 'Request to Join →'}
            </button>

          </form>
        </div>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid var(--rule)', padding: '12px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <button
          onClick={() => useAuthStore.getState().signOut()}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--ink-4)',
          }}
        >Sign Out</button>
        <span className="folio">Player · Join</span>
      </footer>

    </div>
  )
}
