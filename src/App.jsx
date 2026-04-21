import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect, Component } from 'react'
import FullscreenButton from './components/FullscreenButton'
import { useAuthStore } from './stores/authStore'
import Landing from './pages/Landing'
import AuthCallback from './pages/AuthCallback'
import NotAuthorized from './pages/NotAuthorized'
import ProtectedRoute from './components/auth/ProtectedRoute'
import OwnerDashboard from './pages/owner/OwnerDashboard'
import OwnerLogs from './pages/owner/OwnerLogs'
import HostDashboard from './pages/host/HostDashboard'
import HostGameRoom from './pages/host/HostGameRoom'
import JoinGame from './pages/player/JoinGame'
import PlayerDashboard from './pages/player/PlayerDashboard'
import PlayerProfile from './pages/player/PlayerProfile'
import WaitingRoom from './pages/player/WaitingRoom'
import PlayerGameView from './pages/player/PlayerGameView'
import DeckBrowser from './pages/player/DeckBrowser'
import PublicProfile from './pages/player/PublicProfile'
import DuelLobby from './pages/duel/DuelLobby'
import DuelGame from './pages/duel/DuelGame'
import DuelResults from './pages/duel/DuelResults'
import TournamentCreate from './pages/tournament/TournamentCreate'
import TournamentLobby from './pages/tournament/TournamentLobby'
import TournamentJoin from './pages/tournament/TournamentJoin'
import TournamentBracket from './pages/tournament/TournamentBracket'
import TournamentPlayerWait from './pages/tournament/TournamentPlayerWait'
import TournamentDuelWrapper from './pages/tournament/TournamentDuelWrapper'

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
      <FullscreenButton />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/not-authorized" element={<NotAuthorized />} />
        
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
    </BrowserRouter>
    </ErrorBoundary>
  )
}
