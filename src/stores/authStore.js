import { create } from 'zustand'

export const useAuthStore = create((set) => ({
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
  })
}))
