import React, { useState, useEffect } from 'react'
import { collection, query, getDocs, addDoc, updateDoc, doc, serverTimestamp, orderBy } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

export default function OwnerDashboard() {
  const { profile } = useAuth()
  const [hosts, setHosts] = useState([])
  const [emailInput, setEmailInput] = useState('')
  const [loading, setLoading] = useState(true)

  const handleSignOut = () => useAuthStore.getState().signOut()

  useEffect(() => { fetchHosts() }, [])

  const fetchHosts = async () => {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'authorized_hosts'), orderBy('created_at', 'desc')))
      setHosts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (err) { console.error('Error fetching hosts:', err) }
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
        created_at: serverTimestamp(),
      })
      setEmailInput('')
      fetchHosts()
    } catch (err) { alert('Error adding host: ' + err.message) }
  }

  const handleToggleHost = async (id, currentStatus) => {
    if (currentStatus && !window.confirm('Deactivate this host?')) return
    try {
      await updateDoc(doc(db, 'authorized_hosts', id), { is_active: !currentStatus })
      fetchHosts()
    } catch (err) { alert('Error updating host: ' + err.message) }
  }

  return (
    <div className="paper-grain" style={{
      minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 32px' }}>

        {/* Masthead */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '28px 0 20px', borderBottom: '2px solid var(--ink)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <circle cx="18" cy="18" r="17" stroke="var(--ink)" strokeWidth="1.5" fill="none" />
              <text x="18" y="23" textAnchor="middle"
                style={{ fontFamily: 'var(--serif)', fontSize: 13, fontWeight: 500, fill: 'var(--ink)' }}>MR</text>
            </svg>
            <div style={{ width: 1, height: 28, background: 'var(--rule)' }} />
            <h1 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 26, margin: 0, letterSpacing: '-0.015em' }}>
              Owner Dashboard
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link to="/owner/logs" className="folio" style={{
              color: 'var(--gold)', borderBottom: '1px solid var(--gold)',
              textDecoration: 'none', paddingBottom: 1,
            }}>
              ACTIVITY LOGS
            </Link>
            <div style={{ width: 1, height: 14, background: 'var(--rule)' }} />
            <Link to="/host/dashboard" className="folio" style={{
              color: 'var(--navy)', borderBottom: '1px solid var(--navy)',
              textDecoration: 'none', paddingBottom: 1,
            }}>
              HOST DASHBOARD
            </Link>
            <div style={{ width: 1, height: 14, background: 'var(--rule)' }} />
            <button onClick={handleSignOut} className="folio" style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--alert)', borderBottom: '1px solid var(--alert)',
              paddingBottom: 1,
            }}>
              SIGN OUT
            </button>
          </div>
        </div>

        <div style={{ paddingTop: 40 }}>

          {/* Add New Host */}
          <section style={{ marginBottom: 40 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              borderBottom: '2px solid var(--ink)', paddingBottom: 10, marginBottom: 20,
            }}>
              <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 22, margin: 0, letterSpacing: '-0.01em' }}>
                Add New Host
              </h2>
            </div>
            <form onSubmit={handleAddHost} style={{ display: 'flex', gap: 12 }}>
              <input
                type="email"
                placeholder="Host email address…"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                required
                style={{
                  flex: 1, fontFamily: 'var(--mono)', fontSize: 13,
                  padding: '10px 14px', background: 'var(--paper-2)',
                  border: '1px solid var(--rule)', borderBottom: '2px solid var(--ink)',
                  borderRadius: 0, color: 'var(--ink)', outline: 'none',
                }}
              />
              <button type="submit" style={{
                padding: '10px 28px', background: 'var(--ink)', color: 'var(--paper)',
                border: '1px solid var(--ink)', borderRadius: 4, cursor: 'pointer',
                fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 14,
              }}>
                Add Host
              </button>
            </form>
          </section>

          {/* Hosts table */}
          <section>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              borderBottom: '2px solid var(--ink)', paddingBottom: 10, marginBottom: 0,
            }}>
              <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 22, margin: 0, letterSpacing: '-0.01em' }}>
                Authorized Hosts
              </h2>
              <span className="folio" style={{ color: 'var(--ink-3)' }}>{hosts.length} HOSTS</span>
            </div>

            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '32px 0', color: 'var(--ink-3)' }}>
                <Loader2 size={16} className="animate-spin" />
                <span className="folio">LOADING…</span>
              </div>
            ) : hosts.length === 0 ? (
              <p style={{ padding: '32px 0', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-3)', fontSize: 16 }}>
                No hosts added yet.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--rule)' }}>
                    {['Email', 'Status', ''].map(h => (
                      <th key={h} className="folio" style={{
                        padding: '10px 8px', textAlign: h === '' ? 'right' : 'left',
                        color: 'var(--ink-3)', letterSpacing: '0.1em',
                        fontWeight: 400,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hosts.map(host => (
                    <tr key={host.id} style={{ borderBottom: '1px solid var(--rule)' }}>
                      <td style={{ padding: '14px 8px', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-2)' }}>
                        {host.email}
                      </td>
                      <td style={{ padding: '14px 8px' }}>
                        <span className="folio" style={{
                          padding: '3px 8px',
                          border: `1px solid ${host.is_active ? 'var(--success)' : 'var(--rule)'}`,
                          color: host.is_active ? 'var(--success)' : 'var(--ink-4)',
                          borderRadius: 2,
                        }}>
                          {host.is_active ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 8px', textAlign: 'right' }}>
                        <button
                          onClick={() => handleToggleHost(host.id, host.is_active)}
                          className="folio"
                          style={{
                            background: 'none', cursor: 'pointer',
                            border: `1px solid ${host.is_active ? 'var(--alert)' : 'var(--success)'}`,
                            color: host.is_active ? 'var(--alert)' : 'var(--success)',
                            padding: '4px 10px', borderRadius: 2, fontSize: 10, letterSpacing: '0.08em',
                          }}
                        >
                          {host.is_active ? 'REMOVE' : 'REACTIVATE'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
