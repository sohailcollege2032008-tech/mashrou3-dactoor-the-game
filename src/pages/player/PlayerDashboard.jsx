import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Gamepad2, User, LogOut, Swords, RotateCcw } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { ref as rtdbRef, get as rtdbGet } from 'firebase/database'
import { rtdb } from '../../lib/firebase'

export default function PlayerDashboard() {
  const { profile, session } = useAuth()
  const navigate = useNavigate()
  const uid = session?.uid

  const [activeDuel, setActiveDuel] = useState(null)

  // ── Check for an active duel to rejoin ───────────────────────────────────
  useEffect(() => {
    const check = async () => {
      const duelId = localStorage.getItem('activeDuelId')
      if (!duelId || !uid) return
      try {
        const snap = await rtdbGet(rtdbRef(rtdb, `duels/${duelId}`))
        const duel = snap.val()
        if (
          duel &&
          duel.status !== 'finished' &&
          duel.players?.[uid]
        ) {
          setActiveDuel({ id: duelId, ...duel })
        } else {
          localStorage.removeItem('activeDuelId')
        }
      } catch {
        localStorage.removeItem('activeDuelId')
      }
    }
    check()
  }, [uid])

  const rejoinPath = activeDuel
    ? activeDuel.status === 'waiting'
      ? `/duel/lobby/${activeDuel.id}`
      : `/duel/game/${activeDuel.id}`
    : null

  return (
    <div className="min-h-screen bg-background text-white flex flex-col">

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-6 pb-4">
        <div>
          <h1 className="text-2xl font-bold font-display">
            Med <span className="text-primary">Royale</span>
          </h1>
          <p className="text-gray-500 text-sm">
            أهلاً، {profile?.display_name?.split(' ')[0] || 'لاعب'} 👋
          </p>
        </div>

        {/* Profile avatar button */}
        <Link to="/player/profile" className="relative group">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="w-11 h-11 rounded-full border-2 border-gray-700 group-hover:border-primary transition-colors object-cover"
            />
          ) : (
            <div className="w-11 h-11 rounded-full border-2 border-gray-700 group-hover:border-primary transition-colors bg-gray-800 flex items-center justify-center">
              <User size={20} className="text-gray-400" />
            </div>
          )}
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
        </Link>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 gap-4 -mt-10">

        {/* Rejoin active duel — shown only if an active duel exists */}
        {activeDuel && rejoinPath && (
          <button
            onClick={() => navigate(rejoinPath)}
            className="w-full max-w-xs flex items-center gap-3 bg-orange-500/10 border-2 border-orange-500/40 hover:border-orange-400 hover:bg-orange-500/15 rounded-2xl p-4 transition-all active:scale-95"
          >
            <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center flex-shrink-0">
              <RotateCcw size={20} className="text-orange-400" />
            </div>
            <div className="flex-1 text-right min-w-0">
              <p className="text-orange-300 font-bold text-sm">لديك دويل جارٍ!</p>
              <p className="text-gray-500 text-xs truncate">{activeDuel.deck_title}</p>
            </div>
            <span className="text-orange-400 font-bold text-xs flex-shrink-0 bg-orange-500/20 px-2.5 py-1 rounded-xl">
              انضم مجدداً
            </span>
          </button>
        )}

        {/* Join Game — primary action */}
        <Link
          to="/player/join"
          className="w-full max-w-xs flex flex-col items-center gap-3 bg-primary/10 border-2 border-primary/40 hover:border-primary hover:bg-primary/15 rounded-2xl p-8 transition-all active:scale-95 group"
        >
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center group-hover:bg-primary/30 transition-colors">
            <Gamepad2 size={32} className="text-primary" />
          </div>
          <div className="text-center">
            <p className="text-white font-bold text-lg">Join a Game</p>
            <p className="text-gray-500 text-sm">أدخل كود الجيم وانضم</p>
          </div>
        </Link>

        {/* Duel Mode — secondary action */}
        <Link
          to="/player/decks"
          className="w-full max-w-xs flex flex-col items-center gap-3 bg-gray-900/60 border-2 border-gray-800 hover:border-gray-600 hover:bg-gray-800/60 rounded-2xl p-6 transition-all active:scale-95 group"
        >
          <div className="w-14 h-14 rounded-2xl bg-gray-800 flex items-center justify-center group-hover:bg-gray-700 transition-colors">
            <Swords size={28} className="text-gray-300" />
          </div>
          <div className="text-center" dir="rtl">
            <p className="text-white font-bold text-base">تصفح الـ Decks</p>
            <p className="text-gray-500 text-sm">العب دويل مع زميلك</p>
          </div>
        </Link>

      </div>

      {/* Logout */}
      <div className="px-5 pb-8">
        <button
          onClick={() => useAuthStore.getState().signOut()}
          className="w-full flex items-center justify-center gap-2 py-3 text-gray-600 hover:text-gray-400 transition-colors text-sm font-bold"
        >
          <LogOut size={14} /> تسجيل الخروج
        </button>
      </div>

    </div>
  )
}
