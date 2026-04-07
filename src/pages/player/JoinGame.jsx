import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export default function JoinGame() {
  const { profile, session } = useAuth()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleJoin = async (e) => {
    e.preventDefault()
    if (!code || code.length !== 6) return
    setLoading(true)
    
    // 1. Verify Room exists
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('*')
      .eq('code', code.toUpperCase())
      .single()

    if (roomError || !room) {
      alert("Invalid Room Code")
      setLoading(false)
      return
    }

    // 2. Check for Existing Request
    const { data: existing, error: checkError } = await supabase
      .from('join_requests')
      .select('*')
      .eq('room_id', room.id)
      .eq('player_id', session.user.id)
      .maybeSingle()

    if (existing) {
      if (existing.status === 'rejected') {
        // BUG 7 FIX: If previously rejected, "reset" to pending to allow re-evaluation
        const { error: updateError } = await supabase
          .from('join_requests')
          .update({ status: 'pending', created_at: new Date().toISOString() })
          .eq('id', existing.id)
        
        if (updateError) alert("Error re-joining: " + updateError.message)
        else navigate(`/player/waiting/${room.id}`)
      } else {
        // Already pending or approved (though approved should usually navigate away)
        navigate(`/player/waiting/${room.id}`)
      }
    } else {
      // 3. Submit New Join Request
      const { error: insertError } = await supabase
        .from('join_requests')
        .insert({
          room_id: room.id,
          player_id: session.user.id,
          player_email: profile.email,
          player_name: profile.display_name,
          player_avatar: profile.avatar_url,
          status: 'pending'
        })

      if (insertError) {
        alert("Error joining: " + insertError.message)
      } else {
        navigate(`/player/waiting/${room.id}`)
      }
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md bg-gray-900/50 p-8 rounded-2xl border border-gray-800 shadow-xl text-center backdrop-blur-sm">
        <h1 className="text-3xl font-display font-bold text-white mb-2">Join a Game</h1>
        <p className="text-gray-400 mb-8 font-sans">Enter the 6-digit code provided by your host</p>
        
        <form onSubmit={handleJoin} className="space-y-6">
          <input 
            type="text" 
            placeholder="e.g. A1B2C3" 
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="w-full text-center text-4xl tracking-[0.5em] font-mono bg-gray-800 border-2 border-gray-700 rounded-xl py-4 focus:outline-none focus:border-primary text-white transition-colors uppercase"
            required
          />
          <button 
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full bg-primary text-background font-bold text-lg py-4 rounded-xl hover:bg-[#00D4FF] disabled:opacity-50 disabled:hover:bg-primary transition-all active:scale-95"
          >
            {loading ? 'Requesting to Join...' : 'Enter Battle'}
          </button>
        </form>
      </div>
    </div>
  )
}
