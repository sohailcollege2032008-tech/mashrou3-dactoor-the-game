/**
 * TournamentJoin.jsx — Player enters a tournament code and registers.
 */
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, query, where, getDocs,
  doc, setDoc, serverTimestamp
} from 'firebase/firestore'
import { ref as rtdbRef, set } from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { Trophy, Loader2, CheckCircle } from 'lucide-react'

export default function TournamentJoin() {
  const navigate = useNavigate()
  const { session, profile } = useAuth()

  const [code,     setCode]     = useState('')
  const [loading,  setLoading]  = useState(false)
  const [success,  setSuccess]  = useState(false)
  const [tournamentId, setTournamentId] = useState(null)
  const [tournamentTitle, setTournamentTitle] = useState('')
  const [error,    setError]    = useState(null)

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

      // Write to Firestore registrations subcollection
      await setDoc(doc(db, 'tournaments', tDoc.id, 'registrations', uid), {
        uid,
        nickname,
        avatar_url:     avatar,
        registered_at:  serverTimestamp(),
      })

      // Write to RTDB for real-time lobby display
      await set(rtdbRef(rtdb, `tournament_registrations/${tDoc.id}/${uid}`), {
        uid,
        nickname,
        avatar_url:   avatar,
        registered_at: Date.now(),
      })

      // Remember active tournament so dashboard can show the banner
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

  if (success) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center" dir="rtl">
        <div className="space-y-6 max-w-sm w-full">
          <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle size={40} className="text-green-400" />
          </div>
          <div>
            <h2 className="ar text-2xl font-black text-white mb-2">تم التسجيل بنجاح! 🎉</h2>
            <p className="ar text-gray-400 text-sm">تم تسجيلك في بطولة <span className="text-primary font-bold">{tournamentTitle}</span></p>
            <p className="ar text-gray-500 text-xs mt-2">انتظر بدء المرحلة الأولى (FFA)</p>
          </div>
          <button
            onClick={() => navigate(`/tournament/${tournamentId}/wait`)}
            className="w-full py-3 rounded-xl bg-primary text-background font-black ar hover:bg-[#00D4FF] transition-colors"
          >
            انتقل لصفحة الانتظار
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6" dir="rtl">
      <div className="w-full max-w-sm space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Trophy size={32} className="text-primary" />
          </div>
          <h1 className="ar text-2xl font-black text-white">الانضمام لبطولة</h1>
          <p className="ar text-gray-400 text-sm">أدخل كود البطولة المكوّن من 6 أحرف</p>
        </div>

        {/* Code input */}
        <div className="space-y-3">
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
            placeholder="XXXXXX"
            maxLength={6}
            className="w-full bg-gray-900 border border-gray-700 rounded-2xl px-6 py-5 text-center text-3xl font-black text-white tracking-[0.5em] placeholder-gray-700 focus:outline-none focus:border-primary transition-colors"
          />

          {error && (
            <p className="ar text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            onClick={handleJoin}
            disabled={loading || code.trim().length !== 6}
            className="w-full py-4 rounded-2xl bg-primary text-background font-black text-lg ar flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#00D4FF] active:scale-95 transition-all"
          >
            {loading
              ? <><Loader2 size={20} className="animate-spin" /><span>جاري البحث…</span></>
              : <><Trophy size={20} /><span>انضم للبطولة</span></>
            }
          </button>
        </div>

        <button onClick={() => navigate('/player/dashboard')} className="ar w-full text-center text-gray-500 text-sm hover:text-gray-300 transition-colors">
          عودة للرئيسية
        </button>
      </div>
    </div>
  )
}
