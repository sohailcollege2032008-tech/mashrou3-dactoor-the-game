import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { Gamepad2, User, LogOut, Swords, RotateCcw, Trophy, Zap, X, Bell, CheckCheck } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { ref as rtdbRef, get as rtdbGet } from 'firebase/database'
import {
  doc, onSnapshot, getDoc, collection, query, orderBy, limit, updateDoc,
} from 'firebase/firestore'
import { db, rtdb } from '../../lib/firebase'

export default function PlayerDashboard() {
  const { profile, session } = useAuth()
  const navigate = useNavigate()
  const uid = session?.uid

  const [activeDuel,           setActiveDuel]           = useState(null)
  const [activeTournament,     setActiveTournament]     = useState(null)
  const [tournamentEliminated, setTournamentEliminated] = useState(false)

  // Notifications
  const [notifications,      setNotifications]      = useState([])
  const [showNotifications,  setShowNotifications]  = useState(false)

  const markAllRead = async () => {
    if (!uid) return
    await Promise.all(
      notifications.filter(n => !n.read).map(n =>
        updateDoc(doc(db, 'notifications', uid, 'items', n.id), { read: true })
      )
    )
  }

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

  // ── Check for an active tournament ──────────────────────────────────────────
  useEffect(() => {
    const savedId = localStorage.getItem('activeTournamentId')
    if (!savedId) return
    const unsub = onSnapshot(doc(db, 'tournaments', savedId), snap => {
      if (!snap.exists()) {
        localStorage.removeItem('activeTournamentId')
        setActiveTournament(null)
        return
      }
      setActiveTournament({ id: snap.id, ...snap.data() })
    })
    return () => unsub()
  }, [])

  // ── Check if player was eliminated from their active tournament ────────────
  useEffect(() => {
    if (!activeTournament || !uid) return
    if (!['bracket', 'finished'].includes(activeTournament.status)) return

    getDoc(doc(db, 'tournaments', activeTournament.id, 'ffa_results', uid))
      .then(snap => {
        if (snap.exists() && snap.data().advanced === false) {
          setTournamentEliminated(true)
          // Clear the banner — player is done
          localStorage.removeItem('activeTournamentId')
        }
      })
      .catch(() => {})
  }, [activeTournament?.status, activeTournament?.id, uid])

  // ── Subscribe to notifications ─────────────────────────────────────────────
  useEffect(() => {
    if (!uid) return
    const q = query(
      collection(db, 'notifications', uid, 'items'),
      orderBy('created_at', 'desc'),
      limit(20)
    )
    const unsub = onSnapshot(q, snap => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }, () => {})
    return () => unsub()
  }, [uid])

  const tournamentDest = activeTournament
    ? activeTournament.status === 'ffa' && activeTournament.ffa_room_id
      ? `/player/game/${activeTournament.ffa_room_id}`
      : `/tournament/${activeTournament.id}/wait`
    : null

  const TOURNAMENT_STATUS_AR = {
    registration: 'قيد التسجيل — انتظر البدء',
    ffa:          '🔴 FFA جارية — ادخل الآن!',
    transition:   'جاري الانتقال للـ Bracket…',
    bracket:      '⚔️ مرحلة الـ Bracket',
    finished:     '🏁 انتهت البطولة',
  }

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

        {/* Notification bell */}
        <div className="relative">
          <button
            onClick={() => { setShowNotifications(v => !v); if (!showNotifications) markAllRead() }}
            className="relative p-2 rounded-xl bg-gray-800 border border-gray-700 hover:border-gray-600 transition-colors mr-2"
          >
            <Bell size={16} className="text-gray-300" />
            {notifications.filter(n => !n.read).length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-background text-[9px] font-bold rounded-full flex items-center justify-center">
                {notifications.filter(n => !n.read).length}
              </span>
            )}
          </button>
          {showNotifications && createPortal(
            <>
              <div className="fixed inset-0 z-[49998]" onClick={() => setShowNotifications(false)} />
              <div className="fixed top-20 right-4 w-72 bg-[#0D1321] border border-gray-700 rounded-2xl shadow-2xl shadow-black/60 z-[49999] overflow-hidden text-right">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                  <button onClick={() => setShowNotifications(false)} className="text-gray-500 hover:text-white"><X size={14} /></button>
                  <span className="font-bold text-sm text-white ar">الإشعارات</span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="text-gray-500 text-sm text-center py-8 ar">لا توجد إشعارات</p>
                  ) : notifications.map(n => (
                    <div key={n.id} className={`px-4 py-3 border-b border-gray-800/60 ${!n.read ? 'bg-primary/5' : ''}`}>
                      {n.type === 'game_finished' && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-end gap-2">
                            {!n.read && <span className="w-1.5 h-1.5 bg-primary rounded-full" />}
                            <span className="text-white font-bold text-sm ar truncate">{n.room_title}</span>
                            <Trophy size={13} className="text-primary flex-shrink-0" />
                          </div>
                          <p className="text-gray-400 text-xs ar">
                            مرتبتك: <span className="text-white font-bold">#{n.my_rank}</span>
                            {' '}· نقاطك: <span className="text-primary font-bold">{n.my_score}</span>
                            {' '}من {n.total_players} لاعب
                          </p>
                          {n.full_leaderboard?.length > 0 && (
                            <div className="mt-2 space-y-0.5">
                              {n.full_leaderboard.slice(0, 5).map(p => (
                                <div key={p.user_id} className={`flex items-center justify-between text-xs px-2 py-0.5 rounded ${p.user_id === uid ? 'bg-primary/20 text-primary' : 'text-gray-400'}`}>
                                  <span className="font-mono">#{p.rank}</span>
                                  <span className="flex-1 text-right mx-2 truncate">{p.nickname}</span>
                                  <span className="font-mono font-bold">{p.score}</span>
                                </div>
                              ))}
                              {n.full_leaderboard.length > 5 && (
                                <p className="text-gray-600 text-[10px] text-center">+{n.full_leaderboard.length - 5} آخرين</p>
                              )}
                            </div>
                          )}
                          {n.created_at?.seconds && (
                            <p className="text-gray-600 text-[10px] font-mono mt-1">
                              {new Date(n.created_at.seconds * 1000).toLocaleString('ar-EG')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {notifications.length > 0 && (
                  <div className="px-4 py-2 border-t border-gray-800">
                    <button onClick={markAllRead} className="flex items-center justify-end gap-1.5 w-full text-xs text-gray-500 hover:text-gray-300 transition-colors ar">
                      <CheckCheck size={12} /> تحديد الكل كمقروء
                    </button>
                  </div>
                )}
              </div>
            </>,
            document.body
          )}
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

        {/* Active tournament banner — hidden if player was eliminated from FFA */}
        {activeTournament && tournamentDest && !tournamentEliminated && (
          <div
            className={`w-full max-w-xs rounded-2xl border-2 p-4 transition-all ${
              activeTournament.status === 'ffa'
                ? 'bg-yellow-500/10 border-yellow-500/50 shadow-[0_0_20px_rgba(234,179,8,0.15)]'
                : activeTournament.status === 'finished'
                ? 'bg-gray-800/60 border-gray-700'
                : 'bg-primary/10 border-primary/40 shadow-[0_0_20px_rgba(0,184,217,0.1)]'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                activeTournament.status === 'ffa' ? 'bg-yellow-500/20' :
                activeTournament.status === 'finished' ? 'bg-gray-700' : 'bg-primary/20'
              }`}>
                {activeTournament.status === 'ffa'
                  ? <Zap size={20} className="text-yellow-400" />
                  : <Trophy size={20} className={activeTournament.status === 'finished' ? 'text-gray-400' : 'text-primary'} />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="ar text-white font-bold text-sm truncate">{activeTournament.title}</p>
                <p className={`ar text-xs mt-0.5 ${
                  activeTournament.status === 'ffa' ? 'text-yellow-400 font-semibold' :
                  activeTournament.status === 'finished' ? 'text-gray-500' : 'text-primary'
                }`}>
                  {TOURNAMENT_STATUS_AR[activeTournament.status] || activeTournament.status}
                </p>
              </div>
              {activeTournament.status === 'finished' && (
                <button
                  onClick={() => { localStorage.removeItem('activeTournamentId'); setActiveTournament(null) }}
                  className="text-gray-600 hover:text-gray-400 transition-colors flex-shrink-0"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {activeTournament.status !== 'finished' && (
              <button
                onClick={() => navigate(tournamentDest)}
                className={`ar w-full mt-3 py-2 rounded-xl text-sm font-black transition-all active:scale-95 ${
                  activeTournament.status === 'ffa'
                    ? 'bg-yellow-500 text-black hover:bg-yellow-400'
                    : 'bg-primary text-background hover:bg-[#00D4FF]'
                }`}
              >
                {activeTournament.status === 'ffa' ? '⚡ ادخل FFA الآن' : 'متابعة البطولة ←'}
              </button>
            )}
          </div>
        )}

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

        {/* Bottom row: Tournament + Duel side by side */}
        <div className="w-full max-w-xs flex gap-3">

          {/* Join Tournament */}
          <Link
            to="/tournament/join"
            className="flex-1 flex flex-col items-center gap-2 bg-gray-900/60 border-2 border-gray-800 hover:border-yellow-500/50 hover:bg-yellow-500/5 rounded-2xl p-4 transition-all active:scale-95 group"
          >
            <div className="w-12 h-12 rounded-2xl bg-gray-800 flex items-center justify-center group-hover:bg-yellow-500/20 transition-colors">
              <Trophy size={24} className="text-gray-300 group-hover:text-yellow-400 transition-colors" />
            </div>
            <div className="text-center" dir="rtl">
              <p className="text-white font-bold text-sm">بطولة</p>
              <p className="text-gray-600 text-xs">انضم بكود</p>
            </div>
          </Link>

          {/* Duel Mode */}
          <Link
            to="/player/decks"
            className="flex-1 flex flex-col items-center gap-2 bg-gray-900/60 border-2 border-gray-800 hover:border-gray-600 hover:bg-gray-800/60 rounded-2xl p-4 transition-all active:scale-95 group"
          >
            <div className="w-12 h-12 rounded-2xl bg-gray-800 flex items-center justify-center group-hover:bg-gray-700 transition-colors">
              <Swords size={24} className="text-gray-300" />
            </div>
            <div className="text-center" dir="rtl">
              <p className="text-white font-bold text-sm">دويل</p>
              <p className="text-gray-600 text-xs">1v1 مع زميلك</p>
            </div>
          </Link>

        </div>

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
