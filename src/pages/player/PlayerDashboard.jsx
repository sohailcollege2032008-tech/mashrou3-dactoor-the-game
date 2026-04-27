import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { Swords, RotateCcw, Trophy, Zap, X, Bell, CheckCheck } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { ref as rtdbRef, get as rtdbGet } from 'firebase/database'
import {
  doc, onSnapshot, getDoc, collection, query, orderBy, limit, updateDoc,
} from 'firebase/firestore'
import { db, rtdb } from '../../lib/firebase'

/* ── Small brand lockup for top-bar ──────────────────────────────────────── */
function MRMark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
        fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
    </svg>
  )
}

/* ── Notification panel ───────────────────────────────────────────────────── */
function NotificationPanel({ notifications, uid, onClose, onMarkAllRead }) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-[49998]" onClick={onClose} />
      <div style={{
        position: 'fixed', top: 64, right: 16, width: 300,
        background: 'var(--paper)', border: '1px solid var(--rule)',
        borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-3)',
        zIndex: 49999, overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--rule)' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 4 }}>
            <X size={14} />
          </button>
          <span className="ar" style={{ fontFamily: 'var(--arabic)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>الإشعارات</span>
        </div>

        {/* Items */}
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {notifications.length === 0 ? (
            <p className="ar" style={{ color: 'var(--ink-4)', fontSize: 13, textAlign: 'center', padding: '32px 16px', fontFamily: 'var(--arabic)' }}>لا توجد إشعارات</p>
          ) : notifications.map(n => (
            <div key={n.id} style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--rule)',
              background: !n.read ? 'rgba(156,59,46,0.04)' : 'transparent',
            }}>
              {n.type === 'game_finished' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                    {!n.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--burgundy)', flexShrink: 0 }} />}
                    <span style={{ fontFamily: 'var(--arabic)', fontWeight: 600, fontSize: 13, color: 'var(--ink)' }} className="ar">{n.room_title}</span>
                    <Trophy size={12} style={{ color: 'var(--gold)', flexShrink: 0 }} />
                  </div>
                  <p className="ar" style={{ fontFamily: 'var(--arabic)', fontSize: 12, color: 'var(--ink-3)' }}>
                    مرتبتك: <strong style={{ color: 'var(--ink)' }}>#{n.my_rank}</strong>
                    {' '}· نقاطك: <strong style={{ color: 'var(--burgundy)' }}>{n.my_score}</strong>
                    {' '}من {n.total_players} لاعب
                  </p>
                  {n.full_leaderboard?.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                      {n.full_leaderboard.slice(0, 5).map(p => (
                        <div key={p.user_id} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          fontSize: 11, padding: '2px 6px', borderRadius: 'var(--r-xs)',
                          background: p.user_id === uid ? 'rgba(156,59,46,0.08)' : 'transparent',
                          color: p.user_id === uid ? 'var(--burgundy)' : 'var(--ink-3)',
                        }}>
                          <span style={{ fontFamily: 'var(--mono)' }}>#{p.rank}</span>
                          <span style={{ flex: 1, textAlign: 'right', margin: '0 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--arabic)' }}>{p.nickname}</span>
                          <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{p.score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {n.created_at?.seconds && (
                    <p className="folio" style={{ marginTop: 4 }}>
                      {new Date(n.created_at.seconds * 1000).toLocaleString('ar-EG')}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--rule)' }}>
            <button onClick={onMarkAllRead} className="ar" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
              width: '100%', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--arabic)',
            }}>
              <CheckCheck size={12} /> تحديد الكل كمقروء
            </button>
          </div>
        )}
      </div>
    </>,
    document.body
  )
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

const TOURNAMENT_STATUS_AR = {
  registration: 'قيد التسجيل — انتظر البدء',
  ffa:          'FFA جارية — ادخل الآن',
  transition:   'جاري الانتقال للـ Bracket…',
  bracket:      'مرحلة الـ Bracket',
  finished:     'انتهت البطولة',
}

export default function PlayerDashboard() {
  const { profile, session } = useAuth()
  const navigate = useNavigate()
  const uid = session?.uid

  const [activeDuel,           setActiveDuel]           = useState(null)
  const [activeTournament,     setActiveTournament]     = useState(null)
  const [tournamentEliminated, setTournamentEliminated] = useState(false)
  const [notifications,        setNotifications]        = useState([])
  const [showNotifications,    setShowNotifications]    = useState(false)

  const markAllRead = async () => {
    if (!uid) return
    await Promise.all(
      notifications.filter(n => !n.read).map(n =>
        updateDoc(doc(db, 'notifications', uid, 'items', n.id), { read: true })
      )
    )
  }

  useEffect(() => {
    const check = async () => {
      const duelId = localStorage.getItem('activeDuelId')
      if (!duelId || !uid) return
      try {
        const snap = await rtdbGet(rtdbRef(rtdb, `duels/${duelId}`))
        const duel = snap.val()
        if (duel && duel.status !== 'finished' && duel.players?.[uid]) {
          setActiveDuel({ id: duelId, ...duel })
        } else {
          localStorage.removeItem('activeDuelId')
        }
      } catch { localStorage.removeItem('activeDuelId') }
    }
    check()
  }, [uid])

  useEffect(() => {
    const savedId = localStorage.getItem('activeTournamentId')
    if (!savedId) return
    const unsub = onSnapshot(doc(db, 'tournaments', savedId), snap => {
      if (!snap.exists()) { localStorage.removeItem('activeTournamentId'); setActiveTournament(null); return }
      setActiveTournament({ id: snap.id, ...snap.data() })
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!activeTournament || !uid) return
    if (!['bracket', 'finished'].includes(activeTournament.status)) return
    getDoc(doc(db, 'tournaments', activeTournament.id, 'ffa_results', uid))
      .then(snap => {
        if (snap.exists() && snap.data().advanced === false) {
          setTournamentEliminated(true)
          localStorage.removeItem('activeTournamentId')
        }
      }).catch(() => {})
  }, [activeTournament?.status, activeTournament?.id, uid])

  useEffect(() => {
    if (!uid) return
    const q = query(collection(db, 'notifications', uid, 'items'), orderBy('created_at', 'desc'), limit(20))
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

  const rejoinPath = activeDuel
    ? activeDuel.status === 'waiting' ? `/duel/lobby/${activeDuel.id}` : `/duel/game/${activeDuel.id}`
    : null

  const unreadCount = notifications.filter(n => !n.read).length
  const firstName   = profile?.display_name?.split(' ')[0] || 'Scholar'

  return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)',
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        {/* Left: MR mark + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <MRMark size={32} />
          <div>
            <p style={{ fontFamily: 'var(--serif)', fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0, lineHeight: 1 }}>
              {firstName}
            </p>
            <p className="folio" style={{ marginTop: 2 }}>Scholar</p>
          </div>
        </div>

        {/* Center: folio label */}
        <span className="folio" style={{ textAlign: 'center' }}>Med Royale</span>

        {/* Right: bell + avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, justifyContent: 'flex-end' }}>
          <button
            onClick={() => { setShowNotifications(v => !v); if (!showNotifications) markAllRead() }}
            style={{
              position: 'relative', background: 'none', border: '1px solid var(--rule)',
              borderRadius: 'var(--r-sm)', padding: '7px 9px', cursor: 'pointer', color: 'var(--ink-3)',
              display: 'flex', alignItems: 'center',
            }}
          >
            <Bell size={15} />
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

          <Link to="/player/profile" style={{ display: 'block', flexShrink: 0 }}>
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', border: '1.5px solid var(--ink)', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 36, height: 36, borderRadius: '50%', border: '1.5px solid var(--ink)', background: 'var(--paper-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                  {(profile?.display_name || '?').slice(0, 2).toUpperCase()}
                </span>
              </div>
            )}
          </Link>
        </div>
      </header>

      {showNotifications && (
        <NotificationPanel
          notifications={notifications}
          uid={uid}
          onClose={() => setShowNotifications(false)}
          onMarkAllRead={markAllRead}
        />
      )}

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px 20px', gap: 12, maxWidth: 480, width: '100%', margin: '0 auto' }}>

        {/* Active tournament banner */}
        {activeTournament && tournamentDest && !tournamentEliminated && (
          <div style={{
            background: activeTournament.status === 'ffa' ? 'rgba(176,137,68,0.08)' : 'rgba(156,59,46,0.06)',
            border: `1px solid ${activeTournament.status === 'ffa' ? 'var(--gold)' : 'var(--burgundy)'}`,
            borderRadius: 'var(--r-md)',
            padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 'var(--r-sm)', background: activeTournament.status === 'ffa' ? 'rgba(176,137,68,0.15)' : 'rgba(156,59,46,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {activeTournament.status === 'ffa'
                  ? <Zap size={18} style={{ color: 'var(--gold)' }} />
                  : <Trophy size={18} style={{ color: 'var(--burgundy)' }} />
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="ar" style={{ fontFamily: 'var(--arabic)', fontWeight: 600, fontSize: 13, color: 'var(--ink)', margin: 0 }}>{activeTournament.title}</p>
                <p className="ar" style={{ fontFamily: 'var(--arabic)', fontSize: 11, color: activeTournament.status === 'ffa' ? 'var(--gold)' : 'var(--burgundy)', margin: '2px 0 0' }}>
                  {TOURNAMENT_STATUS_AR[activeTournament.status] || activeTournament.status}
                </p>
              </div>
              {activeTournament.status === 'finished' && (
                <button onClick={() => { localStorage.removeItem('activeTournamentId'); setActiveTournament(null) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: 4 }}>
                  <X size={13} />
                </button>
              )}
            </div>
            {activeTournament.status !== 'finished' && (
              <button onClick={() => navigate(tournamentDest)} className="btn btn-sm ar" style={{
                width: '100%', marginTop: 10, justifyContent: 'center',
                background: activeTournament.status === 'ffa' ? 'var(--gold)' : 'var(--burgundy)',
                color: 'var(--paper)', borderColor: 'transparent',
                fontFamily: 'var(--arabic)',
              }}>
                {activeTournament.status === 'ffa' ? 'ادخل FFA الآن' : 'متابعة البطولة'}
              </button>
            )}
          </div>
        )}

        {/* Active duel rejoin */}
        {activeDuel && rejoinPath && (
          <button onClick={() => navigate(rejoinPath)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
            background: 'rgba(176,137,68,0.06)', border: '1px solid var(--gold)',
            borderRadius: 'var(--r-md)', padding: '14px 16px', cursor: 'pointer',
            transition: 'all 150ms var(--ease-out)',
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 'var(--r-sm)', background: 'rgba(176,137,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <RotateCcw size={17} style={{ color: 'var(--gold)' }} />
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <p className="ar" style={{ fontFamily: 'var(--arabic)', fontWeight: 600, fontSize: 13, color: 'var(--ink)', margin: 0 }}>لديك دويل جارٍ</p>
              <p className="ar" style={{ fontFamily: 'var(--arabic)', fontSize: 11, color: 'var(--ink-3)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeDuel.deck_title}</p>
            </div>
            <span className="tag tag-gold">انضم</span>
          </button>
        )}

        {/* ── Primary action: Join a Room ────────────────────────────── */}
        <Link to="/player/join" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          background: 'var(--ink)', color: 'var(--paper)',
          border: '1px solid var(--ink)', borderRadius: 'var(--r-md)',
          padding: '32px 24px', textDecoration: 'none',
          transition: 'all 150ms var(--ease-out)',
        }}>
          <p style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(28px, 6vw, 40px)', fontWeight: 400, letterSpacing: '-0.02em', color: 'var(--paper)', margin: 0, lineHeight: 1 }}>
            Join a Room
          </p>
          <div style={{ width: 40, height: 1, background: 'rgba(244,241,234,0.2)' }} />
          <p className="ar" style={{ fontFamily: 'var(--arabic)', fontSize: 13, color: 'rgba(244,241,234,0.6)', margin: 0 }}>
            أدخل كود الجيم وانضم
          </p>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em', color: 'rgba(244,241,234,0.4)', textTransform: 'uppercase' }}>→ Enter</span>
        </Link>

        {/* ── Secondary actions ──────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>

          {/* Tournament */}
          <Link to="/tournament/join" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            border: '1px solid var(--rule)', borderRadius: 'var(--r-md)',
            padding: '20px 16px', textDecoration: 'none', background: 'var(--paper)',
            transition: 'all 150ms var(--ease-out)',
          }}>
            <Trophy size={22} style={{ color: 'var(--gold)' }} />
            <div style={{ textAlign: 'center' }}>
              <p className="ar" style={{ fontFamily: 'var(--arabic)', fontWeight: 600, fontSize: 14, color: 'var(--ink)', margin: 0 }}>بطولة</p>
              <p className="folio" style={{ marginTop: 4 }}>انضم بكود</p>
            </div>
          </Link>

          {/* Duel */}
          <Link to="/player/decks" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            border: '1px solid var(--rule)', borderRadius: 'var(--r-md)',
            padding: '20px 16px', textDecoration: 'none', background: 'var(--paper)',
            transition: 'all 150ms var(--ease-out)',
          }}>
            <Swords size={22} style={{ color: 'var(--navy)' }} />
            <div style={{ textAlign: 'center' }}>
              <p className="ar" style={{ fontFamily: 'var(--arabic)', fontWeight: 600, fontSize: 14, color: 'var(--ink)', margin: 0 }}>دويل</p>
              <p className="folio" style={{ marginTop: 4 }}>1v1 مع زميلك</p>
            </div>
          </Link>

        </div>

      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="rule" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={() => useAuthStore.getState().signOut()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)' }}
        >
          Sign Out
        </button>
        <span className="folio">Player · Dashboard</span>
      </footer>

    </div>
  )
}
