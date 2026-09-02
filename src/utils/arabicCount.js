/**
 * arabicCount.js — counting in Arabic, including the numeral.
 *
 * Arabic does not put a numeral in front of a dual: «مباراتين» already says
 * "two matches", so «2 مباراتين» reads like "2 two-matches". The singular is
 * the same — «نقطة» is one point, and «1 نقطة» is a form nobody says out loud.
 * Only 3–10 (the plural) and 11+ (which reverts to the singular noun) take the
 * number.
 *
 * The rule lives here because three different screens count things — the
 * qualifier cut line, the round report, the honours board — and each of them
 * had grown its own half of it. `functions/main.py` has the same rule as
 * `_ar_qty`, because what the server writes has to read the same way.
 */

/**
 * @param {number} n
 * @param {string} one   e.g. 'نقطة'
 * @param {string} two   e.g. 'نقطتين'
 * @param {string} few   3–10, e.g. 'نقاط'
 * @param {string} many  11+,  e.g. 'نقطة'
 * @returns {string} the whole phrase, numeral included where Arabic wants one
 */
export function arQty(n, one, two, few, many) {
  const v = Number(n) || 0
  if (v === 1) return one
  if (v === 2) return two
  if (v >= 3 && v <= 10) return `${v} ${few}`
  return `${v} ${many}`
}

/** Points: 1 → نقطة, 2 → نقطتين, 3–10 → 5 نقاط, 11+ → 30 نقطة. */
export const arPoints = n => arQty(n, 'نقطة', 'نقطتين', 'نقاط', 'نقطة')

/** Matches: 1 → مباراة, 2 → مباراتين, 3–10 → 4 مباريات, 11+ → 16 مباراة. */
export const arMatches = n => arQty(n, 'مباراة', 'مباراتين', 'مباريات', 'مباراة')
