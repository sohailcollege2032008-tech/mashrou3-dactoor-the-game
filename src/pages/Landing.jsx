import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import GoogleSignInButton from '../components/auth/GoogleSignInButton'

/* ── Brand Components ─────────────────────────────────────────────────────── */

function MRMonogram({ size = 48, variant = 'outline' }) {
  const isDark = variant === 'filled'
  const bg       = isDark ? '#1A1A1A' : 'none'
  const stroke   = isDark ? '#F4F1EA' : '#1A1A1A'
  const textFill = isDark ? '#F4F1EA' : '#1A1A1A'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="MR monogram">
      {isDark && <circle cx="50" cy="50" r="50" fill="#1A1A1A" />}
      <circle cx="50" cy="50" r="46" stroke={stroke} strokeWidth="1.5" fill={bg} />
      <circle cx="50" cy="50" r="40" stroke={stroke} strokeWidth="0.75" opacity="0.4" />
      <circle cx="50" cy="6"  r="1.8" fill={stroke} opacity="0.5" />
      <circle cx="50" cy="94" r="1.8" fill={stroke} opacity="0.5" />
      <text
        x="50" y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Fraunces, Georgia, serif"
        fontSize="34"
        fontWeight="500"
        fill={textFill}
      >MR</text>
    </svg>
  )
}

function Wordmark({ scale = 1 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{
        fontFamily: 'Fraunces, Georgia, serif',
        fontSize: `${22 * scale}px`,
        fontWeight: 500,
        letterSpacing: '0.18em',
        color: 'var(--ink)',
        lineHeight: 1,
        textTransform: 'uppercase',
      }}>Med Royale</span>
      <span style={{
        fontFamily: 'var(--mono)',
        fontSize: `${8 * scale}px`,
        letterSpacing: '0.12em',
        color: 'var(--ink-3)',
        textTransform: 'uppercase',
      }}>Quiz Arena · Est. 2025</span>
    </div>
  )
}

