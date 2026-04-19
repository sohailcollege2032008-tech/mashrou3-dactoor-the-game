import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { hashCorrectForDuel } from './crypto'

// ── Fetch played question texts for a given user + deck from Firestore ─────────
export async function fetchPlayedQuestions(uid, deckId) {
  if (!uid || !deckId) return []
  try {
    const snap = await getDoc(doc(db, 'profiles', uid, 'played_questions', deckId))
    return snap.exists() ? (snap.data().texts || []) : []
  } catch {
    return []
  }
}

// ── Record played questions to Firestore (merges with existing) ────────────────
export async function recordPlayedQuestions(uid, deckId, questionTexts) {
  if (!uid || !deckId || !questionTexts?.length) return
  try {
    const ref = doc(db, 'profiles', uid, 'played_questions', deckId)
    const snap = await getDoc(ref)
    const existing = snap.exists() ? (snap.data().texts || []) : []
    const merged = [...new Set([...existing, ...questionTexts.filter(Boolean)])]
    await setDoc(ref, { texts: merged, updated_at: serverTimestamp() })
  } catch (e) {
    console.error('recordPlayedQuestions error:', e)
  }
}

// ── Apply duel config to a raw question list ───────────────────────────────────
// playedTexts = combined Set of question texts to exclude (from both players)
export function applyDuelConfig(rawQuestions, config = {}, playedTexts = []) {
  let questions = [...rawQuestions]

  // 1. Exclude played questions (union of both players)
  if (config.excludePlayed && playedTexts.length > 0) {
    const played = new Set(playedTexts)
    const filtered = questions.filter(q => !played.has(q.question))
    // Only apply if at least 3 unplayed questions remain
    if (filtered.length >= 3) questions = filtered
  }

  // 2. Shuffle (mandatory when selecting a subset so it's not always the same Qs)
  const mustShuffle =
    config.shuffleQuestions ||
    (config.questionCount && config.questionCount < questions.length)
  if (mustShuffle) {
    questions = [...questions].sort(() => Math.random() - 0.5)
  }

  // 3. Slice to desired count
  if (config.questionCount && config.questionCount < questions.length) {
    questions = questions.slice(0, config.questionCount)
  }

  // 4. Shuffle answer choices
  if (config.shuffleAnswers) {
    questions = questions.map(q => {
      if (!Array.isArray(q.choices) || q.correct == null) return q
      const correctAnswer = q.choices[q.correct]
      const shuffled = [...q.choices].sort(() => Math.random() - 0.5)
      return { ...q, choices: shuffled, correct: shuffled.indexOf(correctAnswer) }
    })
  }

  return questions
}

// ── Strip correct index before writing to RTDB ────────────────────────────────
// Replaces q.correct with q.correct_hash so the answer can't be read from the
// Network tab. The hash is deterministic: sha256("duel:{duelId}:{qi}:{index}").
// During the transition period, old duels already in RTDB keep their plain
// `correct` field — DuelGame falls back to it if correct_hash is absent.
export async function stripCorrectForRtdb(questions, duelId) {
  return Promise.all(
    questions.map(async (q, qi) => {
      if (q.correct == null) return q
      const { correct, ...rest } = q
      return { ...rest, correct_hash: await hashCorrectForDuel(duelId, qi, correct) }
    })
  )
}
