/**
 * tournamentUtils.js
 * Pure (no Firebase) utility functions for the Tournament system.
 */

import { sortPlayers } from './gameRunner'

// ── Top-cut calculation ────────────────────────────────────────────────────────

/**
 * Given the desired top-cut and actual registered count, return the nearest
 * power-of-2 that is ≤ both values.
 * @param {number} registeredCount
 * @param {number} desiredTopCut  - must be 8, 16, or 32
 * @returns {number} actual top-cut (e.g. 8)
 */
export function computeActualTopCut(registeredCount, desiredTopCut) {
  const cap = Math.min(desiredTopCut, registeredCount)
  let n = 1
  while (n * 2 <= cap) n *= 2
  return n
}

/** Questions consumed by a single bracket match (must match the Cloud Function). */
export const QUESTIONS_PER_MATCH = 5

/** Bracket sizes a host can pick as the cap — each one is a whole number of rounds. */
export const TOP_CUT_CHOICES = [2, 4, 8, 16, 32, 64, 128]

/**
 * Number of bracket rounds a given bracket size produces.
 * 2 → 1 (final only), 4 → 2, 8 → 3 …
 */
export function roundsForTopCut(topCut) {
  let n = 1, rounds = 0
  while (n * 2 <= (topCut || 0)) { n *= 2; rounds++ }
  return Math.max(rounds, 1)
}

/**
 * Check that every slot the tournament will use has questions assigned.
 * Assignment is mandatory — a round left empty used to fall back to random
 * questions, which meant the host never really controlled what was asked.
 *
 * @param {object} roundQuestions - tournament.round_questions
 * @param {number} plannedRounds  - rounds implied by the bracket cap
 * @returns {{ ok: boolean, missing: {slot: string, label: string, have: number, need: number}[] }}
 */
export function validateRoundAssignments(roundQuestions, plannedRounds) {
  const rq = roundQuestions || {}
  const missing = []

  const ffaCount = (rq.ffa || []).length
  if (ffaCount < 1) {
    missing.push({ slot: 'ffa', label: 'التصفيات (FFA)', have: ffaCount, need: 1 })
  }

  for (let r = 1; r <= plannedRounds; r++) {
    const have = (rq[String(r)] || []).length
    if (have < QUESTIONS_PER_MATCH) {
      missing.push({
        slot:  String(r),
        label: r === plannedRounds ? 'النهائي'
             : r === plannedRounds - 1 ? 'نصف النهائي'
             : r === plannedRounds - 2 ? 'ربع النهائي'
             : `الجولة ${r}`,
        have,
        need: QUESTIONS_PER_MATCH,
      })
    }
  }

  return { ok: missing.length === 0, missing }
}

/**
 * Indices currently assigned to a slot the tournament will actually use.
 * Rounds beyond `roundCount` are ignored — when the host lowers the bracket cap
 * those rounds disappear, and their questions must become available again.
 *
 * @param {object} assignments - { ffa: number[], 1: number[], … }
 * @param {number} roundCount
 * @returns {Set<number>}
 */
export function assignedIndices(assignments, roundCount) {
  return new Set(
    Object.entries(assignments || {})
      .filter(([k]) => k === 'ffa' || Number(k) <= roundCount)
      .flatMap(([, idxs]) => idxs || [])
  )
}

/**
 * Reshape an assignment map when the number of bracket rounds changes.
 * Shrinking DELETES the dropped rounds (their questions return to the pool);
 * growing adds empty slots. Kept rounds are untouched.
 *
 * @param {object} assignments
 * @param {number} prevRounds
 * @param {number} nextRounds
 * @returns {object} new assignment map
 */
export function reshapeAssignments(assignments, prevRounds, nextRounds) {
  const copy = { ...(assignments || {}) }
  if (nextRounds < prevRounds) {
    for (let r = nextRounds + 1; r <= prevRounds; r++) delete copy[r]
  } else {
    for (let r = prevRounds + 1; r <= nextRounds; r++) copy[r] = copy[r] || []
  }
  return copy
}

// ── Bracket seed ordering ──────────────────────────────────────────────────────

/**
 * Build the seeding order for a single-elimination bracket of size n (power of 2).
 * Returns an array of 1-based seed numbers arranged so that adjacent pairs are
 * the Round-1 match-ups:  [1, n, (n/2)+1, (n/2), ...]
 *
 * Example: buildBracketOrder(8) → [1, 8, 4, 5, 2, 7, 3, 6]
 * Pairs: (1v8), (4v5), (2v7), (3v6)
 */
export function buildBracketOrder(n) {
  if (n === 2) return [1, 2]
  const prev = buildBracketOrder(n / 2)
  return prev.flatMap(seed => [seed, n + 1 - seed])
}

// ── Match generation ───────────────────────────────────────────────────────────

/**
 * Generate the full bracket match list from a sorted (seeded) player array.
 * @param {object[]} seededPlayers  - sorted by FFA rank (index 0 = seed 1)
 * @returns {object[]}  array of match objects ready to write to Firestore
 */
