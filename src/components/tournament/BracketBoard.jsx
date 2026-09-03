import React, { createContext, useContext, useMemo, useState } from 'react'
import { Radio, Trophy, X, ChevronLeft } from 'lucide-react'
import { motion } from 'framer-motion'
import LockLamp from './LockLamp'
import useIsNarrow from '../../hooks/useIsNarrow'

const TONES = {
  paper: {
    bg: 'var(--paper)', bg2: 'var(--paper-2)',
    rule: 'var(--rule)', ruleStrong: 'var(--rule-strong)',
    ink: 'var(--ink)', ink3: 'var(--ink-3)', ink4: 'var(--ink-4)',
    gold: 'var(--gold)', success: 'var(--success)', alert: 'var(--alert)',
    onInk: 'var(--paper)', winTint: 'rgba(176,137,68,0.10)',
    liveTint: 'rgba(176,137,68,0.06)',
  },
  dark: {
    bg: '#14120E', bg2: '#1C1A14',
    rule: '#3A362C', ruleStrong: '#4A4638',
    ink: '#F4F1EA', ink3: '#8B877C', ink4: '#6F6C63',
    gold: '#C79A4E', success: '#5E9E6E', alert: '#C4634F',
    onInk: '#14120E', winTint: 'rgba(199,154,78,0.14)',
    liveTint: 'rgba(199,154,78,0.07)',
  },
}

function roundName(round, totalRounds) {
  if (!totalRounds) return `الجولة ${round}`
  if (round === totalRounds)     return 'النهائي'
  if (round === totalRounds - 1) return 'نصف النهائي'
  if (round === totalRounds - 2) return 'ربع النهائي'
  if (round === totalRounds - 3) return 'دور الـ 16'
  if (round === totalRounds - 4) return 'دور الـ 32'
  return `الجولة ${round}`
}

/** Short enough for a rail chip on a 360px screen. */
function roundShort(round, totalRounds) {
  if (!totalRounds) return `ج${round}`
  if (round === totalRounds)     return 'النهائي'
  if (round === totalRounds - 1) return 'نصف'
  if (round === totalRounds - 2) return 'ربع'
  if (round === totalRounds - 3) return 'دور ١٦'
  if (round === totalRounds - 4) return 'دور ٣٢'
  return `ج${round}`
}

/** One shape out of the two the callers have. */
function normalize(m) {
  return {
    id:      m.match_id || m.id || `${m.round}-${m.match_number}`,
    round:   m.round || 1,
    n:       m.match_number || 0,
    aUid:    m.a_uid ?? m.player_a_uid ?? null,
    aName:   m.a_name ?? m.player_a_name ?? null,
    bUid:    m.b_uid ?? m.player_b_uid ?? null,
    bName:   m.b_name ?? m.player_b_name ?? null,
    aScore:  m.a_score ?? m.player_a_score ?? null,
    bScore:  m.b_score ?? m.player_b_score ?? null,
    winner:  m.winner_uid || null,
    status:  m.status || 'pending',
    next:    m.next_match_id || null,
    live:    m.live || null,
    tie:     m.tie_breaker || m.tie_broken_by || null,
    walkover: !!m.forced_by_host,
  }
}

const STATUS_LABEL = { active: 'مباشر', finished: 'خلص', pending: 'مستنية' }

/** One competitor line inside a match row. */
/**
 * Qualifier seats, by uid. Threaded by context rather than through four
 * component signatures — the tree is deep and every level would have to carry
 * a prop it does not use itself.
 */
const SeatsContext = createContext(null)

