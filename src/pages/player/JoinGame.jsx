import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ref, get, set, update } from 'firebase/database'
import { rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'

export default function JoinGame() {
  const { profile, session } = useAuth()
  const [code, setCode]         = useState('')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading]   = useState(false)
  const [previewStatus, setPreviewStatus] = useState(null)   // room status preview
  const navigate = useNavigate()

  // Pre-fill nickname from Google profile once it loads
  React.useEffect(() => {
    if (profile?.display_name && !nickname)
      setNickname(profile.display_name)
  }, [profile?.display_name])

  // When user finishes typing the 6-char code, peek at room status
  React.useEffect(() => {
    if (code.length !== 6) { setPreviewStatus(null); return }
    let cancelled = false
    get(ref(rtdb, `rooms/${code.toUpperCase()}/status`)).then(snap => {
      if (!cancelled) setPreviewStatus(snap.exists() ? snap.val() : 'not_found')
    }).catch(() => {})
    return () => { cancelled = true }
  }, [code])

  const handleSignOut = () => useAuthStore.getState().signOut()

  const handleJoin = async (e) => {
    e.preventDefault()
    if (!code || code.length !== 6) return
    setLoading(true)

    const roomCode = code.toUpperCase()

    try {
      // 1. Verify room exists and is not finished
      const roomSnap = await get(ref(rtdb, `rooms/${roomCode}`))
      if (!roomSnap.exists()) {
        alert('Invalid Room Code')
        setLoading(false)
        return
      }
      const roomData = roomSnap.val()
      if (roomData.status === 'finished') {
        alert('هذه المسابقة انتهت بالفعل')
        setLoading(false)
        return
      }

      const userId = session.uid

      // 2. Check if already a player (REJOIN)
      const playerSnap = await get(ref(rtdb, `rooms/${roomCode}/players/${userId}`))
      if (playerSnap.exists()) {
        // Already approved and in game — rejoin directly
        navigate(`/player/game/${roomCode}`)
        return
      }

      // 3. Check for existing request
      const existingSnap = await get(ref(rtdb, `rooms/${roomCode}/join_requests/${userId}`))

      if (existingSnap.exists()) {
        const existing = existingSnap.val()
        if (existing.status === 'approved') {
          // Approved but not in players yet (edge case) — go to game
          navigate(`/player/game/${roomCode}`)
        } else if (existing.status === 'rejected') {
          // Reset to pending
          await update(ref(rtdb, `rooms/${roomCode}/join_requests/${userId}`), {
            status: 'pending',
            created_at: Date.now()
          })
          navigate(`/player/waiting/${roomCode}`)
        } else {
          // Still pending
          navigate(`/player/waiting/${roomCode}`)
        }
      } else {
        // 4. Submit new join request
        await set(ref(rtdb, `rooms/${roomCode}/join_requests/${userId}`), {
          player_id: userId,
          player_email: profile.email,
          player_name: nickname.trim() || profile.display_name || profile.email,
          player_avatar: profile.avatar_url || null,
          status: 'pending',
          created_at: Date.now()
        })
        navigate(`/player/waiting/${roomCode}`)
      }
    } catch (err) {
      alert('Error joining: ' + err.message)
    }

    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md bg-gray-900/50 p-8 rounded-2xl border border-gray-800 shadow-xl text-center backdrop-blur-sm">
        <h1 className="text-3xl font-display font-bold text-white mb-2">Join a Game</h1>
        <p className="text-gray-400 mb-8 font-sans">Enter the 6-digit code provided by your host</p>

        <form onSubmit={handleJoin} className="space-y-4">
          <input
            type="text"
            placeholder="e.g. A1B2C3"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="w-full text-center text-4xl tracking-[0.5em] font-mono bg-gray-800 border-2 border-gray-700 rounded-xl py-4 focus:outline-none focus:border-primary text-white transition-colors uppercase"
            required
          />

          {/* Nickname field */}
          <div className="text-left space-y-1.5">
            <label className="text-xs text-gray-500 font-bold tracking-widest uppercase block">
              Nickname
            </label>
            <input
              type="text"
              placeholder="اسمك في اللعبة"
              maxLength={30}
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              className="w-full bg-gray-800 border-2 border-gray-700 rounded-xl px-4 py-3 text-white font-bold text-lg focus:outline-none focus:border-primary transition-colors placeholder-gray-600"
            />
          </div>

          {/* Game-in-progress notice */}
          {(previewStatus === 'playing' || previewStatus === 'revealing') && (
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3 text-sm text-orange-300 text-right space-y-0.5">
              <p className="font-bold">الجيم شغال دلوقتى!</p>
              <p className="text-orange-300/70">لو الهوست قبلك هتدخل وتحل الأسئلة الباقية.</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full bg-primary text-background font-bold text-lg py-4 rounded-xl hover:bg-[#00D4FF] disabled:opacity-50 disabled:hover:bg-primary transition-all active:scale-95"
          >
            {loading ? 'Requesting to Join...' : (previewStatus === 'playing' || previewStatus === 'revealing') ? 'اطلب الدخول' : 'Enter Battle'}
          </button>
        </form>

        <button
          onClick={handleSignOut}
          className="mt-6 w-full rounded-xl bg-gray-800/50 border border-gray-700 px-6 py-3 font-bold text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors text-sm"
        >
          تسجيل الخروج
        </button>
      </div>
    </div>
  )
}
