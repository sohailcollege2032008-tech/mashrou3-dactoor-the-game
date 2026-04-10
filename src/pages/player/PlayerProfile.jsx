import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { ArrowRight, User, Phone, Edit2, Check, X, Loader2, CheckCircle2 } from 'lucide-react'

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

export default function PlayerProfile() {
  const { profile, session } = useAuth()
  const [saved, setSaved]   = useState(false)

  const saveField = async (field, value) => {
    if (!session) return
    await updateDoc(doc(db, 'profiles', session.uid), { [field]: value })
    await useAuthStore.getState().fetchProfile(session)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="min-h-screen bg-background text-white">

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

      <div className="max-w-md mx-auto px-5 pt-8 space-y-6">

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

        {/* Info - read only */}
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
          <EditableField
            label="رقم الهاتف"
            value={profile?.phone}
            placeholder="مثال: 01012345678"
            type="tel"
            icon={Phone}
            onSave={v => saveField('phone', v)}
          />
        </div>

      </div>
    </div>
  )
}