function PlayerLine({ m, side, myUid, T, onFollow }) {
  const seats  = useContext(SeatsContext)
  const uid    = side === 'a' ? m.aUid : m.bUid
  const oppUid = side === 'a' ? m.bUid : m.aUid
  const name   = side === 'a' ? m.aName : m.bName
  const score  = side === 'a' ? m.aScore : m.bScore
  const isLive = m.status === 'active'
  const done   = m.status === 'finished'
  const isWin  = done && m.winner && m.winner === uid
  const isOut  = done && m.winner && m.winner !== uid
  const isMe   = myUid && uid === myUid

  const liveScore = isLive && m.live?.scores ? m.live.scores[uid] : undefined
  const shown     = liveScore ?? score
  const locked    = isLive && m.live?.status === 'question'
    ? !!(m.live.locked || {})[uid]
    : null

  const follow = onFollow && uid ? () => onFollow(uid) : undefined

  // An upset: a lower seat knocking out a higher one. Marked instead of
  // printing every player's seat on every line — 32 seat numbers is decoration,
  // one «مفاجأة» is the story. A walkover is not one; nobody played.
  const mySeat  = seats && uid ? seats[uid] : null
  const oppSeat = seats && oppUid ? seats[oppUid] : null
  const upset   = isWin && !m.walkover && !!mySeat && !!oppSeat && mySeat > oppSeat

  return (
    <div
      onClick={follow}
      role={follow ? 'button' : undefined}
      tabIndex={follow ? 0 : undefined}
      onKeyDown={follow ? e => { if (e.key === 'Enter') follow() } : undefined}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, padding: '8px 10px',
        background: isWin ? T.winTint : 'transparent',
        cursor: follow ? 'pointer' : 'default',
      }}
    >
      <span className="ar" style={{
        fontSize: 13.5, color: T.ink, fontWeight: isWin ? 700 : 500,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        opacity: isOut ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {isWin && <Trophy size={11} style={{ color: T.gold, flexShrink: 0 }} />}
        {name || <span style={{ color: T.ink4 }}>لسه</span>}
        {isMe && (
          <span className="folio" style={{
            fontSize: 9, color: T.gold, border: `1px solid ${T.gold}`, padding: '1px 4px',
          }}>أنت</span>
        )}
        {upset && (
          <span
            className="folio"
            title={`المقعد ${mySeat} أطاح بالمقعد ${oppSeat}`}
            style={{
              fontSize: 9, color: T.alert, border: `1px solid ${T.alert}`,
              padding: '1px 4px', flexShrink: 0,
            }}
          >
            مفاجأة
          </span>
        )}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
        <LockLamp locked={locked} on={T.success} off={T.ink4} />
        <span className="folio" style={{
          fontSize: 13, minWidth: 18, textAlign: 'center',
          color: isWin ? T.gold : isLive ? T.gold : T.ink3,
          fontWeight: isWin || isLive ? 700 : 400,
          opacity: isOut ? 0.5 : 1,
        }}>
          {typeof shown === 'number' ? shown : '·'}
        </span>
      </span>
    </div>
  )
}

