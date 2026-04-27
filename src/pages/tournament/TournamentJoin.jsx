import React, { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, query, where, getDocs,
  doc, setDoc, serverTimestamp
} from 'firebase/firestore'
import { ref as rtdbRef, set } from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'

export default function TournamentJoin() {
  const navigate = useNavigate()
  const { session, profile } = useAuth()
  const inputRef = useRef(null)

  const [code,           setCode]           = useState('')
  const [loading,        setLoading]        = useState(false)
  const [success,        setSuccess]        = useState(false)
  const [tournamentId,   setTournamentId]   = useState(null)
  const [tournamentTitle, setTournamentTitle] = useState('')
  const [error,          setError]          = useState(null)

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed || trimmed.length !== 6) return setError('الكود يجب أن يتكون من 6 أحرف')
    if (!session?.uid) return setError('يجب تسجيل الدخول أولاً')

    setLoading(true)
    setError(null)

    try {
      const snap = await getDocs(
        query(collection(db, 'tournaments'), where('code', '==', trimmed))
      )
      if (snap.empty) throw new Error('لم يتم العثور على بطولة بهذا الكود')

      const tDoc = snap.docs[0]
      const tournament = tDoc.data()

      if (tournament.status !== 'registration') {
        throw new Error('البطولة لم تعد تقبل التسجيل')
      }

      const uid      = session.uid
      const nickname = profile?.display_name || 'لاعب'
      const avatar   = profile?.avatar_url   || null

      await setDoc(doc(db, 'tournaments', tDoc.id, 'registrations', uid), {
        uid,
        nickname,
        avatar_url:    avatar,
        registered_at: serverTimestamp(),
      })

      await set(rtdbRef(rtdb, `tournament_registrations/${tDoc.id}/${uid}`), {
        uid,
        nickname,
        avatar_url:    avatar,
        registered_at: Date.now(),
      })

      localStorage.setItem('activeTournamentId', tDoc.id)

      setTournamentId(tDoc.id)
      setTournamentTitle(tournament.title)
      setSuccess(true)
    } catch (e) {
      console.error(e)
      setError(e.message || 'حصل خطأ. حاول مرة أخرى.')
    } finally {
      setLoading(false)
    }
  }

  /* ── Success state ──────────────────────────────────────────────────────── */
  if (success) {
    return (
      <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

        <header style={{
          borderBottom: '3px double var(--rule-strong)',
          padding: '13px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span className="folio" style={{ flex: 1 }}>Tournament</span>
          <svg width={28} height={28} viewBox="0 0 100 100" fill="none" aria-label="Med Royale">
            <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
            <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
            <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
              fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
          </svg>
          <span className="folio" style={{ flex: 1, textAlign: 'right' }}>Registered</span>
        </header>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
          <p className="folio" style={{ marginBottom: 14, letterSpacing: '0.28em' }}>— REGISTERED —</p>

          <h1 style={{
            fontFamily: 'var(--serif)', fontWeight: 400,
            fontSize: 'clamp(34px, 8vw, 60px)', lineHeight: 1.0,
            letterSpacing: '-0.025em', margin: '0 0 24px', color: 'var(--ink)',
          }}>
            You're<br /><em style={{ fontWeight: 300, color: 'var(--gold)' }}>enrolled.</em>
          </h1>

          <div style={{
            border: '1px solid var(--gold)', background: 'rgba(176,137,68,0.06)',
            padding: '16px 24px', maxWidth: 320, marginBottom: 36,
          }}>
            <p className="ar" style={{ fontWeight: 600, fontSize: 14, color: 'var(--gold)', margin: '0 0 4px' }}>تم التسجيل بنجاح</p>
            <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
              تم تسجيلك في بطولة <strong style={{ color: 'var(--ink)' }}>{tournamentTitle}</strong>
            </p>
            <p className="ar" style={{ fontSize: 12, color: 'var(--ink-4)', margin: '6px 0 0' }}>انتظر بدء المرحلة الأولى</p>
          </div>

          <button
            onClick={() => navigate(`/tournament/${tournamentId}/wait`)}
            style={{
              padding: '14px 32px', background: 'var(--ink)', color: 'var(--paper)',
              border: '1px solid var(--ink)', fontFamily: 'var(--arabic)', fontSize: 15, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            انتقل لصفحة الانتظار
          </button>
        </main>

        <footer style={{
          borderTop: '1px solid var(--rule)', padding: '12px 20px',
          display: 'flex', justifyContent: 'center',
        }}>
          <span className="folio">Player · Tournament</span>
        </footer>

      </div>
    )
  }

  /* ── Join form ──────────────────────────────────────────────────────────── */
  return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '3px double var(--rule-strong)',
        padding: '13px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button
          onClick={() => navigate('/player/dashboard')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}
        >
          ← Back
        </button>

        <svg width={28} height={28} viewBox="0 0 100 100" fill="none" aria-label="Med Royale">
          <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>

        <span className="folio">Join · Tournament</span>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>

          {/* Chapter label */}
          <p className="folio" style={{ textAlign: 'center', marginBottom: 16, letterSpacing: '0.28em' }}>— CHAPTER III · TOURNAMENT —</p>

          {/* Headline */}
          <h1 style={{
            fontFamily: 'var(--serif)', fontWeight: 400,
            fontSize: 'clamp(30px, 7vw, 52px)', lineHeight: 1.0,
            letterSpacing: '-0.025em', margin: '0 0 40px', textAlign: 'center',
            color: 'var(--ink)',
          }}>
            What is the<br />
            <em style={{ fontWeight: 300, color: 'var(--gold)' }}>tournament code?</em>
          </h1>

          {/* ── Character boxes ─────────────────────────────────────────── */}
          <div
            style={{ position: 'relative', marginBottom: 12, cursor: 'text' }}
            onClick={() => inputRef.current?.focus()}
          >
            <div style={{ display: 'flex', justifyContent: 'center', gap: 5, pointerEvents: 'none' }}>
              {[0, 1, 2, null, 3, 4, 5].map((charIdx, i) => {
                if (charIdx === null) return (
                  <div key="sep" style={{
                    width: 14, display: 'flex', alignItems: 'flex-end',
                    paddingBottom: 14, justifyContent: 'center',
                    fontFamily: 'var(--mono)', fontSize: 18, color: 'var(--rule)',
                  }}>—</div>
                )
                const ch = code[charIdx] || ''
                return (
                  <div key={i} style={{
                    width: 44, height: 68,
                    border: '1px solid var(--ink)', borderBottomWidth: 2,
                    background: ch ? 'var(--paper-2)' : 'var(--paper)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--serif)', fontSize: 30, fontWeight: 500,
                    color: 'var(--ink)', transition: 'background 120ms',
                  }}>{ch}</div>
                )
              })}
            </div>
            <input
              ref={inputRef}
              type="text"
              maxLength={6}
              value={code}
              onChange={e => {
                setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
                setError(null)
              }}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'text' }}
              autoComplete="off"
              autoFocus
            />
          </div>

          <p style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--ink-4)', textAlign: 'center', marginBottom: 28 }}>
            Ask the tournament organiser for the 6-character code.
          </p>

          {/* Error */}
          {error && (
            <div style={{
              border: '1px solid var(--alert)', background: 'rgba(180,48,57,0.06)',
              padding: '10px 14px', marginBottom: 16,
            }}>
              <p className="ar" style={{ fontSize: 13, color: 'var(--alert)', margin: 0 }}>{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleJoin}
            disabled={loading || code.trim().length !== 6}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '14px 20px', background: 'var(--ink)', color: 'var(--paper)',
              border: '1px solid var(--ink)', fontFamily: 'var(--arabic)', fontSize: 15, fontWeight: 600,
              cursor: loading || code.trim().length !== 6 ? 'not-allowed' : 'pointer',
              opacity: loading || code.trim().length !== 6 ? 0.4 : 1,
              transition: 'opacity 150ms',
            }}
          >
            {loading ? 'جاري البحث…' : 'انضم للبطولة'}
          </button>

        </div>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid var(--rule)', padding: '12px 20px',
        display: 'flex', justifyContent: 'center',
      }}>
        <span className="folio">Player · Tournament</span>
      </footer>

    </div>
  )
}
