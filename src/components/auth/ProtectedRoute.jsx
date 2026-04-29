import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'

/* ── Shared loading screen ─────────────────────────────────────────────────── */
function LoadingScreen({ label = 'جاري استعادة الجلسة' }) {
  return (
    <div className="paper-grain" style={{
      minHeight: '100svh', background: 'var(--paper)', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0,
    }}>
      <style>{`
        @keyframes mr-spin-slow { to { transform: rotate(360deg); } }
        @keyframes mr-ring-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
      `}</style>

      {/* MR monogram with spinning outer ring */}
      <div style={{ position: 'relative', width: 72, height: 72, marginBottom: 28 }}>
        <svg
          width={72} height={72} viewBox="0 0 100 100"
          style={{ animation: 'mr-spin-slow 3s linear infinite', display: 'block' }}
        >
          <circle cx="50" cy="50" r="46" fill="none" stroke="var(--rule)" strokeWidth="1.5"
            strokeDasharray="6 4" />
        </svg>
        <svg width={72} height={72} viewBox="0 0 100 100"
          style={{ position: 'absolute', inset: 0, display: 'block' }}>
          <circle cx="50" cy="50" r="38" fill="none" stroke="var(--ink)" strokeWidth="1.2" opacity="0.15" />
          <text x="50" y="54" textAnchor="middle" dominantBaseline="middle"
            fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500"
            fill="var(--ink)" style={{ fontVariationSettings: '"opsz" 72' }}>
            M<tspan dx="-3" fontStyle="italic" fontWeight="400">R</tspan>
          </text>
        </svg>
      </div>

      {/* Double rule */}
      <div style={{ width: 48, borderTop: '3px double var(--rule-strong)', marginBottom: 20 }} />

      {/* Label */}
      <p style={{
        fontFamily: 'var(--arabic)', fontSize: 15, color: 'var(--ink-3)',
        letterSpacing: '0.02em', animation: 'mr-ring-pulse 2s ease-in-out infinite',
      }} dir="rtl">{label}</p>

      {/* Folio */}
      <p style={{
        fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: 'var(--ink-4)', marginTop: 12,
      }}>Med Royale · Al-Azhar</p>
    </div>
  )
}

export default function ProtectedRoute({ children, allowedRoles }) {
  const session     = useAuthStore(state => state.session)
  const profile     = useAuthStore(state => state.profile)
  const initialized = useAuthStore(state => state.initialized)

  if (!initialized) return <LoadingScreen label="جاري استعادة الجلسة" />

  if (!session) return <Navigate to="/" replace />

  if (!profile) return <LoadingScreen label="جاري تحميل الملف الشخصي" />

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/not-authorized" replace />
  }

  return children
}
