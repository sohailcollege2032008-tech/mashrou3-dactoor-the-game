import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { RotateCcw, Trophy, Zap, X, Bell, CheckCheck } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { ref as rtdbRef, get as rtdbGet } from 'firebase/database'
import {
  doc, onSnapshot, getDoc, collection, query, orderBy, limit, updateDoc,
} from 'firebase/firestore'
import { db, rtdb } from '../../lib/firebase'

function formatDate() {
  const now = new Date()
  const days   = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
  return `${days[now.getDay()]} · ${now.getDate()} ${months[now.getMonth()]}`
}

/* ── Notification Panel ─────────────────────────────────────────────────────── */
function NotificationPanel({ notifications, uid, onClose, onMarkAllRead }) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-[49998]" onClick={onClose} />
      <div style={{
        position: 'fixed', top: 64, right: 16, width: 300,
        background: 'var(--paper)', border: '1px solid var(--rule)',
        boxShadow: 'var(--shadow-3)', zIndex: 49999, overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--rule)' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 4 }}>
            <X size={14} />
          </button>
          <span className="ar" style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>الإشعارات</span>
        </div>

        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {notifications.length === 0 ? (
            <p className="ar" style={{ color: 'var(--ink-4)', fontSize: 13, textAlign: 'center', padding: '32px 16px' }}>لا توجد إشعارات</p>
          ) : notifications.map(n => (
            <div key={n.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)', background: !n.read ? 'rgba(156,59,46,0.04)' : 'transparent' }}>
              {n.type === 'game_finished' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                    {!n.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--burgundy)', flexShrink: 0 }} />}
                    <span className="ar" style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{n.room_title}</span>
                    <Trophy size={12} style={{ color: 'var(--gold)', flexShrink: 0 }} />
                  </div>
                  <p className="ar" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    مرتبتك: <strong style={{ color: 'var(--ink)' }}>#{n.my_rank}</strong>
                    {' '}· نقاطك: <strong style={{ color: 'var(--burgundy)' }}>{n.my_score}</strong>
                    {' '}من {n.total_players} لاعب
                  </p>
                  {n.full_leaderboard?.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                      {n.full_leaderboard.slice(0, 5).map(p => (
                        <div key={p.user_id} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          fontSize: 11, padding: '2px 6px',
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

/* ── Constants ────────────────────────────────────────────────────────────── */
const TOURNAMENT_STATUS_AR = {
  registration: 'قيد التسجيل — انتظر البدء',
  ffa:          'FFA جارية — ادخل الآن',
  transition:   'جاري الانتقال للـ Bracket…',
  bracket:      'مرحلة الـ Bracket',
  finished:     'انتهت البطولة',
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
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

  const unreadCount      = notifications.filter(n => !n.read).length
  const firstName        = profile?.display_name?.split(' ')[0] || 'Scholar'
  const showTournament   = activeTournament && tournamentDest && !tournamentEliminated
  const showDuelRejoin   = activeDuel && rejoinPath
  const hasActiveBanners = showTournament || showDuelRejoin

  return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)',
        padding: '13px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <span className="folio" style={{ flex: 1 }}>Scholar</span>

        {/* Monogram */}
        <svg width={30} height={30} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Med Royale">
          <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
          <circle cx="50" cy="6"  r="1.6" fill="var(--ink)" opacity="0.4" />
          <circle cx="50" cy="94" r="1.6" fill="var(--ink)" opacity="0.4" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, justifyContent: 'flex-end' }}>
          {/* Bell */}
          <button
            onClick={() => { setShowNotifications(v => !v); if (!showNotifications) markAllRead() }}
            style={{
              position: 'relative', background: 'none', border: '1px solid var(--rule)',
              padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)',
              display: 'flex', alignItems: 'center',
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

          {/* Avatar → profile */}
          <Link to="/player/profile" style={{ display: 'block', flexShrink: 0 }}>
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid var(--ink)', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid var(--ink)', background: 'var(--paper-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
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

      {/* ── Welcome ────────────────────────────────────────────────────── */}
      <div style={{ padding: '28px 20px 22px', borderBottom: '1px solid var(--rule)' }}>
        <p className="folio" style={{ marginBottom: 12 }}>{formatDate()}</p>
        <h1 style={{
          fontFamily: 'var(--serif)', fontWeight: 400,
          fontSize: 'clamp(34px, 8vw, 64px)', lineHeight: 1.0,
          letterSpacing: '-0.025em', margin: 0, color: 'var(--ink)',
        }}>
          Welcome back,<br />
          <em style={{ fontWeight: 300, color: 'var(--burgundy)' }}>{firstName}.</em>
        </h1>
      </div>

      {/* ── Active banners ─────────────────────────────────────────────── */}
      {hasActiveBanners && (
        <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--rule)' }}>

          {showTournament && (
            <div style={{
              border: `1px solid ${activeTournament.status === 'ffa' ? 'var(--gold)' : 'var(--burgundy)'}`,
              padding: '12px 14px',
              background: activeTournament.status === 'ffa' ? 'rgba(176,137,68,0.05)' : 'rgba(156,59,46,0.04)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ color: activeTournament.status === 'ffa' ? 'var(--gold)' : 'var(--burgundy)', flexShrink: 0 }}>
                  {activeTournament.status === 'ffa' ? <Zap size={15} /> : <Trophy size={15} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="ar" style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', margin: 0 }}>{activeTournament.title}</p>
                  <p className="ar" style={{ fontSize: 11, margin: '2px 0 0', color: activeTournament.status === 'ffa' ? 'var(--gold)' : 'var(--burgundy)' }}>
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
                <button onClick={() => navigate(tournamentDest)} className="ar" style={{
                  width: '100%', marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '9px 14px', fontSize: 13, fontWeight: 500, fontFamily: 'var(--arabic)',
                  background: activeTournament.status === 'ffa' ? 'var(--gold)' : 'var(--burgundy)',
                  color: 'var(--paper)', border: 'none', cursor: 'pointer',
                  transition: 'opacity 150ms',
                }}>
                  {activeTournament.status === 'ffa' ? 'ادخل FFA الآن' : 'متابعة البطولة'}
                </button>
              )}
            </div>
          )}

          {showDuelRejoin && (
            <button onClick={() => navigate(rejoinPath)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              background: 'rgba(176,137,68,0.05)', border: '1px solid var(--gold)',
              padding: '12px 14px', cursor: 'pointer',
              transition: 'background 150ms var(--ease-out)',
            }}>
              <RotateCcw size={14} style={{ color: 'var(--gold)', flexShrink: 0 }} />
              <div style={{ flex: 1, textAlign: 'right' }}>
                <p className="ar" style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', margin: 0 }}>لديك دويل جارٍ</p>
                <p className="ar" style={{ fontSize: 11, color: 'var(--ink-3)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeDuel.deck_title}</p>
              </div>
              <span className="tag tag-gold" style={{ fontSize: 10 }}>انضم</span>
            </button>
          )}

        </div>
      )}

      {/* ── Actions — editorial numbered sections ──────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

        {/* Chapter rule */}
        <div style={{ height: 2, background: 'var(--ink)' }} />

        {/* I · Join a Room */}
        <Link to="/player/join" style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '22px 20px', borderBottom: '1px solid var(--rule)',
          background: 'var(--ink)', textDecoration: 'none',
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--serif)', fontStyle: 'italic', fontWeight: 300,
              fontSize: 44, lineHeight: 1, color: 'rgba(244,241,234,0.2)', marginBottom: 10,
            }}>I.</div>
            <h2 style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--paper)', lineHeight: 1.1 }}>
              Join a Room
            </h2>
            <p className="ar" style={{ fontSize: 13, color: 'rgba(244,241,234,0.45)', margin: '6px 0 0' }}>
              أدخل كود الجيم وانضم
            </p>
          </div>
          <span className="folio" style={{ color: 'rgba(244,241,234,0.3)', marginTop: 2 }}>ENTER →</span>
        </Link>

        {/* II · Open a Duel */}
        <Link to="/player/decks" style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '22px 20px', borderBottom: '1px solid var(--rule)',
          background: 'var(--paper)', textDecoration: 'none',
          transition: 'background 150ms var(--ease-out)',
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--serif)', fontStyle: 'italic', fontWeight: 300,
              fontSize: 44, lineHeight: 1, color: 'var(--burgundy)', opacity: 0.35, marginBottom: 10,
            }}>II.</div>
            <h2 style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)', lineHeight: 1.1 }}>
              Open a Duel
            </h2>
            <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: '6px 0 0' }}>
              1v1 مع زميلك
            </p>
          </div>
          <span className="folio" style={{ color: 'var(--burgundy)', opacity: 0.55, marginTop: 2 }}>DUEL →</span>
        </Link>

        {/* III · Join a Tournament */}
        <Link to="/tournament/join" style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '22px 20px',
          background: 'var(--paper)', textDecoration: 'none',
          transition: 'background 150ms var(--ease-out)',
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--serif)', fontStyle: 'italic', fontWeight: 300,
              fontSize: 44, lineHeight: 1, color: 'var(--gold)', opacity: 0.35, marginBottom: 10,
            }}>III.</div>
            <h2 style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)', lineHeight: 1.1 }}>
              Join a Tournament
            </h2>
            <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: '6px 0 0' }}>
              انضم بكود البطولة
            </p>
          </div>
          <span className="folio" style={{ color: 'var(--gold)', opacity: 0.55, marginTop: 2 }}>ENTER →</span>
        </Link>

      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid var(--rule)',
        padding: '12px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <button
          onClick={() => useAuthStore.getState().signOut()}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--ink-4)',
          }}
        >
          Sign Out
        </button>
        <span className="folio">Player · Dashboard</span>
      </footer>

    </div>
  )
}
