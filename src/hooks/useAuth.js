import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'

export function useAuth() {
  const session = useAuthStore(state => state.session)
  const profile = useAuthStore(state => state.profile)
  const loading = useAuthStore(state => state.loading)

  useEffect(() => {
    async function getProfile(userId) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single()
        if (error) {
          // PGRST116 = no rows found (profile not created yet), not a real error
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
    // If INITIAL_SESSION never fires (edge case / network hang),
    // force-resolve after 8s so the user is never stuck forever.
    const safetyTimeout = setTimeout(() => {
      if (useAuthStore.getState().loading) {
        console.warn('[Auth] Safety timeout — forcing clearAuth()')
        useAuthStore.getState().clearAuth()
      }
    }, 8000)

    // ── Single source of truth: onAuthStateChange ─────────────────────────────
    // In Supabase v2, INITIAL_SESSION fires immediately after subscription
    // with the current session (from localStorage) — no separate getSession()
    // needed. getSession() was the cause of hangs with stale refresh tokens.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        clearTimeout(safetyTimeout) // Cancel fallback on ANY auth event
        console.log(`[Auth] ${event}`, currentSession ? `uid=${currentSession.user.id}` : 'no session')

        if (event === 'INITIAL_SESSION') {
          if (currentSession) {
            const profileData = await getProfile(currentSession.user.id)
            useAuthStore.getState().setAuth(currentSession, profileData)
          } else {
            useAuthStore.getState().clearAuth()
          }
          return
        }

        if (event === 'SIGNED_IN') {
          if (currentSession) {
            // Only flash loading screen on the very first login, not on session restore
            const { initialized } = useAuthStore.getState()
            if (!initialized) useAuthStore.getState().setLoading(true)
            const profileData = await getProfile(currentSession.user.id)
            useAuthStore.getState().setAuth(currentSession, profileData)
          }
          return
        }

        if (event === 'TOKEN_REFRESHED') {
          // Session refreshed — update the store without flashing loading
          if (currentSession) {
            const profileData = await getProfile(currentSession.user.id)
            useAuthStore.getState().setAuth(currentSession, profileData)
          }
          return
        }

        if (event === 'SIGNED_OUT') {
          useAuthStore.getState().clearAuth()
          return
        }
      }
    )

    return () => {
      clearTimeout(safetyTimeout)
      subscription.unsubscribe()
    }
  }, [])

  return { session, profile, loading }
}
