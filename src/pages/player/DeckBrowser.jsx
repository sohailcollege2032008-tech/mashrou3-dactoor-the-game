import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import {
  ref as rtdbRef, get as rtdbGet, push, set, remove, update
} from 'firebase/database'
import { db, rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { Search, X, Swords, ChevronDown, ArrowRight, Loader2, BookOpen } from 'lucide-react'

// ── Bottom Sheet ──────────────────────────────────────────────────────────────
function BottomSheet({ deck, onClose, onDuel, matchmaking }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" dir="rtl">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#0D1321] border-t border-gray-700 rounded-t-2xl p-6 space-y-5 animate-slide-up">
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
async function doMatchmaking({ deck, profile, session, navigate }) {
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

    // Fetch the waiting duel to get questions
    const duelRef = rtdbRef(rtdb, `duels/${duelId}`)
    const duelSnap = await rtdbGet(duelRef)
    const duelData = duelSnap.val()
    if (!duelData) throw new Error('لم يتم العثور على الدويل')

    // Add ourselves to players + start game
    await update(rtdbRef(rtdb, `duels/${duelId}`), {
      [`players/${uid}`]: {
        uid,
        nickname: profile?.display_name || 'لاعب',
        avatar_url: profile?.avatar_url || '',
        score: 0,
      },
      status: 'playing',
      question_started_at: Date.now(),
    })

    // Remove opponent from queue
    await remove(rtdbRef(rtdb, `duel_queue/${deckId}/${opponentUid}`))

    navigate(`/duel/lobby/${duelId}`)
  } else {
    // Create new duel
    // Fetch deck questions
    const deckDoc = await getDoc(doc(db, 'question_sets', deckId))
    const deckFull = deckDoc.data()
    const questions = deckFull?.questions?.questions || []

    const newDuelRef = push(rtdbRef(rtdb, 'duels'))
    const duelId = newDuelRef.key

    const duelData = {
      creator_uid: uid,
      deck_id: deckId,
      deck_title: deck.title,
      questions,
      total_questions: questions.length,
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
      await doMatchmaking({ deck: selectedDeck, profile, session, navigate })
    } catch (e) {
      console.error(e)
      setError('حصل خطأ أثناء البحث عن خصم. حاول مرة ثانية.')
      setMatchmaking(false)
    }
  }, [selectedDeck, matchmaking, profile, session, navigate])

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
          onClose={() => !matchmaking && setSelectedDeck(null)}
          onDuel={handleDuel}
          matchmaking={matchmaking}
        />
      )}
    </div>
  )
}
