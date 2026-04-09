import { create } from 'zustand'
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'

const OWNER_EMAIL = import.meta.env.VITE_OWNER_EMAIL

export const useAuthStore = create((set, get) => ({
  // session = Firebase User object (or null)
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

  clearAuth: () => set({
    session: null,
    profile: null,
    loading: false,
    initialized: true
  }),

  initialize: () => {
    if (get().initialized) return

    // Firebase handles session persistence automatically
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        await get().fetchProfile(user)
      } else {
        get().clearAuth()
      }
    })

    // Failsafe: if auth doesn't resolve in 5s, unblock the app
    setTimeout(() => {
      if (!get().initialized) {
        set({ initialized: true, loading: false })
      }
    }, 5000)

    return unsubscribe
  },

  fetchProfile: async (user) => {
    try {
      const profileRef = doc(db, 'profiles', user.uid)
      const snap = await getDoc(profileRef)

      // Calculate the correct role fresh every login
      const correctRole = user.email === OWNER_EMAIL
        ? 'owner'
        : await get().checkIfHost(user.email)
          ? 'host'
          : 'player'

      if (snap.exists()) {
        const profile = snap.data()

        // If role changed (e.g. owner added this user as host), update it
        if (profile.role !== correctRole) {
          await updateDoc(profileRef, { role: correctRole })
          profile.role = correctRole
        }

        set({ session: user, profile, loading: false, initialized: true })
      } else {
        // First-time login: create profile
        const newProfile = {
          id: user.uid,
          email: user.email,
          display_name: user.displayName || null,
          avatar_url: user.photoURL || null,
          role: correctRole,
        }
        await setDoc(profileRef, newProfile)
        set({ session: user, profile: newProfile, loading: false, initialized: true })
      }
    } catch (err) {
      console.error('[AuthStore] fetchProfile error:', err)
      set({ session: user, profile: null, loading: false, initialized: true })
    }
  },

  checkIfHost: async (email) => {
    try {
      const q = query(
        collection(db, 'authorized_hosts'),
        where('email', '==', email),
        where('is_active', '==', true)
      )
      const snap = await getDocs(q)
      return !snap.empty
    } catch {
      return false
    }
  },

  signOut: async () => {
    await firebaseSignOut(auth)
    get().clearAuth()
  }
}))
