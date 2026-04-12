/**
 * ActivityLogViewer Component
 * Shows detailed activity log for a specific player
 * Helps host investigate suspicious behavior
 */

import React, { useState } from 'react'
import { X, Download, AlertCircle } from 'lucide-react'

const eventLabels = {
  console_opened: '⚠️ فتح Console',
  devtools_opened: '⚠️ فتح DevTools',
  devtools_hotkey: '⚠️ اختصار DevTools',
  context_menu_opened: '⚠️ قائمة اليمين',
  answer_submitted: '📤 إجابة مرسلة',
  answer_changed: '🔄 تغيير الإجابة',
  tampering_detected: '🚨 محاولة غش مكتشفة',
  storage_tampering: '🚨 تعديل التخزين',
  anomalous_reaction_time: '⚠️ وقت غريب',
  window_focused: '👁️ نافذة مركزة',
  window_blurred: '❌ نافذة غير مركزة',
  page_hidden: '❌ الصفحة مخفية',
  page_visible: '👁️ الصفحة مرئية',
  copy_command: '📋 نسخ (Ctrl+C)',
  right_click_attempted: '⚠️ محاولة right-click'
}

const eventSeverity = {
  console_opened: 'high',
  devtools_opened: 'high',
  devtools_hotkey: 'high',
  context_menu_opened: 'medium',
  answer_submitted: 'low',
  answer_changed: 'medium',
  tampering_detected: 'critical',
  storage_tampering: 'critical',
  anomalous_reaction_time: 'high',
  window_focused: 'low',
  window_blurred: 'low',
  page_hidden: 'medium',
  page_visible: 'low',
  copy_command: 'medium',
  right_click_attempted: 'medium'
}

const severityColors = {
  critical: 'bg-red-500/20 border-red-500/40 text-red-300',
  high: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
  medium: 'bg-orange-500/20 border-orange-500/40 text-orange-300',
  low: 'bg-gray-500/20 border-gray-500/40 text-gray-300'
}

export default function ActivityLogViewer({ username, activityLog, suspicionIndicators }) {
  const [showDetails, setShowDetails] = useState(null)

  if (!activityLog || activityLog.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-white">{username} - سجل النشاط</h3>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
          <p className="text-gray-400">لا يوجد سجل نشاط مسجل</p>
        </div>
      </div>
    )
  }

  // Calculate suspicious event count
  const suspiciousEventCount = activityLog.filter(log => {
    const severity = eventSeverity[log.event] || 'low'
    return severity === 'high' || severity === 'critical'
  }).length

  // Format timestamp
  const formatTime = timestamp => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const formatDuration = ms => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white">{username} - سجل النشاط التفصيلي</h3>
        <button
          onClick={() => {
            const json = JSON.stringify(activityLog, null, 2)
            const blob = new Blob([json], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `activity-${username}-${Date.now()}.json`
            a.click()
            URL.revokeObjectURL(url)
          }}
          className="p-2 text-gray-400 hover:text-primary transition-colors"
          title="تحميل السجل"
        >
          <Download size={18} />
        </button>
      </div>

      {/* Summary */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
        <p className="text-sm text-gray-400">
          <span className="font-bold text-white">{activityLog.length}</span> حدث مسجل
        </p>
        {suspiciousEventCount > 0 && (
          <p className="text-sm">
            <span className="font-bold text-amber-300">{suspiciousEventCount}</span>
            <span className="text-gray-400"> أحداث مشبوهة</span>
          </p>
        )}
        {suspicionIndicators && suspicionIndicators.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-700 space-y-1">
            <p className="text-xs font-bold text-gray-500 uppercase">التحذيرات:</p>
            {suspicionIndicators.map((ind, idx) => (
              <p key={idx} className="text-xs text-gray-300">
                • {ind.message}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {activityLog.map((log, idx) => {
          const severity = eventSeverity[log.event] || 'low'
          const label = eventLabels[log.event] || log.event
          const isExpanded = showDetails === idx

          return (
            <div
              key={idx}
              className={`rounded-lg border p-3 cursor-pointer transition-all ${severityColors[severity]}`}
              onClick={() => setShowDetails(isExpanded ? null : idx)}
            >
              {/* Main row */}
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{label}</p>
                  <p className="text-xs opacity-75">{formatTime(log.timestamp)}</p>
                </div>
                <span className="text-lg ml-2">{idx + 1}</span>
              </div>

              {/* Expanded details */}
              {isExpanded && log.details && (
                <div className="mt-3 pt-3 border-t border-current border-opacity-20 space-y-1">
                  {Object.entries(log.details).map(([key, value]) => (
                    <div key={key} className="flex justify-between text-xs">
                      <span className="opacity-75">{key}:</span>
                      <span className="font-mono">
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

      {/* Interpretation help */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 text-sm">
        <p className="text-blue-300 font-semibold mb-2">💡 كيف تقرأ السجل:</p>
        <ul className="text-gray-300 space-y-1 text-xs">
          <li>• <span className="text-red-400">🚨</span> = محاولة غش خطيرة أو تعديل</li>
          <li>• <span className="text-amber-400">⚠️</span> = نشاط غريب أو مريب</li>
          <li>• <span className="text-orange-400">⚠️</span> = نشاط قد يكون عادي أو غريب</li>
          <li>• <span className="text-gray-400">أخضر</span> = نشاط عادي</li>
        </ul>
      </div>
    </div>
  )
}
