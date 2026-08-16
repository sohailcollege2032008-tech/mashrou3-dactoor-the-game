import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect, Component, lazy, Suspense } from 'react'
import FullscreenButton from './components/FullscreenButton'
import ThemeToggle from './components/ThemeToggle'
import SoundPreviewModal from './components/common/SoundPreviewModal'
import { useAuthStore } from './stores/authStore'
import ProtectedRoute from './components/auth/ProtectedRoute'

// ── Lazy-loaded Route Components ───────────────────────────────────────────
const Landing = lazy(() => import('./pages/Landing'))
const AuthCallback = lazy(() => import('./pages/AuthCallback'))
const NotAuthorized = lazy(() => import('./pages/NotAuthorized'))
const SoundTest = lazy(() => import('./pages/owner/SoundTest'))
const TestMathRendering = lazy(() => import('./pages/TestMathRendering'))

// Owner Routes
const OwnerDashboard = lazy(() => import('./pages/owner/OwnerDashboard'))
const OwnerLogs = lazy(() => import('./pages/owner/OwnerLogs'))

// Host Routes
const HostDashboard = lazy(() => import('./pages/host/HostDashboard'))
const HostGameRoom = lazy(() => import('./pages/host/HostGameRoom'))

// Player Routes
const JoinGame = lazy(() => import('./pages/player/JoinGame'))
const PlayerDashboard = lazy(() => import('./pages/player/PlayerDashboard'))
const PlayerProfile = lazy(() => import('./pages/player/PlayerProfile'))
const WaitingRoom = lazy(() => import('./pages/player/WaitingRoom'))
const PlayerGameView = lazy(() => import('./pages/player/PlayerGameView'))
const DeckBrowser = lazy(() => import('./pages/player/DeckBrowser'))
const PublicProfile = lazy(() => import('./pages/player/PublicProfile'))

// Duel Routes
const DuelLobby = lazy(() => import('./pages/duel/DuelLobby'))
const DuelGame = lazy(() => import('./pages/duel/DuelGame'))
const DuelResults = lazy(() => import('./pages/duel/DuelResults'))

// Tournament Routes
const TournamentCreate = lazy(() => import('./pages/tournament/TournamentCreate'))
const TournamentLobby = lazy(() => import('./pages/tournament/TournamentLobby'))
const TournamentJoin = lazy(() => import('./pages/tournament/TournamentJoin'))
const TournamentBracket = lazy(() => import('./pages/tournament/TournamentBracket'))
const TournamentPlayerWait = lazy(() => import('./pages/tournament/TournamentPlayerWait'))
const TournamentDuelWrapper = lazy(() => import('./pages/tournament/TournamentDuelWrapper'))

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
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