function Lockup({ monogramSize = 40, scale = 1 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <MRMonogram size={monogramSize} />
      <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--ink)', opacity: 0.2, margin: '6px 0' }} />
      <Wordmark scale={scale} />
    </div>
  )
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function Landing() {
  const session     = useAuthStore(state => state.session)
  const profile     = useAuthStore(state => state.profile)
  const initialized = useAuthStore(state => state.initialized)
  const [isRetrying, setIsRetrying] = useState(false)
  const navigate = useNavigate()

  React.useEffect(() => {
    if (initialized && session && profile) {
      const target =
        profile.role === 'owner' ? '/owner/dashboard' :
        profile.role === 'host'  ? '/host/dashboard'  : '/player/dashboard'
      if (window.location.pathname === '/') navigate(target, { replace: true })
    }
  }, [initialized, session, profile, navigate])

  const handleSignOut = () => useAuthStore.getState().signOut()
  const handleRetry   = async () => {
    if (!session) return
    setIsRetrying(true)
    await useAuthStore.getState().fetchProfile(session)
    setIsRetrying(false)
  }

  const roleLabel    = profile?.role === 'owner' ? 'Owner' : profile?.role === 'host' ? 'Host' : 'Scholar'
  const roleTagClass = profile?.role === 'owner' ? 'tag tag-gold' : profile?.role === 'host' ? 'tag tag-navy' : 'tag tag-ghost'
  const dashPath     = profile?.role === 'owner' ? '/owner/dashboard' : profile?.role === 'host' ? '/host/dashboard' : '/player/dashboard'
  const dashLabel    = profile?.role === 'owner' ? 'Owner Dashboard' : profile?.role === 'host' ? 'Host Dashboard' : 'Enter the Arena'

  return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)',
        padding: '20px 48px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}>
        <span className="folio" style={{ flex: 1 }}>Academic · Quiz Arena</span>
        <Lockup monogramSize={40} scale={1} />
        <span className="folio" style={{ flex: 1, textAlign: 'right' }}>Est. 2025</span>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
      }}>
        <div style={{ textAlign: 'center', maxWidth: 680, width: '100%' }}>

          {/* Kicker */}
          <p className="folio" style={{ marginBottom: 28 }}>Mashrou3 Dactoor — The Game</p>

          {/* Headline */}
          <h1 style={{
            fontFamily: 'var(--serif)',
            fontSize: 'clamp(44px, 8vw, 100px)',
            fontWeight: 400,
            lineHeight: 0.95,
            letterSpacing: '-0.025em',
            color: 'var(--ink)',
            margin: '0 0 36px',
          }}>
            An Academic<br />
            <em style={{ color: 'var(--burgundy)' }}>Quiz Arena.</em>
          </h1>

          {/* Double rule */}
          <div className="rule-double" style={{ marginBottom: 48 }} />

          {/* ── Auth States ──────────────────────────────────────────── */}

          {!initialized && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--ink-3)' }}>
              <span style={{
                display: 'inline-block', width: 16, height: 16,
                border: '2px solid var(--rule)', borderTopColor: 'var(--ink)',
                borderRadius: '50%', animation: 'mr-spin 1.2s linear infinite',
              }} />
              <span className="folio">Loading</span>
            </div>
          )}

          {initialized && !session && (
            <div className="card" style={{
              display: 'inline-flex', flexDirection: 'column',
              alignItems: 'center', gap: 20, padding: '36px 48px',
            }}>
              <p style={{ fontFamily: 'var(--serif)', fontSize: 17, color: 'var(--ink-2)', margin: 0 }}>
                Sign in to compete
              </p>
              <GoogleSignInButton />
            </div>
          )}

          {initialized && session && !profile && (
            <div className="card" style={{
              display: 'inline-flex', flexDirection: 'column',
              alignItems: 'center', gap: 16, padding: '32px 40px',
              maxWidth: 360, width: '100%',
            }}>
              <span className="tag tag-alert">
                {isRetrying ? 'جاري المحاولة...' : 'تعذّر تحميل بيانات الحساب'}
              </span>
              <p style={{ fontFamily: 'var(--arabic)', color: 'var(--ink-3)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                {isRetrying
                  ? 'جاري إعادة تحميل بيانات حسابك...'
                  : 'تحقق من الاتصال وحاول مجددًا.'
                }
              </p>
              <button onClick={handleRetry} disabled={isRetrying} className="btn btn-solid" style={{ width: '100%' }}>
                إعادة المحاولة
              </button>
              <button onClick={handleSignOut} disabled={isRetrying} className="btn btn-sm" style={{ width: '100%', color: 'var(--alert)', borderColor: 'var(--alert)', background: 'transparent' }}>
                تسجيل الخروج
              </button>
            </div>
          )}

          {initialized && session && profile && (
            <div className="card" style={{
              display: 'inline-flex', flexDirection: 'column',
              alignItems: 'center', gap: 20, padding: '36px 48px', minWidth: 300,
            }}>
              {/* Avatar */}
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                border: '2px solid var(--ink)',
                overflow: 'hidden',
                background: 'var(--paper-3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {profile.avatar_url
                  ? <img src={profile.avatar_url} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 500, color: 'var(--ink)' }}>
                      {(profile.display_name || '?').slice(0, 2).toUpperCase()}
                    </span>
                }
              </div>

              {/* Name + role */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <p style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 500, color: 'var(--ink)', margin: 0, lineHeight: 1.2 }}>
                  {profile.display_name}
                </p>
                <span className={roleTagClass}>{roleLabel}</span>
              </div>

              {/* Divider */}
              <div className="rule" style={{ width: '100%' }} />

              {/* Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                <Link to={dashPath} className="btn btn-burgundy btn-lg" style={{ width: '100%', justifyContent: 'center' }}>
                  {dashLabel}
                </Link>
                {profile.role === 'owner' && (
                  <Link to="/host/dashboard" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>
                    Host Dashboard
                  </Link>
                )}
                <button onClick={handleSignOut} className="btn btn-soft btn-sm" style={{ width: '100%' }}>
                  تسجيل الخروج
                </button>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="rule" style={{
        padding: '14px 48px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span className="folio">Al-Azhar University · Batch 62</span>
        <span className="folio">Med Royale · Quiz Arena · Est. 2025</span>
      </footer>

    </div>
  )
}
