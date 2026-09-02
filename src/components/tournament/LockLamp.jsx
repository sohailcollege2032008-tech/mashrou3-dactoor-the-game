/**
 * LockLamp.jsx — the lamp that carries a live match for someone who cannot see
 * the question.
 *
 * `locked` null = nothing to say right now (renders nothing), false = still
 * thinking, true = the answer is in. It never says what was picked or whether
 * it was right: the spectator mirror deliberately carries no verdict, so a
 * viewer with a second device learns nothing from a lit lamp.
 *
 * Shared by the live page's hero strip and by BracketBoard, which is why it
 * takes its colours as props instead of reading the paper palette directly.
 */
import React from 'react'
import { motion } from 'framer-motion'

export default function LockLamp({
  locked,
  size = 6,
  on = 'var(--success)',
  off = 'var(--ink-4)',
}) {
  if (locked == null) return null
  if (locked) {
    return (
      <span aria-label="قفل إجابته" title="قفل إجابته" style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: on,
      }} />
    )
  }
  return (
    <motion.span
      aria-label="لسه بيفكّر" title="لسه بيفكّر"
      animate={{ opacity: [1, 0.25, 1] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        border: `1px solid ${off}`, background: 'transparent',
      }}
    />
  )
}
