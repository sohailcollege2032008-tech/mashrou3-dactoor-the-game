import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const session = useAuthStore(state => state.session)
  const profile = useAuthStore(state => state.profile)
  const loading = useAuthStore(state => state.loading)
  const [status, setStatus] = useState('loading') // 'loading' | 'error'

  // ── Navigate once auth is resolved ────────────────────────────────────────
  useEffect(() => {
    if (loading) return

    if (session && profile) {
      // Happy path: session + profile ready
      if (profile.role === 'owner') navigate('/owner/dashboard', { replace: true })
      else if (profile.role === 'host') navigate('/host/dashboard', { replace: true })
      else navigate('/player/join', { replace: true })
      return
    }

    if (session && !profile) {
      // Session exists but profile is missing — new user whose trigger hasn't run.
      // Try to upsert a default profile so the auth listener can pick it up.
      const createProfile = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setStatus('error'); return }
        await supabase.from('profiles').upsert({
          id: user.id,
          email: user.email,
          display_name: user.user_metadata?.full_name || null,
          avatar_url: user.user_metadata?.avatar_url || null,
          role: 'player'
        }, { onConflict: 'id' })
        // Auth listener (onAuthStateChange) will pick up the refresh automatically
      }
      createProfile()
      return
    }

    // No session at all — auth failed
    setStatus('error')
    setTimeout(() => navigate('/', { replace: true }), 2000)
  }, [session, profile, loading, navigate])

  // ── Hard safety timeout (10s) ────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!session || !profile) {
        setStatus('error')
        setTimeout(() => navigate('/', { replace: true }), 2000)
      }
    }, 10000)
    return () => clearTimeout(timer)
  }, [session, profile, navigate])

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="text-center space-y-3">
        {status === 'error' ? (
          <>
            <div className="text-red-400 text-2xl font-bold font-sans">⚠️ حدث خطأ في تسجيل الدخول</div>
            <div className="text-gray-400 text-sm font-sans">جاري العودة للصفحة الرئيسية...</div>
          </>
        ) : (
          <>
            <div className="text-primary animate-pulse text-2xl font-bold font-sans">جاري التحقق من الهوية...</div>
            <div className="text-gray-500 text-sm font-mono">Authenticating</div>
          </>
        )}
      </div>
    </div>
  )
}
