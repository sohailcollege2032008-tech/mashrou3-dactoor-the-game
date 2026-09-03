/**
 * matchStory.js — where each player in a knockout match came from.
 *
 * This was computed inside `TournamentDuelWrapper` for the 5-second VS
 * countdown. But the countdown is 5 seconds and the break before it can run
 * minutes, and for that whole minute the wait screen showed two bare names.
 * Same facts, two screens — so the facts moved here and both read from one
 * source, which also means the wait screen cannot phrase a result differently
 * from the duel screen that follows it.
 *
 * Everything is pure and takes data the caller already has: the qualifier
 * results and the bracket matches. No reads happen in here.
 */

/** Canonical Arabic round name. Kept identical to the one it replaced. */
export function roundLabel(round, totalRounds) {
  if (!round) return ''
  if (!totalRounds) return `الجولة ${round}`
  if (round === totalRounds)     return 'النهائي'
  if (round === totalRounds - 1) return 'نصف النهائي'
  if (round === totalRounds - 2) return 'ربع النهائي'
  return `الجولة ${round}`
}

/**
 * One line saying how this player reached this match.
 *
 * @param {string}   playerUid
 * @param {object[]} prevMatches  finished matches of the PREVIOUS round only
 * @param {number?}  ffaRank      their qualifier rank, if they have one
 * @returns {string|null}
 */
export function pathFor(playerUid, prevMatches = [], ffaRank = null) {
  const won = prevMatches.find(m => m.winner_uid === playerUid)
  if (won) {
    const isA   = won.player_a_uid === playerUid
    const oppNm = (isA ? won.player_b_name : won.player_a_name) || 'خصمه'
    if (won.forced_by_host) return `تأهل بالغياب أمام ${oppNm}`
    const mine  = (isA ? won.player_a_score : won.player_b_score) ?? 0
    const other = (isA ? won.player_b_score : won.player_a_score) ?? 0
    const how = won.tie_broken_by === 'speed' ? ' بالسرعة'
      : won.tie_broken_by === 'ffa_rank' ? ' بترتيب التصفيات' : ''
    return `فاز على ${oppNm} ${mine}–${other}${how}`
  }
  return ffaRank ? `تأهل من التصفيات في المركز ${ffaRank}` : null
}

/**
 * The story for one match: what each side did to get here, and what the winner
 * walks away with.
 *
 * @param {object}   match       the bracket match doc (needs round, both uids,
 *                               next_match_id)
 * @param {object[]} allMatches  every bracket match known to the caller
 * @param {object}   ranks       { [uid]: qualifier rank }
 * @param {number}   totalRounds
 * @returns {{stake: string, sides: Object<string,{seed:number|null,path:string|null}>}|null}
 */
export function buildMatchStory(match, allMatches = [], ranks = {}, totalRounds = 0) {
  if (!match) return null
  const uidA = match.player_a_uid
  const uidB = match.player_b_uid
  if (!uidA || !uidB) return null

  const round = match.round || 1
  const prev  = round > 1
    ? allMatches.filter(m => m.status === 'finished' && (m.round || 1) === round - 1)
    : []

  return {
    stake: !match.next_match_id
      ? 'الفايز بطل البطولة'
      : `الفايز يروح ${roundLabel(round + 1, totalRounds)}`,
    sides: {
      [uidA]: { seed: ranks[uidA] || null, path: pathFor(uidA, prev, ranks[uidA] || null) },
      [uidB]: { seed: ranks[uidB] || null, path: pathFor(uidB, prev, ranks[uidB] || null) },
    },
  }
}
