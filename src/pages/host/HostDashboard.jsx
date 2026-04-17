import React, { useState, useEffect, useRef } from 'react'
import { collection, query, where, getDocs, deleteDoc, doc, addDoc, serverTimestamp, onSnapshot, updateDoc, orderBy, limit } from 'firebase/firestore'
import { ref, set, get } from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuthStore } from '../../stores/authStore'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, Bell, Trophy, X, CheckCheck } from 'lucide-react'
import UploadQuestionsModal from '../../components/host/UploadQuestionsModal'
import QuestionBankModal from '../../components/host/QuestionBankModal'

export default function HostDashboard() {
  const profile = useAuthStore(state => state.profile)
  const session = useAuthStore(state => state.session)
  const navigate = useNavigate()
  const [banks, setBanks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [selectedBank, setSelectedBank] = useState(null)
  const [activeRoom, setActiveRoom] = useState(null)   // { code, title } if host has live game
  const [notifications, setNotifications] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)
  const notifPanelRef = useRef(null)

  useEffect(() => {
    if (profile) fetchBanks()
  }, [profile])

  // Check if host has an unfinished game room to rejoin
  useEffect(() => {
    if (!profile) return
    const check = async () => {
      try {
        const snap = await get(ref(rtdb, `host_rooms/${profile.id}/active`))
        if (!snap.exists()) return
        const { code, title } = snap.val()
        const statusSnap = await get(ref(rtdb, `rooms/${code}/status`))
        if (statusSnap.exists() && statusSnap.val() !== 'finished') {
          setActiveRoom({ code, title })
        } else {
          // Stale entry — clean up
          set(ref(rtdb, `host_rooms/${profile.id}/active`), null)
        }
      } catch (_) {}
    }
    check()
  }, [profile])

  // ── Subscribe to host notifications ──────────────────────────────────────
  useEffect(() => {
    if (!session?.uid) return
    const q = query(
      collection(db, 'notifications', session.uid, 'items'),
      orderBy('created_at', 'desc'),
      limit(20)
    )
    const unsub = onSnapshot(q, snap => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }, () => {})
    return () => unsub()
  }, [session?.uid])

  // Close notification panel when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (notifPanelRef.current && !notifPanelRef.current.contains(e.target)) {
        setShowNotifications(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const markAllRead = async () => {
    if (!session?.uid) return
    const unread = notifications.filter(n => !n.read)
    await Promise.all(unread.map(n =>
      updateDoc(doc(db, 'notifications', session.uid, 'items', n.id), { read: true })
    ))
  }

  const fetchBanks = async () => {
    setLoading(true)
    try {
      const q = query(
        collection(db, 'question_sets'),
        where('host_id', '==', profile.id)
      )
      const snap = await getDocs(q)
      const data = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
      setBanks(data)
    } catch (err) {
      console.error('Error fetching question banks:', err)
      alert('خطأ في تحميل بنوك الأسئلة: ' + err.message)
    }
    setLoading(false)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('حذف بنك الأسئلة ده؟ مش هترجعه.')) return
    setDeletingId(id)
    try {
      await deleteDoc(doc(db, 'question_sets', id))
      setBanks(prev => prev.filter(b => b.id !== id))
    } catch (err) {
      alert('خطأ في الحذف: ' + err.message)
    }
    setDeletingId(null)
  }

  const handleStartGame = async (bank) => {
    if (!profile) return

    // Use Firebase Auth UID directly — more reliable than profile.id
    const hostUid = session?.uid || profile.id
    if (!hostUid) { alert('خطأ: مش قادر يتعرف على هويتك. حاول تعمل تسجيل خروج ودخول من جديد.'); return }

    const MAX_ATTEMPTS = 5

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Generate a 6-char alphanumeric code (letters + digits only, no ambiguous chars)
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      const code  = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
      const roomRef = ref(rtdb, `rooms/${code}`)

      try {
        const existing = await get(roomRef)
        if (existing.exists()) continue   // collision — try a new code

        const roomTitle = bank.title + ' Room'

        await set(roomRef, {
          code,
          host_id: hostUid,
          question_set_id: bank.id,
          title: roomTitle,
          questions: bank.questions,
          force_rtl: bank.force_rtl || false,
          status: 'lobby',
          current_question_index: 0,
          question_started_at: null,
          reveal_data: null,
          created_at: Date.now()
        })

        await set(ref(rtdb, `host_rooms/${hostUid}/active`), { code, title: roomTitle })

        navigate(`/host/game/${code}`)
        return
      } catch (err) {
        console.error('[Dashboard] Error creating room (attempt', attempt + 1, '):', err)
        // Only retry on collision errors; surface all other errors immediately
        const isCollision = err?.code === 'ALREADY_EXISTS'
        if (!isCollision) {
          alert(`خطأ في إنشاء الأوضة:\n${err?.message || err}\n\nتأكد من إعدادات Firebase RTDB أو تواصل مع المسؤول.`)
          return
        }
      }
    }

    alert('فشل إنشاء الأوضة بعد عدة محاولات — من المحتمل تعارض في الكود. حاول تاني.')
  }

  const handleBankUpdate = (bankId, updatedQuestions, updatedTitle, fullBankUpdate = null) => {
    setBanks(prev => prev.map(b =>
      b.id === bankId
        ? (fullBankUpdate ? { ...b, ...fullBankUpdate } : { ...b, questions: updatedQuestions, title: updatedTitle, question_count: updatedQuestions.questions.length })
        : b
    ))
    // Update selectedBank so modal reflects changes immediately
    setSelectedBank(prev => prev && prev.id === bankId
      ? (fullBankUpdate ? { ...prev, ...fullBankUpdate } : { ...prev, questions: updatedQuestions, title: updatedTitle })
      : prev
    )
  }

  const handleSignOut = async () => {
    useAuthStore.getState().signOut()
  }

  return (
    <div className="min-h-screen bg-background text-white p-8">
      <div className="max-w-5xl mx-auto space-y-8">

        <header className="flex justify-between items-center bg-gray-900/50 p-6 rounded-2xl border border-gray-800 backdrop-blur-sm">
          <div>
            <h1 className="text-3xl font-display font-bold text-primary">Host Dashboard</h1>
            <p className="text-gray-400 mt-2 font-sans">Manage your Question Banks and Game Rooms</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Notification Bell */}
            <div ref={notifPanelRef}>
              <button
                onClick={() => { setShowNotifications(v => !v); if (!showNotifications) markAllRead() }}
                className="relative p-2 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 transition-colors"
                title="الإشعارات"
              >
                <Bell size={18} className="text-gray-300" />
                {notifications.filter(n => !n.read).length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-background text-[9px] font-bold rounded-full flex items-center justify-center">
                    {notifications.filter(n => !n.read).length}
                  </span>
                )}
              </button>

              {showNotifications && (
                <>
                  {/* invisible backdrop to close on outside click */}
                  <div className="fixed inset-0 z-[49998]" onClick={() => setShowNotifications(false)} />
                <div className="fixed top-24 right-8 w-80 bg-[#0D1321] border border-gray-700 rounded-2xl shadow-2xl shadow-black/60 z-[49999] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                    <button onClick={() => setShowNotifications(false)} className="text-gray-500 hover:text-white transition-colors">
                      <X size={14} />
                    </button>
                    <span className="font-bold text-sm text-white ar">الإشعارات</span>
                  </div>
                  <div className="max-h-[70vh] overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-8 ar">لا توجد إشعارات</p>
                    ) : (
                      notifications.map(n => (
                        <div key={n.id}
                          className={`px-4 py-3 border-b border-gray-800/60 hover:bg-gray-800/40 transition-colors ${!n.read ? 'bg-primary/5' : ''}`}
                        >
                          {n.type === 'game_finished' && (
                            <div className="space-y-1 text-right" dir="rtl">
                              <div className="flex items-center gap-2 justify-end">
                                {!n.read && <span className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0" />}
                                <span className="text-white font-bold text-sm ar">{n.room_title}</span>
                                <Trophy size={13} className="text-primary flex-shrink-0" />
                              </div>
                              <p className="text-gray-400 text-xs ar">
                                {n.winner_nickname ? `الفايز: ${n.winner_nickname} · ` : ''}
                                {n.total_players} لاعب
                              </p>
                              {n.results_url && (
                                <Link
                                  to={n.results_url}
                                  onClick={() => setShowNotifications(false)}
                                  className="inline-block text-primary text-xs font-bold hover:underline"
                                >
                                  → عرض النتائج
                                </Link>
                              )}
                              {n.created_at?.seconds && (
                                <p className="text-gray-600 text-[10px] font-mono">
                                  {new Date(n.created_at.seconds * 1000).toLocaleString('ar-EG')}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  {notifications.length > 0 && (
                    <div className="px-4 py-2 border-t border-gray-800 flex justify-end">
                      <button onClick={markAllRead} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors ar">
                        تحديد الكل كمقروء <CheckCheck size={12} />
                      </button>
                    </div>
                  )}
                </div>
                </>
              )}
            </div>

            <Link to="/" className="text-gray-400 hover:text-white transition-colors font-sans text-sm">Return Home</Link>
            <Link
              to="/player/decks"
              className="px-4 py-2 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 font-bold transition-all text-sm"
            >
              ⚔️ Decks
            </Link>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 font-bold transition-all text-sm"
            >
              تسجيل الخروج
            </button>
          </div>
        </header>

        {/* ── Active game rejoin banner ──────────────────────────────────── */}
        {activeRoom && (
          <div className="bg-primary/10 border border-primary/40 rounded-2xl p-5 flex items-center justify-between gap-4 shadow-lg shadow-primary/5">
            <div className="min-w-0">
              <p className="text-primary text-xs font-bold tracking-widest uppercase mb-1">🎮 جيم نشط</p>
              <h3 className="text-white font-bold text-lg leading-snug truncate">{activeRoom.title}</h3>
              <p className="text-gray-400 text-sm font-mono mt-0.5">كود: <span className="text-primary font-bold tracking-widest">{activeRoom.code}</span></p>
            </div>
            <Link
              to={`/host/game/${activeRoom.code}`}
              className="flex-shrink-0 bg-primary text-background font-bold px-6 py-3 rounded-xl hover:bg-[#00D4FF] transition-all active:scale-95 text-sm"
            >
              Rejoin →
            </Link>
          </div>
        )}

        <section className="bg-gray-900/50 p-6 rounded-2xl border border-gray-800 backdrop-blur-sm shadow-xl">
          <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
            <h2 className="text-2xl font-bold font-display">My Question Banks</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/tournament/create')}
                className="flex items-center gap-2 bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 font-bold px-4 py-2.5 rounded-xl hover:bg-yellow-500/30 transition-all text-sm ar"
              >
                <Trophy size={15} /> إنشاء بطولة
              </button>
              <button
                onClick={() => setShowUpload(true)}
                className="bg-primary text-background font-bold px-5 py-2.5 rounded-xl hover:bg-[#00D4FF] hover:scale-105 active:scale-95 transition-all text-sm"
              >
                + رفع بنك أسئلة
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-primary animate-pulse py-6 text-center font-mono">Loading banks...</div>
          ) : banks.length === 0 ? (
            <div className="text-center py-14 space-y-3">
              <div className="text-5xl">📚</div>
              <p className="ar text-gray-400 font-bold text-lg">مفيش بنوك أسئلة لحد دلوقتي</p>
              <p className="ar text-gray-600 text-sm">ارفع ملف JSON أو استخدم الذكاء الاصطناعي لاستخراج الأسئلة</p>
              <button
                onClick={() => setShowUpload(true)}
                className="mt-2 bg-primary/10 border border-primary/30 text-primary px-6 py-2 rounded-xl hover:bg-primary/20 transition-all font-bold text-sm"
              >
                + رفع أول بنك أسئلة
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {banks.map(bank => (
                <div
                  key={bank.id}
                  className="bg-gray-800/80 p-5 rounded-xl border border-gray-700 hover:border-primary/50 transition-all flex flex-col justify-between shadow-lg hover:shadow-primary/10 group"
                >
                  <div>
                    <h3 className="text-lg font-bold mb-2 font-display leading-snug">{bank.title}</h3>
                    <div className="flex flex-wrap gap-2 text-xs text-gray-400 mb-4 font-mono">
                      <span className="bg-gray-700/80 px-2 py-1 rounded-md">{bank.question_count} سؤال</span>
                      <span className="bg-gray-700/80 px-2 py-1 rounded-md uppercase">{bank.source_type}</span>
                      {bank.source_file_url && (
                        <a 
                          href={bank.source_file_url} 
                          target="_blank" 
                          rel="noreferrer"
                          className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded-md border border-blue-500/20 hover:bg-blue-500/20 transition-colors flex items-center gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                          title={bank.source_filename || 'المصدر'}
                        >
                          <FileText size={12} />
                          المصدر
                        </a>
                      )}
                      <span className="bg-gray-700/80 px-2 py-1 rounded-md">
                        {bank.created_at?.seconds
                          ? new Date(bank.created_at.seconds * 1000).toLocaleDateString('ar-EG')
                          : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button
                      onClick={() => handleStartGame(bank)}
                      className="bg-green-500/10 text-green-400 py-2 rounded-lg hover:bg-green-500/20 transition-colors font-bold text-sm border border-green-500/30"
                    >
                      ▶ Host Game
                    </button>
                    <button
                      onClick={() => handleDelete(bank.id)}
                      disabled={deletingId === bank.id}
                      className="bg-red-500/10 text-red-400 py-2 rounded-lg hover:bg-red-500/20 transition-colors font-bold text-sm border border-red-500/30 disabled:opacity-40"
                    >
                      {deletingId === bank.id ? '...' : '🗑 حذف'}
                    </button>
                  </div>
                  <button
                    onClick={() => setSelectedBank(bank)}
                    className="w-full mt-2 bg-primary/10 text-primary py-2 rounded-lg hover:bg-primary/20 transition-colors font-bold text-sm border border-primary/30"
                  >
                    عرض وتعديل
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {showUpload && (
        <UploadQuestionsModal
          onClose={() => setShowUpload(false)}
          onSuccess={fetchBanks}
        />
      )}

      {selectedBank && (
        <QuestionBankModal
          bank={selectedBank}
          onClose={() => setSelectedBank(null)}
          onUpdate={handleBankUpdate}
        />
      )}
    </div>
  )
}
