import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ref, onValue, get } from 'firebase/database'
import { rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'

export default function WaitingRoom() {
  const { roomId } = useParams()
  const { session } = useAuth()
  const navigate    = useNavigate()
  const [status,     setStatus]     = useState('pending')
  const [roomStatus, setRoomStatus] = useState('lobby')

  useEffect(() => {
    const unsub = onValue(ref(rtdb, `rooms/${roomId}/status`), snap => {
      if (snap.exists()) setRoomStatus(snap.val())
    })
    return () => unsub()
  }, [roomId])

  useEffect(() => {
    if (!session) return
    const userId = session.uid

    get(ref(rtdb, `rooms/${roomId}/join_requests/${userId}`)).then(snap => {
      if (snap.exists()) {
        const data = snap.val()
        setStatus(data.status)
        if (data.status === 'approved') navigate(`/player/game/${roomId}`)
      }
    })

    const unsub = onValue(ref(rtdb, `rooms/${roomId}/join_requests/${userId}/status`), snap => {
      if (!snap.exists()) return
      const val = snap.val()
      setStatus(val)
      if (val === 'approved') navigate(`/player/game/${roomId}`)
    })
    return () => unsub()
  }, [roomId, session, navigate])

  const gameInProgress = roomStatus === 'playing' || roomStatus === 'revealing'
  const isRejected     = status === 'rejected'

  return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)',
        padding: '13px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span className="folio" style={{ flex: 1 }}>Waiting</span>

        <svg width={28} height={28} viewBox="0 0 100 100" fill="none" aria-label="Med Royale">
          <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>

        <span className="folio" style={{ flex: 1, textAlign: 'right' }}>Room · {roomId}</span>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '40px 20px', textAlign: 'center',
      }}>

        {/* Pulsing monogram (pending state only) */}
        {!isRejected && (
          <div style={{ position: 'relative', width: 104, height: 104, marginBottom: 40 }}>
            <svg width="104" height="104" viewBox="0 0 100 100" fill="none"
              style={{ animation: 'mr-spin-slow 10s linear infinite' }}>
              <circle cx="50" cy="50" r="46" stroke="var(--rule)" strokeWidth="1" />
              <circle cx="50" cy="50" r="36" stroke="var(--ink)" strokeWidth="1.5" />
              <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
                fontFamily="Fraunces, Georgia, serif" fontSize="26" fontWeight="500" fill="var(--ink)">MR</text>
            </svg>
            <div style={{
              position: 'absolute', inset: -14,
              border: '1px solid var(--rule)', borderRadius: '50%',
              animation: 'mr-ring-pulse 2.6s ease-in-out infinite',
            }} />
            <style>{`
              @keyframes mr-spin-slow  { to { transform: rotate(360deg); } }
              @keyframes mr-ring-pulse { 0%,100%{transform:scale(1);opacity:0.6} 50%{transform:scale(1.1);opacity:0.15} }
            `}</style>
          </div>
        )}

        {/* Chapter label */}
        <p className="folio" style={{ marginBottom: 14, letterSpacing: '0.28em' }}>
          ROOM Nº {roomId} · {isRejected ? 'REJECTED' : 'PENDING'}
        </p>

        {/* Headline */}
        <h1 style={{
          fontFamily: 'var(--serif)', fontWeight: 400,
          fontSize: 'clamp(34px, 8vw, 60px)', lineHeight: 1.0,
          letterSpacing: '-0.025em', margin: '0 0 24px', color: 'var(--ink)',
        }}>
          {isRejected ? (
            <>Request<br /><em style={{ fontWeight: 300, color: 'var(--alert)' }}>rejected.</em></>
          ) : (
            <>Awaiting<br /><em style={{ fontWeight: 300, color: 'var(--burgundy)' }}>the host.</em></>
          )}
        </h1>

        {/* Status messages */}
        {!isRejected && !gameInProgress && (
          <p className="ar" style={{ fontSize: 15, color: 'var(--ink-3)', maxWidth: 280, lineHeight: 1.75, margin: 0 }}>
            الهوست لازم يوافق عليك الأول عشان تدخل.
          </p>
        )}

        {!isRejected && gameInProgress && (
          <div style={{
            border: '1px solid var(--gold)', background: 'rgba(176,137,68,0.06)',
            padding: '16px 20px', maxWidth: 300,
          }}>
            <p className="ar" style={{ fontWeight: 600, fontSize: 14, color: 'var(--gold)', margin: 0 }}>الجيم بدأ فعلاً!</p>
            <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: '6px 0 0' }}>لو الهوست قبلك هتدخل وتحل الأسئلة الباقية.</p>
          </div>
        )}

        {isRejected && (
          <p className="ar" style={{ fontSize: 15, color: 'var(--ink-3)', margin: 0 }}>
            ممكن تقفل الصفحة دي.
          </p>
        )}

      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid var(--rule)', padding: '12px 20px',
        display: 'flex', justifyContent: 'center',
      }}>
        <span className="folio">Player · Waiting Room</span>
      </footer>

    </div>
  )
}