export function generateBracketMatches(seededPlayers) {
  const n = seededPlayers.length
  const totalRounds = Math.log2(n)
  const order = buildBracketOrder(n)
  const matches = []

  // Round 1 pairs
  for (let i = 0; i < order.length; i += 2) {
    const seedA   = order[i]     // 1-based
    const seedB   = order[i + 1]
    const matchNum = i / 2 + 1   // 1-based within the round
    const playerA = seededPlayers[seedA - 1]
    const playerB = seededPlayers[seedB - 1]
    const matchId = `r1m${matchNum}`
    const nextMatchId = totalRounds > 1 ? `r2m${Math.ceil(matchNum / 2)}` : null

    matches.push({
      match_id:      matchId,
      round:         1,
      match_number:  matchNum,
      player_a_uid:  playerA.uid || playerA.user_id,
      player_b_uid:  playerB.uid || playerB.user_id,
      player_a_name: playerA.nickname,
      player_b_name: playerB.nickname,
      duel_id:       null,
      status:        'pending',
      winner_uid:    null,
      loser_uid:     null,
      player_a_score: null,
      player_b_score: null,
      tie_broken_by: null,
      finished_at:   null,
      next_match_id: nextMatchId,
    })
  }

  // Subsequent rounds — placeholders (players TBD)
  for (let round = 2; round <= totalRounds; round++) {
    const matchesInRound = n / Math.pow(2, round)
    for (let matchNum = 1; matchNum <= matchesInRound; matchNum++) {
      const matchId     = `r${round}m${matchNum}`
      const nextMatchId = round < totalRounds ? `r${round + 1}m${Math.ceil(matchNum / 2)}` : null

      matches.push({
        match_id:      matchId,
        round,
        match_number:  matchNum,
        player_a_uid:  null,
        player_b_uid:  null,
        player_a_name: 'TBD',
        player_b_name: 'TBD',
        duel_id:       null,
        status:        'pending',
        winner_uid:    null,
        loser_uid:     null,
        player_a_score: null,
        player_b_score: null,
        tie_broken_by: null,
        finished_at:   null,
        next_match_id: nextMatchId,
      })
    }
  }

  return matches
}

// ── Tie resolution ─────────────────────────────────────────────────────────────

/**
 * Resolve a tie in a tournament duel.
 * @param {object} duelData   - RTDB duel snapshot value
 * @param {string[]} playerUids - [uidA, uidB]
 * @returns {{ winnerUid: string, loserUid: string, tieBreaker: 'speed'|'random' }}
 */
export function resolveMatchTie(duelData, playerUids) {
  const [uidA, uidB] = playerUids
  const scoreA = duelData.players?.[uidA]?.score ?? 0
  const scoreB = duelData.players?.[uidB]?.score ?? 0

  // Both zero → random winner
  if (scoreA === 0 && scoreB === 0) {
    const winnerUid = Math.random() > 0.5 ? uidA : uidB
    const loserUid  = winnerUid === uidA ? uidB : uidA
    return { winnerUid, loserUid, tieBreaker: 'random' }
  }

  // Equal non-zero scores → fastest completion wins (lower total reaction ms)
  const reactionA = _sumReactionMs(duelData, uidA)
  const reactionB = _sumReactionMs(duelData, uidB)
  const winnerUid  = reactionA <= reactionB ? uidA : uidB
  const loserUid   = winnerUid === uidA ? uidB : uidA
  return { winnerUid, loserUid, tieBreaker: 'speed' }
}

/** Sum reaction_time_ms for all correct answers by a player across all questions */
function _sumReactionMs(duelData, uid) {
  const answers = duelData.answers || {}
  let total = 0
  for (const qAnswers of Object.values(answers)) {
    const a = qAnswers?.[uid]
    if (a?.is_correct) total += a.reaction_time_ms ?? 0
  }
  return total
}

// ── Question assignment ────────────────────────────────────────────────────────

/**
 * Return the question objects to use for a given bracket round.
 * Prefers host-assigned indices; falls back to random unused questions.
 *
 * @param {number}   round           - 1-based round number
 * @param {object}   tournament      - Firestore tournament document data
 * @param {object[]} deckQuestions   - raw questions array from question_sets deck
 * @param {number}   count           - how many questions are needed (default 5)
 * @returns {object[]}
 */
export function getQuestionsForRound(round, tournament, deckQuestions, count = 5) {
  const assigned = tournament.round_questions?.[String(round)]

  if (assigned && assigned.length > 0) {
    // Filter out assigned indices that fell out of the deck's range (e.g. the
    // host deleted a question after assignments were saved) — otherwise the
    // indices silently slip and the match plays wrong/fewer questions.
    const inRange = assigned.filter(i =>
      Number.isInteger(i) && i >= 0 && i < deckQuestions.length
    )
    if (inRange.length !== assigned.length) {
      console.warn(
        `[getQuestionsForRound] Round ${round}: ` +
        `${assigned.length - inRange.length} assigned index(es) outside the deck ` +
        'range were filtered out.'
      )
    }
    const questions = inRange.map(i => deckQuestions[i]).filter(Boolean)
    if (questions.length > 0) return questions
  }

  // Fallback: collect indices used in previous rounds
  const usedIndices = new Set()
  for (let r = 1; r < round; r++) {
    const prev = tournament.round_questions?.[String(r)]
    if (prev) prev.forEach(i => usedIndices.add(i))
  }

  const unused = deckQuestions
    .map((q, i) => ({ q, i }))
    .filter(({ i }) => !usedIndices.has(i))

  const pool = unused.length >= count ? unused : deckQuestions.map((q, i) => ({ q, i }))
  const shuffled = _shuffle([...pool])
  return shuffled.slice(0, count).map(({ q }) => q)
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Generate a 6-character alphanumeric tournament code (same charset as room codes).
 */
export function generateTournamentCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

/**
 * Re-export sortPlayers so tournament pages only need one import.
 */
export { sortPlayers }
