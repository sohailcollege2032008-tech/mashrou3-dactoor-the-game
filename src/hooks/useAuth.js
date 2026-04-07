import { useAuthStore } from '../stores/authStore'

export function useAuth() {
  const session = useAuthStore(state => state.session)
  const profile = useAuthStore(state => state.profile)
  const loading = useAuthStore(state => state.loading)
  const initialized = useAuthStore(state => state.initialized)

  return { session, profile, loading, initialized }
}
