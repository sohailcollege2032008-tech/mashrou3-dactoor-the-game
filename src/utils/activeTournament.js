/**
 * activeTournament.js — multi-slot localStorage tracking of tournaments the
 * player joined. Replaces the old single-key `activeTournamentId` so joining
 * tournament B no longer hides a live tournament A.
 */

const KEY = 'activeTournamentIds'

export function getActiveTournamentIds() {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && x.length > 0) : []
  } catch {
    return []
  }
}

export function addActiveTournamentId(id) {
  if (!id) return
  const arr = getActiveTournamentIds()
  if (!arr.includes(id)) {
    arr.push(id)
    localStorage.setItem(KEY, JSON.stringify(arr))
  }
}

export function removeActiveTournamentId(id) {
  if (!id) return
  localStorage.setItem(KEY, JSON.stringify(getActiveTournamentIds().filter(x => x !== id)))
}
