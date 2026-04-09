import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

// Firebase uses popup auth - no redirect callback needed.
// This page just waits for auth state and redirects accordingly.
export default function AuthCallback() {
  const navigate = useNavigate()
  const { session, profile, loading } = useAuthStore()

  useEffect(() => {
    if (loading) return
    if (session && profile) {
      if (profile.role === 'owner') navigate('/owner/dashboard', { replace: true })
      else if (profile.role === 'host') navigate('/host/dashboard', { replace: true })
      else navigate('/player/join', { replace: true })
    } else {
      navigate('/', { replace: true })
    }
  }, [session, profile, loading, navigate])

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="text-primary animate-pulse text-2xl font-bold font-sans">جاري التحقق من الهوية...</div>
    </div>
  )
}
