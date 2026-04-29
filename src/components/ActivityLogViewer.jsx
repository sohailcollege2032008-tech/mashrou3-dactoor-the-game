import React, { useState } from 'react'
import { Download } from 'lucide-react'

const eventLabels = {
  console_opened:         '⚠️ فتح Console',
  devtools_opened:        '⚠️ فتح DevTools',
  devtools_hotkey:        '⚠️ اختصار DevTools',
  context_menu_opened:    '⚠️ قائمة اليمين',
  answer_submitted:       '📤 إجابة مرسلة',
  answer_changed:         '🔄 تغيير الإجابة',
  tampering_detected:     '🚨 محاولة غش مكتشفة',
  storage_tampering:      '🚨 تعديل التخزين',
  anomalous_reaction_time:'⚠️ وقت غريب',
  window_focused:         '👁️ نافذة مركزة',
  window_blurred:         '❌ نافذة غير مركزة',
  page_hidden:            '❌ الصفحة مخفية',
  page_visible:           '👁️ الصفحة مرئية',
  copy_command:           '📋 نسخ (Ctrl+C)',
  right_click_attempted:  '⚠️ محاولة right-click',
}

const eventSeverity = {
  console_opened: 'high', devtools_opened: 'high', devtools_hotkey: 'high',
  context_menu_opened: 'medium', answer_submitted: 'low', answer_changed: 'medium',
  tampering_detected: 'critical', storage_tampering: 'critical',
  anomalous_reaction_time: 'high', window_focused: 'low', window_blurred: 'low',
  page_hidden: 'medium', page_visible: 'low', copy_command: 'medium',
  right_click_attempted: 'medium',
}

const severityStyle = {
  critical: { borderColor: 'var(--alert)', background: 'color-mix(in srgb, var(--alert) 8%, var(--paper))', color: 'var(--alert)' },
  high:     { borderColor: 'var(--burgundy)', background: 'color-mix(in srgb, var(--burgundy) 6%, var(--paper))', color: 'var(--burgundy)' },
  medium:   { borderColor: 'var(--gold)', background: 'color-mix(in srgb, var(--gold) 6%, var(--paper))', color: 'var(--gold)' },
  low:      { borderColor: 'var(--rule)', background: 'var(--paper-2)', color: 'var(--ink-3)' },
}

export default function ActivityLogViewer({ username, activityLog, suspicionIndicators }) {
  const [showDetails, setShowDetails] = useState(null)

  if (!activityLog || activityLog.length === 0) {
    return (
      <div>
        <div className="folio" style={{ color: 'var(--ink-3)', marginBottom: 12 }}>
          ACTIVITY LOG — {username}
        </div>
        <p style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-3)', fontSize: 15 }}>
          لا يوجد سجل نشاط مسجل
        </p>
      </div>
    )
  }

  const suspiciousEventCount = activityLog.filter(log => {
    const sev = eventSeverity[log.event] || 'low'
    return sev === 'high' || sev === 'critical'
  }).length

  const formatTime = ts => {
    const d = new Date(ts)
    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--rule)', paddingBottom: 10 }}>
        <div>
          <div className="folio" style={{ color: 'var(--ink-3)', marginBottom: 4 }}>ACTIVITY LOG</div>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 500, color: 'var(--ink)' }}>{username}</span>
        </div>
        <button
          onClick={() => {
            const json = JSON.stringify(activityLog, null, 2)
            const blob = new Blob([json], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url; a.download = `activity-${username}-${Date.now()}.json`; a.click()
            URL.revokeObjectURL(url)
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', background: 'none',
            border: '1px solid var(--rule)', borderRadius: 4,
            color: 'var(--ink-3)', cursor: 'pointer',
            fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.06em',
          }}
          title="تحميل السجل"
        >
          <Download size={13} /> EXPORT
        </button>
      </div>

      {/* Summary */}
      <div style={{
        padding: '12px 16px', background: 'var(--paper-2)',
        border: '1px solid var(--rule)', borderRadius: 4,
      }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 2 }}>TOTAL EVENTS</div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>
              {activityLog.length}
            </span>
          </div>
          {suspiciousEventCount > 0 && (
            <div>
              <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 2 }}>SUSPICIOUS</div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 600, color: 'var(--burgundy)' }}>
                {suspiciousEventCount}
              </span>
            </div>
          )}
        </div>
        {suspicionIndicators?.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--rule)' }}>
            <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 8 }}>WARNINGS</div>
            {suspicionIndicators.map((ind, idx) => (
              <p key={idx} style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-2)', margin: '0 0 4px' }}>
                • {ind.message}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 380, overflowY: 'auto' }}>
        {activityLog.map((log, idx) => {
          const severity = eventSeverity[log.event] || 'low'
          const label = eventLabels[log.event] || log.event
          const isExpanded = showDetails === idx
          const style = severityStyle[severity]

          return (
            <div
              key={idx}
              onClick={() => setShowDetails(isExpanded ? null : idx)}
              style={{
                padding: '10px 14px',
                border: `1px solid ${style.borderColor}`,
                background: style.background,
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 13, color: style.color }}>
                    {label}
                  </span>
                  <div className="folio" style={{ color: 'var(--ink-4)', marginTop: 2, fontSize: 9 }}>
                    {formatTime(log.timestamp)}
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-4)' }}>
                  #{idx + 1}
                </span>
              </div>

              {isExpanded && log.details && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${style.borderColor}` }}>
                  {Object.entries(log.details).map(([key, value]) => (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-4)' }}>{key}:</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-2)' }}>
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{ padding: '12px 16px', background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 4 }}>
        <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 10 }}>LEGEND</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {[
            { color: 'var(--alert)', label: 'غش مرجح' },
            { color: 'var(--burgundy)', label: 'نشاط مريب' },
            { color: 'var(--gold)', label: 'قد يكون عادي' },
            { color: 'var(--ink-4)', label: 'نشاط عادي' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
              <span style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--ink-3)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
