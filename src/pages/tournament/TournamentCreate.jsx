import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, addDoc, getDocs, serverTimestamp, query, where
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { generateTournamentCode } from '../../utils/tournamentUtils'
import { Trophy, Loader2, Clock, Zap, Calendar, ChevronRight } from 'lucide-react'

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

function Toggle({ on, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        position: 'relative', width: 44, height: 24, borderRadius: 12,
        background: on ? 'var(--ink)' : 'var(--rule)',
        border: 'none', cursor: 'pointer', flexShrink: 0,
        transition: 'background 200ms',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 22 : 2,
        width: 20, height: 20, borderRadius: '50%', background: 'var(--paper)',
        boxShadow: '0 1px 3px rgba(26,26,26,0.25)', transition: 'left 200ms',
      }} />
    </button>
  )
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
    setLoading(true); setError(null)
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
        scheduled_start_at: (useScheduled && scheduledDate) ? new Date(scheduledDate) : null,
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

  const row = (label, children) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
      <label className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 14, color: 'var(--ink-2)', flex: 1 }}>{label}</label>
      {children}
    </div>
  )

  return (
    <div className="paper-grain" style={{
      minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)',
      padding: '0 0 64px',
    }} dir="rtl">
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 20px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '28px 0 20px', borderBottom: '2px solid var(--ink)' }}>
          <button
            onClick={() => navigate('/host/dashboard')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', alignItems: 'center' }}
          >
            <ChevronRight size={18} />
          </button>
          <Trophy size={20} style={{ color: 'var(--gold)' }} />
          <h1 className="ar" style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 24, margin: 0, letterSpacing: '-0.01em' }}>
            إنشاء بطولة جديدة
          </h1>
        </div>

        <div style={{ paddingTop: 32, display: 'flex', flexDirection: 'column', gap: 28 }}>

          {/* Title */}
          <div>
            <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 8 }}>اسم البطولة *</div>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="مثلاً: بطولة الفصل الدراسي الأول"
              className="ar"
              style={{
                width: '100%', fontFamily: 'var(--sans)', fontSize: 15,
                padding: '10px 14px', background: 'var(--paper-2)',
                border: '1px solid var(--rule)', borderBottom: '2px solid var(--ink)',
                borderRadius: 0, color: 'var(--ink)', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Deck picker */}
          <div>
            <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 8 }}>المجموعة (مصدر الأسئلة) *</div>
            {fetching ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-3)', padding: '10px 0' }}>
                <Loader2 size={14} className="animate-spin" />
                <span className="folio" style={{ fontSize: 10 }}>LOADING…</span>
              </div>
            ) : decks.length === 0 ? (
              <p className="ar" style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-3)', fontSize: 14 }}>
                لا توجد مجموعات — أنشئ واحدة أولاً من لوحة التحكم
              </p>
            ) : (
              <select
                value={deckId}
                onChange={e => setDeckId(e.target.value)}
                className="ar"
                style={{
                  width: '100%', fontFamily: 'var(--sans)', fontSize: 14,
                  padding: '10px 14px', background: 'var(--paper-2)',
                  border: '1px solid var(--rule)', borderBottom: '2px solid var(--ink)',
                  borderRadius: 0, color: 'var(--ink)', outline: 'none',
                  boxSizing: 'border-box',
                }}
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
            <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 10 }}>عدد المتأهلين — Top Cut</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {TOP_CUT_OPTIONS.map(n => (
                <button
                  key={n ?? 'auto'}
                  onClick={() => setTopCut(n)}
                  style={{
                    padding: '8px 16px', cursor: 'pointer',
                    background: topCut === n ? 'var(--ink)' : 'var(--paper-2)',
                    color: topCut === n ? 'var(--paper)' : 'var(--ink-2)',
                    border: `1px solid ${topCut === n ? 'var(--ink)' : 'var(--rule)'}`,
                    borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 12,
                    display: 'flex', alignItems: 'center', gap: 4,
                    transition: 'all 150ms',
                  }}
                >
                  {n === null && <Zap size={11} />}
                  {n === null ? 'تلقائي' : `Top ${n}`}
                </button>
              ))}
            </div>
            <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--ink-4)', marginTop: 8 }}>
              {topCut === null
                ? 'أكبر قوة لـ 2 ≤ عدد المشاركين الفعليين عند إطلاق FFA'
                : `سيتم التقليص لأقرب قوة لـ 2 إذا كان عدد المشاركين أقل من ${topCut}`}
            </p>
          </div>

          {/* Timing */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Clock size={14} style={{ color: 'var(--ink-3)' }} />
              <div className="folio" style={{ color: 'var(--ink-4)' }}>إعدادات التوقيت</div>
            </div>
            <div style={{ border: '1px solid var(--rule)', borderRadius: 4, overflow: 'hidden' }}>
              {[
                { key: 'ffaQuestionDuration',  label: 'مدة السؤال — FFA (ثانية)' },
                { key: 'duelQuestionDuration', label: 'مدة السؤال — 1v1 (ثانية)' },
                { key: 'phaseTransitionWait',  label: 'انتظار قبل الـ Bracket (ثانية)' },
                { key: 'roundBreakTime',       label: 'استراحة بين الجولات (ثانية)' },
              ].map(({ key, label }, i) => (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', gap: 16,
                  borderTop: i > 0 ? '1px solid var(--rule)' : 'none',
                }}>
                  <label className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-2)', flex: 1 }}>{label}</label>
                  <input
                    type="number" min={5} max={300}
                    value={config[key]}
                    onChange={e => updateConfig(key, Number(e.target.value))}
                    style={{
                      width: 72, fontFamily: 'var(--mono)', fontSize: 14, textAlign: 'center',
                      padding: '6px 8px', background: 'var(--paper-2)',
                      border: '1px solid var(--rule)', borderBottom: '2px solid var(--ink)',
                      borderRadius: 0, color: 'var(--ink)', outline: 'none',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Scheduled start */}
          <div style={{ border: '1px solid var(--rule)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calendar size={14} style={{ color: 'var(--ink-3)' }} />
                <span className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 14, color: 'var(--ink-2)' }}>بدء تلقائي مجدوَل</span>
                <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>اختياري</span>
              </div>
              <Toggle on={useScheduled} onToggle={() => setUseScheduled(v => !v)} />
            </div>
            {useScheduled && (
              <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--rule)' }}>
                <input
                  type="datetime-local"
                  value={scheduledDate}
                  min={new Date().toISOString().slice(0, 16)}
                  onChange={e => setScheduledDate(e.target.value)}
                  style={{
                    width: '100%', fontFamily: 'var(--mono)', fontSize: 13,
                    padding: '10px 12px', background: 'var(--paper-2)',
                    border: '1px solid var(--rule)', borderBottom: '2px solid var(--ink)',
                    borderRadius: 0, color: 'var(--ink)', outline: 'none',
                    boxSizing: 'border-box', marginTop: 14,
                  }}
                />
                <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--ink-4)', marginTop: 8 }}>
                  ستبدأ البطولة تلقائياً — يمكنك البدء يدوياً قبله في أي وقت
                </p>
              </div>
            )}
          </div>

          {error && (
            <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 14, color: 'var(--alert)', textAlign: 'center' }}>
              {error}
            </p>
          )}

          <button
            onClick={handleCreate}
            disabled={loading || !title.trim() || !deckId}
            style={{
              width: '100%', padding: '14px 0',
              background: loading || !title.trim() || !deckId ? 'var(--paper-2)' : 'var(--ink)',
              color: loading || !title.trim() || !deckId ? 'var(--ink-3)' : 'var(--paper)',
              border: '1px solid var(--ink)', borderRadius: 4, cursor: 'pointer',
              fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 15,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: loading || !title.trim() || !deckId ? 0.6 : 1,
              transition: 'all 150ms',
            }}
          >
            {loading
              ? <><Loader2 size={16} className="animate-spin" /><span className="ar">جاري الإنشاء…</span></>
              : <><Trophy size={16} /><span className="ar">إنشاء البطولة</span></>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