/** A whole match, as a block that is happy at any width. */
function MatchRow({ m, totalRounds, myUid, T, onFollow, showRound = true, fixedWidth = null }) {
  const isLive = m.status === 'active'
  const label  = STATUS_LABEL[m.status] || 'مستنية'

  return (
    <div style={{
      border: `1px solid ${isLive ? T.gold : T.rule}`,
      background: isLive ? T.liveTint : T.bg2,
      width: fixedWidth ? undefined : '100%',
      minWidth: fixedWidth || undefined,
      maxWidth: fixedWidth || undefined,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 9px', borderBottom: `1px solid ${T.rule}`,
      }}>
        <span className="folio" style={{ fontSize: 9, color: T.ink4 }}>
          {showRound ? `${roundName(m.round, totalRounds)} · ${m.n}` : `#${m.n}`}
        </span>
        {isLive ? (
          <motion.span
            animate={{ opacity: [1, 0.35, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            className="folio"
            style={{ fontSize: 9, color: T.gold, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Radio size={9} /> {label}
          </motion.span>
        ) : (
          <span className="folio" style={{
            fontSize: 9, color: m.status === 'finished' ? T.success : T.ink4,
          }}>
            {label}
          </span>
        )}
      </div>

      <PlayerLine m={m} side="a" myUid={myUid} T={T} onFollow={onFollow} />
      <div style={{ borderTop: `1px solid ${T.rule}` }} />
      <PlayerLine m={m} side="b" myUid={myUid} T={T} onFollow={onFollow} />

      {(isLive && m.live?.total) || (m.status === 'finished' && (m.tie || m.walkover)) ? (
        <div style={{
          padding: '3px 9px', borderTop: `1px solid ${T.rule}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span className="folio" style={{ fontSize: 9, color: T.ink3 }}>
            {isLive && m.live?.total
              ? <>سؤال <span dir="ltr">{Math.min((m.live.qi ?? 0) + 1, m.live.total)}/{m.live.total}</span></>
              : ''}
          </span>
          <span className="folio" style={{ fontSize: 9, color: T.ink4 }}>
            {m.status === 'finished' && m.walkover ? 'حُسم بالغياب'
              : m.tie === 'ffa_rank' ? 'حُسم بترتيب التصفيات'
                : m.tie ? 'حُسم بسؤال فاصل' : ''}
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** The rail: which round am I looking at, and what is happening in the others. */
function RoundRail({ rounds, totalRounds, focus, onFocus, myUid, T }) {
  return (
    <div style={{
      display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2,
      scrollbarWidth: 'none',
    }}>
      {rounds.map(([r, list]) => {
        const done   = list.filter(m => m.status === 'finished').length
        const live   = list.some(m => m.status === 'active')
        const mine   = myUid && list.some(m => m.aUid === myUid || m.bUid === myUid)
        const on     = focus === r
        return (
          <button key={r} onClick={() => onFocus(r)} style={{
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            padding: '6px 8px', cursor: 'pointer',
            border: `1px solid ${on ? T.ink : live ? T.gold : T.rule}`,
            background: on ? T.ink : 'transparent',
          }}>
            <span className="ar" style={{
              fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
              color: on ? T.onInk : live ? T.gold : T.ink3,
            }}>
              {roundShort(r, totalRounds)}
            </span>
            <span className="folio" style={{
              fontSize: 9, color: on ? T.onInk : T.ink4, opacity: on ? 0.75 : 1,
            }} dir="ltr">
              {done === list.length ? '✓' : `${done}/${list.length}`}
            </span>
            {live && !on && (
              <motion.span
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                style={{ width: 5, height: 5, borderRadius: '50%', background: T.gold }}
              />
            )}
            {mine && !live && (
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: on ? T.onInk : T.gold, opacity: on ? 0.8 : 1,
              }} />
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * One player's route. Five rows for a 32-player bracket, which is the whole
 * point: this is the only view whose size does not grow with the tree.
 */
function PathView({ all, totalRounds, subject, myUid, T, onClose }) {
  const name = useMemo(() => {
    for (const m of all) {
      if (m.aUid === subject) return m.aName
      if (m.bUid === subject) return m.bName
    }
    return 'لاعب'
  }, [all, subject])

  const rows = []
  let eliminatedAt = null
  let championed   = false

  for (let r = 1; r <= (totalRounds || 1); r++) {
    const m = all.find(x => x.round === r && (x.aUid === subject || x.bUid === subject))
    if (!m) {
      // Won the round before but not seated yet — the tree is still catching up.
      if (r > 1 && rows.length && rows[rows.length - 1].tone === 'won') {
        rows.push({ round: r, text: 'مستنية الخصم', tone: 'pending', score: null })
      }
      break
    }
    const isA   = m.aUid === subject
    const oppNm = (isA ? m.bName : m.aName) || 'الخصم'
    const mine  = (isA ? m.aScore : m.bScore)
    const other = (isA ? m.bScore : m.aScore)
    const liveMine  = m.live?.scores?.[subject]
    const liveOther = m.live?.scores?.[isA ? m.bUid : m.aUid]

    if (m.status === 'finished' && m.winner === subject) {
      rows.push({
        round: r, tone: 'won',
        text: m.walkover ? `تأهل بالغياب أمام ${oppNm}` : `فاز على ${oppNm}`,
        score: typeof mine === 'number' ? `${mine}–${other ?? 0}` : null,
      })
      if (r === totalRounds) championed = true
    } else if (m.status === 'finished') {
      rows.push({
        round: r, tone: 'out', text: `خرج أمام ${oppNm}`,
        score: typeof mine === 'number' ? `${mine}–${other ?? 0}` : null,
      })
      eliminatedAt = r
      break
    } else if (m.status === 'active') {
      rows.push({
        round: r, tone: 'live', text: `بيلعب مع ${oppNm}`,
        score: typeof liveMine === 'number' ? `${liveMine}–${liveOther ?? 0}` : null,
      })
      break
    } else {
      rows.push({ round: r, tone: 'pending', text: `أمام ${oppNm}`, score: null })
      break
    }
  }

  const toneColor = t => t === 'won' ? T.success : t === 'out' ? T.alert
    : t === 'live' ? T.gold : T.ink4

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, padding: '8px 10px', border: `1px solid ${T.rule}`,
        borderBottom: 'none', background: T.bg2,
      }}>
        <span className="ar" style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>
          مشوار {name}{subject === myUid ? ' — أنت' : ''}
        </span>
        <button onClick={onClose} style={{
          display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
          background: 'transparent', border: 'none', color: T.ink3, padding: 2,
        }}>
          <X size={13} />
          <span className="folio" style={{ fontSize: 9 }}>CLOSE</span>
        </button>
      </div>

      <div style={{ border: `1px solid ${T.rule}`, background: T.bg }}>
        {rows.length === 0 && (
          <p className="ar" style={{ fontSize: 12.5, color: T.ink3, padding: 14, margin: 0 }}>
            اللاعب ده مش في الشجرة.
          </p>
        )}
        {rows.map((row, i) => (
          <div key={row.round} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            borderTop: i === 0 ? 'none' : `1px solid ${T.rule}`,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: toneColor(row.tone),
            }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="folio" style={{ fontSize: 9, color: T.ink4, margin: 0 }}>
                {roundName(row.round, totalRounds)}
              </p>
              <p className="ar" style={{
                fontSize: 13, color: T.ink, margin: '2px 0 0',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {row.text}
              </p>
            </div>
            {row.score && (
              <span className="folio" dir="ltr" style={{
                fontSize: 13, fontWeight: 700, color: toneColor(row.tone), flexShrink: 0,
              }}>
                {row.score}
              </span>
            )}
          </div>
        ))}

        {(championed || eliminatedAt) && (
          <div style={{
            padding: '9px 12px', borderTop: `1px solid ${T.rule}`,
            background: championed ? T.winTint : 'transparent',
          }}>
            <p className="ar" style={{
              fontSize: 12.5, margin: 0, fontWeight: championed ? 700 : 500,
              color: championed ? T.gold : T.ink3,
            }}>
              {championed
                ? '🏆 بطل البطولة'
                : `خرج من البطولة في ${roundName(eliminatedAt, totalRounds)}`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/** The wide-screen shape: the tree as columns, which is what it is. */
function ColumnTree({ shown, totalRounds, myUid, T, onFollow }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', minWidth: 'max-content' }}>
        {shown.map(([r, list]) => (
          <div key={r} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p className="folio" style={{
              fontSize: 10, letterSpacing: '0.18em', color: T.ink4,
              margin: '0 0 2px', textAlign: 'center',
            }}>
              {roundName(r, totalRounds)}
            </p>
            {list.map(m => (
              <MatchRow key={m.id} m={m} totalRounds={totalRounds} myUid={myUid}
                        T={T} onFollow={onFollow} showRound={false} fixedWidth={216} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * @param {Object<string,number>|null} seats  uid → qualifier seat, when the
 *   caller has them (the spectator mirror does). Optional: without seats the
 *   tree is exactly what it was, minus the upset marks.
 */
export default function BracketBoard({ seats = null, ...props }) {
  return (
    <SeatsContext.Provider value={seats}>
      <BracketBoardBody {...props} />
    </SeatsContext.Provider>
  )
}

function BracketBoardBody({
  matches,
  totalRounds: totalRoundsProp,
  myUid = null,
  currentRound = null,
  tone = 'paper',
  emptyNote = 'الشجرة لسه ماتعملتش',
}) {
  const T = TONES[tone] || TONES.paper
  const narrow = useIsNarrow()

  const all = useMemo(() => (matches || []).map(normalize), [matches])
  const totalRounds = totalRoundsProp
    || all.reduce((mx, m) => Math.max(mx, m.round), 0)
    || 1

  const rounds = useMemo(() => {
    const by = new Map()
    for (const m of all) {
      if (!by.has(m.round)) by.set(m.round, [])
      by.get(m.round).push(m)
    }
    return [...by.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([r, list]) => [r, list.sort((x, y) => x.n - y.n)])
  }, [all])

  // The round worth opening on: whatever is live, else the last one with a
  // result, else where the host says the tournament is.
  const defaultRound = useMemo(() => {
    const live = rounds.filter(([, l]) => l.some(m => m.status === 'active'))
    if (live.length) return live[live.length - 1][0]
    if (currentRound && rounds.some(([r]) => r === currentRound)) return currentRound
    const played = rounds.filter(([, l]) => l.some(m => m.status === 'finished'))
    if (played.length) return played[played.length - 1][0]
    return rounds.length ? rounds[0][0] : 1
  }, [rounds, currentRound])

  const [focus, setFocus]     = useState(null)   // null = follow the default
  const [wideAll, setWideAll] = useState(true)   // wide screens: all rounds
  const [pathUid, setPathUid] = useState(null)

  const activeRound = focus ?? defaultRound
  const shownWide   = wideAll ? rounds : rounds.filter(([r]) => r === activeRound)
  const shownRound  = rounds.find(([r]) => r === activeRound)?.[1] || []

  if (rounds.length === 0) {
    return (
      <div style={{ border: `1px dashed ${T.rule}`, padding: 22, textAlign: 'center' }}>
        <p className="ar" style={{ fontSize: 13.5, color: T.ink, margin: 0 }}>{emptyNote}</p>
      </div>
    )
  }

  // ── Wide: the tree, with the round filter it always had ───────────────────
  if (!narrow) {
    return (
      <div dir="rtl">
        {rounds.length > 1 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12 }}>
            <button onClick={() => setWideAll(true)} className="folio" style={{
              fontSize: 10, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
              border: `1px solid ${wideAll ? T.ink : T.rule}`,
              background: wideAll ? T.ink : 'transparent',
              color: wideAll ? T.onInk : T.ink3,
            }}>
              الكل
            </button>
            {rounds.map(([r]) => {
              const on = !wideAll && activeRound === r
              return (
                <button key={r} onClick={() => { setWideAll(false); setFocus(r) }} className="ar" style={{
                  fontSize: 12, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
                  border: `1px solid ${on ? T.ink : T.rule}`,
                  background: on ? T.ink : 'transparent',
                  color: on ? T.onInk : T.ink3,
                }}>
                  {roundName(r, totalRounds)}
                </button>
              )
            })}
          </div>
        )}
        {pathUid ? (
          <div style={{ maxWidth: 460 }}>
            <PathView all={all} totalRounds={totalRounds} subject={pathUid}
                      myUid={myUid} T={T} onClose={() => setPathUid(null)} />
          </div>
        ) : (
          <ColumnTree shown={shownWide} totalRounds={totalRounds} myUid={myUid}
                      T={T} onFollow={setPathUid} />
        )}
      </div>
    )
  }

  // ── Narrow: no sideways scrolling anywhere ────────────────────────────────
  if (pathUid) {
    return (
      <div dir="rtl">
        <PathView all={all} totalRounds={totalRounds} subject={pathUid}
                  myUid={myUid} T={T} onClose={() => setPathUid(null)} />
      </div>
    )
  }

  const myMatch = myUid
    ? all.find(m => m.aUid === myUid || m.bUid === myUid)
    : null

  return (
    <div dir="rtl">
      <RoundRail rounds={rounds} totalRounds={totalRounds} focus={activeRound}
                 onFocus={setFocus} myUid={myUid} T={T} />

      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 8, margin: '12px 0 8px',
      }}>
        <p className="ar" style={{ fontSize: 14, fontWeight: 600, color: T.ink, margin: 0 }}>
          {roundName(activeRound, totalRounds)}
          <span className="folio" style={{ fontSize: 10, color: T.ink4, marginInlineStart: 8 }}>
            {shownRound.length} ماتش
          </span>
        </p>
        {myMatch && (
          <button onClick={() => setPathUid(myUid)} style={{
            display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
            background: 'transparent', border: 'none', color: T.gold, padding: 2,
          }}>
            <span className="ar" style={{ fontSize: 12, fontWeight: 600 }}>مشواري</span>
            <ChevronLeft size={13} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shownRound.map(m => (
          <MatchRow key={m.id} m={m} totalRounds={totalRounds} myUid={myUid}
                    T={T} onFollow={setPathUid} showRound={false} />
        ))}
      </div>

      <p className="ar" style={{
        fontSize: 11, color: T.ink4, margin: '10px 0 0', textAlign: 'center',
      }}>
        دوس على أي اسم تتابع مشواره في البطولة
      </p>
    </div>
  )
}
