import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import {
  ref as rtdbRef, get as rtdbGet, push, set, remove, update, onValue
} from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { fetchPlayedQuestions, applyDuelConfig } from '../../utils/duelUtils'
import { Search, X, Loader2, UserCheck, XCircle } from 'lucide-react'

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function configSummary(config) {
  if (!config) return 'إعدادات افتراضية'
  const parts = []
  if (config.questionCount) parts.push(`${config.questionCount} سؤال`)
  else parts.push('كل الأسئلة')
  if (config.shuffleQuestions || config.questionCount) parts.push('عشوائي')
  if (config.excludePlayed) parts.push('بدون تكرار')
  if (config.shuffleAnswers) parts.push('خلط إجابات')
  return parts.join(' · ')
}

/* ── Editorial Toggle ────────────────────────────────────────────────────── */
function Toggle({ value, onChange, disabled }) {
  return (
    <button
      dir="ltr"
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      style={{
        position: 'relative', display: 'inline-flex', height: 22, width: 40,
        alignItems: 'center', borderRadius: 'var(--r-full)',
        background: value ? 'var(--ink)' : 'var(--rule)',
        border: `1px solid ${value ? 'var(--ink)' : 'var(--rule)'}`,
        transition: 'all 200ms var(--ease-out)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1, flexShrink: 0,
      }}
    >
      <span style={{
        display: 'inline-block', width: 16, height: 16, borderRadius: '50%',
        background: 'var(--paper)', boxShadow: 'var(--shadow-1)',
        transition: 'transform 200ms var(--ease-out)',
        transform: value ? 'translateX(19px)' : 'translateX(2px)',
      }} />
    </button>
  )
}

