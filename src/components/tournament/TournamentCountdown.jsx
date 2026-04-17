/**
 * TournamentCountdown.jsx
 * Full-screen countdown shown during phase transitions and round breaks.
 * Props:
 *   durationMs  {number}  total countdown time in ms
 *   label       {string}  title text shown above the number
 *   onComplete  {fn}      called when countdown reaches 0
 */
import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Timer } from 'lucide-react'

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
  const circumference = 2 * Math.PI * 54   // r=54

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-6"
      >
        {/* Label */}
        <p className="ar text-xl font-bold text-gray-300">{label}</p>

        {/* Circle progress */}
        <div className="relative w-40 h-40">
          <svg className="absolute inset-0 -rotate-90" width="160" height="160">
            <circle cx="80" cy="80" r="54" fill="none" stroke="#1f2937" strokeWidth="10" />
            <circle
              cx="80" cy="80" r="54"
              fill="none"
              stroke="#00B8D9"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pct)}
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <Timer size={20} className="text-primary mb-1" />
            <AnimatePresence mode="wait">
              <motion.span
                key={remaining}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="text-5xl font-black text-white tabular-nums"
              >
                {remaining}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-64 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary rounded-full"
            animate={{ width: `${pct * 100}%` }}
            transition={{ duration: 1, ease: 'linear' }}
          />
        </div>
      </motion.div>
    </div>
  )
}
