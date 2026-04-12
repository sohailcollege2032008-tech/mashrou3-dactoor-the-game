/**
 * Cryptographic utilities for secure answer validation and anti-cheating measures
 * Uses Web Crypto API (native browser crypto)
 */

/**
 * Generate SHA256 hash of a string
 * @param {string} message - Message to hash
 * @returns {Promise<string>} Hex-encoded hash
 */
export async function sha256(message) {
  const encoder = new TextEncoder()
  const data = encoder.encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex
}

/**
 * Generate HMAC-SHA256 signature for an answer
 * @param {object} answer - Answer object {selected_choice, reaction_time, timestamp, room_id, user_id}
 * @param {string} secretKey - Secret key for signing (unique per game/room)
 * @returns {Promise<string>} Hex-encoded signature
 */
export async function signAnswer(answer, secretKey) {
  // Serialize answer in consistent order (important for signature verification)
  const answerString = JSON.stringify({
    selected_choice: answer.selected_choice,
    reaction_time: answer.reaction_time,
    timestamp: answer.timestamp,
    room_id: answer.room_id,
    user_id: answer.user_id,
    question_index: answer.question_index
  })

  // Create HMAC-SHA256 signature
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secretKey)
  const messageData = encoder.encode(answerString)

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData)

  // Convert to hex string
  const signatureArray = Array.from(new Uint8Array(signatureBuffer))
  const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return signatureHex
}

/**
 * Verify HMAC-SHA256 signature
 * @param {object} answer - Answer object
 * @param {string} signature - Hex-encoded signature to verify
 * @param {string} secretKey - Secret key for verification
 * @returns {Promise<boolean>} True if signature is valid
 */
export async function verifyAnswerSignature(answer, signature, secretKey) {
  // Generate expected signature with same object structure
  const answerString = JSON.stringify({
    selected_choice: answer.selected_choice,
    reaction_time: answer.reaction_time,
    timestamp: answer.timestamp,
    room_id: answer.room_id,
    user_id: answer.user_id,
    question_index: answer.question_index
  })

  const encoder = new TextEncoder()
  const keyData = encoder.encode(secretKey)
  const messageData = encoder.encode(answerString)

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )

  // Convert hex signature back to bytes for verification
  const signatureBytes = new Uint8Array(signature.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))

  const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, messageData)
  return isValid
}

/**
 * Generate correct answer hash for a question
 * Used to store instead of plain correct answer
 * @param {number} correctIndex - The correct choice index (0-3)
 * @param {string} questionId - Unique question identifier
 * @param {string} roomId - Room/game identifier
 * @param {string} secretKey - Secret key for hashing (same as game secret)
 * @returns {Promise<string>} Hash that cannot be reversed
 */
export async function generateCorrectAnswerHash(correctIndex, questionId, roomId, secretKey) {
  const hashInput = `${secretKey}:${roomId}:${questionId}:${correctIndex}`
  return sha256(hashInput)
}

/**
 * Verify if a selected answer matches the correct answer hash
 * @param {number} selectedChoice - The choice the player selected (0-3)
 * @param {string} correctHash - The hash of the correct answer
 * @param {string} questionId - Question identifier
 * @param {string} roomId - Room identifier
 * @param {string} secretKey - Secret key
 * @returns {Promise<boolean>} True if the hash matches
 */
export async function verifyAnswerHash(selectedChoice, correctHash, questionId, roomId, secretKey) {
  const selectedHash = await generateCorrectAnswerHash(selectedChoice, questionId, roomId, secretKey)
  return selectedHash === correctHash
}

/**
 * Generate a random secret key for a game session
 * Used for signing answers and hashing correct answers
 * @returns {string} Random hex string (32 bytes = 256 bits)
 */
export function generateGameSecret() {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Validate reaction time against rules
 * @param {number} reactionTime - Reaction time in milliseconds
 * @param {number} questionLimit - Time limit for the question in seconds
 * @returns {object} {valid: boolean, reason: string, isAnomalous: boolean}
 */
export function validateReactionTime(reactionTime, questionLimit) {
  const MIN_REACTION_TIME = 100 // Human minimum is ~100ms
  const QUESTION_LIMIT_MS = questionLimit * 1000
  const MAX_ALLOWED = QUESTION_LIMIT_MS + 5000 // 5 second grace period

  if (reactionTime < MIN_REACTION_TIME) {
    return {
      valid: false,
      reason: 'Reaction time too fast (physically impossible)',
      isAnomalous: true
    }
  }

  if (reactionTime > MAX_ALLOWED) {
    return {
      valid: false,
      reason: 'Answer submitted after time limit',
      isAnomalous: true
    }
  }

  // Flag as anomalous if less than normal human reaction but technically valid
  if (reactionTime < 150) {
    return {
      valid: true,
      reason: 'Unusually fast reaction time',
      isAnomalous: true
    }
  }

  return {
    valid: true,
    reason: 'Normal reaction time',
    isAnomalous: false
  }
}

/**
 * Calculate if pattern of answers looks suspicious
 * @param {array} playerAnswers - Array of answer objects with {reactionTime, is_correct}
 * @returns {object} Suspicion indicators
 */
export function analyzeAnswerPattern(playerAnswers) {
  if (!playerAnswers || playerAnswers.length === 0) {
    return {
      perfectScore: false,
      inconsistentTiming: false,
      averageReactionTime: 0,
      anomalousCount: 0
    }
  }

  const correctCount = playerAnswers.filter(a => a.is_correct).length
  const totalCount = playerAnswers.length
  const perfectScore = correctCount === totalCount && totalCount > 1

  const reactionTimes = playerAnswers.map(a => a.reaction_time)
  const averageReactionTime = reactionTimes.reduce((a, b) => a + b, 0) / totalCount
  const anomalousCount = playerAnswers.filter(a => a.is_anomalous).length

  // Check for identical or near-identical reaction times
  const timeSet = new Set()
  let inconsistentTiming = false
  for (const time of reactionTimes) {
    // Check if there's another time within 10ms
    for (const existingTime of timeSet) {
      if (Math.abs(time - existingTime) < 10) {
        inconsistentTiming = true
        break
      }
    }
    timeSet.add(time)
  }

  return {
    perfectScore,
    inconsistentTiming,
    averageReactionTime: Math.round(averageReactionTime),
    anomalousCount,
    totalAnswers: totalCount,
    correctAnswers: correctCount
  }
}
