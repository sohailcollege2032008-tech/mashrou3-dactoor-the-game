import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from './stores/authStore'
import Landing from './pages/Landing'
import AuthCallback from './pages/AuthCallback'
import NotAuthorized from './pages/NotAuthorized'
import ProtectedRoute from './components/auth/ProtectedRoute'
import OwnerDashboard from './pages/owner/OwnerDashboard'
import HostDashboard from './pages/host/HostDashboard'
import HostGameRoom from './pages/host/HostGameRoom'
import JoinGame from './pages/player/JoinGame'
import PlayerDashboard from './pages/player/PlayerDashboard'
import PlayerProfile from './pages/player/PlayerProfile'
import WaitingRoom from './pages/player/WaitingRoom'
import PlayerGameView from './pages/player/PlayerGameView'

export default function App() {
  useEffect(() => {
    useAuthStore.getState().initialize()
  }, [])
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/not-authorized" element={<NotAuthorized />} />
        
        <Route path="/owner/dashboard" element={<ProtectedRoute allowedRoles={['owner']}><OwnerDashboard /></ProtectedRoute>} />
        <Route path="/host/dashboard" element={<ProtectedRoute allowedRoles={['owner', 'host']}><HostDashboard /></ProtectedRoute>} />
        <Route path="/host/game/:roomId" element={<ProtectedRoute allowedRoles={['owner', 'host']}><HostGameRoom /></ProtectedRoute>} />
        <Route path="/player/dashboard" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><PlayerDashboard /></ProtectedRoute>} />
        <Route path="/player/profile" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><PlayerProfile /></ProtectedRoute>} />
        <Route path="/player/join" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><JoinGame /></ProtectedRoute>} />
        <Route path="/player/waiting/:roomId" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><WaitingRoom /></ProtectedRoute>} />
        <Route path="/player/game/:roomId" element={<ProtectedRoute allowedRoles={['player', 'host', 'owner']}><PlayerGameView /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  )
}
