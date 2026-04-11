import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import {
  ref as rtdbRef, get as rtdbGet, push, set, remove, update
} from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { fetchPlayedQuestions, applyDuelConfig } from '../../utils/duelUtils'
import { Search, X, Swords, ChevronDown, ArrowRight, Loader2, BookOpen, Settings2 } from 'lucide-react'

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
function BottomSheet({ deck, config, onConfigChange, onClose, onDuel, matchmaking }) {
  const maxQ = deck.question_count || 0
  const countOptions = [null, 5, 10, 15, 20, 25, 30].filter(n => n === null || n < maxQ)

  // If selected count is now >= maxQ (e.g. deck is small), reset to null
  const safeCount = config.questionCount && config.questionCount >= maxQ ? null : config.questionCount

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" dir="rtl">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#0D1321] border-t border-gray-700 rounded-t-2xl p-6 space-y-5 animate-slide-up max-h-[90vh] overflow-y-auto">
        {/* Handle */}
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto -mt-2 mb-2" />

        {/* Deck info */}
        <div>
          <h3 className="text-xl font-bold text-white font-display">{deck.title}</h3>
          <p className="text-gray-400 text-sm mt-1">
            {deck.question_count || 0} سؤال
            {deck.hostName ? ` · ${deck.hostName}` : ''}
          </p>
          {deck.tags && deck.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {deck.tags.map(tag => (
                <span
                  key={tag}
                  className="text-xs bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-mono"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Config ── */}
        <div className="border border-gray-800 rounded-2xl p-4 space-y-4 bg-gray-900/40">
          <div className="flex items-center gap-2 text-gray-400 text-xs font-bold">
            <Settings2 size={13} />
            إعدادات الدويل
          </div>

          {/* Question count */}
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

          {/* Toggles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-300 text-sm">ترتيب عشوائي للأسئلة</span>
              <Toggle
                value={config.shuffleQuestions || !!safeCount}
                onChange={v => onConfigChange({ ...config, shuffleQuestions: v })}
                disabled={!!safeCount} // force shuffle if subset selected
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

        {/* Duel button */}
        <button
          onClick={onDuel}
          disabled={matchmaking}
          className="w-full flex items-center justify-center gap-3 bg-primary text-background font-bold py-4 rounded-2xl text-lg hover:bg-[#00D4FF] transition-colors active:scale-95 disabled:opacity-60"
        >
          {matchmaking ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              جاري البحث عن خصم...
            </>
          ) : (
            <>
              <Swords size={20} />
              دويل 1v1 ⚔️
            </>
          )}
        </button>

        <button
          onClick={onClose}
          disabled={matchmaking}
          className="w-full py-3 text-gray-500 hover:text-gray-300 transition-colors text-sm font-bold disabled:opacity-40"
        >
          إلغاء
        </button>
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
      {deck.tags && deck.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {deck.tags.slice(0, 4).map(tag => (
            <span
              key={tag}
              className="text-xs bg-primary/10 text-primary/80 border border-primary/15 px-2 py-0.5 rounded-full font-mono"
            >
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

// ── Matchmaking logic ─────────────────────────────────────────────────────────
async function doMatchmaking({ deck, profile, session, navigate, config }) {
  const uid = session.uid
  const deckId = deck.id

  // Check queue
  const queueRef = rtdbRef(rtdb, `duel_queue/${deckId}`)
  const queueSnap = await rtdbGet(queueRef)
  const queueData = queueSnap.val() || {}

  // Filter out self
  const opponents = Object.entries(queueData).filter(([oUid]) => oUid !== uid)

  if (opponents.length > 0) {
    // Join existing duel
    const [opponentUid, opponentEntry] = opponents[0]
    const duelId = opponentEntry.duel_id

    // Fetch the waiting duel
    const duelRef = rtdbRef(rtdb, `duels/${duelId}`)
    const duelSnap = await rtdbGet(duelRef)
    const duelData = duelSnap.val()
    if (!duelData) throw new Error('لم يتم العثور على الدويل')

    // Fetch raw questions for the deck
    const deckDoc = await getDoc(doc(db, 'question_sets', duelData.deck_id))
    const rawQuestions = deckDoc.data()?.questions?.questions || []

    // Fetch both players' played questions (Firestore, cross-device) and union them
    const [creatorPlayed, joinerPlayed] = await Promise.all([
      fetchPlayedQuestions(opponentUid, duelData.deck_id),
      fetchPlayedQuestions(uid, duelData.deck_id),
    ])
    const allPlayed = [...new Set([...creatorPlayed, ...joinerPlayed])]

    // Apply creator's saved config with full union exclusion
    const questions = applyDuelConfig(rawQuestions, duelData.config || {}, allPlayed)
    if (questions.length === 0) throw new Error('لا توجد أسئلة متاحة بعد تطبيق الإعدادات')

    // Add ourselves + update questions (now with both players' history) + start game
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

    // Remove opponent from queue
    await remove(rtdbRef(rtdb, `duel_queue/${deckId}/${opponentUid}`))

    navigate(`/duel/lobby/${duelId}`)
  } else {
    // Create new duel
    const deckDoc = await getDoc(doc(db, 'question_sets', deckId))
    const deckFull = deckDoc.data()
    const rawQuestions = deckFull?.questions?.questions || []

    // Fetch creator's played questions from Firestore (cross-device)
    const creatorPlayed = await fetchPlayedQuestions(uid, deckId)

    // Apply config with creator's history only (joiner's history added when they join)
    const questions = applyDuelConfig(rawQuestions, config, creatorPlayed)

    if (questions.length === 0) {
      throw new Error('لا توجد أسئلة متاحة بعد تطبيق الإعدادات')
    }

    const newDuelRef = push(rtdbRef(rtdb, 'duels'))
    const duelId = newDuelRef.key

    const duelData = {
      creator_uid: uid,
      deck_id: deckId,
      deck_title: deck.title,
      questions,
      total_questions: questions.length,
      config,   // stored so joiner can reapply with union of both players' history
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
    }

    await set(newDuelRef, duelData)

    // Add self to queue
    await set(rtdbRef(rtdb, `duel_queue/${deckId}/${uid}`), {
      duel_id: duelId,
      nickname: profile?.display_name || 'لاعب',
      avatar_url: profile?.avatar_url || '',
      joined_at: Date.now(),
    })

    navigate(`/duel/lobby/${duelId}`)
  }
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
  const [matchmaking, setMatchmaking] = useState(false)
  const [error, setError] = useState(null)

  // Duel config state
  const [duelConfig, setDuelConfig] = useState({
    questionCount: null,    // null = all
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

        // Fetch host names
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

        const enriched = raw.map(d => ({
          ...d,
          hostName: d.host_id ? (hostNames[d.host_id] || 'دكتور') : null,
        }))
        setDecks(enriched)
      } catch (e) {
        setError('فشل تحميل الـ Decks')
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Collect all tags
  const allTags = [...new Set(decks.flatMap(d => d.tags || []))]

  // Filter decks
  const filtered = decks.filter(d => {
    const matchSearch = !search || d.title?.toLowerCase().includes(search.toLowerCase())
    const matchTag = !activeTag || (d.tags || []).includes(activeTag)
    return matchSearch && matchTag
  })

  const handleDuel = useCallback(async () => {
    if (!selectedDeck || matchmaking) return
    setMatchmaking(true)
    setError(null)
    try {
      await doMatchmaking({
        deck: selectedDeck,
        profile,
        session,
        navigate,
        config: duelConfig,
      })
    } catch (e) {
      console.error(e)
      setError(e.message || 'حصل خطأ أثناء البحث عن خصم. حاول مرة ثانية.')
      setMatchmaking(false)
    }
  }, [selectedDeck, matchmaking, profile, session, navigate, duelConfig])

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

      {/* Error banner */}
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
              <DeckCard
                key={deck.id}
                deck={deck}
                onClick={setSelectedDeck}
              />
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
          onClose={() => !matchmaking && setSelectedDeck(null)}
          onDuel={handleDuel}
          matchmaking={matchmaking}
        />
      )}
    </div>
  )
}
