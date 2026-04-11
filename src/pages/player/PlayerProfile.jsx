import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  doc, updateDoc, collection, getDocs, query, orderBy, limit
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import {
  ArrowRight, User, Phone, Edit2, Check, X, Loader2, CheckCircle2,
  Swords, Gamepad2, Eye, EyeOff, ChevronLeft,
} from 'lucide-react'

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ value, onChange }) {
  return (
    <button
      dir="ltr"
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
        value ? 'bg-primary' : 'bg-gray-700'
      }`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
        value ? 'translate-x-5' : 'translate-x-0.5'
      }`} />
    </button>
  )
}

// ── Editable Field ────────────────────────────────────────────────────────────
function EditableField({ label, value, onSave, placeholder, type = 'text', icon: Icon }) {
  const [editing, setEditing] = useState(false)
  const [input, setInput]     = useState(value || '')
  const [saving, setSaving]   = useState(false)

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
          className="flex items-center justify-between px-4 py-3 bg-gray-800/60 border border-gray-700 rounded-xl cursor-pointer hover:border-gray-600 transition-colors group"
        >
          <span className={`font-bold ${value ? 'text-white' : 'text-gray-600 italic text-sm'}`}>
            {value || placeholder}
          </span>
          <Edit2 size={14} className="text-gray-600 group-hover:text-gray-400 transition-colors flex-shrink-0" />
        </div>
      )}
    </div>
  )
}