/* ── Bottom Sheet ────────────────────────────────────────────────────────── */
function BottomSheet({ deck, config, onConfigChange, onClose, profile, session, navigate }) {
  const uid    = session?.uid
  const deckId = deck.id
  const maxQ   = deck.question_count || 0
  const countOptions = [null, 5, 10, 15, 20, 25, 30].filter(n => n === null || n < maxQ)
  const safeCount    = config.questionCount && config.questionCount >= maxQ ? null : config.questionCount

  const [waitingGames, setWaitingGames] = useState([])
  const [myQueueEntry, setMyQueueEntry] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (!deckId || !uid) return
    const unsub = onValue(rtdbRef(rtdb, `duel_queue/${deckId}`), snap => {
      const data = snap.val() || {}
      const others = []
      let mine = null
      for (const [oUid, entry] of Object.entries(data)) {
        if (oUid === uid) mine = entry
        else others.push({ uid: oUid, ...entry })
      }
      setWaitingGames(others)
      setMyQueueEntry(mine)
    })
    return () => unsub()
  }, [deckId, uid])

  const isInQueue = !!myQueueEntry

  const handleCreate = async () => {
    if (loading) return
    setLoading(true); setError(null)
    try {
      const deckDoc    = await getDoc(doc(db, 'question_sets', deckId))
      const rawQuestions  = deckDoc.data()?.questions?.questions || []
      const creatorPlayed = await fetchPlayedQuestions(uid, deckId)
      const creatorPlayedSet = new Set(creatorPlayed)
      const questions = applyDuelConfig(rawQuestions, config, creatorPlayed)
        .map(q => ({ ...q, played_by_uids: creatorPlayedSet.has(q.question) ? [uid] : [] }))
      if (questions.length === 0) throw new Error('لا توجد أسئلة متاحة بعد تطبيق الإعدادات')
      const newDuelRef = push(rtdbRef(rtdb, 'duels'))
      const duelId = newDuelRef.key
      await set(newDuelRef, {
        creator_uid: uid, deck_id: deckId, deck_title: deck.title,
        questions, total_questions: questions.length, config,
        force_rtl: deckDoc.data()?.force_rtl || false,
        status: 'waiting', current_question_index: 0,
        question_started_at: null, reveal_started_at: null,
        players: { [uid]: { uid, nickname: profile?.display_name || 'لاعب', avatar_url: profile?.avatar_url || '', score: 0 } },
        answers: {},
      })
      await set(rtdbRef(rtdb, `duel_queue/${deckId}/${uid}`), {
        duel_id: duelId, nickname: profile?.display_name || 'لاعب',
        avatar_url: profile?.avatar_url || '', joined_at: Date.now(), config,
      })
      navigate(`/duel/lobby/${duelId}`)
    } catch (e) {
      console.error(e)
      setError(e.message || 'حصل خطأ. حاول مرة ثانية.')
      setLoading(false)
    }
  }

  const handleJoin = async (waitingGame) => {
    if (loading || isInQueue) return
    setLoading(true); setError(null)
    try {
      const { uid: opponentUid, duel_id: duelId } = waitingGame
      const duelSnap = await rtdbGet(rtdbRef(rtdb, `duels/${duelId}`))
      const duelData = duelSnap.val()
      if (!duelData) throw new Error('لم يتم العثور على الدويل')
      const deckDoc = await getDoc(doc(db, 'question_sets', duelData.deck_id))
      const rawQuestions = deckDoc.data()?.questions?.questions || []
      const [creatorPlayed, joinerPlayed] = await Promise.all([
        fetchPlayedQuestions(opponentUid, duelData.deck_id),
        fetchPlayedQuestions(uid, duelData.deck_id),
      ])
      const allPlayed      = [...new Set([...creatorPlayed, ...joinerPlayed])]
      const creatorPlayedSet = new Set(creatorPlayed)
      const joinerPlayedSet  = new Set(joinerPlayed)
      const questions = applyDuelConfig(rawQuestions, duelData.config || {}, allPlayed)
        .map(q => ({
          ...q,
          played_by_uids: [
            ...(creatorPlayedSet.has(q.question) ? [opponentUid] : []),
            ...(joinerPlayedSet.has(q.question)  ? [uid]         : []),
          ],
        }))
      if (questions.length === 0) throw new Error('لا توجد أسئلة متاحة بعد تطبيق الإعدادات')
      await update(rtdbRef(rtdb, `duels/${duelId}`), {
        [`players/${uid}`]: { uid, nickname: profile?.display_name || 'لاعب', avatar_url: profile?.avatar_url || '', score: 0 },
        questions, total_questions: questions.length,
        status: 'playing', question_started_at: Date.now(),
      })
      await remove(rtdbRef(rtdb, `duel_queue/${deckId}/${opponentUid}`))
      navigate(`/duel/lobby/${duelId}`)
    } catch (e) {
      console.error(e)
      setError(e.message || 'فشل الانضمام. حاول مرة أخرى.')
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!myQueueEntry || loading) return
    setLoading(true)
    try {
      await remove(rtdbRef(rtdb, `duel_queue/${deckId}/${uid}`))
      if (myQueueEntry.duel_id) await remove(rtdbRef(rtdb, `duels/${myQueueEntry.duel_id}`))
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      {/* Backdrop */}
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,26,0.55)' }}
        onClick={!isInQueue && !loading ? onClose : undefined}
      />

      {/* Sheet */}
      <div style={{
        position: 'relative', background: 'var(--paper)',
        borderTop: '2px solid var(--ink)',
        maxHeight: '88svh', overflowY: 'auto',
        animation: 'mr-slide-up 280ms var(--ease-out) both',
      }} dir="rtl">
        <style>{`@keyframes mr-slide-up { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }`}</style>

        <div style={{ padding: '20px 20px 0' }}>
          {/* Handle */}
          <div style={{ width: 36, height: 2, background: 'var(--rule)', margin: '0 auto 20px' }} />

          {/* Deck info */}
          <div style={{ borderBottom: '1px solid var(--rule)', paddingBottom: 16, marginBottom: 16 }}>
            <h3 style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 500, margin: 0, color: 'var(--ink)' }}>{deck.title}</h3>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', margin: '6px 0 0', letterSpacing: '0.06em' }}>
              {deck.question_count || 0} سؤال{deck.hostName ? ` · ${deck.hostName}` : ''}
            </p>
            {deck.tags?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {deck.tags.map(tag => (
                  <span key={tag} className="tag tag-ghost" style={{ fontSize: 10 }}>{tag}</span>
                ))}
              </div>
            )}
          </div>

          {/* Config (locked while in queue) */}
          <div style={{ opacity: isInQueue ? 0.45 : 1, pointerEvents: isInQueue ? 'none' : 'auto', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="folio">إعدادات الدويل</span>
              {isInQueue && <span className="tag tag-gold" style={{ fontSize: 10 }}>مقفل</span>}
            </div>

            {countOptions.length > 1 && (
              <div style={{ marginBottom: 14 }}>
                <p className="folio" style={{ marginBottom: 8 }}>عدد الأسئلة</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {countOptions.map(n => (
                    <button
                      key={n ?? 'all'}
                      onClick={() => onConfigChange({ ...config, questionCount: n })}
                      style={{
                        padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: 11,
                        border: '1px solid', borderRadius: 'var(--r-xs)',
                        background: safeCount === n ? 'var(--ink)' : 'var(--paper-2)',
                        color:      safeCount === n ? 'var(--paper)' : 'var(--ink-3)',
                        borderColor: safeCount === n ? 'var(--ink)' : 'var(--rule)',
                        cursor: 'pointer', transition: 'all 120ms',
                      }}
                    >{n === null ? `الكل (${maxQ})` : n}</button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'ترتيب عشوائي للأسئلة', key: 'shuffleQuestions', disabled: !!safeCount, value: config.shuffleQuestions || !!safeCount },
                { label: 'ترتيب عشوائي للإجابات', key: 'shuffleAnswers', disabled: false, value: config.shuffleAnswers },
                { label: 'تخطي الأسئلة المحلولة سابقاً', key: 'excludePlayed', disabled: false, value: config.excludePlayed, sub: 'من أي جهاز · للاعبَين معاً' },
              ].map(opt => (
                <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontFamily: 'var(--sans)', fontSize: 14, color: 'var(--ink)' }}>{opt.label}</span>
                    {opt.sub && <p className="folio" style={{ marginTop: 2 }}>{opt.sub}</p>}
                  </div>
                  <Toggle
                    value={opt.value}
                    onChange={v => onConfigChange({ ...config, [opt.key]: v })}
                    disabled={opt.disabled}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Waiting players */}
          {waitingGames.length > 0 && (
            <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 14, marginBottom: 16 }}>
              <span className="folio" style={{ marginBottom: 10, display: 'block' }}>منتظرون الآن ({waitingGames.length})</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {waitingGames.map(game => (
                  <div key={game.uid} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    border: '1px solid var(--rule)', padding: '10px 12px',
                    background: 'var(--paper-2)',
                  }}>
                    <button
                      onClick={() => navigate(`/player/profile/${game.uid}`)}
                      style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                      {game.avatar_url ? (
                        <img src={game.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--rule)' }} />
                      ) : (
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--paper-3)', border: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                          {(game.nickname || '?')[0]}
                        </div>
                      )}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 500, color: 'var(--ink)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{game.nickname || 'لاعب'}</p>
                      <p className="folio" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{configSummary(game.config)}</p>
                    </div>
                    <button
                      onClick={() => handleJoin(game)}
                      disabled={loading || isInQueue}
                      style={{
                        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
                        padding: '7px 12px', border: '1px solid var(--ink)',
                        background: 'var(--ink)', color: 'var(--paper)',
                        fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 500,
                        cursor: loading || isInQueue ? 'not-allowed' : 'pointer',
                        opacity: loading || isInQueue ? 0.4 : 1, transition: 'opacity 120ms',
                      }}
                    >
                      <UserCheck size={13} /> انضم
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ border: '1px solid var(--alert)', background: 'rgba(181,67,44,0.06)', padding: '10px 14px', marginBottom: 12 }}>
              <p className="ar" style={{ fontSize: 13, color: 'var(--alert)', margin: 0 }}>{error}</p>
            </div>
          )}
        </div>

        {/* Sticky actions */}
        <div style={{ padding: '12px 20px 28px', borderTop: '1px solid var(--rule)', background: 'var(--paper)', position: 'sticky', bottom: 0 }}>
          {isInQueue ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 0', border: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
                <Loader2 size={15} style={{ animation: 'mr-spin 1.2s linear infinite', color: 'var(--ink-3)' }} />
                <span style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-3)' }}>في انتظار خصم...</span>
              </div>
              <button
                onClick={handleCancel}
                disabled={loading}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '12px 16px', border: '1px solid var(--alert)', background: 'rgba(181,67,44,0.06)',
                  fontFamily: 'var(--arabic)', fontSize: 14, fontWeight: 500, color: 'var(--alert)',
                  cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
                }}
              >
                <XCircle size={15} /> إلغاء الانتظار
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={handleCreate}
                disabled={loading}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '14px 20px', background: 'var(--ink)', color: 'var(--paper)',
                  border: '1px solid var(--ink)', fontFamily: 'var(--arabic)', fontSize: 15, fontWeight: 500,
                  cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
                  transition: 'opacity 150ms', marginBottom: 10,
                }}
              >
                {loading ? <><Loader2 size={16} style={{ animation: 'mr-spin 1.2s linear infinite' }} /> جاري الإنشاء...</> : '+ إنشاء دويل جديد'}
              </button>
              <button
                onClick={!loading ? onClose : undefined}
                disabled={loading}
                style={{
                  width: '100%', padding: '10px 0', background: 'none', border: 'none',
                  fontFamily: 'var(--arabic)', fontSize: 13, color: 'var(--ink-4)',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >إلغاء</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Main Component ──────────────────────────────────────────────────────── */
export default function DeckBrowser() {
  const { session, profile } = useAuth()
  const navigate = useNavigate()

  const [decks,        setDecks]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [activeTag,    setActiveTag]    = useState(null)
  const [selectedDeck, setSelectedDeck] = useState(null)
  const [error,        setError]        = useState(null)
  const [duelConfig,   setDuelConfig]   = useState({
    questionCount: null, shuffleQuestions: true, shuffleAnswers: false, excludePlayed: false,
  })

  useEffect(() => {
    const load = async () => {
      try {
        const q    = query(collection(db, 'question_sets'), where('is_global', '==', true))
        const snap = await getDocs(q)
        const raw  = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        const hostIds   = [...new Set(raw.map(d => d.host_id).filter(Boolean))]
        const hostNames = {}
        await Promise.all(hostIds.map(async hid => {
          try {
            const pSnap = await getDoc(doc(db, 'profiles', hid))
            if (pSnap.exists()) hostNames[hid] = pSnap.data().display_name || 'دكتور'
          } catch { hostNames[hid] = 'دكتور' }
        }))
        setDecks(raw.map(d => ({ ...d, hostName: d.host_id ? (hostNames[d.host_id] || 'دكتور') : null })))
      } catch (e) {
        setError('فشل تحميل الـ Decks')
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const allTags  = [...new Set(decks.flatMap(d => d.tags || []))]
  const filtered = decks.filter(d => {
    const matchSearch = !search || d.title?.toLowerCase().includes(search.toLowerCase())
    const matchTag    = !activeTag || (d.tags || []).includes(activeTag)
    return matchSearch && matchTag
  })

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
        >← Back</button>

        <svg width={28} height={28} viewBox="0 0 100 100" fill="none" aria-label="Med Royale">
          <circle cx="50" cy="50" r="46" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="40" stroke="var(--ink)" strokeWidth="0.75" opacity="0.4" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Fraunces, Georgia, serif" fontSize="28" fontWeight="500" fill="var(--ink)">MR</text>
        </svg>

        <span className="folio">Decks · Duel</span>
      </header>

      {/* ── Headline ───────────────────────────────────────────────────── */}
      <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid var(--rule)' }}>
        <p className="folio" style={{ marginBottom: 10 }}>— THE DECKS —</p>
        <h1 style={{
          fontFamily: 'var(--serif)', fontWeight: 400,
          fontSize: 'clamp(28px, 6vw, 48px)', lineHeight: 1.0,
          letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)',
        }}>
          Choose a deck,<br /><em style={{ fontWeight: 300, color: 'var(--burgundy)' }}>start a duel.</em>
        </h1>
      </div>

      {/* ── Search + Tags ───────────────────────────────────────────────── */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--rule)' }}>
        {/* Search */}
        <div style={{ position: 'relative', marginBottom: allTags.length > 0 ? 12 : 0 }}>
          <Search size={14} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', pointerEvents: 'none' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث عن Deck..."
            dir="rtl"
            style={{
              width: '100%', boxSizing: 'border-box',
              border: '1px solid var(--rule)', background: 'var(--paper-2)',
              color: 'var(--ink)', fontFamily: 'var(--arabic)', fontSize: 14,
              padding: '10px 36px 10px 32px', outline: 'none',
              transition: 'border-color 150ms',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 2 }}>
              <X size={13} />
            </button>
          )}
        </div>

        {/* Tag filters */}
        {allTags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            <button
              onClick={() => setActiveTag(null)}
              style={{
                flexShrink: 0, padding: '5px 12px', fontFamily: 'var(--mono)', fontSize: 10,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                border: '1px solid', borderRadius: 'var(--r-xs)', cursor: 'pointer',
                background: !activeTag ? 'var(--ink)' : 'var(--paper-2)',
                color:      !activeTag ? 'var(--paper)' : 'var(--ink-3)',
                borderColor: !activeTag ? 'var(--ink)' : 'var(--rule)',
                transition: 'all 120ms',
              }}
            >الكل</button>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setActiveTag(prev => prev === tag ? null : tag)}
                style={{
                  flexShrink: 0, padding: '5px 12px', fontFamily: 'var(--mono)', fontSize: 10,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  border: '1px solid', borderRadius: 'var(--r-xs)', cursor: 'pointer',
                  background: activeTag === tag ? 'var(--ink)' : 'var(--paper-2)',
                  color:      activeTag === tag ? 'var(--paper)' : 'var(--ink-3)',
                  borderColor: activeTag === tag ? 'var(--ink)' : 'var(--rule)',
                  transition: 'all 120ms',
                }}
              >{tag}</button>
            ))}
          </div>
        )}
      </div>

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ margin: '0 20px 0', padding: '10px 14px', border: '1px solid var(--alert)', background: 'rgba(181,67,44,0.06)' }}>
          <p className="ar" style={{ fontSize: 13, color: 'var(--alert)', margin: 0 }}>{error}</p>
        </div>
      )}

      {/* ── Deck list ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1 }}>

        {/* Thick top rule for the list */}
        <div style={{ height: 2, background: 'var(--ink)' }} />

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', gap: 12, color: 'var(--ink-3)' }}>
            <span style={{ display: 'inline-block', width: 20, height: 20, border: '2px solid var(--rule)', borderTopColor: 'var(--ink)', borderRadius: '50%', animation: 'mr-spin 1.2s linear infinite' }} />
            <span className="folio">جاري التحميل...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', gap: 8, color: 'var(--ink-4)' }}>
            <p style={{ fontFamily: 'var(--serif)', fontSize: 20, fontStyle: 'italic', fontWeight: 300, margin: 0 }}>No decks found.</p>
            <p className="folio">لا توجد Decks متاحة حالياً</p>
          </div>
        ) : (
          filtered.map((deck, i) => (
            <button
              key={deck.id}
              onClick={() => setSelectedDeck(deck)}
              style={{
                width: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                padding: '18px 20px', borderBottom: '1px solid var(--rule)',
                background: 'var(--paper)', cursor: 'pointer',
                transition: 'background 120ms', textAlign: 'right',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--paper-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--paper)'}
            >
              <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }} dir="rtl">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <h3 style={{ fontFamily: 'var(--serif)', fontSize: 17, fontWeight: 500, margin: 0, color: 'var(--ink)', lineHeight: 1.3 }}>{deck.title}</h3>
                </div>
                <p className="folio" style={{ marginTop: 5 }}>
                  {deck.question_count || 0} سؤال{deck.hostName ? ` · ${deck.hostName}` : ''}
                </p>
                {deck.tags?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                    {deck.tags.slice(0, 4).map(tag => (
                      <span key={tag} className="tag tag-ghost" style={{ fontSize: 10 }}>{tag}</span>
                    ))}
                    {deck.tags.length > 4 && (
                      <span className="folio" style={{ alignSelf: 'center' }}>+{deck.tags.length - 4}</span>
                    )}
                  </div>
                )}
              </div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', flexShrink: 0, marginTop: 3, marginRight: 16 }}>→</span>
            </button>
          ))
        )}
      </div>

      {/* ── Bottom Sheet ───────────────────────────────────────────────── */}
      {selectedDeck && (
        <BottomSheet
          deck={selectedDeck}
          config={duelConfig}
          onConfigChange={setDuelConfig}
          onClose={() => setSelectedDeck(null)}
          profile={profile}
          session={session}
          navigate={navigate}
        />
      )}

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid var(--rule)', padding: '12px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <button
          onClick={() => navigate('/player/dashboard')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)' }}
        >← Dashboard</button>
        <span className="folio">Player · Decks</span>
      </footer>

    </div>
  )
}
