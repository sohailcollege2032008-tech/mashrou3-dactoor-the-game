import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuthStore } from '../stores/authStore'
import GoogleSignInButton from '../components/auth/GoogleSignInButton'
import { supabase } from '../lib/supabase'

export default function Landing() {
  const session = useAuthStore(state => state.session)
  const profile = useAuthStore(state => state.profile)
  const initialized = useAuthStore(state => state.initialized)
  const [isRetrying, setIsRetrying] = useState(false)
  const navigate = useNavigate()

  // Auto-redirect if already logged in
  React.useEffect(() => {
    if (initialized && session && profile) {
      const targetPath = profile.role === 'owner' 
        ? '/owner/dashboard' 
        : profile.role === 'host' 
        ? '/host/dashboard' 
        : '/player/join'
      
      // Only redirect if we are exactly on "/"
      if (window.location.pathname === '/') {
        navigate(targetPath, { replace: true })
      }
    }
  }, [initialized, session, profile, navigate])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const handleRetry = async () => {
    if (!session) return
    setIsRetrying(true)
    // Re-fetch profile manually and update store
    const { data } = await supabase
      .from('profiles').select('*').eq('id', session.user.id).single()
    if (data) {
      useAuthStore.getState().setAuth(session, data)
    }
    setIsRetrying(false)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 font-display">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md space-y-8 text-center"
      >
        <div className="space-y-4">
          <h1 className="text-5xl font-bold text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
            Mashrou3 <span className="text-primary">Dactoor</span>
          </h1>
          <p className="text-xl text-gray-400 font-sans">Welcome to the Medical Battleground</p>
        </div>

        {!initialized ? (
          <div className="text-primary animate-pulse py-8 font-sans">Loading...</div>

        ) : !session ? (
          <div className="pt-8 flex justify-center">
            <GoogleSignInButton />
          </div>

        ) : !profile ? (
          // Session exists but profile missing — offer retry
          <div className="space-y-4 pt-8 font-sans">
            <div className="rounded-2xl border border-amber-800/40 bg-amber-900/20 p-5 text-amber-300 text-sm text-center">
              {isRetrying
                ? <span className="animate-pulse">⏳ جاري إعادة تحميل بيانات حسابك...</span>
                : '⚠️ تعذّر تحميل بيانات حسابك. تحقق من الاتصال وحاول مجددًا.'
              }
            </div>
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="w-full rounded-xl bg-primary/10 border border-primary/40 px-6 py-3 font-bold text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {isRetrying ? 'جاري المحاولة...' : '🔄 إعادة المحاولة'}
            </button>
            <button
              onClick={handleSignOut}
              disabled={isRetrying}
              className="w-full rounded-xl bg-red-500/10 border border-red-500/30 px-6 py-3 font-bold text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50 text-sm"
            >
              تسجيل الخروج
            </button>
          </div>


        ) : (
          <div className="space-y-6 pt-8 font-sans">
            {/* Profile card */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur-sm">
              <img
                src={profile.avatar_url || ''}
                alt="Profile"
                className="mx-auto mb-4 h-20 w-20 rounded-full border-2 border-primary object-cover"
              />
              <h2 className="text-2xl font-bold text-white">{profile.display_name}</h2>
              <p className="text-gray-400 mt-1">
                {profile.role === 'owner' ? '👑 Owner' : profile.role === 'host' ? '🎮 Host' : '🎓 Player'}
              </p>
            </div>

            {/* Navigation buttons */}
            <div className="flex flex-col gap-3">
              <Link
                to={profile.role === 'owner' ? '/owner/dashboard' : profile.role === 'host' ? '/host/dashboard' : '/player/join'}
                className="w-full rounded-xl bg-primary px-6 py-4 font-bold text-background transition-colors hover:bg-[#00D4FF]"
              >
                {profile.role === 'owner' ? 'Owner Dashboard' : profile.role === 'host' ? 'Host Dashboard' : 'Join a Game'}
              </Link>

              {profile.role === 'owner' && (
                <Link
                  to="/host/dashboard"
                  className="w-full rounded-xl bg-white/5 border border-primary/30 px-6 py-4 font-bold text-primary transition-colors hover:bg-primary/10"
                >
                  🎮 Host Dashboard
                </Link>
              )}

              <button
                onClick={handleSignOut}
                className="w-full rounded-xl bg-gray-800/50 border border-gray-700 px-6 py-3 font-bold text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors text-sm"
              >
                تسجيل الخروج
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}
