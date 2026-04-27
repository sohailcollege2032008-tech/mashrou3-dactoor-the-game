import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { Loader2, ChevronDown, ChevronUp, Phone } from 'lucide-react'

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
            }}>{entry.opponent_name || 'لاعب'}</button>
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
            }}>{entry.host_name || 'دكتور'}</button>
          </div>
        )}
        {entry.deck_is_global && (
          <button onClick={() => navigate('/player/decks')} className="folio" style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--burgundy)', fontSize: 9,
          }}>BROWSE DECK →</button>
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
                      {m.tie_broken_by && <span>{tieLabel[m.tie_broken_by] ?? ''}</span>}
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
export default function PublicProfile() {
  const { uid: targetUid } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const viewerUid = session?.uid

  const [profile,  setProfile]  = useState(null)
  const [history,  setHistory]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [notFound, setNotFound] = useState(false)

  const isOwnProfile = viewerUid === targetUid

  useEffect(() => {
    if (!targetUid) return
    const load = async () => {
      try {
        const profileSnap = await getDoc(doc(db, 'profiles', targetUid))
        if (!profileSnap.exists()) { setNotFound(true); setLoading(false); return }
        setProfile(profileSnap.data())
        const histSnap = await getDocs(
          query(collection(db, 'profiles', targetUid, 'game_history'), orderBy('played_at', 'desc'), limit(30))
        )
        setHistory(histSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (e) { console.error(e) } finally { setLoading(false) }
    }
    load()
  }, [targetUid])

  if (loading) return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 80, height: 80 }}>
        <svg width="80" height="80" viewBox="0 0 100 100" fill="none" style={{ animation: 'mr-spin-slow 10s linear infinite' }}>
          <circle cx="50" cy="50" r="46" stroke="var(--rule)" strokeWidth="1" />
          <circle cx="50" cy="50" r="36" stroke="var(--ink)" strokeWidth="1.5" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="22" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>
        <style>{`@keyframes mr-spin-slow { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  )

  if (notFound || !profile) return (
    <div className="paper-grain" dir="rtl" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 'clamp(34px,8vw,56px)', letterSpacing: '-0.025em', color: 'var(--ink)', margin: '0 0 16px' }}>
          Profile<br /><em style={{ fontWeight: 300, color: 'var(--alert)' }}>not found.</em>
        </h1>
        <button onClick={() => navigate(-1)} className="folio" style={{
          background: 'none', border: 'none', cursor: 'pointer', color: 'var(--burgundy)',
        }}>← العودة</button>
      </div>
    </div>
  )

  const viewerIsHost = viewerUid && profile.hosted_by?.[viewerUid]
  const showPhone = profile.phone && (isOwnProfile || !!viewerIsHost || profile.phone_visible === true)

  const duelCount = history.filter(h => h.type === 'duel').length
  const compCount = history.filter(h => h.type === 'competition').length
  const wins      = history.filter(h => h.type === 'duel' && (h.outcome === 'win' || h.outcome === 'win_forfeit')).length

  const roleLabel = { owner: 'OWNER', host: 'HOST', player: 'SCHOLAR' }[profile.role] || 'SCHOLAR'
  const roleColor = { owner: 'var(--gold)', host: 'var(--navy)', player: 'var(--ink-3)' }[profile.role] || 'var(--ink-3)'

  return (
    <div className="paper-grain" dir="rtl" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)', padding: '13px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button onClick={() => navigate(-1)} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--ink-3)',
        }}>← رجوع</button>

        <svg width={28} height={28} viewBox="0 0 100 100" fill="none" aria-label="Med Royale">
          <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>

        {isOwnProfile ? (
          <button onClick={() => navigate('/player/profile')} className="folio" style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--burgundy)', fontSize: 9,
          }}>EDIT →</button>
        ) : (
          <span className="folio">Public</span>
        )}
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 480, width: '100%', margin: '0 auto', padding: '40px 20px 60px' }}>

        {/* Avatar + name */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" style={{
              width: 88, height: 88, borderRadius: '50%',
              border: '2px solid var(--ink)', objectFit: 'cover', marginBottom: 12,
            }} />
          ) : (
            <div style={{
              width: 88, height: 88, borderRadius: '50%',
              border: '2px solid var(--rule-strong)', background: 'var(--paper-3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
            }}>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 500, color: 'var(--ink)' }}>
                {(profile.display_name || '?').slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
          <h1 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 26, color: 'var(--ink)', margin: '0 0 6px', textAlign: 'center' }}>
            {profile.display_name || 'لاعب مجهول'}
          </h1>
          <span className="folio" style={{ color: roleColor, fontSize: 9 }}>{roleLabel}</span>
        </div>

        {/* Phone */}
        {showPhone && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px', marginBottom: 24,
            border: '1px solid var(--rule)', borderBottomWidth: 2, background: 'var(--paper-2)',
          }}>
            <Phone size={14} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
            <div>
              <p className="folio" style={{ fontSize: 9, marginBottom: 3 }}>رقم الهاتف</p>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{profile.phone}</p>
            </div>
            {viewerIsHost && !profile.phone_visible && (
              <span className="folio" style={{ marginRight: 'auto', fontSize: 9, color: 'var(--ink-4)' }}>HOSTS ONLY</span>
            )}
          </div>
        )}

        {/* Stats */}
        {history.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 32 }}>
            {[
              { label: 'دوول', value: duelCount, color: 'var(--navy)' },
              { label: 'مسابقات', value: compCount, color: 'var(--burgundy)' },
              { label: 'انتصارات', value: wins, color: 'var(--success)' },
            ].map(s => (
              <div key={s.label} style={{ border: '1px solid var(--rule)', borderBottomWidth: 2, padding: '14px 10px', textAlign: 'center' }}>
                <p style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</p>
                <p className="ar" style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 5 }}>{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Game History ── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
            <span className="folio">سجل المباريات</span>
            <div style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
          </div>

          {history.length === 0 ? (
            <p className="ar" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ink-4)', fontSize: 14 }}>
              لم يلعب أي مباريات بعد
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
        display: 'flex', justifyContent: 'center',
      }}>
        <span className="folio">Med Royale · Profile</span>
      </footer>

    </div>
  )
}
