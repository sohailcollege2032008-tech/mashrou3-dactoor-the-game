import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { calculatePlayerSuspicion, analyzeGameSuspicions, getSuspicionColor } from '../utils/suspicionCalculator'

const suspicionLabels = {
  critical: 'اشتباه عالي جداً — غالباً غش',
  high:     'اشتباه عالي — احتمالية غش',
  medium:   'اشتباه متوسط — قد يكون غريب',
  low:      'يبدو طبيعي',
}

const suspicionStyle = {
  critical: { borderColor: 'var(--alert)',    bg: 'color-mix(in srgb, var(--alert) 7%, var(--paper))',    color: 'var(--alert)' },
  high:     { borderColor: 'var(--burgundy)', bg: 'color-mix(in srgb, var(--burgundy) 6%, var(--paper))', color: 'var(--burgundy)' },
  medium:   { borderColor: 'var(--gold)',     bg: 'color-mix(in srgb, var(--gold) 6%, var(--paper))',     color: 'var(--gold)' },
  low:      { borderColor: 'var(--success)',  bg: 'color-mix(in srgb, var(--success) 5%, var(--paper))',  color: 'var(--success)' },
}

function PlayerSuspicionCard({ player, onViewDetails }) {
  const [expanded, setExpanded] = useState(false)
  const st = suspicionStyle[player.suspicionLevel] || suspicionStyle.low

  return (
    <div style={{
      border: `1px solid ${st.borderColor}`, background: st.bg,
      borderRadius: 4, overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', cursor: 'pointer' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--serif)', fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>
              {player.username}
            </span>
            <span className="folio" style={{ color: st.color, fontSize: 9, letterSpacing: '0.08em' }}>
              {player.suspicionLevel.toUpperCase()}
            </span>
          </div>
          <p style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--ink-3)', margin: '3px 0 0' }}>
            {suspicionLabels[player.suspicionLevel]}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 600, color: st.color }}>
            {player.suspicionScore}<span style={{ fontSize: 11, color: 'var(--ink-4)' }}>/100</span>
          </span>
          <ChevronDown size={16} style={{
            color: 'var(--ink-4)',
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 200ms',
          }} />
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '14px 16px', borderTop: `1px solid ${st.borderColor}` }}>
          <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 10 }}>WARNINGS</div>
          {player.indicators.length > 0 ? (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {player.indicators.map((ind, idx) => (
                <li key={idx} style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-2)' }}>
                  • {ind.message}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink-3)' }}>
              لا توجد تحذيرات
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${st.borderColor}` }}>
            {[
              ['الإجابات الصحيحة', `${player.answers.filter(a => a.is_correct).length} / ${player.answers.length}`],
              ['متوسط الوقت', `${Math.round(player.answers.reduce((s, a) => s + a.reaction_time, 0) / Math.max(player.answers.length, 1))}ms`],
              ['الدرجة', `${player.score} pts`],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--ink-3)' }}>{k}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)' }}>{v}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              onClick={() => onViewDetails(player)}
              style={{
                flex: 1, padding: '8px 0', fontFamily: 'var(--sans)', fontWeight: 500,
                fontSize: 13, border: `1px solid ${st.borderColor}`, background: st.bg,
                color: st.color, borderRadius: 4, cursor: 'pointer',
              }}
            >
              فحص التفاصيل
            </button>
            <button style={{
              flex: 1, padding: '8px 0', fontFamily: 'var(--sans)', fontWeight: 500,
              fontSize: 13, border: '1px solid var(--rule)', background: 'var(--paper-2)',
              color: 'var(--ink-3)', borderRadius: 4, cursor: 'pointer',
            }}>
              تجاهل
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function HostGameReport({ gameResults, onViewDetails }) {
  const [selectedPlayer, setSelectedPlayer] = useState(null)

  const handleViewDetails = (player) => {
    if (onViewDetails) onViewDetails(player)
    else setSelectedPlayer(player)
  }

  if (!gameResults || gameResults.length === 0) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 16, color: 'var(--ink-3)' }}>
          لا توجد نتائج لعرضها
        </p>
      </div>
    )
  }

  const suspiciousReport = analyzeGameSuspicions(gameResults)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Title */}
      <div>
        <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 8 }}>GAME INTEGRITY REPORT</div>
        <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 26, margin: 0, letterSpacing: '-0.015em' }}>
          تقرير الأداء والشكوك
        </h2>
        <p style={{ color: 'var(--ink-3)', fontSize: 14, margin: '6px 0 0' }}>ملخص نتائج اللعبة والتنبيهات الأمنية</p>
      </div>

      <div style={{ borderTop: '1px solid var(--rule)' }} />

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--rule)' }}>
        {[
          { label: 'TOTAL PLAYERS', value: suspiciousReport.summary.totalPlayers, color: 'var(--ink)' },
          { label: 'SUSPECTED',     value: suspiciousReport.summary.suspectedCheaters, color: 'var(--alert)' },
          { label: 'SUSPICIOUS',    value: suspiciousReport.summary.suspiciousCount, color: 'var(--burgundy)' },
          { label: 'CLEAN',         value: suspiciousReport.summary.cleanCount, color: 'var(--success)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: 'var(--paper)', padding: '16px 20px' }}>
            <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 6 }}>{label}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 600, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Cheaters */}
      {suspiciousReport.cheaters.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, borderBottom: '2px solid var(--alert)', paddingBottom: 8, marginBottom: 14 }}>
            <h3 style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 500, margin: 0, color: 'var(--alert)' }}>
              لاعبين غاششين محتملين
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suspiciousReport.cheaters.map(player => (
              <PlayerSuspicionCard key={player.userId} player={player} onViewDetails={handleViewDetails} />
            ))}
          </div>
        </div>
      )}

      {/* Suspicious */}
      {suspiciousReport.suspicious.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, borderBottom: '1px solid var(--rule)', paddingBottom: 8, marginBottom: 14 }}>
            <h3 style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 500, margin: 0, color: 'var(--burgundy)' }}>
              نشاط مريب
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suspiciousReport.suspicious.map(player => (
              <PlayerSuspicionCard key={player.userId} player={player} onViewDetails={handleViewDetails} />
            ))}
          </div>
        </div>
      )}

      {/* Clean */}
      {suspiciousReport.clean.length > 0 && (
        <div>
          <div style={{ borderBottom: '1px solid var(--rule)', paddingBottom: 8, marginBottom: 14 }}>
            <h3 style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 500, margin: 0, color: 'var(--success)' }}>
              لاعبين نظيفين
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {suspiciousReport.clean.map(player => (
              <div key={player.userId} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', border: '1px solid var(--rule)', borderRadius: 4, background: 'var(--paper-2)',
              }}>
                <div>
                  <span style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{player.username}</span>
                  <div className="folio" style={{ color: 'var(--ink-4)', marginTop: 2, fontSize: 9 }}>
                    {player.answers.filter(a => a.is_correct).length} صح / {player.answers.length}
                  </div>
                </div>
                <span className="folio" style={{ color: 'var(--success)', borderBottom: '1px solid var(--success)', paddingBottom: 1 }}>
                  CLEAN
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
