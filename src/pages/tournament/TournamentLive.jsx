/**
 * TournamentLive.jsx
 * The public live bracket — open to anyone signed in, at any point in the
 * tournament, from the first registration to the champion.
 *
 * Reads ONE RTDB node (`bracket_live/{tournamentId}`) and nothing else. That
 * node is written only by the Cloud Functions (see `_mirror_match` /
 * `_mirror_live` in functions/main.py) and deliberately carries no question
 * text, so it is safe for eliminated players and bystanders to watch a match
 * that is still being played. It also costs zero Firestore reads: a 32-player
 * bracket used to be 63 document reads per viewer per refresh, which is what
 * made a live bracket unaffordable.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ref as rtdbRef, onValue } from 'firebase/database'
import { rtdb } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useServerClock } from '../../hooks/useServerClock'
import { Loader2, Trophy, ArrowRight, Radio } from 'lucide-react'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import HonoursBoard from '../../components/tournament/HonoursBoard'
import BracketBoard from '../../components/tournament/BracketBoard'
import RoundRecap from '../../components/tournament/RoundRecap'
import ShareWatchLink from '../../components/tournament/ShareWatchLink'
import SoundToggle from '../../components/common/SoundToggle'
import { soundManager } from '../../utils/soundManager'
import LockLamp from '../../components/tournament/LockLamp'

function roundName(round, totalRounds) {
  if (!totalRounds) return `الجولة ${round}`
  if (round === totalRounds)     return 'النهائي'
  if (round === totalRounds - 1) return 'نصف النهائي'
  if (round === totalRounds - 2) return 'ربع النهائي'
  if (round === totalRounds - 3) return 'دور الـ 16'
  if (round === totalRounds - 4) return 'دور الـ 32'
  return `الجولة ${round}`
}

const PHASE_LABEL = {
  registration: 'التسجيل مفتوح',
  ffa:          'التصفيات جارية',
  bracket:      'الأدوار الإقصائية',
  finished:     'انتهت',
}

/** A line from the host, shown to everyone watching. Auto-hides after 15
 *  minutes so a forgotten announcement does not become furniture. */
function Announcement({ ann, now }) {
  if (!ann?.text) return null
  if (ann.at && now - ann.at > 15 * 60 * 1000) return null
  return (
    <div style={{
      border: '1px solid var(--ink)', background: 'var(--ink)', padding: '12px 14px',
    }}>
      <p className="folio" style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--paper-3)', margin: '0 0 4px' }}>
        من المنظّم
      </p>
      <p className="ar" style={{ fontSize: 14, color: 'var(--paper)', margin: 0, lineHeight: 1.7 }}>
        {ann.text}
      </p>
    </div>
  )
}

