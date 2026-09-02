/**
 * RoundRecap.jsx — what just happened, for the gap before what happens next.
 *
 * The break between rounds was a countdown and nothing else: the round ended,
 * players were knocked out, someone answered faster than anyone had all night,
 * and the screen said "01:17". This is that minute given something to say.
 *
 * The facts are computed server-side when the round closes (`_round_recap` in
 * functions/main.py) and written in the same update that opens the next round,
 * so they cannot be a round behind — and every one of them comes from a field
 * only the server writes. This component only knows how to phrase them.
 *
 * Shape: { round, matches, out[], out_count, fastest_name?, fastest_value?,
 *          upset_name?, upset_value? }
 */
import React from 'react'
import { arMatches } from '../../utils/arabicCount'

const TONES = {
  paper: {
    bg: 'var(--paper-2)', rule: 'var(--rule)', ruleStrong: 'var(--rule-strong)',
    ink: 'var(--ink)', ink3: 'var(--ink-3)', ink4: 'var(--ink-4)',
    gold: 'var(--gold)', alert: 'var(--alert)',
  },
  dark: {
    bg: '#1C1A14', rule: '#3A362C', ruleStrong: '#4A4638',
    ink: '#F4F1EA', ink3: '#8B877C', ink4: '#6F6C63',
    gold: '#C79A4E', alert: '#C4634F',
  },
}

function roundName(round, totalRounds) {
  if (!totalRounds) return `الجولة ${round}`
  if (round === totalRounds)     return 'النهائي'
  if (round === totalRounds - 1) return 'نصف النهائي'
  if (round === totalRounds - 2) return 'ربع النهائي'
  if (round === totalRounds - 3) return 'دور الـ 16'
  if (round === totalRounds - 4) return 'دور الـ 32'
  return `الجولة ${round}`
}

export default function RoundRecap({ recap, totalRounds = 0, myName = null, tone = 'paper' }) {
  if (!recap || !recap.round) return null
  const T = TONES[tone] || TONES.paper

  const out      = Array.isArray(recap.out) ? recap.out : []
  const outCount = recap.out_count ?? out.length
  const hidden   = Math.max(0, outCount - out.length)
  const iAmOut   = myName && out.includes(myName)

  return (
    <div dir="rtl" style={{
      border: `1px solid ${T.rule}`, borderTop: `3px double ${T.ruleStrong}`,
      background: T.bg,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, padding: '8px 14px', borderBottom: `1px solid ${T.rule}`,
      }}>
        <span className="folio" style={{ fontSize: 9, letterSpacing: '0.2em', color: T.ink4 }}>
          ROUND REPORT
        </span>
        <span className="ar" style={{
          fontFamily: 'var(--serif)', fontSize: 13.5, fontWeight: 500, color: T.ink,
        }}>
          {roundName(recap.round, totalRounds)} خلص
          {recap.matches ? (
            <span className="ar" style={{
              fontFamily: 'var(--sans)', fontSize: 10.5, color: T.ink4, marginInlineStart: 8,
            }}>
              {arMatches(recap.matches)}
            </span>
          ) : null}
        </span>
      </div>

      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {recap.upset_name && (
          <p className="ar" style={{ fontSize: 12.5, color: T.ink, margin: 0, lineHeight: 1.6 }}>
            <span style={{ marginInlineEnd: 6 }} aria-hidden="true">💥</span>
            <strong style={{ fontWeight: 700 }}>{recap.upset_name}</strong>
            <span style={{ color: T.ink3 }}> — {recap.upset_value}</span>
          </p>
        )}
        {recap.fastest_name && (
          <p className="ar" style={{ fontSize: 12.5, color: T.ink, margin: 0, lineHeight: 1.6 }}>
            <span style={{ marginInlineEnd: 6 }} aria-hidden="true">⚡</span>
            <span style={{ color: T.ink3 }}>أسرع إجابة في الجولة — </span>
            <strong style={{ fontWeight: 700 }}>{recap.fastest_name}</strong>
            <span className="folio" style={{ fontSize: 11, color: T.gold, marginInlineStart: 6 }}>
              {recap.fastest_value}
            </span>
          </p>
        )}
        {outCount > 0 && (
          <p className="ar" style={{
            fontSize: 12.5, color: T.ink, margin: 0, lineHeight: 1.7,
            paddingTop: 6, borderTop: `1px solid ${T.rule}`,
          }}>
            <span style={{ marginInlineEnd: 6 }} aria-hidden="true">🚪</span>
            <span style={{ color: T.ink3 }}>خرجوا من البطولة — </span>
            <span style={{ color: iAmOut ? T.alert : T.ink }}>
              {out.join('، ')}{hidden > 0 ? ` و${hidden} غيرهم` : ''}
            </span>
          </p>
        )}
      </div>
    </div>
  )
}
