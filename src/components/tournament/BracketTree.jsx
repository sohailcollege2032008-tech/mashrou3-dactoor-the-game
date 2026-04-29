/**
 * BracketTree.jsx
 * Renders the full single-elimination bracket as a horizontal tree.
 * Uses inline styles throughout for html2canvas compatibility.
 */
import React from 'react'
import BracketMatch from './BracketMatch'
import { Trophy } from 'lucide-react'

const BG       = '#14120E'   // dark paper
const GOLD     = '#B08944'
const INK_LIGHT = '#F4F1EA'
const RULE     = '#3A362C'
const INK_3    = '#6F6C63'

export default function BracketTree({ matches, totalRounds, bracketRef, tournamentTitle }) {
  if (!matches || matches.length === 0) return null

  const rounds = {}
  for (let r = 1; r <= totalRounds; r++) {
    rounds[r] = matches
      .filter(m => m.round === r)
      .sort((a, b) => a.match_number - b.match_number)
  }

  const roundLabels = {
    [totalRounds]:     'Final',
    [totalRounds - 1]: 'Semi-finals',
    [totalRounds - 2]: 'Quarter-finals',
    [totalRounds - 3]: 'Round of 16',
    [totalRounds - 4]: 'Round of 32',
  }

  return (
    <div
      ref={bracketRef}
      style={{
        background: BG,
        padding: 32,
        overflowX: 'auto',
        borderRadius: 6,
        minWidth: 'max-content',
        border: `1px solid ${RULE}`,
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <Trophy size={20} color={GOLD} />
          <span style={{
            color: INK_LIGHT, fontFamily: 'Georgia, serif',
            fontWeight: 400, fontSize: 22, letterSpacing: '-0.01em',
          }}>
            {tournamentTitle || 'Tournament Bracket'}
          </span>
          <Trophy size={20} color={GOLD} />
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${RULE}`, margin: '16px 0 28px' }} />

      {/* Rounds */}
      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
        {Array.from({ length: totalRounds }, (_, ri) => {
          const round = ri + 1
          const roundMatches = rounds[round] || []
          const label = roundLabels[round] || `Round ${round}`
          const offsetFactor = Math.pow(2, round - 1)

          return (
            <div key={round} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
              <div style={{
                color: round === totalRounds ? GOLD : INK_3,
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.1em', marginBottom: 14, textAlign: 'center',
                fontFamily: 'monospace',
              }}>
                {label}
              </div>
              <div style={{
                display: 'flex', flexDirection: 'column',
                gap: round === 1 ? 16 : (16 * offsetFactor + (offsetFactor - 1) * 80),
              }}>
                {roundMatches.map(match => (
                  <BracketMatch key={match.match_id} match={match} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
