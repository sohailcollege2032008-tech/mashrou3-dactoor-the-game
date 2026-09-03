import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect, Component, lazy, Suspense } from 'react'
import FullscreenButton from './components/FullscreenButton'
import ThemeToggle from './components/ThemeToggle'
import SoundPreviewModal from './components/common/SoundPreviewModal'
import { useAuthStore } from './stores/authStore'
import ProtectedRoute from './components/auth/ProtectedRoute'

/**
 * A route chunk that 404s is almost never a missing file — it is a deploy that
 * happened while this tab was open. The tab is holding the old build's manifest
 * and asks for `TournamentLive-<oldhash>.js`, which no longer exists, so the
 * navigation dies on an import error and the user sees the error boundary.
 *
 * This cost an hour of chasing a phantom regression: a test suite failed
 * looking for a button on a page whose chunk had just been replaced under it.
 * During a live tournament it would cost the host their control panel.
 *
 * So: reload once, which fetches the new manifest, and remember that we did —
 * a chunk that is genuinely gone must not put the tab in a reload loop. The
 * marker is cleared by the next chunk that loads normally, so a later deploy
 * gets its own retry.
 */
const CHUNK_RELOAD_KEY = 'mr-chunk-reload'

function lazyRoute(factory) {
  return lazy(() => factory().then(
    mod => {
      try { sessionStorage.removeItem(CHUNK_RELOAD_KEY) } catch { /* private mode */ }
      return mod
    },
    err => {
      let alreadyTried = true
      try {
        alreadyTried = sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1'
        if (!alreadyTried) sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
      } catch { /* storage blocked — fall through to the error boundary */ }
      if (!alreadyTried) {
        window.location.reload()
        // Never resolves: the reload is on its way and rendering the error
        // boundary for a tenth of a second would only flash.
        return new Promise(() => {})
      }
      throw err
    },
  ))
}

// ── Lazy-loaded Route Components ───────────────────────────────────────────
const Landing = lazyRoute(() => import('./pages/Landing'))
const AuthCallback = lazyRoute(() => import('./pages/AuthCallback'))
const NotAuthorized = lazyRoute(() => import('./pages/NotAuthorized'))
const SoundTest = lazyRoute(() => import('./pages/owner/SoundTest'))
const TestMathRendering = lazyRoute(() => import('./pages/TestMathRendering'))

// Owner Routes
const OwnerDashboard = lazyRoute(() => import('./pages/owner/OwnerDashboard'))
const OwnerLogs = lazyRoute(() => import('./pages/owner/OwnerLogs'))

// Host Routes
const HostDashboard = lazyRoute(() => import('./pages/host/HostDashboard'))
const HostGameRoom = lazyRoute(() => import('./pages/host/HostGameRoom'))

// Player Routes
const JoinGame = lazyRoute(() => import('./pages/player/JoinGame'))
const PlayerDashboard = lazyRoute(() => import('./pages/player/PlayerDashboard'))
const PlayerProfile = lazyRoute(() => import('./pages/player/PlayerProfile'))
const WaitingRoom = lazyRoute(() => import('./pages/player/WaitingRoom'))
const PlayerGameView = lazyRoute(() => import('./pages/player/PlayerGameView'))
const DeckBrowser = lazyRoute(() => import('./pages/player/DeckBrowser'))
const PublicProfile = lazyRoute(() => import('./pages/player/PublicProfile'))

// Duel Routes
const DuelLobby = lazyRoute(() => import('./pages/duel/DuelLobby'))
const DuelGame = lazyRoute(() => import('./pages/duel/DuelGame'))
const DuelResults = lazyRoute(() => import('./pages/duel/DuelResults'))

// Tournament Routes
const TournamentCreate = lazyRoute(() => import('./pages/tournament/TournamentCreate'))
const TournamentLobby = lazyRoute(() => import('./pages/tournament/TournamentLobby'))
const TournamentJoin = lazyRoute(() => import('./pages/tournament/TournamentJoin'))
const TournamentBracket = lazyRoute(() => import('./pages/tournament/TournamentBracket'))
const TournamentPlayerWait = lazyRoute(() => import('./pages/tournament/TournamentPlayerWait'))
const TournamentDuelWrapper = lazyRoute(() => import('./pages/tournament/TournamentDuelWrapper'))
const TournamentLive = lazyRoute(() => import('./pages/tournament/TournamentLive'))

