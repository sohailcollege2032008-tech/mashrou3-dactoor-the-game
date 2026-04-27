import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { doc, updateDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { Check, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react'

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ value, onChange }) {
  return (
    <button
      dir="ltr"
      onClick={() => onChange(!value)}
      style={{
        position: 'relative', width: 44, height: 24, borderRadius: 12, flexShrink: 0,
        background: value ? 'var(--ink)' : 'var(--rule)', border: 'none', cursor: 'pointer',
        transition: 'background 200ms',
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: value ? 23 : 3, width: 18, height: 18,
        borderRadius: '50%', background: 'var(--paper)', transition: 'left 200ms',
      }} />
    </button>
  )
}

// ── Editable Field ────────────────────────────────────────────────────────────
function EditableField({ label, value, onSave, placeholder, type = 'text' }) {
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
    <div>
      <p className="folio" style={{ marginBottom: 8 }}>{label}</p>
      {editing ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
          <input
            autoFocus
            type={type}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
            placeholder={placeholder}
            style={{
              flex: 1, border: '1px solid var(--ink)', borderBottomWidth: 2,
              background: 'var(--paper-2)', color: 'var(--ink)',
              fontFamily: 'var(--arabic)', fontSize: 15, padding: '10px 14px', outline: 'none',
            }}
          />
          <button onClick={handleSave} disabled={saving} style={{
            border: '1px solid var(--ink)', borderBottomWidth: 2,
            background: 'var(--ink)', color: 'var(--paper)',
            padding: '0 14px', cursor: saving ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center',
          }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          </button>
          <button onClick={() => { setInput(value || ''); setEditing(false) }} style={{
            border: '1px solid var(--rule)', background: 'none',
            color: 'var(--ink-3)', padding: '0 12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center',
          }}>
            <X size={14} />
          </button>
        </div>
      ) : (
        <div onClick={() => setEditing(true)} style={{
          border: '1px solid var(--rule)', borderBottomWidth: 2,
          background: 'var(--paper-2)', color: value ? 'var(--ink)' : 'var(--ink-4)',
          fontFamily: value ? 'var(--arabic)' : 'var(--sans)', fontSize: 15,
          padding: '11px 14px', cursor: 'text',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontStyle: !value ? 'italic' : 'normal' }}>{value || placeholder}</span>
          <span className="folio" style={{ fontSize: 9 }}>EDIT</span>
        </div>
      )}
    </div>
  )
}

// ── History Card ──────────────────────────────────────────────────────────────
function HistoryCard({ entry, navigate }) {
  const isDuel    = entry.type === 'duel'
  const isForfeit = entry.outcome?.includes('forfeit')

  const outcomeColor = {
    win: 'var(--success)', win_forfeit: 'var(--success)',
    lose: 'var(--alert)',  lose_forfeit: 'var(--alert)',
    tie: 'var(--navy)',
  }[entry.outcome] || 'var(--ink-3)'

  const outcomeLabel = {
    win: 'فزت', win_forfeit: 'فزت', lose: 'خسرت', lose_forfeit: 'خسرت', tie: 'تعادل',
  }[entry.outcome] || ''

  const date = entry.played_at?.toDate?.()
    ? entry.played_at.toDate().toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })
    : ''

  return (
    <div style={{ border: '1px solid var(--rule)', borderBottomWidth: 2, padding: '14px 16px', background: 'var(--paper)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="ar" style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.deck_title || (isDuel ? 'دويل' : 'مسابقة')}
          </p>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-4)' }}>{date}</p>
        </div>
        {isDuel && entry.outcome ? (
          <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 15, color: outcomeColor, flexShrink: 0 }}>
            {outcomeLabel}
          </span>
        ) : !isDuel ? (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--burgundy)', flexShrink: 0 }}>
            {entry.score}/{entry.total_questions}
          </span>
        ) : null}
      </div>

      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {isDuel ? (
          <div className="ar" style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>ضد</span>
            <button onClick={() => entry.opponent_uid && navigate(`/player/profile/${entry.opponent_uid}`)} style={{
              background: 'none', border: 'none', padding: 0,
              cursor: entry.opponent_uid ? 'pointer' : 'default',
              fontWeight: 600, color: entry.opponent_uid ? 'var(--burgundy)' : 'var(--ink-3)',
              fontFamily: 'var(--arabic)', fontSize: 12,
            }}>
              {entry.opponent_name || 'لاعب'}
            </button>
            {!isForfeit && (
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink-4)', fontSize: 11 }}>
                ({entry.my_score} – {entry.opponent_score})
              </span>
            )}
          </div>
        ) : (
          <div className="ar" style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>هوست:</span>
            <button onClick={() => entry.host_uid && navigate(`/player/profile/${entry.host_uid}`)} style={{
              background: 'none', border: 'none', padding: 0,
              cursor: entry.host_uid ? 'pointer' : 'default',
              fontWeight: 600, color: entry.host_uid ? 'var(--burgundy)' : 'var(--ink-3)',
              fontFamily: 'var(--arabic)', fontSize: 12,
            }}>
              {entry.host_name || 'دكتور'}
            </button>
          </div>
        )}
        {entry.deck_is_global && (
          <button onClick={() => navigate('/player/decks')} className="folio" style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--burgundy)', fontSize: 9,
          }}>
            BROWSE DECK →
          </button>
        )}
      </div>
    </div>
  )
}

