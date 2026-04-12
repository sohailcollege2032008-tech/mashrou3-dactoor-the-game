/**
 * Suspicion Score Calculator
 * Analyzes player behavior and assigns a suspicion score (0-100)
 */

/**
 * Calculate suspicion score for a single player
 * @param {object} playerData - Player game data
 * @param {array} playerData.answers - Array of player's answers
 * @param {object} playerData.activityLog - Activity log from logger
 * @param {boolean} playerData.signatureTampered - Whether signature validation failed
 * @returns {object} Suspicion analysis with score and indicators
 */
export function calculatePlayerSuspicion(playerData) {
  let suspicionScore = 0
  const indicators = []

  const { answers = [], activityLog = [], signatureTampered = false } = playerData

  // 1. SIGNATURE TAMPERING (40 points) - Most suspicious
  if (signatureTampered) {
    suspicionScore += 40
    indicators.push({
      type: 'signature_tampered',
      severity: 'critical',
      message: 'محاولة تزوير الإجابة',
      weight: 40
    })
  }

  // 2. DEVTOOLS OPENED (30 points)
  if (activityLog.some(log =>
    ['console_opened', 'devtools_opened', 'devtools_hotkey'].includes(log.event)
  )) {
    suspicionScore += 30
    indicators.push({
      type: 'devtools_opened',
      severity: 'high',
      message: 'فتح أدوات المتطور (DevTools)',
      weight: 30
    })
  }

  // 3. IMPOSSIBLE REACTION TIME (20 points each)
  const impossibleAnswers = answers.filter(a => a.is_anomalous && a.reaction_time < 150)
  if (impossibleAnswers.length > 0) {
    const count = Math.min(impossibleAnswers.length, 1) // Cap at 20 points per type
    suspicionScore += count * 20
    indicators.push({
      type: 'impossible_reaction_time',
      severity: 'high',
      message: `الإجابة أسرع من الممكن للإنسان (${impossibleAnswers.length} مرات)`,
      weight: count * 20,
      count: impossibleAnswers.length
    })
  }

  // 4. PERFECT SCORE (25 points)
  // Only suspicious if 100% correct AND more than 1 question
  if (answers.length > 1) {
    const correctCount = answers.filter(a => a.is_correct).length
    if (correctCount === answers.length) {
      suspicionScore += 25
      indicators.push({
        type: 'perfect_score',
        severity: 'medium',
        message: `أجاب على كل أسئلة صح (${correctCount}/${answers.length})`,
        weight: 25
      })
    }
  }

  // 5. MULTIPLE ANSWER CHANGES (15 points)
  const answerChanges = activityLog.filter(log => log.event === 'answer_changed').length
  if (answerChanges > 1) {
    suspicionScore += 15
    indicators.push({
      type: 'answer_changed_multiple_times',
      severity: 'medium',
      message: `غيّر الإجابة ${answerChanges} مرات قبل الإرسال`,
      weight: 15,
      count: answerChanges
    })
  }

  // 6. CONTEXT MENU ATTEMPTS (10 points)
  const contextMenuOpens = activityLog.filter(log => log.event === 'context_menu_opened').length
  if (contextMenuOpens > 0) {
    suspicionScore += 10
    indicators.push({
      type: 'context_menu_opened',
      severity: 'low',
      message: 'حاولة فتح القائمة اليمين (right-click)',
      weight: 10,
      count: contextMenuOpens
    })
  }

  // 7. COPY COMMANDS (5 points each, max 15)
  const copyCounts = activityLog.filter(log => log.event === 'copy_command').length
  if (copyCounts > 0) {
    const points = Math.min(copyCounts * 5, 15)
    suspicionScore += points
    indicators.push({
      type: 'copy_commands',
      severity: 'low',
      message: `محاولات نسخ (${copyCounts} مرات)`,
      weight: points,
      count: copyCounts
    })
  }

  // 8. INCONSISTENT TIMING PATTERN (15 points)
  if (answers.length > 2) {
    const reactionTimes = answers.map(a => a.reaction_time)
    const hasDuplicateTimes = reactionTimes.some((time, index) =>
      reactionTimes.slice(index + 1).some(t => Math.abs(t - time) < 10)
    )

    if (hasDuplicateTimes) {
      suspicionScore += 15
      indicators.push({
        type: 'duplicate_reaction_times',
        severity: 'medium',
        message: 'أوقات إجابة متطابقة/متشابهة جداً (قد تكون من برنامج)',
        weight: 15
      })
    }
  }

  // 9. ANOMALOUS PATTERN (10 points)
  // If average reaction time is too low across multiple answers
  if (answers.length > 2) {
    const avgReactionTime = answers.reduce((sum, a) => sum + a.reaction_time, 0) / answers.length
    if (avgReactionTime < 200) {
      suspicionScore += 10
      indicators.push({
        type: 'anomalous_avg_time',
        severity: 'low',
        message: `متوسط سرعة الإجابة منخفض جداً (${Math.round(avgReactionTime)}ms)`,
        weight: 10
      })
    }
  }

  // Cap at 100
  suspicionScore = Math.min(suspicionScore, 100)

  // Determine suspicion level
  let suspicionLevel
  if (suspicionScore >= 90) {
    suspicionLevel = 'critical' // 🚨
  } else if (suspicionScore >= 50) {
    suspicionLevel = 'high' // 🟡
  } else if (suspicionScore >= 20) {
    suspicionLevel = 'medium' // 🟠
  } else {
    suspicionLevel = 'low' // 🟢
  }

  return {
    suspicionScore,
    suspicionLevel,
    indicators: indicators.sort((a, b) => b.weight - a.weight),
    isLikelyCheat: suspicionScore >= 60,
    summary: generateSuspicionSummary(suspicionScore, indicators)
  }
}