// ── Minimalist Brand-Aligned Route Fallback ────────────────────────────────
function PageLoader() {
  return (
    <div style={{
      minHeight: '100svh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--paper)',
      color: 'var(--ink)',
      gap: 16
    }}>
      <div style={{
        width: 36,
        height: 36,
        border: '2px solid var(--rule)',
        borderTopColor: 'var(--ink)',
        borderRadius: '50%',
        animation: 'mr-spin 0.8s linear infinite'
      }} />
      <span className="folio" style={{ letterSpacing: '0.15em' }}>MED ROYALE</span>
    </div>
  )
}

// ── Global Error Boundary — prevents blank screen on unexpected render errors ──
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null } }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) { console.error('App crashed:', error, info) }
  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center font-sans">
        <div className="max-w-md space-y-4">
          <p className="text-5xl">⚠️</p>
          <h1 className="text-xl font-bold text-white">حصل خطأ غير متوقع</h1>
          <p className="text-gray-400 text-sm font-mono break-words">{this.state.error?.message}</p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload() }}
            className="mt-4 px-6 py-3 bg-primary text-background font-bold rounded-xl hover:bg-[#00D4FF] transition-colors"
          >
            🔄 إعادة تحميل الصفحة
          </button>
        </div>
      </div>
    )
  }
}

export default function App() {
  useEffect(() => {
    useAuthStore.getState().initialize()
  }, [])

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeToggle />
        <FullscreenButton />
        <SoundPreviewModal />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/sound-test" element={<SoundTest />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/not-authorized" element={<NotAuthorized />} />
            <Route path="/test-math" element={<TestMathRendering />} />
            
            <Route path="/owner/dashboard" element={<ProtectedRoute allowedRoles={['owner']}><OwnerDashboard /></ProtectedRoute>} />
            <Route path="/owner/logs" element={<ProtectedRoute allowedRoles={['owner']}><OwnerLogs /></ProtectedRoute>} />
            <Route path="/host/dashboard" element={<ProtectedRoute allowedRoles={['owner', 'host']}><HostDashboard /></ProtectedRoute>} />
            <Route path="/host/game/:roomId" element={<ProtectedRoute allowedRoles={['owner', 'host']}><HostGameRoom /></ProtectedRoute>} />
            <Route path="/player/dashboard" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><PlayerDashboard /></ProtectedRoute>} />
            <Route path="/player/profile" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><PlayerProfile /></ProtectedRoute>} />
            <Route path="/player/join" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><JoinGame /></ProtectedRoute>} />
            <Route path="/player/waiting/:roomId" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><WaitingRoom /></ProtectedRoute>} />
            <Route path="/player/game/:roomId" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><PlayerGameView /></ProtectedRoute>} />
            <Route path="/player/decks" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><DeckBrowser /></ProtectedRoute>} />
            <Route path="/player/profile/:uid" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><PublicProfile /></ProtectedRoute>} />
            <Route path="/duel/lobby/:duelId" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><DuelLobby /></ProtectedRoute>} />
            <Route path="/duel/game/:duelId" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><DuelGame /></ProtectedRoute>} />
            <Route path="/duel/results/:duelId" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><DuelResults /></ProtectedRoute>} />

            {/* ── Tournament routes ─────────────────────────────────────────── */}
            <Route path="/tournament/create" element={<ProtectedRoute allowedRoles={['owner', 'host']}><TournamentCreate /></ProtectedRoute>} />
            <Route path="/tournament/join" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><TournamentJoin /></ProtectedRoute>} />
            <Route path="/tournament/:tournamentId/lobby" element={<ProtectedRoute allowedRoles={['owner', 'host']}><TournamentLobby /></ProtectedRoute>} />
            <Route path="/tournament/:tournamentId/bracket" element={<ProtectedRoute allowedRoles={['owner', 'host']}><TournamentBracket /></ProtectedRoute>} />
            <Route path="/tournament/:tournamentId/wait" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><TournamentPlayerWait /></ProtectedRoute>} />
            <Route path="/tournament/:tournamentId/duel/:matchId" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><TournamentDuelWrapper /></ProtectedRoute>} />
            <Route path="/tournament/:tournamentId/live" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><TournamentLive /></ProtectedRoute>} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

