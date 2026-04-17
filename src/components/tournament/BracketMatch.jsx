/**
 * BracketMatch.jsx
 * Single match node in the bracket tree.
 * Uses inline styles for html2canvas compatibility (no Tailwind CSS vars).
 */
import React from 'react'
import { Trophy, Shuffle } from 'lucide-react'

const COLORS = {
  bg:          '#111827',   // gray-900
  bgHighlight: '#0A1628',   // dark navy
  border:      '#374151',   // gray-700
  borderWin:   '#00B8D9',   // primary cyan
  text:        '#f9fafb',   // gray-50
  textMuted:   '#6b7280',   // gray-500
  green:       '#22c55e',
  cyan:        '#00B8D9',
  yellow:      '#f59e0b',
  random:      '#a78bfa',   // violet
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
          justifyContent: 'space-between', opacity: 0.4
        }}>
          <span style={{ color: COLORS.textMuted, fontSize: compact ? 11 : 12 }}>TBD</span>
        </div>
      )
    }
    const highlight = done && isWinner
    return (
      <div style={{
        padding: compact ? '5px 8px' : '7px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: highlight ? 'rgba(0,184,217,0.10)' : 'transparent',
        borderRadius: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {highlight && <Trophy size={12} color={COLORS.cyan} />}
          <span style={{
            color: highlight ? COLORS.cyan : COLORS.text,
            fontWeight: highlight ? 700 : 400,
            fontSize: compact ? 11 : 13,
            maxWidth: compact ? 80 : 110,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {name}
          </span>
        </div>
        {score !== null && score !== undefined && (
          <span style={{
            color: highlight ? COLORS.cyan : COLORS.textMuted,
            fontWeight: highlight ? 700 : 500,
            fontSize: compact ? 11 : 13,
            minWidth: 20, textAlign: 'right',
          }}>
            {score}
          </span>
        )}
      </div>
    )
  }

  const borderColor = done ? COLORS.borderWin : active ? COLORS.yellow : COLORS.border

  return (
    <div style={{
      background: COLORS.bg,
      border: `1px solid ${borderColor}`,
      borderRadius: 10,
      minWidth: compact ? 140 : 180,
      overflow: 'hidden',
      boxShadow: done ? `0 0 10px rgba(0,184,217,0.15)` : 'none',
    }}>
      {/* Status badge */}
      {active && (
        <div style={{
          background: COLORS.yellow + '22', padding: '2px 8px',
          textAlign: 'center', fontSize: 10, color: COLORS.yellow, fontWeight: 700,
        }}>
          🔴 LIVE
        </div>
      )}

      <PlayerRow
        uid={player_a_uid} name={player_a_name}
        score={player_a_score} isWinner={winner_uid === player_a_uid}
      />

      {/* Divider */}
      <div style={{ height: 1, background: COLORS.border, margin: '0 8px' }} />

      {isBye
        ? <div style={{ padding: '7px 10px', color: COLORS.textMuted, fontSize: 12 }}>BYE</div>
        : <PlayerRow
            uid={player_b_uid} name={player_b_name}
            score={player_b_score} isWinner={winner_uid === player_b_uid}
          />
      }

      {/* Tie-breaker badge */}
      {done && tie_broken_by && (
        <div style={{
          padding: '2px 8px', textAlign: 'center', fontSize: 10,
          color: tie_broken_by === 'random' ? COLORS.random : COLORS.green,
          background: (tie_broken_by === 'random' ? COLORS.random : COLORS.green) + '18',
        }}>
          {tie_broken_by === 'random'
            ? <><Shuffle size={9} style={{ display:'inline', marginRight: 4 }} />Random</>
            : '⚡ Speed'}
        </div>
      )}
    </div>
  )
}