/**
 * Generate human-readable summary of suspicion
 */
function generateSuspicionSummary(score, indicators) {
  if (score >= 90) {
    return 'احتمالية غش عالية جداً ⚠️⚠️⚠️'
  } else if (score >= 60) {
    return 'احتمالية غش عالية ⚠️⚠️'
  } else if (score >= 30) {
    return 'اشتباه متوسط ⚠️'
  } else if (score > 0) {
    return 'قد يكون هناك نشاط غريب 🔶'
  } else {
    return 'يبدو عادياً ✅'
  }
}

/**
 * Analyze all players in a game and create report
 */
export function analyzeGameSuspicions(gameResults) {
  const playerSuspicions = gameResults.map(player => ({
    userId: player.userId,
    username: player.username,
    score: player.score,
    answers: player.answers,
    activityLog: player.activityLog || [],
    signatureTampered: player.signatureTampered || false,
    ...calculatePlayerSuspicion({
      answers: player.answers || [],
      activityLog: player.activityLog || [],
      signatureTampered: player.signatureTampered || false
    })
  }))

  // Sort by suspicion score (highest first)
  playerSuspicions.sort((a, b) => b.suspicionScore - a.suspicionScore)

  // Categorize players
  const cheaters = playerSuspicions.filter(p => p.suspicionScore >= 60)
  const suspicious = playerSuspicions.filter(p => p.suspicionScore >= 30 && p.suspicionScore < 60)
  const clean = playerSuspicions.filter(p => p.suspicionScore < 30)

  return {
    allPlayers: playerSuspicions,
    cheaters,
    suspicious,
    clean,
    summary: {
      totalPlayers: playerSuspicions.length,
      suspectedCheaters: cheaters.length,
      suspiciousCount: suspicious.length,
      cleanCount: clean.length,
      cheatingPercentage: Math.round((cheaters.length / playerSuspicions.length) * 100)
    }
  }
}

/**
 * Get icon/emoji for suspicion level
 */
export function getSuspicionIcon(suspicionLevel) {
  const icons = {
    critical: '🚨',
    high: '🟡',
    medium: '🟠',
    low: '🟢'
  }
  return icons[suspicionLevel] || '❓'
}

/**
 * Get color for suspicion level
 */
export function getSuspicionColor(suspicionLevel) {
  const colors = {
    critical: 'red',
    high: 'amber',
    medium: 'orange',
    low: 'green'
  }
  return colors[suspicionLevel] || 'gray'
}
