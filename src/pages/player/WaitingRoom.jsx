import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ref, onValue, get } from 'firebase/database'
import { rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'

export default function WaitingRoom() {
  const { roomId } = useParams()   // roomId = room code
  const { session } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState('pending')
  const [roomStatus, setRoomStatus] = useState('lobby')

  // Watch room status to detect if game started while waiting
  useEffect(() => {
    const unsub = onValue(ref(rtdb, `rooms/${roomId}/status`), snap => {
      if (snap.exists()) setRoomStatus(snap.val())
    })
    return () => unsub()
  }, [roomId])

  useEffect(() => {
    if (!session) return
    const userId = session.uid

    // Initial check
    get(ref(rtdb, `rooms/${roomId}/join_requests/${userId}`)).then(snap => {
      if (snap.exists()) {
        const data = snap.val()
        setStatus(data.status)
        if (data.status === 'approved') navigate(`/player/game/${roomId}`)
      }
    })

    // Listen for status changes
    const reqRef = ref(rtdb, `rooms/${roomId}/join_requests/${userId}/status`)
    const unsubscribe = onValue(reqRef, (snap) => {
      if (!snap.exists()) return
      const newStatus = snap.val()
      setStatus(newStatus)
      if (newStatus === 'approved') {
        navigate(`/player/game/${roomId}`)
      }
    })

    return () => unsubscribe()
  }, [roomId, session, navigate])

  const gameInProgress = roomStatus === 'playing' || roomStatus === 'revealing'

  return (
    <div className="flex h-screen items-center justify-center bg-background text-center p-6">
      <div className="space-y-6 max-w-sm w-full">
        {status === 'pending' && (
          <div className="w-24 h-24 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        )}
        <h1 className="text-3xl font-display font-bold text-white">
          {status === 'pending'
            ? 'في انتظار موافقة الهوست...'
            : status === 'rejected'
            ? 'تم رفض الطلب'
            : 'جاري الدخول...'}
        </h1>

        {status === 'pending' && gameInProgress && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-2xl px-5 py-4 text-sm text-orange-300 space-y-1">
            <p className="font-bold">الجيم بدأ فعلاً!</p>
            <p className="text-orange-300/70">لو الهوست قبلك هتدخل وتحل الأسئلة الباقية.</p>
          </div>
        )}

        {status === 'pending' && !gameInProgress && (
          <p className="text-lg text-gray-400 font-sans">
            الهوست لازم يوافق عليك الأول عشان تدخل.
          </p>
        )}

        {status === 'rejected' && (
          <p className="text-lg text-gray-400 font-sans">
            ممكن تقفل الصفحة دي.
          </p>
        )}

      </div>
    </div>
  )
}
