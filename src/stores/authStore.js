import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useAuthStore = create((set, get) => ({
  session: null,
  profile: null,
  loading: true,
  initialized: false,

  setAuth: (session, profile) => set({ 
    session, 
    profile, 
    loading: false, 
    initialized: true 
  }),

  setLoading: (loading) => set({ loading }),

  clearAuth: () => set({ 
    session: null, 
    profile: null, 
    loading: false, 
    initialized: true 
  }),

  initialize: async () => {
    if (get().initialized) return

    // 1. Initial Session Check (Immediate)
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      await get().fetchProfile(session.user.id, session)
    } else {
      set({ initialized: true, loading: false })
    }

    // 2. Listen for Auth State Changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      console.log(`[AuthStore] Event: ${event}`)
      
      if (session) {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          await get().fetchProfile(session.user.id, session)
        }
      } else {
        get().clearAuth()
      }
    })

    // Failsafe
    setTimeout(() => {
      if (!get().initialized) {
        set({ initialized: true, loading: false })
      }
    }, 5000)
  },

  fetchProfile: async (userId, session) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) {
        console.warn('[AuthStore] Profile fetch error:', error.message)
        // If profile doesn't exist yet, we still have the session
        set({ session, profile: null, loading: false, initialized: true })
      } else {
        set({ session, profile: data, loading: false, initialized: true })
      }
    } catch (err) {
      console.error('[AuthStore] fetchProfile exception:', err)
      set({ session, profile: null, loading: false, initialized: true })
    }
  }
}))
