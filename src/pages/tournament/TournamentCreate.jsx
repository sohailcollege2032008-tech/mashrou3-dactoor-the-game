/**
 * TournamentCreate.jsx — Host creates a new tournament.
 * Top-cut: null (auto) | 8 | 16 | 32 | 64 | 128
 * Optional scheduled start time — tournament begins automatically at that moment.
 */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, addDoc, getDocs, serverTimestamp, query, where
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { generateTournamentCode } from '../../utils/tournamentUtils'
import { Trophy, ChevronLeft, Loader2, Clock, Zap, Calendar } from 'lucide-react'

const TOP_CUT_OPTIONS = [null, 8, 16, 32, 64, 128]

const DEFAULTS = {
  ffaQuestionDuration:   30,
  duelQuestionDuration:  30,
  phaseTransitionWait:   60,
  roundBreakTime:        30,
}

function defaultScheduledDate() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000)
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0)
  return d.toISOString().slice(0, 16)
}

export default function TournamentCreate() {
  const navigate   = useNavigate()
  const { session } = useAuth()

  const [title,         setTitle]         = useState('')
  const [deckId,        setDeckId]        = useState('')
  const [topCut,        setTopCut]        = useState(null)
  const [config,        setConfig]        = useState({ ...DEFAULTS })
  const [useScheduled,  setUseScheduled]  = useState(false)
  const [scheduledDate, setScheduledDate] = useState(defaultScheduledDate)
  const [decks,         setDecks]         = useState([])
  const [loading,       setLoading]       = useState(false)
  const [fetching,      setFetching]      = useState(true)
  const [error,         setError]         = useState(null)

  useEffect(() => {
    if (!session?.uid) return
    ;(async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'question_sets'), where('host_id', '==', session.uid))
        )
        setDecks(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (e) { console.error(e) }
      finally { setFetching(false) }
    })()
  }, [session?.uid])

  const updateConfig = (key, val) => setConfig(prev => ({ ...prev, [key]: val }))

  const handleCreate = async () => {
    if (!title.trim() || !deckId) return setError('يرجى إدخال العنوان وتحديد المجموعة')
    if (useScheduled && new Date(scheduledDate) <= new Date()) {
      return setError('وقت البدء يجب أن يكون في المستقبل')
    }
    setLoading(true)
    setError(null)
    try {
      const selectedDeck = decks.find(d => d.id === deckId)

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
        is_auto_top_cut:        topCut === null,
        actual_top_cut:         null,
        total_rounds:           null,
        ffa_question_duration:  config.ffaQuestionDuration  * 1000,
        duel_question_duration: config.duelQuestionDuration * 1000,
        phase_transition_wait:  config.phaseTransitionWait  * 1000,
        round_break_time:       config.roundBreakTime       * 1000,

        scheduled_start_at: (useScheduled && scheduledDate)
          ? new Date(scheduledDate)
          : null,

        ffa_room_id:    null,
        current_round:  null,
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
      <div className="flex items-center gap-3 mb-8 mt-4">
        <button
          onClick={() => navigate('/host/dashboard')}
          className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
        >
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
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="مثلاً: بطولة الفصل الدراسي الأول"
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-primary text-sm ar"
          />
        </div>

        {/* Deck picker */}
        <div>
          <label className="ar block text-sm text-gray-400 mb-1.5">المجموعة (مصدر الأسئلة) *</label>
          {fetching ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm py-3">
              <Loader2 size={14} className="animate-spin" />
              <span className="ar">جاري التحميل…</span>
            </div>
          ) : decks.length === 0 ? (
            <p className="ar text-sm text-gray-600 py-2">لا توجد مجموعات — أنشئ واحدة أولاً من لوحة التحكم</p>
          ) : (
            <select
              value={deckId}
              onChange={e => setDeckId(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary text-sm ar"
            >
              <option value="">— اختر مجموعة —</option>
              {decks.map(d => (
                <option key={d.id} value={d.id}>
                  {d.title} ({d.question_count || '?'} سؤال)
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Top Cut */}
        <div>
          <label className="ar block text-sm text-gray-400 mb-2">عدد المتأهلين للـ Bracket (Top Cut)</label>
          <div className="flex flex-wrap gap-2">
            {TOP_CUT_OPTIONS.map(n => (
              <button
                key={n ?? 'auto'}
                onClick={() => setTopCut(n)}
                className={`px-4 py-2.5 rounded-xl text-sm font-bold border transition-all flex items-center gap-1.5 ${
                  topCut === n
                    ? 'bg-primary/20 border-primary text-primary shadow-[0_0_12px_rgba(0,184,217,0.2)]'
                    : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
              >
                {n === null && <Zap size={13} />}
                {n === null ? 'تلقائي' : `Top ${n}`}
              </button>
            ))}
          </div>
          <p className="ar text-xs text-gray-500 mt-2">
            {topCut === null
              ? '⚡ أكبر قوة لـ 2 ≤ عدد المشاركين الفعليين عند إطلاق FFA'
              : `سيتم التقليص تلقائياً لأقرب قوة لـ 2 إذا كان عدد المشاركين أقل من ${topCut}`}
          </p>
        </div>

        {/* Timing */}
        <div className="bg-gray-900 rounded-xl p-4 space-y-4 border border-gray-800">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-primary" />
            <span className="ar text-sm font-semibold text-gray-200">إعدادات التوقيت</span>
          </div>
          {[
            { key: 'ffaQuestionDuration',  label: 'مدة السؤال — FFA (ثانية)' },
            { key: 'duelQuestionDuration', label: 'مدة السؤال — 1v1 (ثانية)' },
            { key: 'phaseTransitionWait',  label: 'انتظار قبل الـ Bracket (ثانية)' },
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

        {/* Scheduled start (optional) */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar size={15} className="text-primary" />
              <span className="ar text-sm font-semibold text-gray-200">بدء تلقائي مجدوَل</span>
              <span className="ar text-xs text-gray-600">(اختياري)</span>
            </div>
            <button
              onClick={() => setUseScheduled(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                useScheduled ? 'bg-primary' : 'bg-gray-700'
              }`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                useScheduled ? 'translate-x-5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          {useScheduled && (
            <div className="space-y-2">
              <input
                type="datetime-local"
                value={scheduledDate}
                min={new Date().toISOString().slice(0, 16)}
                onChange={e => setScheduledDate(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-primary"
              />
              <p className="ar text-xs text-gray-500 leading-relaxed">
                ستبدأ البطولة تلقائياً عند الوقت المحدد — يمكنك البدء يدوياً قبله في أي وقت
              </p>
            </div>
          )}
        </div>

        {error && <p className="ar text-red-400 text-sm text-center">{error}</p>}

        <button
          onClick={handleCreate}
          disabled={loading || !title.trim() || !deckId}
          className="w-full py-4 rounded-xl bg-primary text-background font-black text-base ar flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#00D4FF] active:scale-95 transition-all"
        >
          {loading
            ? <><Loader2 size={18} className="animate-spin" /><span>جاري الإنشاء…</span></>
            : <><Trophy size={18} /><span>إنشاء البطولة</span></>
          }
        </button>
      </div>
    </div>
  )
}
