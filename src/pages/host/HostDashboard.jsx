import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { collection, query, where, getDocs, deleteDoc, doc, addDoc, serverTimestamp, onSnapshot, updateDoc, orderBy, limit } from 'firebase/firestore'
import { Swords } from 'lucide-react'
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
  const [activeRoom,       setActiveRoom]       = useState(null)
  const [activeTournament, setActiveTournament] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)

  useEffect(() => {
    if (profile) fetchBanks()
  }, [profile])

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
          set(ref(rtdb, `host_rooms/${profile.id}/active`), null)
        }
      } catch (_) {}
    }
    check()
  }, [profile])

  useEffect(() => {
    if (!session?.uid) return
    const q = query(collection(db, 'tournaments'), where('host_id', '==', session.uid))
    const unsub = onSnapshot(q, snap => {
      const ACTIVE = ['registration', 'ffa', 'transition', 'bracket']
      const found = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(t => ACTIVE.includes(t.status))
      setActiveTournament(found || null)
    }, () => {})
    return () => unsub()
  }, [session?.uid])

  useEffect(() => {
    if (!session?.uid) return
    const q = query(collection(db, 'notifications', session.uid, 'items'), orderBy('created_at', 'desc'), limit(20))
    const unsub = onSnapshot(q, snap => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }, () => {})
    return () => unsub()
  }, [session?.uid])

  const markAllRead = async () => {
    if (!session?.uid) return
    const unread = notifications.filter(n => !n.read)
    await Promise.all(unread.map(n => updateDoc(doc(db, 'notifications', session.uid, 'items', n.id), { read: true })))
  }

  const fetchBanks = async () => {
    setLoading(true)
    try {
      const q = query(collection(db, 'question_sets'), where('host_id', '==', profile.id))
      const snap = await getDocs(q)
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
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
    } catch (err) { alert('خطأ في الحذف: ' + err.message) }
    setDeletingId(null)
  }

  const handleStartGame = async (bank) => {
    if (!profile) return
    const hostUid = session?.uid || profile.id
    if (!hostUid) { alert('خطأ: مش قادر يتعرف على هويتك. حاول تعمل تسجيل خروج ودخول من جديد.'); return }
    const MAX_ATTEMPTS = 5
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      const code  = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
      const roomRef = ref(rtdb, `rooms/${code}`)
      try {
        const existing = await get(roomRef)
        if (existing.exists()) continue
        const roomTitle = bank.title + ' Room'
        await set(roomRef, {
          code, host_id: hostUid, question_set_id: bank.id, title: roomTitle,
          questions: bank.questions, force_rtl: bank.force_rtl || false,
          status: 'lobby', current_question_index: 0, question_started_at: null,
          reveal_data: null, created_at: Date.now()
        })
        await set(ref(rtdb, `host_rooms/${hostUid}/active`), { code, title: roomTitle })
        navigate(`/host/game/${code}`)
        return
      } catch (err) {
        console.error('[Dashboard] Error creating room (attempt', attempt + 1, '):', err)
        const isCollision = err?.code === 'ALREADY_EXISTS'
        if (!isCollision) { alert(`خطأ في إنشاء الأوضة:\n${err?.message || err}\n\nتأكد من إعدادات Firebase RTDB أو تواصل مع المسؤول.`); return }
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
    setSelectedBank(prev => prev && prev.id === bankId
      ? (fullBankUpdate ? { ...prev, ...fullBankUpdate } : { ...prev, questions: updatedQuestions, title: updatedTitle })
      : prev
    )
  }

  const handleSignOut = async () => { useAuthStore.getState().signOut() }

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', color: 'var(--ink)', padding: '0 0 60px' }}>

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)', padding: '13px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <svg width={28} height={28} viewBox="0 0 100 100" fill="none" aria-label="Med Royale">
            <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
            <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
            <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
              fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
          </svg>
          <div>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 1 }}>MED ROYALE</p>
            <p style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 400, color: 'var(--ink)', lineHeight: 1 }}>Host Dashboard</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Bell */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowNotifications(v => !v); if (!showNotifications) markAllRead() }}
              style={{
                position: 'relative', background: 'none',
                border: '1px solid var(--rule)', padding: '6px 8px', cursor: 'pointer',
                color: 'var(--ink-3)', display: 'flex', alignItems: 'center',
              }}
            >
              <Bell size={14} />
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: -5, right: -5,
                  width: 16, height: 16, borderRadius: '50%',
                  background: 'var(--burgundy)', color: 'var(--paper)',
                  fontSize: 9, fontFamily: 'var(--mono)', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{unreadCount}</span>
              )}
            </button>

            {showNotifications && createPortal(
              <>
                <div className="fixed inset-0 z-[49998]" onClick={() => setShowNotifications(false)} />
                <div style={{
                  position: 'fixed', top: 64, right: 20, width: 300, zIndex: 49999,
                  background: 'var(--paper)', border: '1px solid var(--rule)',
                  borderTop: '3px double var(--rule-strong)', boxShadow: 'var(--shadow-3)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--rule)' }}>
                    <button onClick={() => setShowNotifications(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}>
                      <X size={13} />
                    </button>
                    <span className="folio">الإشعارات</span>
                  </div>
                  <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    {notifications.length === 0 ? (
                      <p className="ar" style={{ color: 'var(--ink-4)', fontSize: 13, textAlign: 'center', padding: '28px 16px' }}>لا توجد إشعارات</p>
                    ) : notifications.map(n => (
                      <div key={n.id} style={{
                        padding: '12px 14px', borderBottom: '1px solid var(--rule)',
                        background: !n.read ? 'rgba(156,59,46,0.04)' : 'transparent',
                      }}>
                        {n.type === 'game_finished' && (
                          <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                              {!n.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--burgundy)', flexShrink: 0 }} />}
                              <span className="ar" style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{n.room_title}</span>
                              <Trophy size={12} style={{ color: 'var(--gold)', flexShrink: 0 }} />
                            </div>
                            <p className="ar" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                              {n.winner_nickname ? `الفايز: ${n.winner_nickname} · ` : ''}
                              {n.total_players} لاعب
                            </p>
                            {n.results_url && (
                              <button onClick={() => { setShowNotifications(false); navigate(n.results_url) }}
                                className="folio" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--burgundy)', fontSize: 9, textAlign: 'right' }}>
                                → عرض النتائج
                              </button>
                            )}
                            {n.created_at?.seconds && (
                              <p style={{ fontFamily: 'var(--mono)', color: 'var(--ink-4)', fontSize: 10 }}>
                                {new Date(n.created_at.seconds * 1000).toLocaleString('ar-EG')}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {notifications.length > 0 && (
                    <div style={{ padding: '10px 14px', borderTop: '1px solid var(--rule)', display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={markAllRead} className="ar" style={{
                        display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
                        cursor: 'pointer', fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--arabic)',
                      }}>
                        <CheckCheck size={11} /> تحديد الكل كمقروء
                      </button>
                    </div>
                  )}
                </div>
              </>,
              document.body
            )}
          </div>

          <Link to="/player/decks" style={{
            padding: '6px 14px', border: '1px solid var(--rule)', background: 'none',
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--ink-3)', textDecoration: 'none',
          }}>DECKS</Link>

          <button onClick={handleSignOut} style={{
            padding: '6px 14px', border: '1px solid var(--alert)', background: 'none',
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--alert)', cursor: 'pointer',
          }}>SIGN OUT</button>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px 0' }}>

        {/* ── Active game rejoin banner ─────────────────────────────────── */}
        {activeRoom && (
          <div style={{
            border: '1px solid var(--navy)', borderBottomWidth: 3,
            padding: '16px 20px', marginBottom: 20,
            background: 'rgba(45,62,92,0.05)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
          }}>
            <div style={{ minWidth: 0 }}>
              <p className="folio" style={{ fontSize: 9, color: 'var(--navy)', marginBottom: 4 }}>ACTIVE GAME ROOM</p>
              <h3 className="ar" style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 400, color: 'var(--ink)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeRoom.title}
              </h3>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
                CODE: <strong style={{ color: 'var(--navy)', letterSpacing: '0.18em' }}>{activeRoom.code}</strong>
              </p>
            </div>
            <Link to={`/host/game/${activeRoom.code}`} style={{
              flexShrink: 0, padding: '10px 20px',
              background: 'var(--ink)', color: 'var(--paper)',
              fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em',
              textTransform: 'uppercase', textDecoration: 'none', border: 'none',
            }}>REJOIN →</Link>
          </div>
        )}

        {/* ── Active tournament banner ──────────────────────────────────── */}
        {activeTournament && (() => {
          const statusLabel = {
            registration: { text: 'REGISTRATION OPEN', color: 'var(--gold)' },
            ffa:          { text: 'FFA IN PROGRESS',   color: 'var(--alert)' },
            transition:   { text: 'TRANSITIONING',     color: 'var(--navy)' },
            bracket:      { text: 'BRACKET ACTIVE',    color: 'var(--burgundy)' },
          }[activeTournament.status] || { text: activeTournament.status.toUpperCase(), color: 'var(--ink-3)' }

          const url = activeTournament.status === 'registration'
            ? `/tournament/${activeTournament.id}/lobby`
            : activeTournament.status === 'ffa' && activeTournament.ffa_room_id
              ? `/host/game/${activeTournament.ffa_room_id}`
              : `/tournament/${activeTournament.id}/bracket`

          return (
            <div style={{
              border: `1px solid ${statusLabel.color}`, borderBottomWidth: 3,
              padding: '16px 20px', marginBottom: 20,
              background: `color-mix(in srgb, ${statusLabel.color} 5%, transparent)`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Swords size={12} style={{ color: statusLabel.color, flexShrink: 0 }} />
                  <p className="folio" style={{ fontSize: 9, color: statusLabel.color }}>{statusLabel.text}</p>
                </div>
                <h3 className="ar" style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 400, color: 'var(--ink)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeTournament.title}
                </h3>
                {activeTournament.code && (
                  <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>
                    CODE: <strong style={{ color: statusLabel.color, letterSpacing: '0.14em' }}>{activeTournament.code}</strong>
                  </p>
                )}
              </div>
              <Link to={url} style={{
                flexShrink: 0, padding: '10px 20px',
                background: 'var(--ink)', color: 'var(--paper)',
                fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em',
                textTransform: 'uppercase', textDecoration: 'none',
              }}>متابعة →</Link>
            </div>
          )
        })()}

        {/* ── Question Banks ────────────────────────────────────────────── */}
        <div style={{ border: '1px solid var(--rule)', borderBottomWidth: 3 }}>

          {/* Section header */}
          <div style={{
            borderBottom: '1px solid var(--rule)', padding: '14px 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 22, color: 'var(--ink)', margin: 0 }}>
              Question Banks
            </h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => navigate('/tournament/create')} style={{
                padding: '7px 14px', border: '1px solid var(--gold)',
                background: 'none', cursor: 'pointer',
                fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'var(--gold)',
              }}>
                CREATE TOURNAMENT
              </button>
              <button onClick={() => setShowUpload(true)} style={{
                padding: '7px 16px', border: '1px solid var(--ink)',
                background: 'var(--ink)', cursor: 'pointer',
                fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'var(--paper)',
              }}>
                + UPLOAD BANK
              </button>
            </div>
          </div>

          {/* Banks list */}
          {loading ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-4)', letterSpacing: '0.1em' }}>
              LOADING…
            </div>
          ) : banks.length === 0 ? (
            <div style={{ padding: '64px 20px', textAlign: 'center' }}>
              <p style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 28, color: 'var(--ink)', marginBottom: 10 }}>
                No banks yet.
              </p>
              <p className="ar" style={{ fontSize: 14, color: 'var(--ink-4)', marginBottom: 24 }}>ارفع ملف JSON أو استخدم الذكاء الاصطناعي لاستخراج الأسئلة</p>
              <button onClick={() => setShowUpload(true)} style={{
                padding: '10px 24px', border: '1px solid var(--ink)', background: 'var(--ink)',
                color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: 10,
                letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
              }}>+ UPLOAD FIRST BANK</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {banks.map((bank, idx) => (
                <div key={bank.id} style={{
                  borderRight: '1px solid var(--rule)',
                  borderBottom: '1px solid var(--rule)',
                  padding: '18px 20px',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14,
                }}>
                  <div>
                    <h3 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 18, color: 'var(--ink)', margin: '0 0 10px', lineHeight: 1.2 }}>
                      {bank.title}
                    </h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)', padding: '2px 8px', border: '1px solid var(--rule)' }}>
                        {bank.question_count} سؤال
                      </span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)', padding: '2px 8px', border: '1px solid var(--rule)', textTransform: 'uppercase' }}>
                        {bank.source_type}
                      </span>
                      {bank.source_file_url && (
                        <a href={bank.source_file_url} target="_blank" rel="noreferrer"
                          onClick={e => e.stopPropagation()} style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--navy)',
                            padding: '2px 8px', border: '1px solid var(--navy)',
                            textDecoration: 'none',
                          }}>
                          <FileText size={10} /> SOURCE
                        </a>
                      )}
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)', padding: '2px 8px', border: '1px solid var(--rule)' }}>
                        {bank.created_at?.seconds ? new Date(bank.created_at.seconds * 1000).toLocaleDateString('ar-EG') : '—'}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button onClick={() => handleStartGame(bank)} style={{
                      padding: '9px 0', border: '1px solid var(--ink)', background: 'var(--ink)',
                      color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: 10,
                      letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
                    }}>▶ HOST GAME</button>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <button onClick={() => setSelectedBank(bank)} style={{
                        padding: '8px 0', border: '1px solid var(--navy)', background: 'none',
                        fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
                        textTransform: 'uppercase', color: 'var(--navy)', cursor: 'pointer',
                      }}>VIEW / EDIT</button>
                      <button onClick={() => handleDelete(bank.id)} disabled={deletingId === bank.id} style={{
                        padding: '8px 0', border: '1px solid var(--alert)', background: 'none',
                        fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
                        textTransform: 'uppercase', color: 'var(--alert)', cursor: deletingId === bank.id ? 'not-allowed' : 'pointer',
                        opacity: deletingId === bank.id ? 0.5 : 1,
                      }}>{deletingId === bank.id ? '…' : 'DELETE'}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showUpload && (
        <UploadQuestionsModal onClose={() => setShowUpload(false)} onSuccess={fetchBanks} />
      )}
      {selectedBank && (
        <QuestionBankModal bank={selectedBank} onClose={() => setSelectedBank(null)} onUpdate={handleBankUpdate} />
      )}
    </div>
  )
}
