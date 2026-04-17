/**
 * TournamentCreate.jsx — Host creates a new tournament.
 * Configures title, deck, top-cut, and all timing parameters.
 */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, addDoc, getDocs, serverTimestamp, query, where
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { generateTournamentCode } from '../../utils/tournamentUtils'
import { Trophy, ChevronLeft, Loader2, Clock } from 'lucide-react'

const TOP_CUT_OPTIONS = [8, 16, 32]

const DEFAULTS = {
  ffaQuestionDuration:   30,   // seconds
  duelQuestionDuration:  30,
  phaseTransitionWait:   60,
  roundBreakTime:        30,
}

export default function TournamentCreate() {
  const navigate  = useNavigate()
  const { session } = useAuth()

  const [title,     setTitle]     = useState('')
  const [deckId,    setDeckId]    = useState('')
  const [topCut,    setTopCut]    = useState(8)
  const [config,    setConfig]    = useState({ ...DEFAULTS })
  const [decks,     setDecks]     = useState([])
  const [loading,   setLoading]   = useState(false)
  const [fetching,  setFetching]  = useState(true)
  const [error,     setError]     = useState(null)

  // Fetch host's question banks
  useEffect(() => {
    if (!session?.uid) return
    const fetch = async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'question_sets'), where('host_id', '==', session.uid))
        )
        setDecks(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (e) {
        console.error(e)
      } finally {
        setFetching(false)
      }
    }
    fetch()
  }, [session?.uid])

  const updateConfig = (key, val) => setConfig(prev => ({ ...prev, [key]: val }))

  const handleCreate = async () => {
    if (!title.trim() || !deckId) return setError('يرجى إدخال العنوان وتحديد المجموعة')
    setLoading(true)
    setError(null)
    try {
      const selectedDeck = decks.find(d => d.id === deckId)

      // Try up to 5 codes to avoid collision (same pattern as room codes)
      let code
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateTournamentCode()
        const existing  = await getDocs(
          query(collection(db, 'tournaments'), where('code', '==', candidate))
        )
        if (existing.empty) { code = candidate; break }
      }
      if (!code) throw new Error('تعذّر توليد كود فريد، حاول مرة أخرى')

      const docRef = await addDoc(collection(db, 'tournaments'), {
        code,
        host_id:    session.uid,
        title:      title.trim(),
        deck_id:    deckId,
        deck_title: selectedDeck?.title || '',
        created_at: serverTimestamp(),
        status:     'registration',

        top_cut:                topCut,
        actual_top_cut:         null,   // computed when FFA starts
        ffa_question_duration:  config.ffaQuestionDuration  * 1000,
        duel_question_duration: config.duelQuestionDuration * 1000,
        phase_transition_wait:  config.phaseTransitionWait  * 1000,
        round_break_time:       config.roundBreakTime       * 1000,

        ffa_room_id:    null,
        current_round:  null,
        total_rounds:   null,
        winner_uid:     null,
        round_questions: {},
      })

      navigate(`/tournament/${docRef.id}/lobby`)
    } catch (e) {
      console.error(e)
      setError(e.message || 'حصل خطأ. حاول مرة أخرى.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-white p-4 max-w-lg mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8 mt-4">
        <button onClick={() => navigate('/host/dashboard')} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
          <ChevronLeft size={20} />
        </button>
        <Trophy size={22} className="text-primary" />
        <h1 className="text-xl font-bold ar">إنشاء بطولة جديدة</h1>
      </div>

      <div className="space-y-5">
        {/* Title */}
        <div>
          <label className="ar block text-sm text-gray-400 mb-1.5">اسم البطولة *</label>
          <input
            value={title} onChange={e => setTitle(e.target.value)}
            placeholder="مثلاً: بطولة الفصل الدراسي الأول"
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-primary text-sm ar"
          />
        </div>

        {/* Deck picker */}
        <div>
          <label className="ar block text-sm text-gray-400 mb-1.5">المجموعة (مصدر الأسئلة) *</label>
          {fetching ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm py-3"><Loader2 size={14} className="animate-spin" /><span className="ar">جاري التحميل…</span></div>
          ) : (
            <select
              value={deckId} onChange={e => setDeckId(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary text-sm ar"
            >
              <option value="">— اختر مجموعة —</option>
              {decks.map(d => (
                <option key={d.id} value={d.id}>{d.title} ({d.question_count || '?'} سؤال)</option>
              ))}
            </select>
          )}
        </div>

        {/* Top Cut */}
        <div>
          <label className="ar block text-sm text-gray-400 mb-1.5">عدد المتأهلين (Top Cut)</label>
          <div className="flex gap-3">
            {TOP_CUT_OPTIONS.map(n => (
              <button
                key={n} onClick={() => setTopCut(n)}
                className={`flex-1 py-3 rounded-xl text-sm font-bold border transition-all ${
                  topCut === n
                    ? 'bg-primary/20 border-primary text-primary shadow-[0_0_12px_rgba(0,184,217,0.25)]'
                    : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
              >
                Top {n}
              </button>
            ))}
          </div>
          <p className="ar text-xs text-gray-500 mt-1.5">سيتم تقليصه تلقائياً لأقرب قوة لـ 2 إذا كان عدد المشاركين أقل</p>
        </div>

        {/* Timing config */}
        <div className="bg-gray-900 rounded-xl p-4 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={16} className="text-primary" />
            <span className="ar text-sm font-semibold text-gray-200">إعدادات التوقيت</span>
          </div>
          {[
            { key: 'ffaQuestionDuration',  label: 'مدة السؤال — مرحلة FFA (ثانية)' },
            { key: 'duelQuestionDuration', label: 'مدة السؤال — مباريات 1v1 (ثانية)' },
            { key: 'phaseTransitionWait',  label: 'وقت الانتظار قبل بدء الـ Bracket (ثانية)' },
            { key: 'roundBreakTime',       label: 'استراحة بين الجولات (ثانية)' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <label className="ar text-sm text-gray-400 flex-1">{label}</label>
              <input
                type="number" min={5} max={300}
                value={config[key]}
                onChange={e => updateConfig(key, Number(e.target.value))}
                className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm text-center focus:outline-none focus:border-primary"
              />
            </div>
          ))}
        </div>

        {error && <p className="ar text-red-400 text-sm text-center">{error}</p>}

        <button
          onClick={handleCreate}
          disabled={loading || !title.trim() || !deckId}
          className="w-full py-4 rounded-xl bg-primary text-background font-black text-base ar flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#00D4FF] active:scale-95 transition-all"
        >
          {loading ? <><Loader2 size={18} className="animate-spin" /><span>جاري الإنشاء…</span></> : <><Trophy size={18} /><span>إنشاء البطولة</span></>}
        </button>
      </div>
    </div>
  )
}
