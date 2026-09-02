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

/**
 * The lamp that carries a live match for someone who cannot see the question.
 * `locked` null = not answering right now (no lamp at all), false = still
 * thinking, true = answer is in. It never says what was picked, or whether it
 * was right — that would hand the answer to a spectator with a second device.
 */
function LockLamp({ locked, size = 6 }) {
  if (locked == null) return null
  if (locked) {
    return (
      <span aria-label="قفل إجابته" title="قفل إجابته" style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: 'var(--success)',
      }} />
    )
  }
  return (
    <motion.span
      aria-label="لسه بيفكّر" title="لسه بيفكّر"
      animate={{ opacity: [1, 0.25, 1] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        border: '1px solid var(--ink-4)', background: 'transparent',
      }}
    />
  )
}

/** One side of a match card. */
function Side({ name, uid, score, isWinner, isLoser, isMe, live, locked = null }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 8, padding: '7px 10px',
      background: isWinner ? 'rgba(176,137,68,0.10)' : 'transparent',
    }}>
      <span className="ar" style={{
        fontSize: 13, color: 'var(--ink)', fontWeight: isWinner ? 700 : 500,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        opacity: isLoser ? 0.45 : 1,
      }}>
        {name || <span style={{ color: 'var(--ink-4)' }}>—</span>}
        {isMe && uid && (
          <span className="folio" style={{
            marginInlineStart: 6, color: 'var(--gold)', fontSize: 9,
            border: '1px solid var(--gold)', padding: '1px 4px',
          }}>أنت</span>
        )}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <LockLamp locked={locked} />
        <span className="folio" style={{
          fontSize: 13, minWidth: 18, textAlign: 'center',
          color: live ? 'var(--gold)' : 'var(--ink-3)',
          fontWeight: live ? 700 : 400,
          opacity: isLoser ? 0.45 : 1,
        }}>
          {typeof score === 'number' ? score : '·'}
        </span>
      </span>
    </div>
  )
}

function MatchCard({ m, totalRounds, uid }) {
  const isLive     = m.status === 'active'
  const isFinished = m.status === 'finished'
  const live       = m.live || null
  const scores     = live?.scores || null
  // Only while the question is open — during the reveal the score says it all.
  const lockable   = isLive && live?.status === 'question'
  const lockOf     = u => (lockable ? !!(live.locked || {})[u] : null)

  const aScore = scores?.[m.a_uid] ?? (isFinished ? m.a_score : undefined)
  const bScore = scores?.[m.b_uid] ?? (isFinished ? m.b_score : undefined)

  return (
    <div style={{
      border: `1px solid ${isLive ? 'var(--gold)' : 'var(--rule)'}`,
      background: 'var(--paper-2)',
      minWidth: 190, maxWidth: 240,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 8px', borderBottom: '1px solid var(--rule)',
      }}>
        <span className="folio" style={{ fontSize: 9, color: 'var(--ink-4)' }}>
          {roundName(m.round, totalRounds)} · {m.match_number}
        </span>
        {isLive ? (
          <motion.span
            animate={{ opacity: [1, 0.35, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            className="folio"
            style={{ fontSize: 9, color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Radio size={9} /> مباشر
          </motion.span>
        ) : isFinished ? (
          <span className="folio" style={{ fontSize: 9, color: 'var(--success)' }}>خلص</span>
        ) : (
          <span className="folio" style={{ fontSize: 9, color: 'var(--ink-4)' }}>مستنية</span>
        )}
      </div>

      <Side
        name={m.a_name} uid={m.a_uid} score={aScore} live={isLive}
        locked={lockOf(m.a_uid)}
        isMe={uid && m.a_uid === uid}
        isWinner={isFinished && m.winner_uid === m.a_uid}
        isLoser={isFinished && m.winner_uid && m.winner_uid !== m.a_uid}
      />
      <div style={{ borderTop: '1px solid var(--rule)' }} />
      <Side
        name={m.b_name} uid={m.b_uid} score={bScore} live={isLive}
        locked={lockOf(m.b_uid)}
        isMe={uid && m.b_uid === uid}
        isWinner={isFinished && m.winner_uid === m.b_uid}
        isLoser={isFinished && m.winner_uid && m.winner_uid !== m.b_uid}
      />

      {isLive && live?.total ? (
        <div style={{ padding: '3px 8px', borderTop: '1px solid var(--rule)' }}>
          <span className="folio" style={{ fontSize: 9, color: 'var(--ink-3)' }}>
            سؤال <span dir="ltr">{Math.min((live.qi ?? 0) + 1, live.total)}/{live.total}</span>
          </span>
        </div>
      ) : null}

      {isFinished && m.tie_breaker ? (
        <div style={{ padding: '3px 8px', borderTop: '1px solid var(--rule)' }}>
          <span className="folio" style={{ fontSize: 9, color: 'var(--ink-4)' }}>
            {m.tie_breaker === 'ffa_rank' ? 'حُسم بترتيب التصفيات' : 'حُسم بسؤال فاصل'}
          </span>
        </div>
      ) : null}
    </div>
  )
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
  const [focusRound, setFocus] = useState(null)
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

  const rounds = useMemo(() => {
    const by = new Map()
    matches.forEach(m => {
      if (!by.has(m.round)) by.set(m.round, [])
      by.get(m.round).push(m)
    })
    return [...by.entries()].sort((a, b) => a[0] - b[0])
  }, [matches])

  const liveMatches = useMemo(() => matches.filter(m => m.status === 'active'), [matches])
  const liveCount   = liveMatches.length

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
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    confettiRef.current = true
    confetti({ particleCount: 160, spread: 110, origin: { y: 0.4 } })
  }, [meta?.status, meta?.winner_uid])

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

  const shownRounds = focusRound == null ? rounds : rounds.filter(([r]) => r === focusRound)

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

      {/* Round filter — a 32-player bracket does not fit a phone screen */}
      {rounds.length > 1 && (
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto', padding: '16px 16px 0',
        }}>
          <button onClick={() => setFocus(null)} className="folio" style={{
            fontSize: 10, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1px solid ${focusRound == null ? 'var(--ink)' : 'var(--rule)'}`,
            background: focusRound == null ? 'var(--ink)' : 'transparent',
            color: focusRound == null ? 'var(--paper)' : 'var(--ink-3)',
          }}>
            الكل
          </button>
          {rounds.map(([r]) => (
            <button key={r} onClick={() => setFocus(r)} className="ar" style={{
              fontSize: 12, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
              border: `1px solid ${focusRound === r ? 'var(--ink)' : 'var(--rule)'}`,
              background: focusRound === r ? 'var(--ink)' : 'transparent',
              color: focusRound === r ? 'var(--paper)' : 'var(--ink-3)',
            }}>
              {roundName(r, totalRounds)}
            </button>
          ))}
        </div>
      )}

      {/* The tree */}
      <div style={{ flex: 1, overflowX: 'auto', padding: 16 }}>
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
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', minWidth: 'max-content' }}>
            {shownRounds.map(([r, list]) => (
              <div key={r} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p className="folio" style={{
                  fontSize: 10, letterSpacing: '0.18em', color: 'var(--ink-4)',
                  margin: '0 0 2px', textAlign: 'center',
                }}>
                  {roundName(r, totalRounds)}
                </p>
                {list.map(m => (
                  <MatchCard key={m.match_id} m={m} totalRounds={totalRounds} uid={uid} />
                ))}
              </div>
            ))}
          </div>
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
