import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import {
  ref as rtdbRef, get as rtdbGet, push, set, remove, update, onValue
} from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { fetchPlayedQuestions, applyDuelConfig } from '../../utils/duelUtils'
import { Search, X, Swords, ChevronDown, ArrowRight, Loader2, BookOpen, Settings2, Plus, UserCheck, XCircle } from 'lucide-react'

// ── Config summary helper ─────────────────────────────────────────────────────
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

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ value, onChange, disabled }) {
  return (
    <button
      dir="ltr"
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
        value ? 'bg-primary' : 'bg-gray-700'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          value ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

// ── Bottom Sheet ──────────────────────────────────────────────────────────────
function BottomSheet({ deck, config, onConfigChange, onClose, profile, session, navigate }) {
  const uid = session?.uid
  const deckId = deck.id

  const maxQ = deck.question_count || 0
  const countOptions = [null, 5, 10, 15, 20, 25, 30].filter(n => n === null || n < maxQ)
  const safeCount = config.questionCount && config.questionCount >= maxQ ? null : config.questionCount

  const [waitingGames, setWaitingGames] = useState([])
  const [myQueueEntry, setMyQueueEntry] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Live queue subscription
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

  // ── Create new duel + enter queue ────────────────────────────────────────
  const handleCreate = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const deckDoc = await getDoc(doc(db, 'question_sets', deckId))
      const rawQuestions = deckDoc.data()?.questions?.questions || []

      const creatorPlayed = await fetchPlayedQuestions(uid, deckId)
      const creatorPlayedSet = new Set(creatorPlayed)

      const questions = applyDuelConfig(rawQuestions, config, creatorPlayed)
        .map(q => ({ ...q, played_by_uids: creatorPlayedSet.has(q.question) ? [uid] : [] }))

      if (questions.length === 0) throw new Error('لا توجد أسئلة متاحة بعد تطبيق الإعدادات')

      const newDuelRef = push(rtdbRef(rtdb, 'duels'))
      const duelId = newDuelRef.key

      await set(newDuelRef, {
        creator_uid: uid,
        deck_id: deckId,
        deck_title: deck.title,
        questions,
        total_questions: questions.length,
        config,
        status: 'waiting',
        current_question_index: 0,
        question_started_at: null,
        reveal_started_at: null,
        players: {
          [uid]: {
            uid,
            nickname: profile?.display_name || 'لاعب',
            avatar_url: profile?.avatar_url || '',
            score: 0,
          }
        },
        answers: {},
      })

      await set(rtdbRef(rtdb, `duel_queue/${deckId}/${uid}`), {
        duel_id: duelId,
        nickname: profile?.display_name || 'لاعب',
        avatar_url: profile?.avatar_url || '',
        joined_at: Date.now(),
        config,
      })

      navigate(`/duel/lobby/${duelId}`)
    } catch (e) {
      console.error(e)
      setError(e.message || 'حصل خطأ. حاول مرة ثانية.')
      setLoading(false)
    }
  }

  // ── Join a specific waiting duel ──────────────────────────────────────────
  const handleJoin = async (waitingGame) => {
    if (loading || isInQueue) return
    setLoading(true)
    setError(null)
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
      const allPlayed = [...new Set([...creatorPlayed, ...joinerPlayed])]
      const creatorPlayedSet = new Set(creatorPlayed)
      const joinerPlayedSet = new Set(joinerPlayed)

      const questions = applyDuelConfig(rawQuestions, duelData.config || {}, allPlayed)
        .map(q => ({
          ...q,
          played_by_uids: [
            ...(creatorPlayedSet.has(q.question) ? [opponentUid] : []),
            ...(joinerPlayedSet.has(q.question) ? [uid] : []),
          ]
        }))

      if (questions.length === 0) throw new Error('لا توجد أسئلة متاحة بعد تطبيق الإعدادات')

      await update(rtdbRef(rtdb, `duels/${duelId}`), {
        [`players/${uid}`]: {
          uid,
          nickname: profile?.display_name || 'لاعب',
          avatar_url: profile?.avatar_url || '',
          score: 0,
        },
        questions,
        total_questions: questions.length,
        status: 'playing',
        question_started_at: Date.now(),
      })

      await remove(rtdbRef(rtdb, `duel_queue/${deckId}/${opponentUid}`))

      navigate(`/duel/lobby/${duelId}`)
    } catch (e) {
      console.error(e)
      setError(e.message || 'فشل الانضمام. حاول مرة أخرى.')
      setLoading(false)
    }
  }

  // ── Cancel queue + delete waiting duel ───────────────────────────────────
  const handleCancel = async () => {
    if (!myQueueEntry || loading) return
    setLoading(true)
    try {
      await remove(rtdbRef(rtdb, `duel_queue/${deckId}/${uid}`))
      if (myQueueEntry.duel_id) {
        await remove(rtdbRef(rtdb, `duels/${myQueueEntry.duel_id}`))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" dir="rtl">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={!isInQueue && !loading ? onClose : undefined}
      />
      <div className="relative bg-[#0D1321] border-t border-gray-700 rounded-t-2xl p-6 space-y-5 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto -mt-2 mb-2" />

        {/* Deck info */}
        <div>
          <h3 className="text-xl font-bold text-white font-display">{deck.title}</h3>
          <p className="text-gray-400 text-sm mt-1">
            {deck.question_count || 0} سؤال
            {deck.hostName ? ` · ${deck.hostName}` : ''}
          </p>
          {deck.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {deck.tags.map(tag => (
                <span key={tag} className="text-xs bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-mono">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Config (locked while in queue) */}
        <div className={`border border-gray-800 rounded-2xl p-4 space-y-4 bg-gray-900/40 transition-opacity ${isInQueue ? 'opacity-50 pointer-events-none select-none' : ''}`}>
          <div className="flex items-center gap-2 text-gray-400 text-xs font-bold">
            <Settings2 size={13} />
            إعدادات الدويل
            {isInQueue && <span className="text-yellow-500 font-mono text-xs mr-auto">مقفل</span>}
          </div>

          {countOptions.length > 1 && (
            <div>
              <p className="text-gray-400 text-xs font-mono mb-2">عدد الأسئلة</p>
              <div className="flex flex-wrap gap-2">
                {countOptions.map(n => (
                  <button
                    key={n ?? 'all'}
                    onClick={() => onConfigChange({ ...config, questionCount: n })}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono border transition-colors ${
                      safeCount === n
                        ? 'bg-primary text-background border-primary font-bold'
                        : 'bg-gray-900 text-gray-400 border-gray-700 hover:border-gray-500'
                    }`}
                  >
                    {n === null ? `الكل (${maxQ})` : n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-300 text-sm">ترتيب عشوائي للأسئلة</span>
              <Toggle
                value={config.shuffleQuestions || !!safeCount}
                onChange={v => onConfigChange({ ...config, shuffleQuestions: v })}
                disabled={!!safeCount}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-300 text-sm">ترتيب عشوائي للإجابات</span>
              <Toggle
                value={config.shuffleAnswers}
                onChange={v => onConfigChange({ ...config, shuffleAnswers: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="text-gray-300 text-sm">تخطي الأسئلة المحلولة سابقاً</span>
                <p className="text-gray-600 text-xs font-mono mt-0.5">من أي جهاز · للاعبَين معاً</p>
              </div>
              <Toggle
                value={config.excludePlayed}
                onChange={v => onConfigChange({ ...config, excludePlayed: v })}
              />
            </div>
          </div>
        </div>

        {/* Waiting games list */}
        {waitingGames.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 font-bold">منتظرون الآن ({waitingGames.length})</p>
            {waitingGames.map(game => (
              <div key={game.uid} className="flex items-center gap-3 bg-gray-900/60 border border-gray-800 rounded-2xl p-3">
                {game.avatar_url ? (
                  <img src={game.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-gray-700 flex-shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-500 text-sm font-bold flex-shrink-0">
                    {(game.nickname || '?')[0]}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-bold truncate">{game.nickname || 'لاعب'}</p>
                  <p className="text-gray-500 text-xs font-mono truncate">{configSummary(game.config)}</p>
                </div>
                <button
                  onClick={() => handleJoin(game)}
                  disabled={loading || isInQueue}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/30 hover:bg-primary/20 text-primary font-bold rounded-xl text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <UserCheck size={13} />
                  انضم
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        {/* Actions */}
        {isInQueue ? (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 py-3 bg-primary/5 border border-primary/20 rounded-2xl">
              <Loader2 size={16} className="animate-spin text-primary" />
              <span className="text-sm text-gray-400">في انتظار خصم...</span>
            </div>
            <button
              onClick={handleCancel}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-400 font-bold rounded-2xl text-sm transition-colors disabled:opacity-60"
            >
              <XCircle size={16} />
              إلغاء الانتظار
            </button>
          </div>
        ) : (
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-primary text-background font-bold py-4 rounded-2xl text-lg hover:bg-[#00D4FF] transition-colors active:scale-95 disabled:opacity-60"
          >
            {loading ? (
              <><Loader2 size={20} className="animate-spin" /> جاري الإنشاء...</>
            ) : (
              <><Plus size={20} /> إنشاء دويل جديد</>
            )}
          </button>
        )}

        {!isInQueue && (
          <button
            onClick={!loading ? onClose : undefined}
            disabled={loading}
            className="w-full py-3 text-gray-500 hover:text-gray-300 transition-colors text-sm font-bold disabled:opacity-40"
          >
            إلغاء
          </button>
        )}
      </div>
    </div>
  )
}

// ── Deck Card ─────────────────────────────────────────────────────────────────
function DeckCard({ deck, onClick }) {
  return (
    <button
      onClick={() => onClick(deck)}
      className="w-full text-right bg-gray-900/60 border border-gray-800 hover:border-primary/40 hover:bg-gray-800/60 rounded-2xl p-4 transition-all active:scale-95 space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-white font-bold text-sm leading-snug flex-1">{deck.title}</h3>
        <ChevronDown size={16} className="text-gray-500 flex-shrink-0 mt-0.5 rotate-[-90deg]" />
      </div>
      <p className="text-gray-500 text-xs font-mono">
        {deck.question_count || 0} سؤال
        {deck.hostName ? ` · ${deck.hostName}` : ''}
      </p>
      {deck.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {deck.tags.slice(0, 4).map(tag => (
            <span key={tag} className="text-xs bg-primary/10 text-primary/80 border border-primary/15 px-2 py-0.5 rounded-full font-mono">
              {tag}
            </span>
          ))}
          {deck.tags.length > 4 && (
            <span className="text-xs text-gray-600 font-mono">+{deck.tags.length - 4}</span>
          )}
        </div>
      )}
    </button>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DeckBrowser() {
  const { session, profile } = useAuth()
  const navigate = useNavigate()

  const [decks, setDecks] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState(null)
  const [selectedDeck, setSelectedDeck] = useState(null)
  const [error, setError] = useState(null)

  const [duelConfig, setDuelConfig] = useState({
    questionCount: null,
    shuffleQuestions: true,
    shuffleAnswers: false,
    excludePlayed: false,
  })

  // Load global decks
  useEffect(() => {
    const load = async () => {
      try {
        const q = query(collection(db, 'question_sets'), where('is_global', '==', true))
        const snap = await getDocs(q)
        const raw = snap.docs.map(d => ({ id: d.id, ...d.data() }))

        const hostIds = [...new Set(raw.map(d => d.host_id).filter(Boolean))]
        const hostNames = {}
        await Promise.all(
          hostIds.map(async hid => {
            try {
              const pSnap = await getDoc(doc(db, 'profiles', hid))
              if (pSnap.exists()) hostNames[hid] = pSnap.data().display_name || 'دكتور'
            } catch {
              hostNames[hid] = 'دكتور'
            }
          })
        )

        setDecks(raw.map(d => ({
          ...d,
          hostName: d.host_id ? (hostNames[d.host_id] || 'دكتور') : null,
        })))
      } catch (e) {
        setError('فشل تحميل الـ Decks')
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const allTags = [...new Set(decks.flatMap(d => d.tags || []))]

  const filtered = decks.filter(d => {
    const matchSearch = !search || d.title?.toLowerCase().includes(search.toLowerCase())
    const matchTag = !activeTag || (d.tags || []).includes(activeTag)
    return matchSearch && matchTag
  })

  return (
    <div className="min-h-screen bg-background text-white flex flex-col" dir="rtl">

      {/* Top bar */}
      <div className="px-5 pt-6 pb-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/player/dashboard')}
            className="p-2 text-gray-400 hover:text-white transition-colors"
          >
            <ArrowRight size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold font-display text-white">تصفح الـ <span className="text-primary">Decks</span></h1>
            <p className="text-gray-500 text-xs">اختر Deck وابدأ دويل</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث عن Deck..."
            className="w-full bg-gray-900 border border-gray-700 rounded-xl pr-10 pl-4 py-2.5 text-white text-sm focus:outline-none focus:border-primary transition-colors placeholder:text-gray-600"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Tag filters */}
        {allTags.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setActiveTag(null)}
              className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full font-mono border transition-colors ${
                !activeTag
                  ? 'bg-primary text-background border-primary font-bold'
                  : 'bg-gray-900 text-gray-400 border-gray-700 hover:border-gray-500'
              }`}
            >
              الكل
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setActiveTag(prev => prev === tag ? null : tag)}
                className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full font-mono border transition-colors ${
                  activeTag === tag
                    ? 'bg-primary text-background border-primary font-bold'
                    : 'bg-gray-900 text-gray-400 border-gray-700 hover:border-gray-500'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mb-3 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm text-center">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 px-5 pb-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-500">
            <Loader2 size={32} className="animate-spin text-primary" />
            <p className="text-sm">جاري تحميل الـ Decks...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-600">
            <BookOpen size={40} />
            <p className="text-sm">لا توجد Decks متاحة حالياً</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map(deck => (
              <DeckCard key={deck.id} deck={deck} onClick={setSelectedDeck} />
            ))}
          </div>
        )}
      </div>

      {/* Bottom Sheet */}
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
    </div>
  )
}
