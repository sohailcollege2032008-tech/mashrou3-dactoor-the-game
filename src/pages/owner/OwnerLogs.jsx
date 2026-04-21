import { useState, useEffect, useCallback } from 'react'
import { ref, get } from 'firebase/database'
import {
  collection, getDocs, orderBy, limit,
  query as fsQuery, doc, getDoc
} from 'firebase/firestore'
import { rtdb, db } from '../../lib/firebase'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, RefreshCw, Trophy, Gamepad2, Swords } from 'lucide-react'

const TABS = [
  { id: 'games',       label: 'Games',       icon: Gamepad2 },
  { id: 'tournaments', label: 'Tournaments',  icon: Trophy },
  { id: 'duels',       label: 'Duels',        icon: Swords },
]

function fmt(ts) {
  if (!ts) return '—'
  const d = ts?.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

function Badge({ color = 'gray', children }) {
  const palette = {
    green:  'bg-green-500/20 text-green-400 border-green-500/30',
    red:    'bg-red-500/20 text-red-400 border-red-500/30',
    yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    blue:   'bg-blue-500/20 text-blue-400 border-blue-500/30',
    cyan:   'bg-primary/20 text-primary border-primary/30',
    gray:   'bg-gray-700/60 text-gray-400 border-gray-600/40',
  }
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${palette[color]}`}>
      {children}
    </span>
  )
}

function statusColor(s) {
  if (!s) return 'gray'
  if (s === 'finished') return 'green'
  if (s === 'playing' || s === 'question' || s === 'bracket') return 'cyan'
  if (s === 'lobby' || s === 'waiting' || s === 'registration') return 'yellow'
  if (s === 'ffa' || s === 'revealing') return 'blue'
  return 'gray'
}

// ── Game Log Card ──────────────────────────────────────────────────────────────
function GameCard({ room }) {
  const [open, setOpen] = useState(false)
  const players = Object.values(room.players || {})
  const sorted  = [...players].sort((a, b) => (b.score || 0) - (a.score || 0))
  const qCount  = room.questions?.questions?.length ?? '?'
  const deckTitle = room.questions?.title || room.title || '—'

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800/40 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Badge color={statusColor(room.status)}>{room.status || '?'}</Badge>
          <span className="font-bold text-white truncate">{room.title || room.code}</span>
          <span className="text-gray-500 font-mono text-xs hidden sm:block">#{room.code}</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400 shrink-0">
          <span>{players.length} players</span>
          <span>{qCount} Qs</span>
          <span className="hidden md:block">{fmt(room.created_at)}</span>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-800 px-5 py-4 space-y-4">
          {/* Meta */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Info label="Deck" value={deckTitle} mono />
            <Info label="Questions" value={qCount} />
            <Info label="Created" value={fmt(room.created_at)} />
            <Info label="Host ID" value={room.host_id} mono />
          </div>

          {/* Config */}
          {room.config && (
            <div>
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">Config</p>
              <div className="flex flex-wrap gap-2">
                {room.config.timer_seconds != null && <Badge color="gray">Timer: {room.config.timer_seconds}s</Badge>}
                {room.config.scoring_mode && <Badge color="gray">Mode: {room.config.scoring_mode}</Badge>}
                {room.config.shuffle_questions && <Badge color="blue">Shuffle Qs</Badge>}
                {room.config.shuffle_choices && <Badge color="blue">Shuffle Choices</Badge>}
                {room.config.auto_mode && <Badge color="cyan">Auto Mode</Badge>}
                {room.config.auto_accept && <Badge color="green">Auto Accept</Badge>}
              </div>
            </div>
          )}

          {/* Leaderboard */}
          {sorted.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">Final Leaderboard</p>
              <div className="space-y-1">
                {sorted.map((p, i) => (
                  <div key={p.user_id || i} className="flex items-center gap-3 text-sm py-1.5 px-3 rounded-lg bg-gray-800/40">
                    <span className="w-6 text-gray-500 font-mono text-xs text-right">{i + 1}</span>
                    <span className={`font-bold truncate flex-1 ${i === 0 ? 'text-yellow-400' : 'text-white'}`}>
                      {p.nickname || p.user_id}
                    </span>
                    <span className="font-mono text-primary">{p.score ?? 0} pts</span>
                    {p.correct_count != null && (
                      <span className="text-gray-400 text-xs">{p.correct_count} correct</span>
                    )}
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

// ── Tournament Log Card ────────────────────────────────────────────────────────
function TournamentCard({ t, expanded, onExpand, detail }) {
  const loading = expanded && !detail

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={onExpand}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800/40 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Badge color={statusColor(t.status)}>{t.status || '?'}</Badge>
          <span className="font-bold text-white truncate">{t.title || t.id}</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400 shrink-0">
          <span className="hidden md:block">{fmt(t.created_at)}</span>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-800 px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Info label="Deck" value={t.deck_title || t.deck_id || '—'} mono />
            <Info label="Top Cut" value={t.actual_top_cut ?? '—'} />
            <Info label="Rounds" value={t.total_rounds ?? '—'} />
            <Info label="Created by" value={t.created_by} mono />
          </div>

          {loading && <p className="text-primary animate-pulse text-sm font-mono">Loading details…</p>}

          {detail && (
            <>
              {/* Registrations */}
              {detail.registrations?.length > 0 && (
                <Section label={`Registrations (${detail.registrations.length})`}>
                  <div className="flex flex-wrap gap-2">
                    {detail.registrations.map(r => (
                      <span key={r.id} className="px-2.5 py-1 bg-gray-800 rounded-lg text-xs text-gray-300">
                        {r.nickname || r.id}
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {/* FFA Results */}
              {detail.ffa_results?.length > 0 && (
                <Section label="FFA Results">
                  <div className="space-y-1">
                    {detail.ffa_results.map((p, i) => (
                      <div key={p.id || i} className="flex items-center gap-3 text-sm py-1.5 px-3 rounded-lg bg-gray-800/40">
                        <span className="w-5 text-gray-500 font-mono text-xs text-right">#{p.rank ?? i + 1}</span>
                        <span className={`font-bold flex-1 truncate ${p.advanced ? 'text-green-400' : 'text-white'}`}>
                          {p.nickname || p.uid}
                        </span>
                        <span className="font-mono text-primary">{p.score ?? 0} pts</span>
                        {p.correct_count != null && <span className="text-gray-400 text-xs">{p.correct_count}✓</span>}
                        {p.advanced && <Badge color="green">Advanced</Badge>}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Bracket Matches by Round */}
              {detail.bracket_matches?.length > 0 && (
                <Section label="Bracket Matches">
                  {groupByRound(detail.bracket_matches).map(([round, matches]) => (
                    <div key={round} className="mb-3">
                      <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Round {round}</p>
                      <div className="space-y-1">
                        {matches.map(m => (
                          <div key={m.id} className="flex items-center gap-2 text-sm py-1.5 px-3 rounded-lg bg-gray-800/40">
                            <Badge color={statusColor(m.status)}>{m.status || '?'}</Badge>
                            <span className={m.winner_uid === m.player_a_uid ? 'text-green-400 font-bold' : 'text-gray-300'}>
                              {m.player_a_name || m.player_a_uid || '?'}
                            </span>
                            <span className="text-gray-600">vs</span>
                            <span className={m.winner_uid === m.player_b_uid ? 'text-green-400 font-bold' : 'text-gray-300'}>
                              {m.player_b_name || m.player_b_uid || '?'}
                            </span>
                            {m.player_a_score != null && (
                              <span className="ml-auto text-primary font-mono text-xs">
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

// ── Duel Log Card ──────────────────────────────────────────────────────────────
function DuelCard({ duel }) {
  const [open, setOpen] = useState(false)
  const players = Object.values(duel.players || {})
  const [pa, pb] = players

  function outcome() {
    if (duel.forfeit_by) {
      const loser = players.find(p => p.user_id === duel.forfeit_by)
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
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800/40 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Badge color={statusColor(duel.status)}>{duel.status || '?'}</Badge>
          <span className="font-bold text-white truncate">
            {pa?.nickname || '?'} <span className="text-gray-500">vs</span> {pb?.nickname || '?'}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400 shrink-0">
          <span className="hidden sm:block text-xs truncate max-w-32">{duel.deck_title || '—'}</span>
          <span className="hidden md:block">{fmt(duel.created_at)}</span>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-800 px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Info label="Deck" value={duel.deck_title || duel.deck_id || '—'} mono />
            <Info label="Questions" value={duel.total_questions ?? duel.questions?.length ?? '?'} />
            <Info label="Outcome" value={outcome()} />
            <Info label="Created" value={fmt(duel.created_at)} />
          </div>

          {/* Players scores */}
          {players.length > 0 && (
            <Section label="Scores">
              <div className="space-y-1">
                {[...players].sort((a,b)=>(b.score||0)-(a.score||0)).map((p, i) => (
                  <div key={p.user_id || i} className="flex items-center gap-3 text-sm py-1.5 px-3 rounded-lg bg-gray-800/40">
                    <span className={`font-bold flex-1 ${i===0 ? 'text-yellow-400' : 'text-white'}`}>
                      {p.nickname || p.user_id}
                    </span>
                    <span className="font-mono text-primary">{p.score ?? 0} pts</span>
                    {duel.forfeit_by === p.user_id && <Badge color="red">Forfeit</Badge>}
                    {duel.surrender_by === p.user_id && <Badge color="yellow">Surrender</Badge>}
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

// ── Helpers ────────────────────────────────────────────────────────────────────
function Info({ label, value, mono = false }) {
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-widest mb-0.5">{label}</p>
      <p className={`text-sm text-gray-200 truncate ${mono ? 'font-mono text-xs' : ''}`}>{value ?? '—'}</p>
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">{label}</p>
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
  return Object.entries(map).sort(([a],[b]) => Number(a) - Number(b))
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function OwnerLogs() {
  const [activeTab, setActiveTab] = useState('games')
  const [games,       setGames]       = useState(null)
  const [tournaments, setTournaments] = useState(null)
  const [duels,       setDuels]       = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [tDetail,     setTDetail]     = useState({})   // { [tId]: { ffa_results, bracket_matches, registrations } }
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

  // Load data when switching tabs
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
    <div className="min-h-screen bg-background text-white p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <header className="flex flex-wrap justify-between items-center gap-4 bg-gray-900/50 p-5 rounded-2xl border border-gray-800 backdrop-blur-sm">
          <div>
            <h1 className="text-2xl font-display font-bold text-primary">Activity Logs</h1>
            <p className="text-gray-400 text-sm mt-1 font-sans">Full audit trail — games, tournaments, duels</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all text-sm font-bold disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <Link
              to="/owner/dashboard"
              className="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 transition-all text-sm"
            >
              ← Dashboard
            </Link>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-900/50 p-1 rounded-xl border border-gray-800">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${
                activeTab === id
                  ? 'bg-primary text-background shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
              }`}
            >
              <Icon size={15} />
              {label}
              {activeTab === id && currentData != null && (
                <span className="bg-background/30 text-xs px-1.5 py-0.5 rounded-full font-mono">
                  {currentData.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="space-y-3">
          {loading && currentData === null ? (
            <div className="text-center py-16 text-primary animate-pulse font-mono">Loading logs…</div>
          ) : currentData?.length === 0 ? (
            <div className="text-center py-16 text-gray-600 font-mono">No {activeTab} found.</div>
          ) : (
            <>
              {activeTab === 'games' && games?.map(room => (
                <GameCard key={room.code} room={room} />
              ))}

              {activeTab === 'tournaments' && tournaments?.map(t => (
                <TournamentCard
                  key={t.id}
                  t={t}
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
