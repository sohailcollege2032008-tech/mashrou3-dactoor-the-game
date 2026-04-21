import React, { useState, useEffect } from 'react'
import { collection, query, getDocs, addDoc, updateDoc, doc, serverTimestamp, orderBy } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { Link } from 'react-router-dom'

export default function OwnerDashboard() {
  const { profile } = useAuth()
  const [hosts, setHosts] = useState([])
  const [emailInput, setEmailInput] = useState('')
  const [loading, setLoading] = useState(true)

  const handleSignOut = () => useAuthStore.getState().signOut()

  useEffect(() => {
    fetchHosts()
  }, [])

  const fetchHosts = async () => {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'authorized_hosts'), orderBy('created_at', 'desc')))
      setHosts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (err) {
      console.error('Error fetching hosts:', err)
    }
    setLoading(false)
  }

  const handleAddHost = async (e) => {
    e.preventDefault()
    if (!emailInput.trim()) return

    try {
      await addDoc(collection(db, 'authorized_hosts'), {
        email: emailInput.trim().toLowerCase(),
        added_by: profile.id,
        is_active: true,
        display_name: null,
        created_at: serverTimestamp()
      })
      setEmailInput('')
      fetchHosts()
    } catch (err) {
      alert('Error adding host: ' + err.message)
    }
  }

  const handleToggleHost = async (id, currentStatus) => {
    if (currentStatus) {
      if (!window.confirm('Are you sure you want to deactivate this host?')) return
    }
    try {
      await updateDoc(doc(db, 'authorized_hosts', id), { is_active: !currentStatus })
      fetchHosts()
    } catch (err) {
      alert('Error updating host: ' + err.message)
    }
  }

  return (
    <div className="min-h-screen bg-background text-white p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex justify-between items-center bg-gray-900/50 p-6 rounded-2xl border border-gray-800 backdrop-blur-sm">
          <div>
            <h1 className="text-3xl font-display font-bold text-primary">Owner Dashboard</h1>
            <p className="text-gray-400 mt-2 font-sans">Manage Authorized Hosts</p>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/owner/logs" className="px-4 py-2 rounded-lg bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 font-bold transition-all">
              Activity Logs
            </Link>
            <Link to="/host/dashboard" className="px-4 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 font-bold transition-all">
              Go to Host Dashboard
            </Link>
            <Link to="/" className="text-gray-400 hover:text-white transition-colors">Return Home</Link>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 font-bold transition-all text-sm"
            >
              تسجيل الخروج
            </button>
          </div>
        </header>

        <section className="bg-gray-900/50 p-6 rounded-2xl border border-gray-800 backdrop-blur-sm">
          <h2 className="text-xl font-bold mb-4 font-display">Add New Host</h2>
          <form onSubmit={handleAddHost} className="flex gap-4">
            <input
              type="email"
              placeholder="Host Email Address..."
              className="flex-1 bg-gray-800/80 border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-primary text-white font-mono transition-colors"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              required
            />
            <button
              type="submit"
              className="bg-primary text-background font-bold px-8 py-3 rounded-lg hover:bg-[#00D4FF] hover:scale-105 active:scale-95 transition-all"
            >
              Add Host
            </button>
          </form>
        </section>

        <section className="bg-gray-900/50 p-6 rounded-2xl border border-gray-800 backdrop-blur-sm shadow-xl">
          <h2 className="text-xl font-bold mb-4 font-display">Authorized Hosts</h2>
          {loading ? (
            <div className="text-primary animate-pulse py-4 font-mono">Loading hosts...</div>
          ) : hosts.length === 0 ? (
            <div className="text-gray-500 italic py-4">No hosts added yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 font-sans tracking-wide text-sm">
                    <th className="p-4 font-medium">Email</th>
                    <th className="p-4 font-medium">Status</th>
                    <th className="p-4 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {hosts.map(host => (
                    <tr key={host.id} className="hover:bg-gray-800/20 transition-colors">
                      <td className="p-4 font-mono text-sm text-gray-300">{host.email}</td>
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold inline-block shadow-sm ${
                          host.is_active
                            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                            : 'bg-red-500/20 text-red-400 border border-red-500/30'
                        }`}>
                          {host.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => handleToggleHost(host.id, host.is_active)}
                          className={`text-sm px-4 py-1.5 rounded-lg font-medium transition-all hover:scale-105 active:scale-95 ${
                            host.is_active
                              ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30'
                              : 'bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/30'
                          }`}
                        >
                          {host.is_active ? 'Remove' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
