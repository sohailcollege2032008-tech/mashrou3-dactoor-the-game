import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'

let isListenerSubscribed = false

function initAuthListener() {
  if (isListenerSubscribed) return
  isListenerSubscribed = true

  // Retry up to MAX_RETRIES times with RETRY_DELAY_MS between attempts
  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 1500

  async function getProfile(userId, attempt = 1) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 6000)

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
        .abortSignal(controller.signal)

      clearTimeout(timeoutId)

      if (error) {
        if (error.code === 'PGRST116') return null // row not found — legit
        throw error
      }
      return data
    } catch (err) {
      console.warn(`[Auth] Profile fetch attempt ${attempt}/${MAX_RETRIES} failed:`, err.message)

      // Retry with delay
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        return getProfile(userId, attempt + 1)
      }

      console.error('[Auth] All profile fetch attempts failed.')
      return null
    }
  }

  // ── Safety timeout ────────────────────────────────────────────────────────
  // Must be > max possible getProfile time: 3 retries × (6s abort + 1.5s delay) ≈ 23s
  // We use 35s as a generous upper bound
  const safetyTimeout = setTimeout(() => {
    if (useAuthStore.getState().loading) {
      console.warn('[Auth] Safety timeout — forcing clearAuth()')
      useAuthStore.getState().clearAuth()
    }
  }, 35000)

  // ── Single source of truth: onAuthStateChange ─────────────────────────────
  supabase.auth.onAuthStateChange(async (event, currentSession) => {
    console.log(`[Auth] ${event}`, currentSession ? `uid=${currentSession.user.id}` : 'no session')

    if (event === 'INITIAL_SESSION') {
      if (currentSession) {
        let profileData = await getProfile(currentSession.user.id)
        if (!profileData) profileData = useAuthStore.getState().profile // fallback to existing if network fails
        useAuthStore.getState().setAuth(currentSession, profileData)
      } else {
        useAuthStore.getState().clearAuth()
      }
      clearTimeout(safetyTimeout)
      return
    }

    if (event === 'SIGNED_IN') {
      if (currentSession) {
        const { initialized } = useAuthStore.getState()
        if (!initialized) useAuthStore.getState().setLoading(true)
        let profileData = await getProfile(currentSession.user.id)
        if (!profileData) profileData = useAuthStore.getState().profile
        useAuthStore.getState().setAuth(currentSession, profileData)
      }
      clearTimeout(safetyTimeout)
      return
    }

    if (event === 'TOKEN_REFRESHED') {
      if (currentSession) {
        let profileData = await getProfile(currentSession.user.id)
        if (!profileData) profileData = useAuthStore.getState().profile
        useAuthStore.getState().setAuth(currentSession, profileData)
      }
      return
    }

    if (event === 'SIGNED_OUT') {
      useAuthStore.getState().clearAuth()
      clearTimeout(safetyTimeout)
      return
    }
  })
}

export function useAuth() {
  const session = useAuthStore(state => state.session)
  const profile = useAuthStore(state => state.profile)
  const loading = useAuthStore(state => state.loading)

  useEffect(() => {
    initAuthListener()
  }, [])

  return { session, profile, loading }
}
