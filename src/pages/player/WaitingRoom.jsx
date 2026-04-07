import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export default function WaitingRoom() {
  const { roomId } = useParams()
  const { session } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState('pending')

  useEffect(() => {
    const checkStatus = async () => {
      const { data, error } = await supabase
        .from('join_requests')
        .select('status')
        .eq('room_id', roomId)
        .eq('player_id', session.user.id)
        .maybeSingle()
      
      if (error) {
        console.error('[WaitingRoom] Error checking status:', error)
      } else if (data) {
        setStatus(data.status)
        if (data.status === 'approved') navigate(`/player/game/${roomId}`)
      }
    }
    checkStatus()

    const sub = supabase.channel(`join_req_${session.user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'join_requests',
        filter: `player_id=eq.${session.user.id}`
      }, (payload) => {
        if (payload.new.room_id === roomId) {
          setStatus(payload.new.status)
          if (payload.new.status === 'approved') {
            navigate(`/player/game/${roomId}`)
          }
        }
      }).subscribe()

    return () => {
      supabase.removeChannel(sub)
    }
  }, [roomId, session, navigate])

  return (
    <div className="flex h-screen items-center justify-center bg-background text-center p-6">
      <div className="space-y-6">
        {status === 'pending' && <div className="w-24 h-24 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>}
        <h1 className="text-3xl font-display font-bold text-white">
          {status === 'pending' ? 'Waiting for Host Approval...' : status === 'rejected' ? 'Request Rejected' : 'Loading Game...'}
        </h1>
        <p className="text-lg text-gray-400 font-sans">
          {status === 'pending' ? 'The host must verify your identity before you can join the room.' : 'You can close this window if your request was rejected.'}
        </p>
      </div>
    </div>
  )
}