// ── Tournament Summary Card ───────────────────────────────────────────────────
function TournamentSummaryCard({ entry }) {
  const [expanded, setExpanded] = useState(false)

  const isChampion = entry.final_result === 'champion'

  const depthLabel = {
    champion:           'بطل البطولة',
    finalist:           'وصل للنهائي',
    semi_finalist:      'وصل لنصف النهائي',
    eliminated_bracket: entry.reached_round ? `جولة ${entry.reached_round}` : 'خرج من البراكيت',
    eliminated_ffa:     'خرج في التصفيات',
  }[entry.final_result] ?? ''

  const date = entry.played_at?.toDate?.()
    ? entry.played_at.toDate().toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })
    : ''

  const tieLabel = { speed: '⚡', ffa_rank: '🏅', random: '🎲' }

  return (
    <div style={{
      border: `1px solid ${isChampion ? 'var(--gold)' : 'var(--rule)'}`,
      borderBottomWidth: 2, background: isChampion ? 'rgba(176,137,68,0.04)' : 'var(--paper)',
    }}>
      <button onClick={() => setExpanded(e => !e)} style={{
        width: '100%', background: 'none', border: 'none', cursor: 'pointer',
        padding: '14px 16px', display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', gap: 12, textAlign: 'right',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="ar" style={{ fontWeight: 600, fontSize: 14, color: isChampion ? 'var(--gold)' : 'var(--ink)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isChampion && '🏆 '}{entry.tournament_title || 'بطولة'}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {entry.ffa_rank && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-4)' }}>
                #{entry.ffa_rank}{entry.ffa_total_players ? `/${entry.ffa_total_players}` : ''}
              </span>
            )}
            <span className="ar" style={{ fontSize: 12, fontWeight: 600, color: isChampion ? 'var(--gold)' : 'var(--burgundy)' }}>
              {depthLabel}
            </span>
          </div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)', marginTop: 3 }}>{date}</p>
        </div>
        <div style={{ color: 'var(--ink-4)', flexShrink: 0, marginTop: 2 }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--rule)' }}>
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--paper-2)', borderRight: '2px solid var(--rule-strong)' }}>
            <p className="folio" style={{ marginBottom: 6 }}>مرحلة التصفيات (FFA)</p>
            <div className="ar" style={{ fontSize: 13, color: 'var(--ink-2)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--mono)' }}>#{entry.ffa_rank ?? '—'}{entry.ffa_total_players ? `/${entry.ffa_total_players}` : ''}</span>
              <span>نقاط: <strong style={{ fontFamily: 'var(--mono)', color: 'var(--burgundy)' }}>{entry.ffa_score ?? 0}</strong></span>
              <span style={{ color: entry.advanced_from_ffa ? 'var(--success)' : 'var(--alert)' }}>
                {entry.advanced_from_ffa ? '✓ تأهل' : '✗ لم يتأهل'}
              </span>
            </div>
          </div>

          {entry.bracket_matches?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <p className="folio" style={{ marginBottom: 8 }}>مباريات البراكيت</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {entry.bracket_matches.map((m, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '8px 12px', fontSize: 12,
                    borderRight: `2px solid ${m.outcome === 'win' ? 'var(--success)' : 'var(--alert)'}`,
                    background: 'var(--paper-2)',
                  }}>
                    <div className="ar" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontWeight: 700, color: m.outcome === 'win' ? 'var(--success)' : 'var(--alert)', flexShrink: 0 }}>
                        {m.outcome === 'win' ? '✓' : '✗'}
                      </span>
                      <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{m.round_label}</span>
                      <span style={{ color: 'var(--ink-4)' }}>ضد</span>
                      <span style={{ fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.opponent_name}</span>
                      {m.tie_broken_by && <span style={{ flexShrink: 0 }}>{tieLabel[m.tie_broken_by] ?? ''}</span>}
                    </div>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink-2)', flexShrink: 0 }}>
                      {m.my_score} – {m.opponent_score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PlayerProfile() {
  const { profile, session } = useAuth()
  const navigate = useNavigate()
  const [saved, setSaved]               = useState(false)
  const [history, setHistory]           = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const uid = session?.uid

  useEffect(() => {
    if (!uid) return
    const load = async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'profiles', uid, 'game_history'), orderBy('played_at', 'desc'), limit(30))
        )
        setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch { } finally { setHistoryLoading(false) }
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
    <div className="paper-grain" dir="rtl" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)', padding: '13px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Link to="/player/dashboard" style={{
          fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--ink-3)', textDecoration: 'none',
        }}>← رجوع</Link>

        <svg width={28} height={28} viewBox="0 0 100 100" fill="none" aria-label="Med Royale">
          <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>

        {saved
          ? <span className="folio" style={{ color: 'var(--success)', fontSize: 9 }}>SAVED ✓</span>
          : <span className="folio">Profile</span>
        }
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 480, width: '100%', margin: '0 auto', padding: '40px 20px 60px' }}>

        {/* Avatar */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" style={{
              width: 88, height: 88, borderRadius: '50%',
              border: '2px solid var(--ink)', objectFit: 'cover', marginBottom: 10,
            }} />
          ) : (
            <div style={{
              width: 88, height: 88, borderRadius: '50%',
              border: '2px solid var(--rule-strong)', background: 'var(--paper-3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10,
            }}>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 500, color: 'var(--ink)' }}>
                {(profile?.display_name || '?').slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
          <p className="folio" style={{ fontSize: 9 }}>صورة من حساب Google</p>
        </div>

        {/* View public profile */}
        {uid && (
          <button onClick={() => navigate(`/player/profile/${uid}`)} className="folio" style={{
            width: '100%', padding: '10px 0', marginBottom: 28,
            border: '1px solid var(--rule)', background: 'none', cursor: 'pointer',
            color: 'var(--ink-3)', letterSpacing: '0.12em', fontSize: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            VIEW PUBLIC PROFILE →
          </button>
        )}

        {/* Email (read-only) */}
        <div style={{ marginBottom: 24 }}>
          <p className="folio" style={{ marginBottom: 8 }}>البريد الإلكتروني</p>
          <div style={{
            padding: '11px 14px', background: 'var(--paper-2)',
            border: '1px solid var(--rule)', borderBottomWidth: 2,
            fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-3)',
          }}>
            {profile?.email}
          </div>
        </div>

        {/* Display name */}
        <div style={{ marginBottom: 24 }}>
          <EditableField label="الاسم" value={profile?.display_name} placeholder="أدخل اسمك" onSave={v => saveField('display_name', v)} />
        </div>

        {/* Phone (players only) */}
        {isPlayer && (
          <>
            <div style={{ marginBottom: 16 }}>
              <EditableField label="رقم الهاتف" value={profile?.phone} placeholder="01012345678" type="tel" onSave={v => saveField('phone', v)} />
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px', marginBottom: 32,
              border: `1px solid ${profile?.phone_visible ? 'var(--ink)' : 'var(--rule)'}`,
              borderBottomWidth: 2,
              background: profile?.phone_visible ? 'var(--paper-2)' : 'var(--paper)',
              transition: 'border-color 200ms, background 200ms',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="ar" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>
                  إظهار رقم الهاتف للطلاب
                </p>
                <p className="folio" style={{ fontSize: 9 }}>
                  {profile?.phone_visible ? 'VISIBLE TO ALL' : 'HOSTS ONLY'}
                </p>
              </div>
              <Toggle value={profile?.phone_visible || false} onChange={v => saveField('phone_visible', v)} />
            </div>
          </>
        )}

        {/* ── Game History ── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
            <span className="folio">سجل المباريات</span>
            <div style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
          </div>

          {historyLoading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ink-4)' }}>
              <Loader2 size={20} className="animate-spin" style={{ display: 'inline-block' }} />
            </div>
          ) : history.length === 0 ? (
            <p className="ar" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ink-4)', fontSize: 14 }}>
              لم تلعب أي مباريات بعد
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(() => {
                const summaryIds = new Set(
                  history.filter(e => e.type === 'tournament_summary').map(e => e.tournament_id)
                )
                return history
                  .filter(e => {
                    if ((e.type === 'tournament_ffa' || e.type === 'tournament_match') &&
                        summaryIds.has(e.tournament_id)) return false
                    return true
                  })
                  .map(entry =>
                    entry.type === 'tournament_summary'
                      ? <TournamentSummaryCard key={entry.id} entry={entry} />
                      : <HistoryCard key={entry.id} entry={entry} navigate={navigate} />
                  )
              })()}
            </div>
          )}
        </div>

      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid var(--rule)', padding: '12px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <button onClick={() => useAuthStore.getState().signOut()} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--ink-4)',
        }}>Sign Out</button>
        <span className="folio">Player · Profile</span>
      </footer>

    </div>
  )
}
