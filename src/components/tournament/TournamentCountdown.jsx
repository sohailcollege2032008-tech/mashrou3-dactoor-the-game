import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function TournamentCountdown({ durationMs, label, onComplete }) {
  const [remaining, setRemaining] = useState(Math.ceil(durationMs / 1000))
  const total = Math.ceil(durationMs / 1000)

  useEffect(() => {
    setRemaining(Math.ceil(durationMs / 1000))
  }, [durationMs])

  useEffect(() => {
    if (remaining <= 0) {
      onComplete?.()
      return
    }
    const t = setTimeout(() => setRemaining(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [remaining, onComplete])

  const pct = total > 0 ? remaining / total : 0
  const circumference = 2 * Math.PI * 54

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'color-mix(in srgb, var(--paper) 96%, transparent)',
      backdropFilter: 'blur(2px)',
    }}>
      <div style={{ borderTop: '1px solid var(--rule)', width: 280, marginBottom: 40 }} />
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}
      >
        <p className="folio ar" style={{ color: 'var(--ink-3)', letterSpacing: '0.14em' }}>{label}</p>

        <div style={{ position: 'relative', width: 160, height: 160 }}>
          <svg style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }} width="160" height="160">
            <circle cx="80" cy="80" r="54" fill="none" stroke="var(--rule)" strokeWidth="8" />
            <circle
              cx="80" cy="80" r="54"
              fill="none"
              stroke={pct > 0.5 ? 'var(--ink)' : pct > 0.25 ? 'var(--burgundy)' : 'var(--alert)'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pct)}
              style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s' }}
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}>
            <AnimatePresence mode="wait">
              <motion.span
                key={remaining}
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                style={{
                  fontFamily: 'var(--serif)', fontSize: 64, fontWeight: 400,
                  color: 'var(--ink)', lineHeight: 1, letterSpacing: '-0.03em',
                }}
              >
                {remaining}
              </motion.span>
            </AnimatePresence>
            <div className="folio" style={{ color: 'var(--ink-4)', marginTop: 2, fontSize: 9, letterSpacing: '0.12em' }}>
              SEC
            </div>
          </div>
        </div>

        <div style={{ width: 280, height: 2, background: 'var(--rule)', borderRadius: 1, overflow: 'hidden' }}>
          <motion.div
            style={{ height: '100%', background: 'var(--ink)', borderRadius: 1 }}
            animate={{ width: `${pct * 100}%` }}
            transition={{ duration: 1, ease: 'linear' }}
          />
        </div>
      </motion.div>
      <div style={{ borderTop: '1px solid var(--rule)', width: 280, marginTop: 40 }} />
    </div>
  )
}
