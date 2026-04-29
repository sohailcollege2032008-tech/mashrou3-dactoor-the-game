import { useState, useEffect, useCallback } from 'react'
import { ref, get } from 'firebase/database'
import {
  collection, getDocs, orderBy, limit,
  query as fsQuery,
} from 'firebase/firestore'
import { rtdb, db } from '../../lib/firebase'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, RefreshCw, Trophy, Gamepad2, Swords, Loader2 } from 'lucide-react'

const TABS = [
  { id: 'games',       label: 'Games',      icon: Gamepad2 },
  { id: 'tournaments', label: 'Tournaments', icon: Trophy },
  { id: 'duels',       label: 'Duels',       icon: Swords },
]

function fmt(ts) {
  if (!ts) return '—'
  const d = ts?.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

function statusStyle(s) {
  if (!s) return { color: 'var(--ink-4)', borderColor: 'var(--rule)' }
  if (s === 'finished')                              return { color: 'var(--success)', borderColor: 'var(--success)' }
  if (s === 'playing' || s === 'question' || s === 'bracket') return { color: 'var(--navy)',    borderColor: 'var(--navy)' }
  if (s === 'lobby'   || s === 'waiting'  || s === 'registration') return { color: 'var(--gold)', borderColor: 'var(--gold)' }
  if (s === 'ffa'     || s === 'revealing')          return { color: 'var(--burgundy)', borderColor: 'var(--burgundy)' }
  return { color: 'var(--ink-4)', borderColor: 'var(--rule)' }
}

function StatusBadge({ status }) {
  const st = statusStyle(status)
  return (
    <span className="folio" style={{
      color: st.color, border: `1px solid ${st.borderColor}`,
      padding: '1px 8px', fontSize: 9,
    }}>
      {(status || '?').toUpperCase()}
    </span>
  )
}

// ── Info + Section helpers ─────────────────────────────────────────────────────
function Info({ label, value, mono = false }) {
  return (
    <div>
      <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: mono ? 'var(--mono)' : 'var(--sans)', fontSize: mono ? 11 : 13, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value ?? '—'}
      </div>
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div>
      <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid var(--rule)' }}>{label}</div>
      {children}
    </div>
  )
}

function groupByRound(matches) {
  const map = {}
  matches.forEach(m => {
    const r = m.round ?? 0
    if (!map[r]) map[r] = []
    map[r].push(m)
  })
  return Object.entries(map).sort(([a], [b]) => Number(a) - Number(b))
}

