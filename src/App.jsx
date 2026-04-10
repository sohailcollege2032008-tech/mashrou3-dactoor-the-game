import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect, Component } from 'react'
import { useAuthStore } from './stores/authStore'
import Landing from './pages/Landing'
import AuthCallback from './pages/AuthCallback'
import NotAuthorized from './pages/NotAuthorized'
import ProtectedRoute from './components/auth/ProtectedRoute'
import OwnerDashboard from './pages/owner/OwnerDashboard'
import HostDashboard from './pages/host/HostDashboard'
import HostGameRoom from './pages/host/HostGameRoom'
import JoinGame from './pages/player/JoinGame'
import WaitingRoom from './pages/player/WaitingRoom'
import PlayerGameView from './pages/player/PlayerGameView'

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
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/not-authorized" element={<NotAuthorized />} />
        
        <Route path="/owner/dashboard" element={<ProtectedRoute allowedRoles={['owner']}><OwnerDashboard /></ProtectedRoute>} />
        <Route path="/host/dashboard" element={<ProtectedRoute allowedRoles={['owner', 'host']}><HostDashboard /></ProtectedRoute>} />
        <Route path="/host/game/:roomId" element={<ProtectedRoute allowedRoles={['owner', 'host']}><HostGameRoom /></ProtectedRoute>} />
        <Route path="/player/join" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><JoinGame /></ProtectedRoute>} />
        <Route path="/player/waiting/:roomId" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><WaitingRoom /></ProtectedRoute>} />
        <Route path="/player/game/:roomId" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><PlayerGameView /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