// ── History Entry Card ────────────────────────────────────────────────────────
function HistoryCard({ entry, navigate }) {
  const isDuel = entry.type === 'duel'
  const isForfeit = entry.outcome?.includes('forfeit')

  const outcomeColor = {
    win: 'text-green-400',
    win_forfeit: 'text-green-400',
    lose: 'text-red-400',
    lose_forfeit: 'text-red-400',
    tie: 'text-primary',
  }[entry.outcome] || 'text-gray-400'

  const outcomeLabel = {
    win: 'فزت ✓',
    win_forfeit: 'فزت (انسحاب)',
    lose: 'خسرت',
    lose_forfeit: 'خسرت (انسحاب)',
    tie: 'تعادل',
  }[entry.outcome] || ''

  const date = entry.played_at?.toDate?.()
    ? entry.played_at.toDate().toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })
    : ''

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
            isDuel ? 'bg-purple-500/10' : 'bg-primary/10'
          }`}>
            {isDuel
              ? <Swords size={14} className="text-purple-400" />
              : <Gamepad2 size={14} className="text-primary" />
            }
          </div>
          <div className="min-w-0">
            <p className="text-white font-bold text-sm leading-snug truncate max-w-[180px]">
              {entry.deck_title || (isDuel ? 'دويل' : 'مسابقة')}
            </p>
            <p className="text-gray-600 text-xs font-mono">{date}</p>
          </div>
        </div>
        {isDuel && entry.outcome && (
          <span className={`text-xs font-bold flex-shrink-0 ${outcomeColor}`}>
            {outcomeLabel}
          </span>
        )}
        {!isDuel && (
          <span className="text-primary font-bold font-mono text-sm flex-shrink-0">
            {entry.score}/{entry.total_questions}
          </span>
        )}
      </div>

      {/* Details row */}
      <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
        {isDuel ? (
          <div className="flex items-center gap-1.5">
            <span>ضد</span>
            <button
              onClick={() => entry.opponent_uid && navigate(`/player/profile/${entry.opponent_uid}`)}
              className={`font-bold ${entry.opponent_uid ? 'text-primary hover:underline cursor-pointer' : 'text-gray-400 cursor-default'}`}
            >
              {entry.opponent_name || 'لاعب'}
            </button>
            {!isForfeit && (
              <span className="text-gray-600 font-mono">
                ({entry.my_score} - {entry.opponent_score})
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span>هوست:</span>
            <button
              onClick={() => entry.host_uid && navigate(`/player/profile/${entry.host_uid}`)}
              className={`font-bold ${entry.host_uid ? 'text-primary hover:underline cursor-pointer' : 'text-gray-400 cursor-default'}`}
            >
              {entry.host_name || 'دكتور'}
            </button>
          </div>
        )}
        {/* Deck link */}
        {entry.deck_is_global && (
          <button
            onClick={() => navigate('/player/decks')}
            className="text-primary/70 hover:text-primary transition-colors flex items-center gap-0.5"
          >
            تصفح Deck <ChevronLeft size={11} />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function PlayerProfile() {
  const { profile, session } = useAuth()
  const navigate = useNavigate()
  const [saved, setSaved]     = useState(false)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const uid = session?.uid

  // Load game history
  useEffect(() => {
    if (!uid) return
    const load = async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'profiles', uid, 'game_history'),
            orderBy('played_at', 'desc'),
            limit(30)
          )
        )
        setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch { /* ignore */ } finally {
        setHistoryLoading(false)
      }
    }
    load()
  }, [uid])

  const saveField = async (field, value) => {
    if (!session) return
    await updateDoc(doc(db, 'profiles', session.uid), { [field]: value })
    await useAuthStore.getState().fetchProfile(session)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const isPlayer = profile?.role === 'player'

  return (
    <div className="min-h-screen bg-background text-white" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-6 pb-4 border-b border-gray-800">
        <Link
          to="/player/dashboard"
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowRight size={18} /> رجوع
        </Link>
        <h2 className="text-white font-bold">الملف الشخصي</h2>
        {saved ? (
          <div className="flex items-center gap-1 text-green-400 text-sm font-bold">
            <CheckCircle2 size={14} /> تم
          </div>
        ) : <div className="w-12" />}
      </div>

      <div className="max-w-md mx-auto px-5 pt-8 pb-12 space-y-6">

        {/* Avatar */}
        <div className="flex flex-col items-center gap-3">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="w-24 h-24 rounded-full border-2 border-primary object-cover"
            />
          ) : (
            <div className="w-24 h-24 rounded-full border-2 border-gray-700 bg-gray-800 flex items-center justify-center">
              <User size={36} className="text-gray-500" />
            </div>
          )}
          <p className="text-gray-500 text-xs">الصورة من حساب Google</p>
        </div>

        {/* View public profile link */}
        {uid && (
          <button
            onClick={() => navigate(`/player/profile/${uid}`)}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-800/60 border border-gray-700 hover:border-gray-600 rounded-xl text-gray-400 hover:text-white transition-colors text-sm"
          >
            <Eye size={14} />
            عرض الملف العام
          </button>
        )}

        {/* Read-only: email */}
        <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-4 space-y-1">
          <p className="text-xs text-gray-500 font-bold tracking-widest uppercase">البريد الإلكتروني</p>
          <p className="text-gray-300 font-mono text-sm">{profile?.email}</p>
        </div>

        {/* Editable fields */}
        <div className="space-y-4">
          <EditableField
            label="الاسم"
            value={profile?.display_name}
            placeholder="أدخل اسمك"
            icon={User}
            onSave={v => saveField('display_name', v)}
          />

          {/* Phone — only for players */}
          {isPlayer && (
            <>
              <EditableField
                label="رقم الهاتف"
                value={profile?.phone}
                placeholder="مثال: 01012345678"
                type="tel"
                icon={Phone}
                onSave={v => saveField('phone', v)}
              />

              {/* Phone visibility toggle */}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-800/60 border border-gray-700 rounded-xl">
                <div className="flex items-center gap-2">
                  {profile?.phone_visible ? <Eye size={14} className="text-primary" /> : <EyeOff size={14} className="text-gray-500" />}
                  <div>
                    <p className="text-sm text-gray-300 font-bold">إظهار رقم الهاتف</p>
                    <p className="text-xs text-gray-600">
                      {profile?.phone_visible ? 'مرئي لمن استضافك' : 'مخفي — لن يراه أحد'}
                    </p>
                  </div>
                </div>
                <Toggle
                  value={profile?.phone_visible || false}
                  onChange={v => saveField('phone_visible', v)}
                />
              </div>
            </>
          )}
        </div>

        {/* ── Game History ── */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-gray-400 tracking-wider uppercase">سجل المباريات</h3>
          {historyLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-600">
              <Loader2 size={20} className="animate-spin text-primary" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-gray-600 text-sm">
              لم تلعب أي مباريات بعد
            </div>
          ) : (
            <div className="space-y-2">
              {history.map(entry => (
                <HistoryCard key={entry.id} entry={entry} navigate={navigate} />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
