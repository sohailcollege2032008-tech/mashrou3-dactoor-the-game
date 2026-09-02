/**
 * deckLoader.js — read a tournament's deck, and say why it is unusable.
 *
 * A tournament points at a deck by id, and that deck can be gone: nothing stops
 * a host deleting a deck a tournament still references. The host used to find
 * that out through a console error, because the deck rule cannot evaluate
 * `is_global` on a document that does not exist — so the get came back
 * PERMISSION_DENIED, which reads like a broken app rather than a deleted deck.
 *
 * The rule now allows the get of a missing document (existence was never the
 * secret; the questions still are), so "deleted" and "not yours" are finally
 * distinguishable. This turns every outcome into one shape the pages can render
 * as a sentence, and keeps that sentence identical wherever it is shown.
 */
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'

export const DECK_MESSAGES = {
  none:    'البطولة مش مربوطة بأي ديك أسئلة.',
  missing: 'ديك أسئلة البطولة مش موجود — يظهر إنه اتمسح. اربط البطولة بديك تاني قبل ما تشغّل أي جولة.',
  denied:  'ديك أسئلة البطولة مش مسموح لك تقراه — يظهر إنه بقى ملك حساب تاني.',
  empty:   'ديك أسئلة البطولة موجود بس مفيهوش أسئلة.',
  error:   'مش قادر أقرا ديك أسئلة البطولة دلوقتي — اتأكد من النت وجرّب تاني.',
}

/**
 * The same fact in a few words, for when an action is refused on a screen that
 * is already carrying the full sentence — the banner states the condition, the
 * refusal states the consequence, and neither repeats the other.
 */
export const DECK_SHORT = {
  none:    'مفيش ديك مربوط بالبطولة',
  missing: 'ديك الأسئلة مش موجود',
  denied:  'ديك الأسئلة مش مسموح لك تقراه',
  empty:   'ديك الأسئلة مفيهوش أسئلة',
  error:   'مش قادر أقرا ديك الأسئلة',
}

/**
 * @param {string|null|undefined} deckId
 * @returns {Promise<{
 *   ok: boolean, questions: object[], title: string|null, raw: object|null,
 *   reason: null|'none'|'missing'|'denied'|'empty'|'error',
 *   message: string|null, short: string|null,
 * }>}
 */
export async function loadTournamentDeck(deckId) {
  const fail = reason => ({
    ok: false, questions: [], title: null, raw: null,
    reason, message: DECK_MESSAGES[reason], short: DECK_SHORT[reason],
  })

  if (!deckId) return fail('none')

  let snap
  try {
    snap = await getDoc(doc(db, 'question_sets', deckId))
  } catch (e) {
    const denied = e?.code === 'permission-denied' ||
      /permission|insufficient/i.test(e?.message || '')
    return fail(denied ? 'denied' : 'error')
  }

  if (!snap.exists()) return fail('missing')

  const data      = snap.data() || {}
  const questions = data.questions?.questions || []
  if (questions.length === 0) {
    return { ...fail('empty'), title: data.title || null, raw: data }
  }

  return {
    ok: true, questions, title: data.title || null, raw: data,
    reason: null, message: null, short: null,
  }
}
