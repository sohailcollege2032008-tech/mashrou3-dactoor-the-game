/**
 * HonoursBoard.jsx — the honours list at the end of a tournament.
 *
 * The entries are computed server-side when the champion is crowned
 * (`_compute_awards` in functions/main.py) and stored on the tournament doc,
 * mirrored into `bracket_live/{id}/meta/awards` for the spectator page. Every
 * one of them comes from a field only the server writes — `is_correct`,
 * `reaction_ms_server`, the qualifier ranks, the match results — so a medal
 * cannot be farmed from a browser.
 *
 * This component only knows how to name them. The facts arrive as
 * { key, uid, name, value }.
 */
import React from 'react'

const MEDALS = {
  champion:  { icon: '🏆', label: 'بطل البطولة',        tone: 'var(--gold)' },
  runner_up: { icon: '🥈', label: 'الوصيف',              tone: 'var(--ink-3)' },
  qualifier: { icon: '🔥', label: 'متصدّر التصفيات',     tone: 'var(--burgundy)' },
  fastest:   { icon: '⚡', label: 'أسرع إجابة',          tone: 'var(--navy)' },
  sniper:    { icon: '🎯', label: 'القنّاص',              tone: 'var(--success)' },
  upset:     { icon: '💥', label: 'مفاجأة البطولة',      tone: 'var(--alert)' },
}

// Champion first, then the rest in a fixed order — never in whatever order the
// server happened to append them, so the board reads the same way every time.
const ORDER = ['champion', 'runner_up', 'upset', 'fastest', 'sniper', 'qualifier']

export default function HonoursBoard({ awards, myUid = null, compact = false }) {
  if (!Array.isArray(awards) || awards.length === 0) return null

  const known = awards.filter(a => a && MEDALS[a.key])
  if (known.length === 0) return null
  known.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))

  return (
    <div style={{
      border: '1px solid var(--rule)', borderTop: '3px double var(--rule-strong)',
      background: 'var(--paper)',
    }} dir="rtl">
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px', borderBottom: '1px solid var(--rule)',
      }}>
        <span className="folio" style={{ fontSize: 10, letterSpacing: '0.22em', color: 'var(--ink-3)' }}>
          HONOURS
        </span>
        <span className="ar" style={{
          fontFamily: 'var(--serif)', fontSize: 13, fontWeight: 500, color: 'var(--ink)',
        }}>
          لوحة الشرف
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fit, minmax(180px, 1fr))',
      }}>
        {known.map(a => {
          const m = MEDALS[a.key]
          const isMe = myUid && a.uid === myUid
          return (
            <div key={a.key} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px',
              borderBottom: '1px solid var(--rule)',
              borderLeft: '1px solid var(--rule)',
              background: isMe ? `color-mix(in srgb, ${m.tone} 8%, var(--paper))` : 'var(--paper)',
            }}>
              <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }} aria-hidden="true">{m.icon}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="ar" style={{
                  fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 700,
                  color: m.tone, margin: 0, letterSpacing: '0.02em',
                }}>
                  {m.label}
                </p>
                <p className="ar" style={{
                  fontFamily: 'var(--serif)', fontSize: 14, fontWeight: isMe ? 700 : 500,
                  color: 'var(--ink)', margin: '1px 0 0',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {a.name}{isMe ? ' — أنت' : ''}
                </p>
                {a.value && (
                  <p className="ar" style={{
                    fontFamily: 'var(--sans)', fontSize: 10.5, color: 'var(--ink-3)', margin: '1px 0 0',
                  }}>
                    {a.value}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
