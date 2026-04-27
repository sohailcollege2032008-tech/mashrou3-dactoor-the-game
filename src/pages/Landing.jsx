import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import GoogleSignInButton from '../components/auth/GoogleSignInButton'

/* ── Brand Components ─────────────────────────────────────────────────────── */

function MRMonogram({ size = 64, color = 'var(--ink)', bg = 'transparent', filled = false }) {
  const stroke = Math.max(1.5, size * 0.02);
  const inner = filled ? 'var(--paper)' : color;
  const fill = filled ? color : bg;
  
  // Unique ID for pattern to avoid collisions
  const patternId = React.useId().replace(/:/g, '');

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: 'block', borderRadius: filled ? 'var(--r-sm)' : '0' }}>
      {filled && (
        <defs>
          <pattern id={patternId} x="0" y="0" width="25" height="25" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="12.5" height="12.5" fill="#0A0A0A"/>
            <rect x="12.5" y="12.5" width="12.5" height="12.5" fill="#0A0A0A"/>
            <rect x="12.5" y="0" width="12.5" height="12.5" fill="#141414"/>
            <rect x="0" y="12.5" width="12.5" height="12.5" fill="#141414"/>
          </pattern>
        </defs>
      )}
      {filled && <rect width="100" height="100" fill={`url(#${patternId})`} />}
      
      <circle cx="50" cy="50" r={filled ? 44 : 48} fill={fill} stroke={color} strokeWidth={stroke} />
      <circle cx="50" cy="50" r={filled ? 38 : 42} fill="none" stroke={color} strokeWidth={stroke * 0.5} opacity={filled ? 0.25 : 0.4} />
      <text
        x="50" y="55"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="var(--serif)"
        fontSize="38"
        fontWeight="500"
        fill={inner}
        style={{ fontVariationSettings: '"opsz" 144' }}
      >
        M<tspan dx="-4" fontStyle="italic" fontWeight="400">R</tspan>
      </text>
      <path d={`M 35 16 L 40 20 M 65 16 L 60 20`} stroke={inner} strokeWidth={stroke * 0.7} fill="none" opacity={filled ? 0.6 : 0.8} />
      <circle cx="50" cy={filled ? 80 : 84} r="1.6" fill={inner} opacity={filled ? 0.6 : 0.8} />
    </svg>
  );
}

function Wordmark({ size = 'md', color = 'var(--ink)', subtitle = true }) {
  const scale = { sm: 0.8, md: 1, lg: 1.4, xl: 2 }[size] || 1;
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', color, lineHeight: 1 }}>
      <div style={{
        fontFamily: 'var(--serif)',
        fontSize: `${22 * scale}px`,
        fontWeight: 500,
        letterSpacing: '0.18em',
        fontVariationSettings: '"opsz" 48, "SOFT" 0',
      }}>
        MED<span style={{ margin: `0 ${0.3 * scale}em`, fontStyle: 'italic', fontWeight: 300, letterSpacing: 0 }}>·</span>ROYALE
      </div>
      {subtitle && (
        <div style={{
          fontFamily: 'var(--mono)',
          fontSize: `${8 * scale}px`,
          letterSpacing: '0.28em',
          color: 'currentColor',
          opacity: 0.7,
          marginTop: `${4 * scale}px`,
          textTransform: 'uppercase',
        }}>
          An Academic Quiz Arena · Est. 2025
        </div>
      )}
    </div>
  );
}

function Lockup({ size = 'md', color = 'var(--ink)' }) {
  const mgSize = { sm: 28, md: 36, lg: 48 }[size] || 36;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, color }}>
      <MRMonogram size={mgSize} color={color} />
      <div style={{ borderLeft: `1px solid ${color}`, opacity: 0.25, height: mgSize * 0.7 }} />
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <div style={{
          fontFamily: 'var(--serif)',
          fontSize: mgSize * 0.44,
          fontWeight: 500,
          letterSpacing: '0.12em',
          fontVariationSettings: '"opsz" 48',
        }}>
          MED ROYALE
        </div>
        <div style={{
          fontFamily: 'var(--mono)',
          fontSize: mgSize * 0.22,
          letterSpacing: '0.2em',
          opacity: 0.6,
          marginTop: 3,
          textTransform: 'uppercase',
        }}>
          Quiz Arena
        </div>
      </div>
    </div>
  );
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
        <Lockup size="md" />
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
        <span className="folio" />
      </footer>

    </div>
  )
}
