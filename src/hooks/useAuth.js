import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'

let isListenerSubscribed = false

function initAuthListener() {
  if (isListenerSubscribed) return
  isListenerSubscribed = true

  async function getProfile(userId) {
    try {
      const queryPromise = supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Profile fetch timeout')), 6000)
      )
      const { data, error } = await Promise.race([queryPromise, timeoutPromise])
      if (error) {
        if (error.code !== 'PGRST116') {
          console.error('[Auth] Profile fetch error:', error)
        }
        return null
      }
      return data
    } catch (err) {
      console.error('[Auth] Profile fetch exception:', err)
      return null
    }
  }

  // ── Safety timeout ────────────────────────────────────────────────────────
  const safetyTimeout = setTimeout(() => {
    if (useAuthStore.getState().loading) {
      console.warn('[Auth] Safety timeout — forcing clearAuth()')
      useAuthStore.getState().clearAuth()
    }
  }, 8000)

  // ── Single source of truth: onAuthStateChange ─────────────────────────────
  supabase.auth.onAuthStateChange(async (event, currentSession) => {
    console.log(`[Auth] ${event}`, currentSession ? `uid=${currentSession.user.id}` : 'no session')

    if (event === 'INITIAL_SESSION') {
      if (currentSession) {
        const profileData = await getProfile(currentSession.user.id)
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
        const profileData = await getProfile(currentSession.user.id)
        useAuthStore.getState().setAuth(currentSession, profileData)
      }
      clearTimeout(safetyTimeout)
      return
    }

    if (event === 'TOKEN_REFRESHED') {
      if (currentSession) {
        const profileData = await getProfile(currentSession.user.id)
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
