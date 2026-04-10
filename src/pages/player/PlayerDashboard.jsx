import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { ref, get, set, update } from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { User, Phone, Edit2, Check, X, LogOut, Gamepad2, Loader2, CheckCircle2 } from 'lucide-react'

// ── Editable field ────────────────────────────────────────────────────────────
function EditableField({ label, value, onSave, placeholder, type = 'text', icon: Icon }) {
  const [editing, setEditing]   = useState(false)
  const [input, setInput]       = useState(value || '')
  const [saving, setSaving]     = useState(false)

  useEffect(() => { setInput(value || '') }, [value])

  const handleSave = async () => {
    setSaving(true)
    await onSave(input.trim())
    setSaving(false)
    setEditing(false)
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-gray-500 font-bold tracking-widest uppercase flex items-center gap-1.5">
        {Icon && <Icon size={11} />} {label}
      </label>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            type={type}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
            placeholder={placeholder}
            className="flex-1 bg-gray-800 border border-primary rounded-xl px-4 py-2.5 text-white font-bold focus:outline-none"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-2.5 bg-primary/20 text-primary rounded-xl hover:bg-primary/30 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          </button>
          <button
            onClick={() => { setInput(value || ''); setEditing(false) }}
            className="p-2.5 bg-gray-700 text-gray-400 rounded-xl hover:bg-gray-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="flex items-center justify-between px-4 py-2.5 bg-gray-800/60 border border-gray-700 rounded-xl cursor-pointer hover:border-gray-600 transition-colors group"
        >
          <span className={`font-bold ${value ? 'text-white' : 'text-gray-600 italic'}`}>
            {value || placeholder}
          </span>
          <Edit2 size={14} className="text-gray-600 group-hover:text-gray-400 transition-colors flex-shrink-0" />
        </div>
      )}
    </div>
  )
}

