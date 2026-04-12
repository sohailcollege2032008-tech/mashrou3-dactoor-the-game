/**
 * HostGameReport Component
 * Displays a clear, non-technical report of suspicious player activity
 * Designed for non-technical hosts to understand who might be cheating
 */

import React, { useState } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react'
import { calculatePlayerSuspicion, analyzeGameSuspicions, getSuspicionColor } from '../utils/suspicionCalculator'

// Simple, clear icon map for Arabic
const suspicionIcons = {
  critical: '🚨',    // Critical - very likely cheating
  high: '🟡',        // High - probably suspicious
  medium: '🟠',      // Medium - might be suspicious
  low: '🟢'          // Low - looks normal
}

const suspicionLabels = {
  critical: 'اشتباه عالي جداً - غالباً غش',
  high: 'اشتباه عالي - احتمالية غش',
  medium: 'اشتباه متوسط - قد يكون غريب',
  low: 'يبدو طبيعي'
}

function PlayerSuspicionCard({ player, onViewDetails }) {
  const [expanded, setExpanded] = useState(false)

  const Icon = suspicionIcons[player.suspicionLevel]
  const Label = suspicionLabels[player.suspicionLevel]

  return (
    <div
      className={`rounded-lg border p-4 transition-all ${
        player.suspicionLevel === 'critical'
          ? 'bg-red-500/10 border-red-500/40'
          : player.suspicionLevel === 'high'
          ? 'bg-amber-500/10 border-amber-500/40'
          : player.suspicionLevel === 'medium'
          ? 'bg-orange-500/10 border-orange-500/40'
          : 'bg-green-500/10 border-green-500/40'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{Icon}</span>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white truncate">{player.username}</p>
              <p className={`text-xs font-semibold ${
                player.suspicionLevel === 'critical'
                  ? 'text-red-300'
                  : player.suspicionLevel === 'high'
                  ? 'text-amber-300'
                  : player.suspicionLevel === 'medium'
                  ? 'text-orange-300'
                  : 'text-green-300'
              }`}>
                {Label}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="font-mono text-lg font-bold text-gray-300">{player.suspicionScore}/100</span>
          <ChevronDown size={18} className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-700 space-y-3">
          {/* Indicators */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-400 uppercase">التحذيرات:</p>
            {player.indicators.length > 0 ? (
              <ul className="space-y-1">
                {player.indicators.map((indicator, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-red-400 text-lg flex-shrink-0">✓</span>
                    <span className="text-gray-300">{indicator.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400">لا توجد تحذيرات</p>
            )}
          </div>

          {/* Game stats */}
          <div className="space-y-1 text-sm text-gray-400">
            <p><span className="font-semibold">الإجابات الصحيحة:</span> {player.answers.filter(a => a.is_correct).length} من {player.answers.length}</p>
            <p><span className="font-semibold">متوسط الوقت:</span> {Math.round(player.answers.reduce((sum, a) => sum + a.reaction_time, 0) / Math.max(player.answers.length, 1))}ms</p>
            <p><span className="font-semibold">الدرجة النهائية:</span> {player.score} نقطة</p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => onViewDetails(player)}
              className="flex-1 px-3 py-2 text-xs font-bold bg-primary/20 text-primary hover:bg-primary/30 rounded-lg transition-colors"
            >
              فحص التفاصيل
            </button>
            <button className="flex-1 px-3 py-2 text-xs font-bold bg-gray-700 text-gray-300 hover:bg-gray-600 rounded-lg transition-colors">
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
  const [showActivityLog, setShowActivityLog] = useState(false)

  // Use the passed callback if available, otherwise use internal state
  const handleViewDetails = (player) => {
    if (onViewDetails) {
      onViewDetails(player)
    } else {
      setSelectedPlayer(player)
      setShowActivityLog(true)
    }
  }

  if (!gameResults || gameResults.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">لا توجد نتائج لعرضها</p>
      </div>
    )
  }

  // Analyze all players
  const suspiciousReport = analyzeGameSuspicions(gameResults)

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="space-y-2">
        <h2 className="text-3xl font-bold text-white flex items-center gap-2">
          <AlertCircle className="text-amber-400" />
          تقرير الأداء والشكوك
        </h2>
        <p className="text-gray-400">ملخص نتائج اللعبة والتنبيهات الأمنية</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">إجمالي اللاعبين</p>
          <p className="text-2xl font-bold text-white">{suspiciousReport.summary.totalPlayers}</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-xs text-red-400 mb-1">🚨 غاششون مشبوهون</p>
          <p className="text-2xl font-bold text-red-300">{suspiciousReport.summary.suspectedCheaters}</p>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <p className="text-xs text-amber-400 mb-1">🟡 اشتباهات</p>
          <p className="text-2xl font-bold text-amber-300">{suspiciousReport.summary.suspiciousCount}</p>
        </div>
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
          <p className="text-xs text-green-400 mb-1">✅ نظيفين</p>
          <p className="text-2xl font-bold text-green-300">{suspiciousReport.summary.cleanCount}</p>
        </div>
      </div>

      {/* Suspected Cheaters - CRITICAL */}
      {suspiciousReport.cheaters.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xl font-bold text-red-300 flex items-center gap-2">
            <span className="text-2xl">🚨</span>
            لاعبين غاششين محتملين
          </h3>
          <p className="text-sm text-gray-400">
            اللاعبين التاليين لديهم علامات قوية جداً للغش. يُنصح بمراجعة نتائجهم:
          </p>
          <div className="space-y-3">
            {suspiciousReport.cheaters.map(player => (
              <PlayerSuspicionCard key={player.userId} player={player} onViewDetails={handleViewDetails} />
            ))}
          </div>
        </div>
      )}

      {/* Suspicious Activity - HIGH */}
      {suspiciousReport.suspicious.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-amber-300 flex items-center gap-2">
            <span className="text-2xl">🟡</span>
            نشاط مريب
          </h3>
          <p className="text-sm text-gray-400">
            اللاعبين التاليين قد يكون هناك نشاط غريب، لكنه قد يكون عادياً:
          </p>
          <div className="space-y-3">
            {suspiciousReport.suspicious.map(player => (
              <PlayerSuspicionCard key={player.userId} player={player} onViewDetails={handleViewDetails} />
            ))}
          </div>
        </div>
      )}

      {/* Clean Players */}
      {suspiciousReport.clean.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-green-300 flex items-center gap-2">
            <span className="text-2xl">✅</span>
            لاعبين نظيفين
          </h3>
          <div className="grid gap-2">
            {suspiciousReport.clean.map(player => (
              <div key={player.userId} className="bg-green-500/5 border border-green-500/20 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="font-bold text-white">{player.username}</p>
                  <p className="text-xs text-gray-400">{player.answers.filter(a => a.is_correct).length} إجابة صحيحة من {player.answers.length}</p>
                </div>
                <span className="text-xl">✅</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p className="text-xs font-bold text-gray-500 mb-3 uppercase">شرح الرموز:</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xl">🚨</span>
            <span className="text-gray-400">= اشتباه عالي جداً (احتمالية غش عالية)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🟡</span>
            <span className="text-gray-400">= اشتباه عالي (انتبه)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🟠</span>
            <span className="text-gray-400">= اشتباه متوسط (قد يكون عادي)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl">✅</span>
            <span className="text-gray-400">= يبدو طبيعياً</span>
          </div>
        </div>
      </div>

      {/* Tip */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 text-sm">
        <p className="text-blue-300 font-semibold mb-2">💡 نصيحة للهوست:</p>
        <ul className="text-gray-300 space-y-1 text-xs">
          <li>• لاعب مع 🚨 = غالباً يكون غاش، يمكنك إزالة درجاته</li>
          <li>• لاعب مع 🟡 = قد يكون غاش، لكن قد يكون موهوب أو عنده نت سريع</li>
          <li>• إذا كان لديك شك، فحص التفاصيل سيخبرك بماذا فعل اللاعب</li>
        </ul>
      </div>
    </div>
  )
}
