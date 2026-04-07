import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'

let isListenerSubscribed = false

async function initAuthListener() {
  if (isListenerSubscribed) return
  isListenerSubscribed = true

  const state = useAuthStore.getState()
  
  // ── Helper to fetch profile with retries ──────────────────────────────────
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
        if (error.code === 'PGRST116') return null // row not found
        throw error
      }
      return data
    } catch (err) {
      console.warn(`[Auth] Profile fetch attempt ${attempt}/${MAX_RETRIES} failed:`, err.message)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        return getProfile(userId, attempt + 1)
      }
      return null
    }
  }

  // ── INITIAL SESSION RECOVERY ──────────────────────────────────────────────
  // We don't call clearAuth() immediately because we want to wait for Supabase to be sure.
  // But we can check getSession() to speed up things if it's already there.
  const { data: { session: quickSession } } = await supabase.auth.getSession()
  if (quickSession && !state.initialized) {
    console.log('[Auth] Quick session recovery found session')
    const profile = await getProfile(quickSession.user.id)
    useAuthStore.getState().setAuth(quickSession, profile)
  }

  // ── Listen for changes ────────────────────────────────────────────────────
  supabase.auth.onAuthStateChange(async (event, currentSession) => {
    console.log(`[Auth] Event: ${event}`, currentSession ? `user=${currentSession.user.id}` : 'no session')

    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      if (currentSession) {
        const profile = await getProfile(currentSession.user.id)
        useAuthStore.getState().setAuth(currentSession, profile)
      } else {
        useAuthStore.getState().clearAuth()
      }
    } else if (event === 'SIGNED_OUT') {
      useAuthStore.getState().clearAuth()
    }
  })

  // Failsafe: if after 10 seconds we are still "loading", something is wrong
  setTimeout(() => {
    if (!useAuthStore.getState().initialized) {
      console.warn('[Auth] Failsafe: initialization took too long, clearing loading state.')
      useAuthStore.getState().clearAuth()
    }
  }, 10000)
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
