import { Link } from 'react-router-dom'

export default function NotAuthorized() {
  return (
    <div className="paper-grain" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: 24,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 16, letterSpacing: '0.18em' }}>
          ACCESS DENIED
        </div>
        <div style={{ borderTop: '3px double var(--rule-strong)', marginBottom: 28 }} />
        <h1 style={{
          fontFamily: 'var(--serif)', fontSize: 40, fontWeight: 400,
          margin: '0 0 14px', letterSpacing: '-0.02em', lineHeight: 1.1,
        }}>
          Not Authorized
        </h1>
        <p style={{ color: 'var(--ink-3)', fontSize: 15, lineHeight: 1.6, margin: '0 0 36px' }}>
          You don't have permission to access this page.
        </p>
        <div style={{ borderTop: '1px solid var(--rule)', marginBottom: 36 }} />
        <Link
          to="/"
          style={{
            display: 'inline-block', padding: '12px 32px',
            background: 'var(--ink)', color: 'var(--paper)',
            fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 14,
            border: '1px solid var(--ink)', borderRadius: 4, textDecoration: 'none',
            letterSpacing: '0.02em',
          }}
        >
          Return Home
        </Link>
      </div>
    </div>
  )
}
