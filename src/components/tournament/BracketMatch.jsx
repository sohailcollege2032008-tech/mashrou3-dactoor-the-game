/**
 * BracketMatch.jsx
 * Single match node in the bracket tree.
 * Uses inline styles throughout for html2canvas compatibility (no Tailwind CSS vars).
 */
import React from 'react'
import { Trophy, Shuffle } from 'lucide-react'

const COLORS = {
  bg:          '#1C1A14',   // dark paper-2
  bgHighlight: '#26231B',   // dark paper-3
  border:      '#3A362C',   // dark rule
  borderWin:   '#B08944',   // gold (winner)
  borderActive:'#9C3B2E',   // burgundy (live)
  text:        '#F4F1EA',   // light paper (ink on dark)
  textMuted:   '#6F6C63',   // ink-3
  gold:        '#B08944',
  burgundy:    '#9C3B2E',
  success:     '#3C6E47',
  random:      '#7A5CA0',   // muted violet
}

export default function BracketMatch({ match, compact = false }) {
  if (!match) return null

  const { player_a_uid, player_b_uid, player_a_name, player_b_name,
          player_a_score, player_b_score, winner_uid, status, tie_broken_by } = match

  const isBye   = !player_b_uid && !player_b_name
  const pending = status === 'pending'
  const active  = status === 'active'
  const done    = status === 'finished'

  function PlayerRow({ uid, name, score, isWinner }) {
    if (!uid && !name) {
      return (
        <div style={{
          padding: '6px 10px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', opacity: 0.4,
        }}>
          <span style={{ color: COLORS.textMuted, fontSize: compact ? 11 : 12, fontFamily: 'Georgia, serif' }}>TBD</span>
        </div>
      )
    }
    const highlight = done && isWinner
    return (
      <div style={{
        padding: compact ? '5px 8px' : '7px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: highlight ? 'rgba(176,137,68,0.12)' : 'transparent',
        borderRadius: 4,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {highlight && <Trophy size={12} color={COLORS.gold} />}
          <span style={{
            color: highlight ? COLORS.gold : COLORS.text,
            fontWeight: highlight ? 700 : 400,
            fontSize: compact ? 11 : 13,
            fontFamily: 'Georgia, serif',
            maxWidth: compact ? 80 : 110,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {name}
          </span>
        </div>
        {score !== null && score !== undefined && (
          <span style={{
            color: highlight ? COLORS.gold : COLORS.textMuted,
            fontWeight: highlight ? 700 : 500,
            fontSize: compact ? 11 : 13,
            fontFamily: 'monospace',
            minWidth: 20, textAlign: 'right',
          }}>
            {score}
          </span>
        )}
      </div>
    )
  }

  const borderColor = done ? COLORS.borderWin : active ? COLORS.borderActive : COLORS.border

  return (
    <div style={{
      background: COLORS.bg,
      border: `1px solid ${borderColor}`,
      borderRadius: 6,
      minWidth: compact ? 140 : 180,
      overflow: 'hidden',
      boxShadow: done ? `0 0 12px rgba(176,137,68,0.15)` : 'none',
    }}>
      {active && (
        <div style={{
          background: 'rgba(156,59,46,0.18)', padding: '2px 8px',
          textAlign: 'center', fontSize: 10, color: COLORS.burgundy,
          fontWeight: 700, fontFamily: 'monospace', letterSpacing: '0.08em',
        }}>
          LIVE
        </div>
      )}

      <PlayerRow
        uid={player_a_uid} name={player_a_name}
        score={player_a_score} isWinner={winner_uid === player_a_uid}
      />

      <div style={{ height: 1, background: COLORS.border, margin: '0 8px' }} />

      {isBye
        ? <div style={{ padding: '7px 10px', color: COLORS.textMuted, fontSize: 12, fontFamily: 'monospace' }}>BYE</div>
        : <PlayerRow
            uid={player_b_uid} name={player_b_name}
            score={player_b_score} isWinner={winner_uid === player_b_uid}
          />
      }

      {done && tie_broken_by && (
        <div style={{
          padding: '2px 8px', textAlign: 'center', fontSize: 10,
          color: tie_broken_by === 'random' ? COLORS.random : COLORS.success,
          background: (tie_broken_by === 'random' ? COLORS.random : COLORS.success) + '18',
          fontFamily: 'monospace', letterSpacing: '0.06em',
        }}>
          {tie_broken_by === 'random'
            ? <><Shuffle size={9} style={{ display: 'inline', marginRight: 4 }} />RANDOM</>
            : '⚡ SPEED'}
        </div>
      )}
    </div>
  )
}