/** Turns dead air into a stated beat: what the tournament is waiting for. */
function PaceBar({ label, detail, countdownMs }) {
  const secs = countdownMs != null ? Math.max(0, Math.ceil(countdownMs / 1000)) : null
  const mm   = secs != null ? String(Math.floor(secs / 60)).padStart(2, '0') : null
  const ss   = secs != null ? String(secs % 60).padStart(2, '0') : null
  return (
    <div style={{
      border: '1px solid var(--rule)', background: 'var(--paper-2)',
      padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <div style={{ minWidth: 0 }}>
        <p className="ar" style={{ fontSize: 14, color: 'var(--ink)', margin: 0, fontWeight: 600 }}>
          {label}
        </p>
        {detail && (
          <p className="ar" style={{ fontSize: 12, color: 'var(--ink-3)', margin: '3px 0 0' }}>
            {detail}
          </p>
        )}
      </div>
      {secs != null && (
        <span className="folio" style={{ fontSize: 26, color: 'var(--gold)', whiteSpace: 'nowrap' }} dir="ltr">
          {mm}:{ss}
        </span>
      )}
    </div>
  )
}

/** One competitor inside the live hero strip. */
function HeroSide({ name, uidSide, score, leader, uid, locked = null }) {
  const isLeader = leader === uidSide
  return (
    <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
      <p className="ar" style={{
        fontSize: 14, margin: '0 0 4px', color: 'var(--ink)',
        fontWeight: isLeader ? 700 : 500,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {name || '—'}
        {uid && uidSide === uid && (
          <span className="folio" style={{
            marginInlineStart: 6, color: 'var(--gold)', fontSize: 9,
            border: '1px solid var(--gold)', padding: '1px 4px',
          }}>أنت</span>
        )}
      </p>
      <p className="folio" style={{
        fontSize: 30, margin: 0, lineHeight: 1,
        color: isLeader ? 'var(--gold)' : 'var(--ink-2)',
      }}>
        {score}
      </p>
      {locked != null && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 7,
        }}>
          <LockLamp locked={locked} size={7} />
          <span className="ar" style={{
            fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 600,
            color: locked ? 'var(--success)' : 'var(--ink-4)',
          }}>
            {locked ? 'قفل إجابته' : 'لسه بيفكّر'}
          </span>
        </span>
      )}
    </div>
  )
}

/** The match everyone is here for: big names, big numbers, visible progress. */
function LiveHero({ m, totalRounds, uid }) {
  const live   = m.live || {}
  const total  = live.total || 0
  const qi     = Math.min((live.qi ?? 0) + 1, total || 1)
  const scores = live.scores || {}
  const aScore = scores[m.a_uid] ?? 0
  const bScore = scores[m.b_uid] ?? 0
  const leader = aScore === bScore ? null : (aScore > bScore ? m.a_uid : m.b_uid)
  // The lamps belong to the open question only; on the reveal the numbers move
  // and the lamps would just be repeating what everyone can already see.
  const lockable = live.status === 'question'
  const locks    = live.locked || {}
  const lockOf   = u => (lockable ? !!locks[u] : null)

  return (
    <div style={{
      border: '1px solid var(--gold)', background: 'rgba(176,137,68,0.06)', padding: 14,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
      }}>
        <motion.span
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="folio"
          style={{ fontSize: 10, color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <Radio size={10} /> مباشر
        </motion.span>
        <span className="ar" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {roundName(m.round, totalRounds)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <HeroSide name={m.a_name} uidSide={m.a_uid} score={aScore} leader={leader} uid={uid}
                  locked={lockOf(m.a_uid)} />
        <span className="folio" style={{ fontSize: 11, color: 'var(--ink-4)' }}>VS</span>
        <HeroSide name={m.b_name} uidSide={m.b_uid} score={bScore} leader={leader} uid={uid}
                  locked={lockOf(m.b_uid)} />
      </div>

      {total > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {Array.from({ length: total }, (_, i) => (
              <div key={i} style={{
                flex: 1, height: 3,
                background: i < qi ? 'var(--gold)' : 'var(--rule)',
              }} />
            ))}
          </div>
          <p className="ar" style={{ fontSize: 11, color: 'var(--ink-3)', margin: '6px 0 0', textAlign: 'center' }}>
            سؤال <span dir="ltr">{qi}/{total}</span>
          </p>
        </div>
      )}
    </div>
  )
}

export default function TournamentLive() {
  const { tournamentId } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const uid = session?.uid || null

  const [data, setData]       = useState(undefined)   // undefined = loading, null = missing
  const [now, setNow]          = useState(() => Date.now())
  const confettiRef = useRef(false)
  const clockOffset = useServerClock()

  useEffect(() => {
    if (!tournamentId) return
    const r = rtdbRef(rtdb, `bracket_live/${tournamentId}`)
    const unsub = onValue(r, snap => setData(snap.exists() ? snap.val() : null))
    return () => unsub()
  }, [tournamentId])

  const meta        = data?.meta || null
  const totalRounds = meta?.total_rounds || 0

  const matches = useMemo(() => {
    const raw = data?.matches
    if (!raw) return []
    return Object.values(raw)
      .filter(m => m && typeof m === 'object')
      .sort((a, b) => (a.round - b.round) || (a.match_number - b.match_number))
  }, [data])

  const liveMatches = useMemo(() => matches.filter(m => m.status === 'active'), [matches])
  const liveCount   = liveMatches.length

  // The break belongs to the round that just ended: show its report while
  // nothing is being played, and let the live heroes take the screen back the
  // moment a match starts.
  const lastRecap = useMemo(() => {
    const recaps = meta?.round_recaps
    if (!recaps || typeof recaps !== 'object') return null
    const entries = Object.values(recaps).filter(r => r && r.round)
    if (entries.length === 0) return null
    return entries.sort((a, b) => (a.round || 0) - (b.round || 0))[entries.length - 1]
  }, [meta])

  // What is the tournament waiting for right now? Derived from the same
  // launch_after the launcher itself uses, so the countdown a viewer sees is
  // the real one and every device agrees on it.
  const pace = useMemo(() => {
    if (!meta || meta.status === 'finished') return null
    if (meta.status === 'registration') {
      return { label: 'التسجيل لسه مفتوح', detail: 'البطولة تبدأ بالتصفيات' }
    }
    if (meta.status === 'ffa') {
      return { label: 'التصفيات جارية', detail: 'الشجرة تظهر أول ما يتحدد المتأهلون' }
    }
    const round   = meta.current_round || 1
    const inRound = matches.filter(m => m.round === round)
    if (inRound.length === 0) return null

    const active = inRound.filter(m => m.status === 'active').length
    const done   = inRound.filter(m => m.status === 'finished').length

    const upcoming = inRound
      .filter(m => m.status === 'pending' && m.a_uid && m.b_uid && m.launch_after)
      .map(m => m.launch_after)
    const nextAt = upcoming.length ? Math.min(...upcoming) : null
    const serverNow = now + (clockOffset.current || 0)

    if (nextAt && nextAt > serverNow) {
      return {
        label: `${roundName(round, totalRounds)} بيبدأ`,
        detail: `${inRound.length} ماتش في الجولة`,
        countdownMs: nextAt - serverNow,
      }
    }
    if (active > 0) {
      return {
        label: `${active} ماتش شغال دلوقتي`,
        detail: done > 0 ? `و${done} خلصوا من ${inRound.length}` : `${roundName(round, totalRounds)}`,
      }
    }
    if (done === inRound.length) {
      return {
        label: `${roundName(round, totalRounds)} خلص`,
        detail: round < totalRounds ? 'مستنيين الجولة الجاية تبدأ' : 'مستنيين إعلان النتيجة',
      }
    }
    return { label: `${roundName(round, totalRounds)}`, detail: 'الماتشات بتتجهز' }
  }, [meta, matches, totalRounds, now, clockOffset])

  // One second while something counts down, otherwise a slow tick that only
  // exists so an announcement can expire without a reload.
  const isCountingDown = pace?.countdownMs != null
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), isCountingDown ? 1000 : 30_000)
    return () => clearInterval(id)
  }, [isCountingDown])

  // ── The viewer's own story: who knocked them out, and how far that player got.
  //    This is read entirely from the mirror — no extra subscription.
  const story = useMemo(() => {
    if (!uid || matches.length === 0) return null
    const mine = matches.filter(m => m.a_uid === uid || m.b_uid === uid)
    if (mine.length === 0) return { kind: 'spectator' }

    const lost = mine.find(m => m.status === 'finished' && m.winner_uid && m.winner_uid !== uid)
    if (!lost) {
      const pending = mine.find(m => m.status !== 'finished')
      if (meta?.winner_uid === uid) return { kind: 'champion' }
      if (pending?.status === 'active') return { kind: 'playing', round: pending.round }
      if (pending) return { kind: 'waiting', round: pending.round }
      return { kind: 'alive' }
    }

    const killerUid  = lost.winner_uid
    const killerName = killerUid === lost.a_uid ? lost.a_name : lost.b_name
    const killerRuns = matches.filter(
      m => (m.a_uid === killerUid || m.b_uid === killerUid) && m.round > lost.round
    )
    const killerLost = killerRuns.find(
      m => m.status === 'finished' && m.winner_uid && m.winner_uid !== killerUid
    )
    return {
      kind: 'eliminated',
      round: lost.round,
      killerName,
      killerIsChampion: meta?.winner_uid === killerUid,
      killerStoppedAt:  killerLost ? killerLost.round : null,
      killerStillIn:    !killerLost && meta?.status !== 'finished',
    }
  }, [uid, matches, meta])

  // Champion confetti — once, and never for someone who asked for less motion.
  useEffect(() => {
    if (meta?.status !== 'finished' || !meta?.winner_uid) return
    if (confettiRef.current) return
    confettiRef.current = true
    soundManager.playChampion()
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    confetti({ particleCount: 160, spread: 110, origin: { y: 0.4 } })
  }, [meta?.status, meta?.winner_uid])

  // A gasp when a seat falls to a lower one — and only for a result that lands
  // while you are watching. The first render seeds the set of already-finished
  // matches silently, otherwise opening the page on a played-out bracket would
  // fire one gasp per historic upset. Muting is the sound toggle in the header.
  const gaspedRef = useRef(null)
  useEffect(() => {
    const seats = meta?.seats
    const finished = matches.filter(m => m.status === 'finished' && m.winner_uid)
    if (gaspedRef.current === null) {
      // Seed from the first snapshot that actually arrived. Seeding from the
      // render before it (matches: []) marks nothing as seen, so every result
      // already in the bracket then arrives as news and the page gasps its way
      // through the history of the tournament.
      if (!data) return
      gaspedRef.current = new Set(finished.map(m => m.match_id))
      return
    }
    for (const m of finished) {
      if (gaspedRef.current.has(m.match_id)) continue
      gaspedRef.current.add(m.match_id)
      if (!seats || m.forced_by_host) continue
      const loser = m.winner_uid === m.a_uid ? m.b_uid : m.a_uid
      const sw = seats[m.winner_uid], sl = seats[loser]
      if (sw && sl && sw > sl) soundManager.playGasp()
    }
  }, [matches, meta?.seats, data])

  // ── States ────────────────────────────────────────────────────────────────
  if (data === undefined) {
    return (
      <div dir="rtl" className="paper-grain" style={{
        minHeight: '100svh', background: 'var(--paper)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Loader2 size={20} className="animate-spin" color="var(--ink-3)" />
      </div>
    )
  }

  if (data === null) {
    return (
      <div dir="rtl" className="paper-grain" style={{
        minHeight: '100svh', background: 'var(--paper)', display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24,
      }}>
        <p className="ar" style={{ fontSize: 15, color: 'var(--ink)', margin: 0, textAlign: 'center' }}>
          مفيش شجرة لايف للبطولة دي
        </p>
        <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0, textAlign: 'center', maxWidth: 320 }}>
          البطولة يا إما لسه ماوصلتش لمرحلة الأدوار الإقصائية، يا إما قديمة وبدأت قبل الشجرة اللايف.
        </p>
        <button onClick={() => navigate('/player/dashboard')} className="ar" style={{
          background: 'none', border: '1px solid var(--rule)', color: 'var(--ink-2)',
          padding: '8px 16px', fontSize: 13, cursor: 'pointer',
        }}>
          الرئيسية
        </button>
      </div>
    )
  }

  return (
    <div dir="rtl" className="paper-grain" style={{
      minHeight: '100svh', background: 'var(--paper)', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate(-1)} aria-label="رجوع" style={{
            background: 'none', border: 'none', color: 'var(--ink-3)',
            cursor: 'pointer', padding: 4, display: 'flex',
          }}>
            <ArrowRight size={18} />
          </button>
          <span className="folio" style={{ letterSpacing: '0.2em' }}>Live Bracket</span>
          {/* Whoever is already watching is the likeliest person to bring the
              next spectator — so the link lives on the page itself, not only
              in the host's hands. */}
          <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* The page makes noise now (a gasp when a seat falls, the champion
                fanfare), so it needs the mute that every other page has. */}
            <SoundToggle showPreviewBtn={false} />
            <ShareWatchLink tournamentId={tournamentId} title={meta?.title} hint={false} label="شارك" />
          </div>
          {liveCount > 0 && (
            <motion.span
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="folio"
              style={{
                fontSize: 9, color: 'var(--gold)', border: '1px solid var(--gold)',
                padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <Radio size={9} /> {liveCount} مباشر
            </motion.span>
          )}
        </div>

        <h1 className="ar" style={{
          fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: '10px 0 2px',
        }}>
          {meta?.title || 'البطولة'}
        </h1>
        <p className="ar" style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0 }}>
          {PHASE_LABEL[meta?.status] || meta?.status || '—'}
          {meta?.status === 'bracket' && totalRounds ? (
            <> · {roundName(meta.current_round || 1, totalRounds)}</>
          ) : null}
        </p>
        <div className="rule" style={{ marginTop: 12 }} />
      </div>

      {/* Champion */}
      {meta?.status === 'finished' && meta?.winner_name && (
        <div style={{ padding: '16px 16px 0' }}>
          <div style={{
            border: '1px solid var(--gold)', background: 'rgba(176,137,68,0.08)',
            padding: 16, textAlign: 'center',
          }}>
            <Trophy size={22} color="var(--gold)" style={{ marginBottom: 6 }} />
            <p className="folio" style={{ fontSize: 10, letterSpacing: '0.22em', color: 'var(--gold)', margin: '0 0 6px' }}>
              Champion
            </p>
            <p className="ar" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
              {meta.winner_name}
            </p>
          </div>
        </div>
      )}

      {/* Honours */}
      {meta?.status === 'finished' && meta?.awards?.length > 0 && (
        <div style={{ padding: '16px 16px 0' }}>
          <HonoursBoard awards={meta.awards} myUid={uid} />
        </div>
      )}

      {/* A word from the host */}
      {meta?.announcement?.text && (
        <div style={{ padding: '16px 16px 0' }}>
          <Announcement ann={meta.announcement} now={now} />
        </div>
      )}

      {/* The current beat, named */}
      {pace && (
        <div style={{ padding: '16px 16px 0' }}>
          <PaceBar label={pace.label} detail={pace.detail} countdownMs={pace.countdownMs} />
        </div>
      )}

      {/* What just happened, while nothing is happening */}
      {lastRecap && liveMatches.length === 0 && (
        <div style={{ padding: '16px 16px 0' }}>
          <RoundRecap recap={lastRecap} totalRounds={totalRounds} tone="paper" />
        </div>
      )}

      {/* What is happening right now */}
      {liveMatches.length > 0 && (
        <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {liveMatches.map(m => (
            <LiveHero key={m.match_id} m={m} totalRounds={totalRounds} uid={uid} />
          ))}
        </div>
      )}

      {/* The viewer's own thread through the bracket */}
      {story && story.kind !== 'spectator' && story.kind !== 'alive' && (
        <div style={{ padding: '16px 16px 0' }}>
          <div style={{
            border: '1px solid var(--rule)', background: 'var(--paper-2)', padding: 14,
          }}>
            {story.kind === 'champion' && (
              <p className="ar" style={{ fontSize: 14, color: 'var(--gold)', fontWeight: 700, margin: 0 }}>
                انت بطل البطولة 🏆
              </p>
            )}
            {story.kind === 'playing' && (
              <p className="ar" style={{ fontSize: 14, color: 'var(--ink)', margin: 0 }}>
                ماتشك شغال دلوقتي في {roundName(story.round, totalRounds)}
              </p>
            )}
            {story.kind === 'waiting' && (
              <p className="ar" style={{ fontSize: 14, color: 'var(--ink)', margin: 0 }}>
                لسه في اللعب — جولتك الجاية: {roundName(story.round, totalRounds)}
              </p>
            )}
            {story.kind === 'eliminated' && (
              <>
                <p className="ar" style={{ fontSize: 14, color: 'var(--ink)', margin: '0 0 6px' }}>
                  خرجت في {roundName(story.round, totalRounds)} أمام <strong>{story.killerName}</strong>
                </p>
                <p className="ar" style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
                  {story.killerIsChampion
                    ? `و${story.killerName} كمّل لآخر الطريق وبقى بطل البطولة`
                    : story.killerStillIn
                      ? `و${story.killerName} لسه في اللعب`
                      : story.killerStoppedAt
                        ? `و${story.killerName} وقف عند ${roundName(story.killerStoppedAt, totalRounds)}`
                        : `و${story.killerName} خرج هو كمان`}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* The bracket. A column tree on a laptop, and on a phone one round at a
          time plus a follow-a-player path — never a sideways scroller. */}
      <div style={{ flex: 1, padding: 16 }}>
        {matches.length === 0 ? (
          <div style={{
            border: '1px dashed var(--rule)', padding: 24, textAlign: 'center',
          }}>
            <p className="ar" style={{ fontSize: 14, color: 'var(--ink)', margin: '0 0 6px' }}>
              {meta?.status === 'ffa'
                ? 'التصفيات جارية — الشجرة تظهر أول ما تتحدد المتأهلين'
                : meta?.status === 'registration'
                  ? 'التسجيل لسه مفتوح — استنى بدء التصفيات'
                  : 'الشجرة لسه ماتعملتش'}
            </p>
            <p className="ar" style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0 }}>
              الصفحة دي بتتحدث لوحدها — مش محتاج تعمل refresh
            </p>
          </div>
        ) : (
          <BracketBoard
            matches={matches}
            seats={meta?.seats || null}
            totalRounds={totalRounds}
            myUid={uid}
            currentRound={meta?.current_round || null}
            tone="paper"
          />
        )}
      </div>

      <div style={{ padding: '0 16px 20px' }}>
        <p className="ar" style={{ fontSize: 11, color: 'var(--ink-4)', margin: 0, textAlign: 'center' }}>
          نتايج ومجاميع حية · مفيش أسئلة معروضة هنا
        </p>
      </div>
    </div>
  )
}
