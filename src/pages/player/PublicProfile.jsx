import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc, getDoc, collection, getDocs, query, orderBy, limit
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import {
  ArrowRight, User, Phone, Swords, Gamepad2, ChevronLeft,
  Loader2, ShieldCheck,
} from 'lucide-react'

// ── Role badge ────────────────────────────────────────────────────────────────
function RoleBadge({ role }) {
  const map = {
    owner: { label: 'مالك', color: 'bg-yellow-500/10 border-yellow-500/40 text-yellow-400' },
    host:  { label: 'هوست', color: 'bg-primary/10 border-primary/40 text-primary' },
    player:{ label: 'لاعب', color: 'bg-gray-800 border-gray-700 text-gray-400' },
  }
  const cfg = map[role] || map.player
  return (
    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${cfg.color}`}>
      {cfg.label}
    </span>
  )
}

// ── History Entry Card ────────────────────────────────────────────────────────
function HistoryCard({ entry, navigate }) {
  const isDuel = entry.type === 'duel'
  const isForfeit = entry.outcome?.includes('forfeit')

  const outcomeColor = {
    win: 'text-green-400', win_forfeit: 'text-green-400',
    lose: 'text-red-400',  lose_forfeit: 'text-red-400',
    tie: 'text-primary',
  }[entry.outcome] || 'text-gray-400'

  const outcomeLabel = {
    win: 'فزت ✓', win_forfeit: 'فزت (انسحاب)',
    lose: 'خسرت',  lose_forfeit: 'خسرت (انسحاب)',
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
              <span className="text-gray-600 font-mono">({entry.my_score} - {entry.opponent_score})</span>
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
export default function PublicProfile() {
  const { uid: targetUid } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const viewerUid = session?.uid

  const [profile, setProfile] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const isOwnProfile = viewerUid === targetUid

  useEffect(() => {
    if (!targetUid) return
    const load = async () => {
      try {
        // Load profile
        const profileSnap = await getDoc(doc(db, 'profiles', targetUid))
        if (!profileSnap.exists()) { setNotFound(true); setLoading(false); return }
        const profileData = profileSnap.data()
        setProfile(profileData)

        // Load game history (last 30 entries)
        const histSnap = await getDocs(
          query(
            collection(db, 'profiles', targetUid, 'game_history'),
            orderBy('played_at', 'desc'),
            limit(30)
          )
        )
        setHistory(histSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [targetUid])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-gray-400" dir="rtl">
        <div className="text-center space-y-3">
          <p className="text-lg font-bold">الملف غير موجود</p>
          <button onClick={() => navigate(-1)} className="text-primary text-sm hover:underline">
            العودة
          </button>
        </div>
      </div>
    )
  }

  // Phone visibility rules:
  // - Own profile → always show
  // - Viewer is a host who hosted this player → always show (regardless of toggle)
  // - phone_visible=true → show to everyone (including other students)
  // - Otherwise → hidden
  const viewerIsHost = viewerUid && profile.hosted_by?.[viewerUid]
  const showPhone = profile.phone && (
    isOwnProfile ||
    !!viewerIsHost ||
    profile.phone_visible === true
  )

  // Stats
  const duelCount = history.filter(h => h.type === 'duel').length
  const compCount = history.filter(h => h.type === 'competition').length
  const wins = history.filter(h => h.type === 'duel' && (h.outcome === 'win' || h.outcome === 'win_forfeit')).length

  return (
    <div className="min-h-screen bg-background text-white" dir="rtl">

      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-4 border-b border-gray-800">
        <button
          onClick={() => navigate(-1)}
          className="p-2 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowRight size={18} />
        </button>
        <h2 className="text-white font-bold flex-1">الملف الشخصي</h2>
        {isOwnProfile && (
          <button
            onClick={() => navigate('/player/profile')}
            className="text-primary text-xs font-bold hover:underline"
          >
            تعديل
          </button>
        )}
      </div>

      <div className="max-w-md mx-auto px-5 pt-8 pb-12 space-y-6">

        {/* Avatar + name */}
        <div className="flex flex-col items-center gap-3">
          {profile.avatar_url ? (
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
          <div className="text-center space-y-1">
            <h1 className="text-xl font-bold font-display text-white">
              {profile.display_name || 'لاعب مجهول'}
            </h1>
            <div className="flex items-center justify-center gap-2">
              <RoleBadge role={profile.role} />
              {profile.role === 'host' && (
                <span className="flex items-center gap-1 text-xs text-gray-500 font-mono">
                  <ShieldCheck size={11} /> هوست معتمد
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Phone (if visible) */}
        {showPhone && (
          <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/60 border border-gray-700 rounded-2xl">
            <Phone size={16} className="text-primary flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 font-bold">رقم الهاتف</p>
              <p className="text-white font-mono font-bold">{profile.phone}</p>
            </div>
            {viewerIsHost && !profile.phone_visible && (
              <span className="mr-auto text-xs text-gray-600 font-mono">(مرئي للدكاترة فقط)</span>
            )}
          </div>
        )}

        {/* Stats */}
        {history.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-3 text-center">
              <p className="text-primary font-bold font-mono text-xl">{duelCount}</p>
              <p className="text-gray-500 text-xs mt-0.5">دوول</p>
            </div>
            <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-3 text-center">
              <p className="text-primary font-bold font-mono text-xl">{compCount}</p>
              <p className="text-gray-500 text-xs mt-0.5">مسابقات</p>
            </div>
            <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-3 text-center">
              <p className="text-green-400 font-bold font-mono text-xl">{wins}</p>
              <p className="text-gray-500 text-xs mt-0.5">انتصارات</p>
            </div>
          </div>
        )}

        {/* ── Game History ── */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-gray-400 tracking-wider uppercase">سجل المباريات</h3>
          {history.length === 0 ? (
            <div className="text-center py-8 text-gray-600 text-sm">
              لم يلعب أي مباريات بعد
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
