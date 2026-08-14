import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

/**
 * Phase countdown — a floating corner card, NOT a blocking overlay.
 *
 * It used to render as `position: fixed; inset: 0` with a blur, which took the
 * whole screen hostage for the entire break: the host could not reach the
 * bracket, the match list, "ابدأ الجولة الآن", or the question panel while it
 * counted down. It is information, not a modal — so it now floats in the corner
 * and everything behind it stays live. Collapses to a pill if it is still in
 * the way.
 *
 * No framer-motion here on purpose. The seconds used to render inside an
 * <AnimatePresence>, which drives its enter/exit with requestAnimationFrame —
 * and rAF is paused in a backgrounded tab, so the number could sit frozen at
 * its old value (or at opacity 0) while the clock actually ran. The number is
 * the whole point of this component, so it is plain React state now; only
 * decoration uses CSS transitions.
 */
export default function TournamentCountdown({ durationMs, label, onComplete }) {
  const [remaining, setRemaining] = useState(Math.ceil(durationMs / 1000))
  const [collapsed, setCollapsed] = useState(false)
  const total = Math.ceil(durationMs / 1000)
  const firedRef = useRef(false)

  useEffect(() => {
    if (remaining <= 0) {
      // Fire onComplete exactly once per countdown — re-renders with a fresh
      // callback identity must not double-advance the bracket.
      if (!firedRef.current) {
        firedRef.current = true
        onComplete?.()
      }
      return
    }
    const t = setTimeout(() => setRemaining(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [remaining, onComplete])

  const pct = total > 0 ? remaining / total : 0
  const R = 26
  const circumference = 2 * Math.PI * R
  const ringColor = pct > 0.5 ? 'var(--ink)' : pct > 0.25 ? 'var(--burgundy)' : 'var(--alert)'

  return (
    // The wrapper spans the corner but never swallows clicks; only the card
    // itself is interactive.
    <div style={{
      // Physical left, not logical: these pages are dir="rtl", and the global
      // FullscreenButton owns the bottom-right corner.
      position: 'fixed', left: 16, bottom: 16, zIndex: 45,
      pointerEvents: 'none',
    }}>
      <div style={{
        pointerEvents: 'auto',
        background: 'var(--paper)',
        border: `1px solid ${ringColor}`,
        borderRadius: 6,
        boxShadow: '0 6px 24px rgba(0,0,0,0.10)',
        overflow: 'hidden',
        minWidth: collapsed ? 0 : 210,
        transition: 'border-color 500ms',
      }}>
        {collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            title={label}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', background: 'none', border: 'none',
              cursor: 'pointer', color: 'var(--ink)',
            }}
          >
            <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, color: ringColor }}>
              {remaining}
            </span>
            <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>SEC</span>
            <ChevronUp size={12} style={{ color: 'var(--ink-4)' }} />
          </button>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
              <div style={{ position: 'relative', width: 60, height: 60, flexShrink: 0 }}>
                <svg style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }} width="60" height="60">
                  <circle cx="30" cy="30" r={R} fill="none" stroke="var(--rule)" strokeWidth="4" />
                  <circle
                    cx="30" cy="30" r={R}
                    fill="none"
                    stroke={ringColor}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - pct)}
                    style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s' }}
                  />
                </svg>
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{
                    fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 400,
                    color: 'var(--ink)', lineHeight: 1, letterSpacing: '-0.02em',
                  }}>
                    {remaining}
                  </span>
                </div>
              </div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="folio ar" style={{
                  color: 'var(--ink-2)', letterSpacing: '0.10em', margin: 0,
                  fontSize: 10, lineHeight: 1.6,
                }}>
                  {label}
                </p>
                <p className="folio" style={{ color: 'var(--ink-4)', margin: '2px 0 0', fontSize: 9 }}>
                  {remaining} SEC
                </p>
              </div>

              <button
                onClick={() => setCollapsed(true)}
                title="تصغير"
                style={{
                  padding: 4, background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--ink-4)', display: 'flex', alignSelf: 'flex-start',
                }}
              >
                <ChevronDown size={13} />
              </button>
            </div>

            <div style={{ height: 2, background: 'var(--rule)' }}>
              <div style={{
                height: '100%', width: `${pct * 100}%`, background: ringColor,
                transition: 'width 1s linear, background 500ms',
              }} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
