/**
 * returnTo.js — remember where a signed-out visitor was trying to go.
 *
 * The links that get shared for an event — the watch link, `/tournament/join?code=…`
 * — are opened mostly by people who are not signed in on that browser yet.
 * ProtectedRoute bounces them to the landing page, and after Google sign-in the
 * landing page used to send everyone to their dashboard: the link they tapped
 * was simply gone. Now the bounce records the destination and the first
 * post-login redirect goes back to it.
 */
const KEY = 'mr_return_to'
const MAX_AGE_MS = 30 * 60 * 1000

export function rememberReturnTo(path) {
  if (!path || !path.startsWith('/') || path === '/' || path.startsWith('//')) return
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }))
  } catch { /* storage refused (private mode) — the dashboard fallback still works */ }
}

/** Returns the remembered path once, then forgets it. */
export function takeReturnTo() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    sessionStorage.removeItem(KEY)
    const { path, at } = JSON.parse(raw)
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null
    if (!at || Date.now() - at > MAX_AGE_MS) return null
    return path
  } catch {
    return null
  }
}