// ── Join Game Card ────────────────────────────────────────────────────────────
function JoinGameCard({ profile, session }) {
  const [code, setCode]           = useState('')
  const [nickname, setNickname]   = useState(profile?.display_name || '')
  const [loading, setLoading]     = useState(false)
  const [previewStatus, setPreviewStatus] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (profile?.display_name && !nickname) setNickname(profile.display_name)
  }, [profile?.display_name])

  useEffect(() => {
    if (code.length !== 6) { setPreviewStatus(null); return }
    let cancelled = false
    get(ref(rtdb, `rooms/${code.toUpperCase()}/status`))
      .then(snap => { if (!cancelled) setPreviewStatus(snap.exists() ? snap.val() : 'not_found') })
      .catch(() => {})
    return () => { cancelled = true }
  }, [code])

  const handleJoin = async (e) => {
    e.preventDefault()
    if (!code || code.length !== 6) return
    setLoading(true)
    const roomCode = code.toUpperCase()
    try {
      const roomSnap = await get(ref(rtdb, `rooms/${roomCode}`))
      if (!roomSnap.exists()) { alert('كود غير صحيح'); setLoading(false); return }
      const roomData = roomSnap.val()
      if (roomData.status === 'finished') { alert('هذه المسابقة انتهت بالفعل'); setLoading(false); return }

      const userId = session.uid
      const playerSnap = await get(ref(rtdb, `rooms/${roomCode}/players/${userId}`))
      if (playerSnap.exists()) { navigate(`/player/game/${roomCode}`); return }

      const existingSnap = await get(ref(rtdb, `rooms/${roomCode}/join_requests/${userId}`))
      if (existingSnap.exists()) {
        const existing = existingSnap.val()
        if (existing.status === 'approved') {
          navigate(`/player/game/${roomCode}`)
        } else if (existing.status === 'rejected') {
          await update(ref(rtdb, `rooms/${roomCode}/join_requests/${userId}`), { status: 'pending', created_at: Date.now() })
          navigate(`/player/waiting/${roomCode}`)
        } else {
          navigate(`/player/waiting/${roomCode}`)
        }
      } else {
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
      alert('Error: ' + err.message)
    }
    setLoading(false)
  }

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Gamepad2 size={18} className="text-primary" />
        <h3 className="text-white font-bold">الانضمام لجيم</h3>
      </div>

      <form onSubmit={handleJoin} className="space-y-3">
        <input
          type="text"
          placeholder="كود الجيم"
          maxLength={6}
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          className="w-full text-center text-3xl tracking-[0.4em] font-mono bg-gray-800 border-2 border-gray-700 rounded-xl py-3 focus:outline-none focus:border-primary text-white transition-colors uppercase"
          required
        />

        <div className="space-y-1">
          <label className="text-xs text-gray-500 font-bold tracking-widest uppercase">الاسم في الجيم</label>
          <input
            type="text"
            placeholder="اسمك في اللعبة"
            maxLength={30}
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white font-bold focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        {previewStatus === 'not_found' && (
          <p className="text-red-400 text-sm font-mono text-center">❌ كود غير موجود</p>
        )}
        {(previewStatus === 'playing' || previewStatus === 'revealing') && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-2.5 text-sm text-orange-300 text-right">
            <p className="font-bold">الجيم شغال دلوقتى!</p>
            <p className="text-orange-300/70 text-xs">لو الهوست قبلك هتدخل وتحل الأسئلة الباقية.</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="w-full bg-primary text-background font-bold py-3 rounded-xl hover:bg-[#00D4FF] disabled:opacity-50 transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          {loading
            ? <><Loader2 size={16} className="animate-spin" /> جاري الانضمام...</>
            : (previewStatus === 'playing' || previewStatus === 'revealing')
              ? 'اطلب الدخول'
              : 'Enter Battle'}
        </button>
      </form>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function PlayerDashboard() {
  const { profile, session } = useAuth()
  const [saved, setSaved] = useState(false)

  const saveField = async (field, value) => {
    if (!session) return
    await updateDoc(doc(db, 'profiles', session.uid), { [field]: value })
    // Refresh store profile
    await useAuthStore.getState().fetchProfile(session)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="min-h-screen bg-background text-white p-4">
      <div className="max-w-md mx-auto space-y-4 pt-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold font-display text-white">
              Med <span className="text-primary">Royale</span>
            </h1>
            <p className="text-gray-500 text-sm">لوحة تحكم الطالب</p>
          </div>
          {saved && (
            <div className="flex items-center gap-1.5 text-green-400 text-sm font-bold">
              <CheckCircle2 size={15} /> تم الحفظ
            </div>
          )}
        </div>

        {/* Profile Card */}
        <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5 space-y-4">
          {/* Avatar + email */}
          <div className="flex items-center gap-4">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="w-16 h-16 rounded-full border-2 border-primary object-cover flex-shrink-0" />
            ) : (
              <div className="w-16 h-16 rounded-full border-2 border-gray-700 bg-gray-800 flex items-center justify-center flex-shrink-0">
                <User size={28} className="text-gray-500" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-white font-bold truncate">{profile?.display_name || '—'}</p>
              <p className="text-gray-500 text-sm truncate">{profile?.email}</p>
              <span className="text-xs text-primary font-mono bg-primary/10 px-2 py-0.5 rounded-full">🎓 Student</span>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-4 space-y-3">
            <EditableField
              label="الاسم"
              value={profile?.display_name}
              placeholder="أدخل اسمك"
              icon={User}
              onSave={v => saveField('display_name', v)}
            />
            <EditableField
              label="رقم الهاتف"
              value={profile?.phone}
              placeholder="أدخل رقم هاتفك"
              type="tel"
              icon={Phone}
              onSave={v => saveField('phone', v)}
            />
          </div>
        </div>

        {/* Join Game */}
        <JoinGameCard profile={profile} session={session} />

        {/* Logout */}
        <button
          onClick={() => useAuthStore.getState().signOut()}
          className="w-full flex items-center justify-center gap-2 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors font-bold text-sm"
        >
          <LogOut size={15} /> تسجيل الخروج
        </button>

      </div>
    </div>
  )
}