// ── Game Card ──────────────────────────────────────────────────────────────────
function GameCard({ room }) {
  const [open, setOpen] = useState(false)
  const players  = Object.values(room.players || {})
  const sorted   = [...players].sort((a, b) => (b.score || 0) - (a.score || 0))
  const qCount   = room.questions?.questions?.length ?? '?'
  const deckTitle = room.questions?.title || room.title || '—'

  return (
    <div style={{ border: '1px solid var(--rule)', background: 'var(--paper-2)', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <StatusBadge status={room.status} />
          <span style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {room.title || room.code}
          </span>
          <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9, flexShrink: 0 }}>#{room.code}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, marginLeft: 12 }}>
          <span className="folio" style={{ color: 'var(--ink-3)', fontSize: 9 }}>{players.length} PLAYERS</span>
          <span className="folio" style={{ color: 'var(--ink-3)', fontSize: 9 }}>{qCount} QS</span>
          <span style={{ color: 'var(--ink-4)' }}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </div>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--rule)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Meta */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <Info label="DECK" value={deckTitle} mono />
            <Info label="QUESTIONS" value={qCount} />
            <Info label="CREATED" value={fmt(room.created_at)} />
            <Info label="HOST ID" value={room.host_id} mono />
          </div>

          {/* Config */}
          {room.config && (
            <Section label="CONFIG">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {room.config.timer_seconds != null && (
                  <span className="folio" style={{ color: 'var(--ink-3)', border: '1px solid var(--rule)', padding: '1px 8px', fontSize: 9 }}>
                    TIMER: {room.config.timer_seconds}s
                  </span>
                )}
                {room.config.scoring_mode && (
                  <span className="folio" style={{ color: 'var(--ink-3)', border: '1px solid var(--rule)', padding: '1px 8px', fontSize: 9 }}>
                    MODE: {room.config.scoring_mode}
                  </span>
                )}
                {room.config.shuffle_questions && (
                  <span className="folio" style={{ color: 'var(--navy)', border: '1px solid var(--navy)', padding: '1px 8px', fontSize: 9 }}>
                    SHUFFLE QS
                  </span>
                )}
                {room.config.auto_accept && (
                  <span className="folio" style={{ color: 'var(--success)', border: '1px solid var(--success)', padding: '1px 8px', fontSize: 9 }}>
                    AUTO ACCEPT
                  </span>
                )}
              </div>
            </Section>
          )}

          {/* Leaderboard */}
          {sorted.length > 0 && (
            <Section label="FINAL LEADERBOARD">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sorted.map((p, i) => (
                  <div key={p.user_id || i} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '8px 12px', border: '1px solid var(--rule)',
                    background: i === 0 ? 'color-mix(in srgb, var(--gold) 5%, var(--paper))' : 'var(--paper)',
                  }}>
                    <span className="folio" style={{ color: 'var(--ink-4)', width: 20, textAlign: 'right', fontSize: 9 }}>{i + 1}</span>
                    <span style={{
                      fontFamily: 'var(--serif)', fontSize: 14, color: i === 0 ? 'var(--gold)' : 'var(--ink)',
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {p.nickname || p.user_id}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-2)' }}>
                      {p.score ?? 0} pts
                    </span>
                    {p.correct_count != null && (
                      <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>{p.correct_count} CORRECT</span>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tournament Card ────────────────────────────────────────────────────────────
function TournamentCard({ t, expanded, onExpand, detail }) {
  const loading = expanded && !detail

  return (
    <div style={{ border: '1px solid var(--rule)', background: 'var(--paper-2)', overflow: 'hidden' }}>
      <button
        onClick={onExpand}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <StatusBadge status={t.status} />
          <span style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.title || t.id}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, marginLeft: 12 }}>
          <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>{fmt(t.created_at)}</span>
          <span style={{ color: 'var(--ink-4)' }}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--rule)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <Info label="DECK"     value={t.deck_title || t.deck_id || '—'} mono />
            <Info label="TOP CUT"  value={t.actual_top_cut ?? '—'} />
            <Info label="ROUNDS"   value={t.total_rounds ?? '—'} />
            <Info label="HOST ID"  value={t.host_id} mono />
          </div>

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-3)' }}>
              <Loader2 size={13} className="animate-spin" />
              <span className="folio" style={{ fontSize: 9 }}>LOADING DETAILS…</span>
            </div>
          )}

          {detail && (
            <>
              {detail.registrations?.length > 0 && (
                <Section label={`REGISTRATIONS (${detail.registrations.length})`}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {detail.registrations.map(r => (
                      <span key={r.id} style={{
                        fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--ink-2)',
                        border: '1px solid var(--rule)', padding: '3px 10px',
                      }}>
                        {r.nickname || r.id}
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {detail.ffa_results?.length > 0 && (
                <Section label="FFA RESULTS">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {detail.ffa_results.map((p, i) => (
                      <div key={p.id || i} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '8px 12px', border: '1px solid var(--rule)',
                        background: p.advanced ? 'color-mix(in srgb, var(--success) 5%, var(--paper))' : 'var(--paper)',
                      }}>
                        <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9, width: 20, textAlign: 'right' }}>
                          #{p.rank ?? i + 1}
                        </span>
                        <span style={{
                          fontFamily: 'var(--serif)', fontSize: 14, flex: 1,
                          color: p.advanced ? 'var(--success)' : 'var(--ink)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {p.nickname || p.uid}
                        </span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-2)' }}>{p.score ?? 0} pts</span>
                        {p.correct_count != null && (
                          <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>{p.correct_count} CORRECT</span>
                        )}
                        {p.advanced && (
                          <span className="folio" style={{ color: 'var(--success)', border: '1px solid var(--success)', padding: '1px 6px', fontSize: 9 }}>ADVANCED</span>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {detail.bracket_matches?.length > 0 && (
                <Section label="BRACKET MATCHES">
                  {groupByRound(detail.bracket_matches).map(([round, matches]) => (
                    <div key={round} style={{ marginBottom: 12 }}>
                      <div className="folio" style={{ color: 'var(--ink-4)', fontSize: 9, marginBottom: 6 }}>ROUND {round}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {matches.map(m => (
                          <div key={m.id} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 12px', border: '1px solid var(--rule)', background: 'var(--paper)',
                          }}>
                            <StatusBadge status={m.status} />
                            <span style={{
                              fontFamily: 'var(--sans)', fontSize: 13,
                              color: m.winner_uid === m.player_a_uid ? 'var(--success)' : 'var(--ink-2)',
                              fontWeight: m.winner_uid === m.player_a_uid ? 600 : 400,
                            }}>
                              {m.player_a_name || m.player_a_uid || '?'}
                            </span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-4)' }}>vs</span>
                            <span style={{
                              fontFamily: 'var(--sans)', fontSize: 13,
                              color: m.winner_uid === m.player_b_uid ? 'var(--success)' : 'var(--ink-2)',
                              fontWeight: m.winner_uid === m.player_b_uid ? 600 : 400,
                            }}>
                              {m.player_b_name || m.player_b_uid || '?'}
                            </span>
                            {m.player_a_score != null && (
                              <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>
                                {m.player_a_score} – {m.player_b_score}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Duel Card ──────────────────────────────────────────────────────────────────
function DuelCard({ duel }) {
  const [open, setOpen] = useState(false)
  const players = Object.values(duel.players || {})
  const [pa, pb] = players

  function outcome() {
    if (duel.forfeit_by) {
      const winner = players.find(p => p.user_id !== duel.forfeit_by)
      return `${winner?.nickname || '?'} wins (forfeit)`
    }
    if (duel.surrender_by) return 'Draw (surrender)'
    if (!pa || !pb) return '—'
    if (pa.score > pb.score) return `${pa.nickname} wins`
    if (pb.score > pa.score) return `${pb.nickname} wins`
    return 'Tie'
  }

  return (
    <div style={{ border: '1px solid var(--rule)', background: 'var(--paper-2)', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <StatusBadge status={duel.status} />
          <span style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pa?.nickname || '?'} <span style={{ color: 'var(--ink-4)', fontWeight: 400, fontSize: 13 }}>vs</span> {pb?.nickname || '?'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, marginLeft: 12 }}>
          <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {duel.deck_title || '—'}
          </span>
          <span style={{ color: 'var(--ink-4)' }}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </div>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--rule)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <Info label="DECK"      value={duel.deck_title || duel.deck_id || '—'} mono />
            <Info label="QUESTIONS" value={duel.total_questions ?? duel.questions?.length ?? '?'} />
            <Info label="OUTCOME"   value={outcome()} />
            <Info label="CREATED"   value={fmt(duel.created_at)} />
          </div>

          {players.length > 0 && (
            <Section label="SCORES">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[...players].sort((a, b) => (b.score || 0) - (a.score || 0)).map((p, i) => (
                  <div key={p.user_id || i} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '8px 12px', border: '1px solid var(--rule)',
                    background: i === 0 ? 'color-mix(in srgb, var(--gold) 5%, var(--paper))' : 'var(--paper)',
                  }}>
                    <span style={{
                      fontFamily: 'var(--serif)', fontSize: 14, flex: 1,
                      color: i === 0 ? 'var(--gold)' : 'var(--ink)',
                    }}>
                      {p.nickname || p.user_id}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-2)' }}>{p.score ?? 0} pts</span>
                    {duel.forfeit_by === p.user_id && (
                      <span className="folio" style={{ color: 'var(--alert)', border: '1px solid var(--alert)', padding: '1px 6px', fontSize: 9 }}>FORFEIT</span>
                    )}
                    {duel.surrender_by === p.user_id && (
                      <span className="folio" style={{ color: 'var(--gold)', border: '1px solid var(--gold)', padding: '1px 6px', fontSize: 9 }}>SURRENDER</span>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function OwnerLogs() {
  const [activeTab,   setActiveTab]   = useState('games')
  const [games,       setGames]       = useState(null)
  const [tournaments, setTournaments] = useState(null)
  const [duels,       setDuels]       = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [tDetail,     setTDetail]     = useState({})
  const [expandedT,   setExpandedT]   = useState(null)

  const loadGames = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await get(ref(rtdb, 'rooms'))
      if (!snap.exists()) { setGames([]); return }
      const list = Object.entries(snap.val())
        .map(([code, room]) => ({ code, ...room }))
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      setGames(list)
    } catch (e) { console.error(e); setGames([]) }
    finally { setLoading(false) }
  }, [])

  const loadTournaments = useCallback(async () => {
    setLoading(true)
    try {
      const q = fsQuery(collection(db, 'tournaments'), orderBy('created_at', 'desc'), limit(200))
      const snap = await getDocs(q)
      setTournaments(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (e) { console.error(e); setTournaments([]) }
    finally { setLoading(false) }
  }, [])

  const loadDuels = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await get(ref(rtdb, 'duels'))
      if (!snap.exists()) { setDuels([]); return }
      const list = Object.entries(snap.val())
        .map(([id, duel]) => ({ id, ...duel }))
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      setDuels(list)
    } catch (e) { console.error(e); setDuels([]) }
    finally { setLoading(false) }
  }, [])

  const loadTournamentDetail = useCallback(async (id) => {
    if (tDetail[id]) return
    try {
      const [regSnap, ffaSnap, matchSnap] = await Promise.all([
        getDocs(collection(db, 'tournaments', id, 'registrations')),
        getDocs(collection(db, 'tournaments', id, 'ffa_results')),
        getDocs(collection(db, 'tournaments', id, 'bracket_matches')),
      ])
      setTDetail(prev => ({
        ...prev,
        [id]: {
          registrations:   regSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          ffa_results:     ffaSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
          bracket_matches: matchSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.round ?? 0) - (b.round ?? 0) || (a.match_number ?? 0) - (b.match_number ?? 0)),
        }
      }))
    } catch (e) { console.error(e) }
  }, [tDetail])

  useEffect(() => {
    if (activeTab === 'games'       && games       === null) loadGames()
    if (activeTab === 'tournaments' && tournaments === null) loadTournaments()
    if (activeTab === 'duels'       && duels       === null) loadDuels()
  }, [activeTab, games, tournaments, duels, loadGames, loadTournaments, loadDuels])

  function handleRefresh() {
    if (activeTab === 'games')       { setGames(null);       loadGames() }
    if (activeTab === 'tournaments') { setTournaments(null); loadTournaments() }
    if (activeTab === 'duels')       { setDuels(null);       loadDuels() }
  }

  function handleExpandTournament(id) {
    if (expandedT === id) { setExpandedT(null); return }
    setExpandedT(id)
    loadTournamentDetail(id)
  }

  const currentData = activeTab === 'games' ? games : activeTab === 'tournaments' ? tournaments : duels

  return (
    <div className="paper-grain" style={{ minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: '0 0 64px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px' }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '28px 0 20px', borderBottom: '2px solid var(--ink)', flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 4 }}>OWNER PANEL</div>
            <h1 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 28, margin: 0, letterSpacing: '-0.015em' }}>
              Activity Logs
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleRefresh} disabled={loading}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', border: '1px solid var(--rule)', borderRadius: 4,
                background: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: 'var(--ink-3)', opacity: loading ? 0.5 : 1, transition: 'all 150ms',
              }}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <Link
              to="/owner/dashboard"
              style={{
                padding: '8px 14px', border: '1px solid var(--rule)', borderRadius: 4,
                fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: 'var(--ink-3)', textDecoration: 'none', transition: 'all 150ms',
              }}
            >
              Dashboard
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--rule)', marginTop: 28, marginBottom: 20 }}>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px',
                border: 'none', borderBottom: activeTab === id ? '2px solid var(--ink)' : '2px solid transparent',
                background: 'none', cursor: 'pointer',
                fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: activeTab === id ? 'var(--ink)' : 'var(--ink-4)',
                transition: 'all 150ms',
              }}
            >
              <Icon size={13} />
              {label}
              {activeTab === id && currentData != null && (
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--ink-3)',
                  background: 'var(--paper-2)', border: '1px solid var(--rule)',
                  padding: '0 5px', borderRadius: 10,
                }}>
                  {currentData.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading && currentData === null ? (
            <div style={{ textAlign: 'center', padding: '64px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Loader2 size={16} className="animate-spin" style={{ color: 'var(--ink-3)' }} />
              <span className="folio" style={{ color: 'var(--ink-4)' }}>LOADING LOGS…</span>
            </div>
          ) : currentData?.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '64px 0' }}>
              <p style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 16, color: 'var(--ink-3)' }}>
                No {activeTab} found.
              </p>
            </div>
          ) : (
            <>
              {activeTab === 'games' && games?.map(room => (
                <GameCard key={room.code} room={room} />
              ))}
              {activeTab === 'tournaments' && tournaments?.map(t => (
                <TournamentCard
                  key={t.id} t={t}
                  expanded={expandedT === t.id}
                  onExpand={() => handleExpandTournament(t.id)}
                  detail={tDetail[t.id] || null}
                />
              ))}
              {activeTab === 'duels' && duels?.map(duel => (
                <DuelCard key={duel.id} duel={duel} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
