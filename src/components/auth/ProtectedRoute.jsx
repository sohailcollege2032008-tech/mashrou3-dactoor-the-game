import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'

export default function ProtectedRoute({ children, allowedRoles }) {
  const session = useAuthStore(state => state.session)
  const profile = useAuthStore(state => state.profile)
  const loading = useAuthStore(state => state.loading)

  // Still initializing
  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#0A0E1A]" dir="rtl">
        <div className="text-[#00F5A0] animate-pulse font-mono text-xl">جاري التحميل...</div>
      </div>
    )
  }

  // Not authenticated → back to landing
  if (!session) {
    return <Navigate to="/" replace />
  }

  // Session exists but profile still loading (shouldn't happen with new useAuth, but safety net)
  if (!profile) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#0A0E1A]" dir="rtl">
        <div className="text-[#00F5A0] animate-pulse font-mono text-xl">جاري تحميل الملف الشخصي...</div>
      </div>
    )
  }

  // Role check
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/not-authorized" replace />
  }

  return children
}
