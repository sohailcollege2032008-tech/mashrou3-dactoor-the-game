/**
 * Activity Logger - Tracks player behavior for cheating detection
 * Logs to browser localStorage for persistence
 */

class ActivityLogger {
  constructor(userId, roomId) {
    this.userId = userId
    this.roomId = roomId
    this.logsKey = `activity_logs_${roomId}_${userId}`
    this.logs = this.loadLogs()
    this.setupListeners()
  }

  /**
   * Load logs from localStorage
   */
  loadLogs() {
    try {
      const stored = localStorage.getItem(this.logsKey)
      return stored ? JSON.parse(stored) : []
    } catch (e) {
      console.error('Failed to load activity logs:', e)
      return []
    }
  }

  /**
   * Save logs to localStorage
   */
  saveLogs() {
    try {
      localStorage.setItem(this.logsKey, JSON.stringify(this.logs))
    } catch (e) {
      console.error('Failed to save activity logs:', e)
      // Silently fail - don't interrupt gameplay
    }
  }

  /**
   * Add a log entry
   * @param {string} event - Event type (console_opened, answer_changed, answer_submitted, etc.)
   * @param {object} details - Event details
   */
  addLog(event, details = {}) {
    const entry = {
      timestamp: Date.now(),
      event,
      details
    }
    this.logs.push(entry)
    this.saveLogs()
  }

  /**
   * Setup event listeners for automatic logging
   */
  setupListeners() {
    // Detect DevTools opening (Console tab)
    // This is a heuristic - checks for DevTools-related behavior
    let consoleOpened = false

    // Method 1: Check for console override
    const originalLog = console.log
    console.log = (...args) => {
      if (!consoleOpened) {
        consoleOpened = true
        this.addLog('console_opened', { method: 'console_log' })
      }
      originalLog.apply(console, args)
    }

    // Method 2: Detect if DevTools are open using screen size tricks
    let devToolsOpen = false
    const checkDevTools = () => {
      const threshold = 160
      const isDevToolsOpen = window.outerHeight - window.innerHeight > threshold

      if (isDevToolsOpen && !devToolsOpen) {
        devToolsOpen = true
        this.addLog('devtools_opened', {
          outerHeight: window.outerHeight,
          innerHeight: window.innerHeight,
          difference: window.outerHeight - window.innerHeight
        })
      }
    }

    // Check periodically
    setInterval(checkDevTools, 1000)

    // Detect page visibility changes
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.addLog('page_hidden')
      } else {
        this.addLog('page_visible')
      }
    })

    // Detect keyboard shortcuts (F12, Ctrl+Shift+I, Ctrl+Shift+J, etc.)
    document.addEventListener('keydown', (e) => {
      if (
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
        (e.ctrlKey && e.key === 'Shift' && e.key === 'K')
      ) {
        this.addLog('devtools_hotkey', {
          key: e.key,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey
        })
      }

      // Detect Ctrl+C (copy)
      if (e.ctrlKey && e.key === 'c') {
        this.addLog('copy_command')
      }

      // Detect right-click
      if (e.button === 2 || e.key === 'ContextMenu') {
        this.addLog('right_click_attempted')
      }
    })

    // Detect right-click context menu
    document.addEventListener('contextmenu', (e) => {
      this.addLog('context_menu_opened', {
        x: e.clientX,
        y: e.clientY
      })
    })

    // Track window focus
    window.addEventListener('focus', () => {
      this.addLog('window_focused')
    })

    window.addEventListener('blur', () => {
      this.addLog('window_blurred')
    })
  }

  /**
   * Log answer submission
   */
  logAnswerSubmission(answerData) {
    this.addLog('answer_submitted', {
      question_index: answerData.question_index,
      selected_choice: answerData.selected_choice,
      reaction_time: answerData.reaction_time,
      timestamp: answerData.timestamp
    })
  }

  /**
   * Log answer change (if somehow answer is modified before final submit)
   */
  logAnswerChange(questionIndex, previousChoice, newChoice) {
    this.addLog('answer_changed', {
      question_index: questionIndex,
      previous_choice: previousChoice,
      new_choice: newChoice,
      changed_at: Date.now()
    })
  }

  /**
   * Log if a signature validation failed (tampering attempt)
   */
  logTamperingDetected(answerData, reason) {
    this.addLog('tampering_detected', {
      reason,
      question_index: answerData.question_index,
      selected_choice: answerData.selected_choice,
      signature: answerData.signature ? 'present' : 'missing',
      detected_at: Date.now()
    })
  }

  /**
   * Log localStorage/IndexedDB tampering
   */
  logStorageTampering(storageType, action) {
    this.addLog('storage_tampering', {
      storage_type: storageType,
      action,
      detected_at: Date.now()
    })
  }

  /**
   * Get all logs
   */
  getLogs() {
    return this.logs
  }

  /**
   * Get logs as JSON string for export
   */
  exportLogs() {
    return JSON.stringify(this.logs, null, 2)
  }

  /**
   * Clear logs (called when game ends)
   */
  clearLogs() {
    this.logs = []
    try {
      localStorage.removeItem(this.logsKey)
    } catch (e) {
      console.error('Failed to clear logs:', e)
    }
  }

  /**
   * Get suspicious events count
   */
  getSuspiciousEventCount() {
    const suspiciousEvents = [
      'console_opened',
      'devtools_opened',
      'devtools_hotkey',
      'context_menu_opened',
      'tampering_detected',
      'storage_tampering',
      'answer_changed'
    ]

    return this.logs.filter(log => suspiciousEvents.includes(log.event)).length
  }

  /**
   * Check if DevTools were opened
   */
  wasDevToolsOpened() {
    return this.logs.some(log =>
      ['console_opened', 'devtools_opened', 'devtools_hotkey'].includes(log.event)
    )
  }

  /**
   * Check if context menu was accessed
   */
  wasContextMenuOpened() {
    return this.logs.some(log => log.event === 'context_menu_opened')
  }

  /**
   * Count of copy commands
   */
  getCopyCommandCount() {
    return this.logs.filter(log => log.event === 'copy_command').length
  }

  /**
   * Get timeline of events
   */
  getTimeline() {
    return this.logs.map(log => ({
      ...log,
      timeString: new Date(log.timestamp).toLocaleTimeString('ar-EG'),
      timeFromStart: log.timestamp - (this.logs[0]?.timestamp || Date.now())
    }))
  }
}

/**
 * Create and manage activity logger instance per game session
 */
let loggerInstance = null

export function initActivityLogger(userId, roomId) {
  loggerInstance = new ActivityLogger(userId, roomId)
  return loggerInstance
}

export function getActivityLogger() {
  if (!loggerInstance) {
    console.warn('Activity logger not initialized')
    return null
  }
  return loggerInstance
}

export function logActivity(event, details) {
  const logger = getActivityLogger()
  if (logger) {
    logger.addLog(event, details)
  }
}
