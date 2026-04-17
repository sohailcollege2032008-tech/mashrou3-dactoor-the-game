/**
 * BracketTree.jsx
 * Renders the full single-elimination bracket as a horizontal tree.
 * Uses inline styles throughout for html2canvas compatibility.
 *
 * Props:
 *   matches      {object[]}  array of bracket_match documents (with match_id field)
 *   totalRounds  {number}
 *   bracketRef   {React.ref} ref attached to the root div (for html2canvas export)
 *   tournamentTitle {string}
 */
import React from 'react'
import BracketMatch from './BracketMatch'
import { Trophy } from 'lucide-react'

const BG   = '#0A0E1A'
const CYAN = '#00B8D9'

export default function BracketTree({ matches, totalRounds, bracketRef, tournamentTitle }) {
  if (!matches || matches.length === 0) return null

  // Group matches by round
  const rounds = {}
  for (let r = 1; r <= totalRounds; r++) {
    rounds[r] = matches
      .filter(m => m.round === r)
      .sort((a, b) => a.match_number - b.match_number)
  }

  const roundLabels = {
    [totalRounds]:     '🏆 Final',
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
        borderRadius: 16,
        minWidth: 'max-content',
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <Trophy size={22} color={CYAN} />
          <span style={{ color: CYAN, fontWeight: 800, fontSize: 20, letterSpacing: 1 }}>
            {tournamentTitle || 'Tournament Bracket'}
          </span>
          <Trophy size={22} color={CYAN} />
        </div>
      </div>

      {/* Rounds — displayed left-to-right */}
      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
        {Array.from({ length: totalRounds }, (_, ri) => {
          const round = ri + 1
          const roundMatches = rounds[round] || []
          const label = roundLabels[round] || `Round ${round}`
          const matchesAbove = matches.filter(m => m.round < round).length
          const offsetFactor = Math.pow(2, round - 1)

          return (
            <div key={round} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
              {/* Round label */}
              <div style={{
                color: CYAN, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: 1, marginBottom: 12, textAlign: 'center',
              }}>
                {label}
              </div>

              {/* Match cards with vertical spacing that aligns them between their feeder matches */}
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
