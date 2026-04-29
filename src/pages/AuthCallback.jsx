import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

export default function AuthCallback() {
  const navigate = useNavigate()
  const { session, profile, loading } = useAuthStore()

  useEffect(() => {
    if (loading) return
    if (session && profile) {
      if (profile.role === 'owner') navigate('/owner/dashboard', { replace: true })
      else if (profile.role === 'host') navigate('/host/dashboard', { replace: true })
      else navigate('/player/join', { replace: true })
    } else {
      navigate('/', { replace: true })
    }
  }, [session, profile, loading, navigate])

  return (
    <div className="paper-grain" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)',
    }}>
      <style>{`@keyframes mr-spin-slow { to { transform: rotate(360deg) } }`}</style>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none"
          style={{ animation: 'mr-spin-slow 2.4s linear infinite' }}>
          <circle cx="26" cy="26" r="24" stroke="var(--rule)" strokeWidth="1.5" fill="none" />
          <circle cx="26" cy="26" r="24" stroke="var(--ink)" strokeWidth="1.5" fill="none"
            strokeDasharray="150 151" strokeLinecap="round" />
          <text x="26" y="32" textAnchor="middle"
            style={{ fontFamily: 'var(--serif)', fontSize: 16, fontWeight: 500, fill: 'var(--ink)' }}>
            MR
          </text>
        </svg>
        <div className="folio" style={{ color: 'var(--ink-3)', letterSpacing: '0.16em' }}>
          VERIFYING IDENTITY…
        </div>
      </div>
    </div>
  )
}
