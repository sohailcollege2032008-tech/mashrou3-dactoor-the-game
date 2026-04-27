import React, { useEffect, useState, useRef, useCallback } from 'react'
import MathText from '../../components/common/MathText'
import { getDir } from '../../utils/rtlUtils'
import { useParams, useNavigate } from 'react-router-dom'
import { ref, onValue, update, get, set, onDisconnect } from 'firebase/database'
import { doc, getDoc, setDoc, updateDoc, collection, writeBatch, serverTimestamp } from 'firebase/firestore'
import { rtdb, db } from '../../lib/firebase'
import { performReveal, performNextQuestion, sortPlayers } from '../../utils/gameRunner'
import { useAuth } from '../../hooks/useAuth'
import {
  Play, UserCheck, XCircle, CheckCircle, SkipForward, Trophy,
  Eye, Timer, Loader2, WifiOff, StopCircle, Shuffle, Star, Zap, Settings, Layers, Shield,
  X, Phone, Mail, User, Moon
} from 'lucide-react'
import confetti from 'canvas-confetti'
import QuestionImage from '../../components/QuestionImage'
import { generateCorrectAnswerHash, verifyAnswerHash } from '../../utils/crypto'
import HostGameReport from '../../components/HostGameReport'
import ActivityLogViewer from '../../components/ActivityLogViewer'

// ── Countdown bar ──────────────────────────────────────────────────────────────
function CountdownBar({ startedAt, duration }) {
  const [remaining, setRemaining] = useState(duration)
  const rafRef = useRef(null)

  useEffect(() => {
    const tick = () => {
      const rem = Math.max(0, duration - (Date.now() - startedAt) / 1000)
      setRemaining(rem)
      if (rem > 0) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [startedAt, duration])

  const pct     = (remaining / duration) * 100
  const urgent  = remaining < duration * 0.25
  const expired = remaining === 0
  const barColor = expired ? 'var(--rule)' : urgent ? 'var(--alert)' : 'var(--ink)'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
      border: `1px solid ${expired ? 'var(--rule)' : urgent ? 'var(--alert)' : 'var(--rule-strong)'}`,
      borderBottomWidth: expired ? 1 : 2, background: 'var(--paper-2)',
    }}>
      <Timer size={14} style={{ color: expired ? 'var(--ink-4)' : urgent ? 'var(--alert)' : 'var(--ink)', flexShrink: 0 }} />
      <div style={{ flex: 1, height: 2, background: 'var(--rule)', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: barColor, transition: 'width 0.1s linear' }} />
      </div>
      <span style={{
        fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16,
        color: expired ? 'var(--ink-4)' : urgent ? 'var(--alert)' : 'var(--ink)',
        width: 52, textAlign: 'right',
      }}>
        {expired ? 'Done' : `${Math.ceil(remaining)}s`}
      </span>
    </div>
  )
}

function formatFormulaForLog(html) {
  if (!html) return '';
  let text = html
    .replace(/<mfrac>\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*<\/mfrac>/gi, '($1)/($2)')
    .replace(/<msup>\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*<\/msup>/gi, '($1)^($2)')
    .replace(/<msub>\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*<\/msub>/gi, '($1)_($2)')
    .replace(/<msqrt>\s*(?:<mrow>)?([\s\S]*?)(?:<\/mrow>)?\s*<\/msqrt>/gi, 'sqrt($1)');
  const temp = document.createElement('div');
  temp.innerHTML = text;
  const plain = temp.textContent || temp.innerText || "";
  return plain.replace(/\s+/g, ' ').trim();
}

// ── Config panel ──────────────────────────────────────────────────────────────
function GameConfigPanel({ config, onChange }) {
  const apply = (key, val) => onChange({ ...config, [key]: val })

  const Toggle = ({ value, onToggle, color = 'var(--ink)' }) => (
    <button onClick={onToggle} style={{
      position: 'relative', width: 42, height: 22, borderRadius: 11, flexShrink: 0,
      background: value ? color : 'var(--rule)', border: 'none', cursor: 'pointer',
      transition: 'background 200ms',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: value ? 22 : 2, width: 18, height: 18,
        borderRadius: '50%', background: 'var(--paper)', transition: 'left 200ms',
      }} />
    </button>
  )

  const row = (icon, label, desc, control) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
        <div style={{ marginTop: 1, flexShrink: 0, color: 'var(--ink-3)' }}>{icon}</div>
        <div>
          <p className="ar" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: desc ? 2 : 0 }}>{label}</p>
          {desc && <p className="ar" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{desc}</p>}
        </div>
      </div>
      {control}
    </div>
  )

  return (
    <div style={{ border: '1px solid var(--rule)', borderBottomWidth: 2, background: 'var(--paper)' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Settings size={13} style={{ color: 'var(--ink-3)' }} />
        <p style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>
          GAME CONFIG
        </p>
      </div>
      <div style={{ padding: '0 16px 4px' }}>

        {row(<UserCheck size={14} />, 'قبول تلقائي للاعبين', 'قبول طلبات الانضمام فوراً دون تدخل يدوي',
          <Toggle value={config.auto_accept} onToggle={() => apply('auto_accept', !config.auto_accept)} color="var(--success)" />
        )}

        {/* Timer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Timer size={14} style={{ color: 'var(--ink-3)' }} />
            <p className="ar" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>وقت العد التنازلي</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" min={5} max={300} value={config.timer_seconds}
              onChange={e => apply('timer_seconds', Math.max(5, Number(e.target.value)))}
              style={{
                width: 56, border: '1px solid var(--rule)', borderBottomWidth: 2,
                background: 'var(--paper-2)', color: 'var(--ink)',
                fontFamily: 'var(--mono)', fontSize: 13, padding: '4px 8px',
                textAlign: 'center', outline: 'none',
              }}
            />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-4)' }}>ث</span>
          </div>
        </div>

        {row(<Zap size={14} />, 'وضع تلقائي', null,
          <Toggle value={config.auto_mode} onToggle={() => apply('auto_mode', !config.auto_mode)} color="var(--gold)" />
        )}

        {config.auto_mode && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0 12px 24px', borderBottom: '1px solid var(--rule)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Timer size={12} style={{ color: 'var(--ink-4)' }} />
              <p className="ar" style={{ fontSize: 12, color: 'var(--ink-3)' }}>تايمر إجباري (ثانية)</p>
            </div>
            <input type="number" min={5} max={600} value={config.auto_timer}
              onChange={e => apply('auto_timer', Math.max(5, Number(e.target.value)))}
              style={{
                width: 56, border: '1px solid var(--rule)', borderBottomWidth: 2,
                background: 'var(--paper-2)', color: 'var(--ink)',
                fontFamily: 'var(--mono)', fontSize: 12, padding: '4px 8px',
                textAlign: 'center', outline: 'none',
              }}
            />
          </div>
        )}

        {row(<Moon size={14} />, 'وضع غير مُراقَب', 'ابدأ الجيم وسيبه يشتغل لوحده',
          <Toggle value={config.unattended_mode} onToggle={() => {
            const next = !config.unattended_mode
            if (next) { onChange({ ...config, unattended_mode: true, auto_accept: true, auto_mode: true }) }
            else { onChange({ ...config, unattended_mode: false }) }
          }} color="var(--burgundy)" />
        )}

        {row(<Shuffle size={14} />, 'ترتيب الاختيارات عشوائي', null,
          <Toggle value={config.shuffle_choices} onToggle={() => apply('shuffle_choices', !config.shuffle_choices)} />
        )}

        {row(<Layers size={14} />, 'ترتيب الأسئلة عشوائي', null,
          <Toggle value={config.shuffle_questions} onToggle={() => apply('shuffle_questions', !config.shuffle_questions)} />
        )}

        {/* Repeat entry */}
        <div style={{ padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
          <p className="folio" style={{ marginBottom: 8, fontSize: 9 }}>الدخول المتكرر للـ Deck</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {[
              { val: 'allow', label: 'مسموح', color: 'var(--ink)' },
              { val: 'badge', label: 'تحذير', color: 'var(--gold)' },
              { val: 'block', label: 'ممنوع', color: 'var(--alert)' },
            ].map(opt => (
              <button key={opt.val} onClick={() => apply('repeat_entry', opt.val)} className="ar" style={{
                padding: '7px 0', fontSize: 12, fontFamily: 'var(--arabic)', fontWeight: 600,
                border: `1px solid ${config.repeat_entry === opt.val ? opt.color : 'var(--rule)'}`,
                borderBottomWidth: config.repeat_entry === opt.val ? 2 : 1,
                background: config.repeat_entry === opt.val ? `color-mix(in srgb, ${opt.color} 8%, transparent)` : 'var(--paper)',
                color: config.repeat_entry === opt.val ? opt.color : 'var(--ink-3)',
                cursor: 'pointer',
              }}>{opt.label}</button>
            ))}
          </div>
        </div>

        {/* Scoring mode */}
        <div style={{ padding: '12px 0' }}>
          <p className="folio" style={{ marginBottom: 10, fontSize: 9 }}>نظام التقييم</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { val: 'classic', label: 'كلاسيك', desc: 'أول واحد صح ياخد نقطة، الباقي صفر' },
              { val: 'custom',  label: 'كاستوم',  desc: 'أول واحد صح N نقطة، الباقي M نقطة' },
              { val: 'ranked',  label: 'ترتيبي',  desc: 'الأول N، الثاني N−X، الثالث N−2X…' },
            ].map(opt => (
              <div key={opt.val}>
                <button onClick={() => apply('scoring_mode', opt.val)} style={{
                  width: '100%', textAlign: 'right', padding: '10px 12px', cursor: 'pointer',
                  border: `1px solid ${config.scoring_mode === opt.val ? 'var(--ink)' : 'var(--rule)'}`,
                  borderBottomWidth: config.scoring_mode === opt.val ? 2 : 1,
                  background: config.scoring_mode === opt.val ? 'var(--paper-2)' : 'var(--paper)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${config.scoring_mode === opt.val ? 'var(--ink)' : 'var(--rule)'}`,
                    background: config.scoring_mode === opt.val ? 'var(--ink)' : 'transparent',
                  }} />
                  <div className="ar">
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{opt.label}</p>
                    <p style={{ fontSize: 11, color: 'var(--ink-4)' }}>{opt.desc}</p>
                  </div>
                </button>

                {config.scoring_mode === opt.val && (opt.val === 'custom' || opt.val === 'ranked') && (
                  <div style={{ display: 'flex', gap: 16, padding: '10px 12px', background: 'var(--paper-2)', borderBottom: '2px solid var(--ink)' }}>
                    <div>
                      <p className="ar" style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4 }}>
                        {opt.val === 'ranked' ? 'N (نقاط الأول)' : 'أول واحد صح'}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="number" min={1} max={100} value={config.first_correct_points}
                          onChange={e => apply('first_correct_points', Math.max(1, Number(e.target.value)))}
                          style={{
                            width: 52, border: '1px solid var(--rule)', borderBottomWidth: 2,
                            background: 'var(--paper)', color: 'var(--ink)',
                            fontFamily: 'var(--mono)', fontSize: 13, padding: '4px 6px', outline: 'none', textAlign: 'center',
                          }}
                        />
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)' }}>نقطة</span>
                      </div>
                    </div>
                    <div>
                      <p className="ar" style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4 }}>
                        {opt.val === 'ranked' ? 'X (الفرق)' : 'باقي الصح'}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="number" min={0} max={opt.val === 'ranked' ? 50 : 100}
                          value={opt.val === 'ranked' ? config.points_decrement : config.other_correct_points}
                          onChange={e => apply(opt.val === 'ranked' ? 'points_decrement' : 'other_correct_points', Math.max(0, Number(e.target.value)))}
                          style={{
                            width: 52, border: '1px solid var(--rule)', borderBottomWidth: 2,
                            background: 'var(--paper)', color: 'var(--ink)',
                            fontFamily: 'var(--mono)', fontSize: 13, padding: '4px 6px', outline: 'none', textAlign: 'center',
                          }}
                        />
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)' }}>نقطة</span>
                      </div>
                    </div>
                    {opt.val === 'ranked' && (
                      <div style={{ alignSelf: 'flex-end', paddingBottom: 6 }}>
                        <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-4)' }}>
                          {config.first_correct_points}, {Math.max(0, config.first_correct_points - config.points_decrement)}, {Math.max(0, config.first_correct_points - 2 * config.points_decrement)}…
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Fisher-Yates shuffle ──────────────────────────────────────────────────────
function shuffleArray(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Player Profile Modal ──────────────────────────────────────────────────────
function PlayerProfileModal({ player, onClose }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!player?.user_id) return
    getDoc(doc(db, 'profiles', player.user_id))
      .then(snap => { setProfile(snap.exists() ? snap.data() : null) })
      .finally(() => setLoading(false))
  }, [player?.user_id])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 360,
        background: 'var(--paper)', border: '1px solid var(--rule)',
        borderTop: '3px double var(--rule-strong)', padding: 24,
      }}>
        <button onClick={onClose} style={{
          position: 'absolute', top: 14, left: 14, background: 'none', border: 'none',
          cursor: 'pointer', color: 'var(--ink-3)', display: 'flex',
        }}><X size={16} /></button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          {player.avatar_url ? (
            <img src={player.avatar_url} alt="" style={{ width: 56, height: 56, borderRadius: '50%', border: '2px solid var(--ink)', objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              border: '2px solid var(--rule-strong)', background: 'var(--paper-3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <User size={22} style={{ color: 'var(--ink-3)' }} />
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, color: 'var(--ink)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {player.nickname}
            </h3>
            {player.score > 0 && (
              <p style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--navy)' }}>{player.score} pts</p>
            )}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-4)', fontSize: 13 }}>
              <Loader2 size={13} className="animate-spin" /> Loading…
            </div>
          ) : profile ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Mail size={13} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {profile.email || '—'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Phone size={13} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: profile.phone ? 'var(--ink-2)' : 'var(--ink-4)', fontStyle: !profile.phone ? 'italic' : 'normal' }}>
                  {profile.phone || 'لم يُضف رقم هاتف'}
                </span>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--ink-4)', fontStyle: 'italic' }}>لا توجد بيانات إضافية</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function HostGameRoom() {
  const { roomId }  = useParams()
  const { session } = useAuth()
  const navigate    = useNavigate()

  const [room, setRoom]         = useState(null)
  const [requests, setRequests] = useState([])
  const [players, setPlayers]   = useState([])
  const [presence, setPresence] = useState({})
  const [answers, setAnswers]   = useState([])
  const [revealResult, setRevealResult] = useState(null)
  const [isRevealing, setIsRevealing]   = useState(false)
  const [startingCountdown, setStartingCountdown] = useState(false)
  const [processingRequests, setProcessingRequests] = useState(new Set())
  const [endingGame, setEndingGame] = useState(false)

  const [gameConfig, setGameConfig] = useState({
    scoring_mode: 'classic',
    shuffle_choices: false,
    first_correct_points: 3,
    other_correct_points: 1,
    points_decrement: 1,
    timer_seconds: 30,
    auto_mode: false,
    auto_timer: 45,
    shuffle_questions: false,
    auto_accept: false,
    repeat_entry: 'allow',
    unattended_mode: false,
  })
  const [playHistory, setPlayHistory] = useState({})

  const [toasts, setToasts]               = useState([])
  const [downloadingLogs, setDownloadingLogs] = useState(false)
  const [gameResults, setGameResults] = useState(null)
  const [resultTab, setResultTab]     = useState('leaderboard')
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [profileModal, setProfileModal]   = useState(null)
  const notifiedAnswersRef = useRef(new Set())
  const roomStatusRef      = useRef(null)

  // ── Host presence ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const presRef = ref(rtdb, `rooms/${roomId}/presence/host`)
    const connRef = ref(rtdb, '.info/connected')
    const unsub = onValue(connRef, async (snap) => {
      if (!snap.val()) return
      await onDisconnect(presRef).set({ online: false, last_seen: Date.now() })
      await set(presRef, { online: true, last_seen: Date.now() })
    })
    return () => {
      unsub()
      set(presRef, { online: false, last_seen: Date.now() })
    }
  }, [roomId, session])

  // ── Room subscription ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const unsubRoom = onValue(ref(rtdb, `rooms/${roomId}`), snap => {
      if (!snap.exists()) return
      const data = snap.val()
      if (data.config) {
        setGameConfig(prev => {
          if (JSON.stringify(prev) !== JSON.stringify(data.config)) return { ...prev, ...data.config }
          return prev
        })
      }
      roomStatusRef.current = data.status
      setRoom(prev => {
        if (prev && data.current_question_index !== prev.current_question_index) {
          setAnswers([]); setRevealResult(null)
        }
        if (data.status === 'finished' && prev?.status !== 'finished') {
          confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 } })
        }
        return data
      })
    })
    return () => unsubRoom()
  }, [roomId, session])

  // ── Sync gameConfig to DB ────────────────────────────────────────────────
  useEffect(() => {
    if (!session || !roomId || !room) return
    const currentDbConfigStr = JSON.stringify(room.config || {})
    const localConfigStr     = JSON.stringify(gameConfig)
    if (currentDbConfigStr !== localConfigStr) {
      console.log("Syncing config to DB...")
      update(ref(rtdb, `rooms/${roomId}`), { config: gameConfig })
        .catch(err => console.error("Config sync failed:", err))
    }
  }, [gameConfig, roomId, session, room?.config])

  // ── Fetch play history ────────────────────────────────────────────────────
  useEffect(() => {
    if (!requests.length || !room?.question_set_id) return
    const qSetId = room.question_set_id
    const uids = requests.map(r => r.key).filter(uid => !(uid in playHistory))
    if (!uids.length) return
    Promise.all(uids.map(uid =>
      getDoc(doc(db, 'profiles', uid)).then(snap => ({
        uid, count: snap.exists() ? (snap.data().played_decks?.[qSetId] || 0) : 0
      }))
    )).then(results => {
      setPlayHistory(prev => {
        const next = { ...prev }
        results.forEach(({ uid, count }) => { next[uid] = count })
        return next
      })
    })
  }, [requests, room?.question_set_id])

  // ── Requests, players, presence, answers ──────────────────────────────────
  useEffect(() => {
    if (!session) return
    const unsubReq = onValue(ref(rtdb, `rooms/${roomId}/join_requests`), snap => {
      if (!snap.exists()) { setRequests([]); return }
      setRequests(Object.entries(snap.val()).map(([key, val]) => ({ key, ...val })).filter(r => r.status === 'pending'))
    })
    return () => unsubReq()
  }, [roomId, session])

  useEffect(() => {
    if (!session) return
    const unsubPlayers = onValue(ref(rtdb, `rooms/${roomId}/players`), snap => {
      if (!snap.exists()) { setPlayers([]); return }
      setPlayers(sortPlayers(Object.values(snap.val())))
    })
    return () => unsubPlayers()
  }, [roomId, session])

  useEffect(() => {
    if (!session) return
    const unsubPres = onValue(ref(rtdb, `rooms/${roomId}/presence/players`), snap => {
      setPresence(snap.exists() ? snap.val() : {})
    })
    return () => unsubPres()
  }, [roomId, session])

  useEffect(() => {
    if (!session || room?.current_question_index === undefined) return
    const qIdx = room.current_question_index
    notifiedAnswersRef.current = new Set()
    const unsubAns = onValue(ref(rtdb, `rooms/${roomId}/answers/${qIdx}`), snap => {
      const all = snap.exists() ? Object.values(snap.val()) : []
      setAnswers(all)
      if (roomStatusRef.current !== 'playing') return
      all.filter(a => a.is_correct).forEach(a => {
        if (notifiedAnswersRef.current.has(a.user_id)) return
        notifiedAnswersRef.current.add(a.user_id)
        const id = `${Date.now()}-${a.user_id}`
        setToasts(prev => [...prev, { id, nickname: a.player_name, time_ms: a.reaction_time_ms }])
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
      })
    })
    return () => unsubAns()
  }, [roomId, session, room?.current_question_index])

  // ── Auto-Accept ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gameConfig.auto_accept || !requests.length) return
    requests.forEach(req => {
      const playCount = playHistory[req.key] || 0
      const isBlocked = playCount > 0 && gameConfig.repeat_entry === 'block'
      if (!isBlocked && !processingRequests.has(req.key)) {
        console.log(`Auto-accepting player: ${req.player_name} (${req.key})`)
        handleRequest(req.key, 'approved')
      }
    });
  }, [gameConfig.auto_accept, requests, playHistory, gameConfig.repeat_entry])

  // ── Auto Mode: Reveal ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!room || room.status !== 'playing' || !gameConfig.auto_mode || isRevealing) return
    const totalPlayers = players.length
    if (totalPlayers > 0 && answers.length >= totalPlayers) {
      console.log("Auto-Mode: All players answered. Revealing...")
      revealAnswer(); return
    }
    const checkTimer = setInterval(() => {
      if (!room.question_started_at) return
      const elapsed = (Date.now() - room.question_started_at) / 1000
      if (elapsed >= gameConfig.auto_timer) {
        console.log("Auto-Mode: Mandatory Timer expired. Revealing...")
        revealAnswer(); clearInterval(checkTimer)
      }
    }, 1000)
    return () => clearInterval(checkTimer)
  }, [room?.status, answers.length, players.length, gameConfig.auto_mode, gameConfig.auto_timer, isRevealing])

  // ── Auto Mode: Next ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!room || room.status !== 'revealing' || !gameConfig.auto_mode) return
    const timer = setTimeout(() => {
      console.log("Auto-Mode: 8s delay finished. Moving to next question...")
      nextQuestion()
    }, 8000)
    return () => clearTimeout(timer)
  }, [room?.status, gameConfig.auto_mode])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleRequest = async (reqKey, action) => {
    setProcessingRequests(prev => new Set(prev).add(reqKey))
    try {
      if (action === 'approved') {
        const reqSnap = await get(ref(rtdb, `rooms/${roomId}/join_requests/${reqKey}`))
        if (!reqSnap.exists()) return
        const reqData = reqSnap.val()
        const currentQIdx = roomStatusRef.current === 'lobby' ? 0 : (room?.current_question_index ?? 0)
        await update(ref(rtdb), {
          [`rooms/${roomId}/join_requests/${reqKey}/status`]: 'approved',
          [`rooms/${roomId}/players/${reqKey}`]: {
            user_id: reqKey, nickname: reqData.player_name,
            avatar_url: reqData.player_avatar || null, score: 0,
            correct_count: 0, total_reaction_ms: 0,
            joined_at: Date.now(), joined_at_question_index: currentQIdx,
          }
        })
      } else {
        await update(ref(rtdb, `rooms/${roomId}/join_requests/${reqKey}`), { status: 'rejected' })
      }
    } catch (err) { alert('Error: ' + err.message) }
    finally { setProcessingRequests(prev => { const n = new Set(prev); n.delete(reqKey); return n }) }
  }

  const startGame = async () => {
    try {
      const secretKey = `${roomId}:${room.created_at}`
      let questions = { ...room.questions }
      if (gameConfig.shuffle_questions) { questions.questions = shuffleArray(questions.questions) }
      if (gameConfig.shuffle_choices) {
        questions = {
          ...questions,
          questions: questions.questions.map(q => {
            const indices = q.choices.map((_, i) => i)
            const shuffled = shuffleArray(indices)
            return { ...q, choices: shuffled.map(i => q.choices[i]), correct: shuffled.indexOf(q.correct) }
          })
        }
      }
      const secureQuestions = {
        ...questions,
        questions: questions.questions.map(async (q, qIdx) => {
          const correctHash = await generateCorrectAnswerHash(q.correct, `${roomId}-q${qIdx}`, roomId, secretKey)
          const { correct, ...qWithoutCorrect } = q
          return { ...qWithoutCorrect, correct_hash: correctHash }
        })
      }
      const secureQuestionsArray = await Promise.all(secureQuestions.questions)
      const finalQuestions = { ...questions, questions: secureQuestionsArray }
      await update(ref(rtdb, `rooms/${roomId}`), {
        status: 'playing', current_question_index: 0, question_started_at: Date.now(),
        config: gameConfig, questions: finalQuestions,
        countdown_started_at: null, countdown_duration: null,
      })
    } catch (err) { alert('Failed to start: ' + err.message) }
  }

  const endCompetition = async () => {
    if (!window.confirm('إنهاء المسابقة الآن؟')) return
    setEndingGame(true)
    try {
      await update(ref(rtdb, `rooms/${roomId}`), { status: 'finished' })
      await set(ref(rtdb, `host_rooms/${session.uid}/active`), null)
    } catch (err) { alert('Error: ' + err.message) }
    finally { setEndingGame(false) }
  }

  const revealAnswer = async () => {
    setIsRevealing(true)
    try {
      const { revealData } = await performReveal(roomId, room, players)
      setRevealResult(revealData)
    } catch (err) { alert('Reveal failed: ' + err.message) }
    finally { setIsRevealing(false) }
  }

  const nextQuestion = async () => {
    if (!room?.questions?.questions) return
    try {
      await performNextQuestion(roomId, room, session.uid)
      setRevealResult(null)
    } catch (err) { alert('Error: ' + err.message) }
  }

  const startCountdown = async () => {
    setStartingCountdown(true)
    try {
      const dur = room.config?.timer_seconds || 30
      await update(ref(rtdb, `rooms/${roomId}`), { countdown_started_at: Date.now(), countdown_duration: dur })
    } catch (err) { alert('Error: ' + err.message) }
    finally { setStartingCountdown(false) }
  }

  const downloadLogs = async () => {
    setDownloadingLogs(true)
    try {
      const questions = room.questions?.questions || []
      const lines = []
      const pad  = (s, n) => String(s).padEnd(n)
      lines.push('=== Med Royale — Game Log ===')
      lines.push(`Room      : ${roomId}`)
      lines.push(`Date      : ${new Date().toLocaleString()}`)
      lines.push(`Players   : ${players.length}`)
      lines.push(`Questions : ${questions.length}`)
      lines.push(`Scoring   : ${room.config?.scoring_mode || 'classic'}`)
      lines.push('')
      for (let qi = 0; qi < questions.length; qi++) {
        const q = questions[qi]
        lines.push('═'.repeat(62))
        lines.push(`Q${qi + 1}: ${formatFormulaForLog(q.question)}`)
        let correctIdx = -1
        const sessionSecret = `${roomId}:${room.created_at}`
        for (let i = 0; i < q.choices.length; i++) {
          const isMatch = await verifyAnswerHash(i, q.correct_hash, `${roomId}-q${qi}`, roomId, sessionSecret)
          if (isMatch) { correctIdx = i; break }
        }
        lines.push(`Correct: ${formatFormulaForLog(q.choices[correctIdx] || '?')}`)
        lines.push('─'.repeat(62))
        const ansSnap = await get(ref(rtdb, `rooms/${roomId}/answers/${qi}`))
        const ansMap  = ansSnap.exists() ? ansSnap.val() : {}
        const answered = Object.values(ansMap)
        const answeredIds = new Set(answered.map(a => a.user_id))
        const correct  = answered.filter(a => a.is_correct ).sort((a, b) => a.reaction_time_ms - b.reaction_time_ms)
        const wrong    = answered.filter(a => !a.is_correct).sort((a, b) => a.reaction_time_ms - b.reaction_time_ms)
        const noAnswer = players.filter(p => !answeredIds.has(p.user_id))
        correct.forEach((a, i) => {
          const pts = a.points_earned != null ? `  +${a.points_earned}pt` : ''
          lines.push(`  ✓  #${i + 1}  ${pad(a.player_name || '?', 28)}${pad(a.reaction_time_ms + 'ms', 10)}${pts}`)
        })
        wrong.forEach(a => {
          const chosen = formatFormulaForLog(q.choices[a.selected_choice] || '?')
          lines.push(`  ✗       ${pad(a.player_name || '?', 28)}${pad(a.reaction_time_ms + 'ms', 10)}  chose: ${chosen}`)
        })
        noAnswer.forEach(p => { lines.push(`  —       ${pad(p.nickname, 28)}no answer`) })
        lines.push('')
      }
      lines.push('═'.repeat(62))
      lines.push('FINAL SCORES')
      lines.push('─'.repeat(62))
      players.forEach((p, i) => { lines.push(`  #${pad(i + 1, 4)}${pad(p.nickname, 32)}${p.score} pts`) })
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/plain;charset=utf-8' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `dactoor-${roomId}-${new Date().toISOString().slice(0, 10)}.txt`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) { alert('Error downloading logs: ' + err.message) }
    finally { setDownloadingLogs(false) }
  }

  const collectGameResults = async () => {
    try {
      const questions = room.questions?.questions || []
      const results = []
      for (const player of players) {
        const playerAnswers = []
        let activityLog = []
        for (let qIdx = 0; qIdx < questions.length; qIdx++) {
          const ansSnap = await get(ref(rtdb, `rooms/${roomId}/answers/${qIdx}/${player.user_id}`))
          if (ansSnap.exists()) {
            const ansData = ansSnap.val()
            playerAnswers.push({
              question_index: qIdx, is_correct: ansData.is_correct || false,
              reaction_time: ansData.reaction_time_ms || 0, selected_choice: ansData.selected_choice,
              points_earned: ansData.points_earned || 0, rank: ansData.rank || null,
              is_first_correct: ansData.is_first_correct || false,
            })
          }
        }
        const activitySnap = await get(ref(rtdb, `rooms/${roomId}/activity_log/${player.user_id}`))
        if (activitySnap.exists()) { activityLog = Object.values(activitySnap.val()) || [] }
        results.push({ userId: player.user_id, username: player.nickname || 'Unknown', score: player.score || 0, answers: playerAnswers, activityLog, avatar_url: player.avatar_url || null })
      }
      setGameResults(results)
    } catch (err) { console.error('Error collecting game results:', err); alert('Error collecting game results: ' + err.message) }
  }

  const notificationsWrittenRef = useRef(false)
  const writeGameNotifications = async () => {
    if (notificationsWrittenRef.current) return
    notificationsWrittenRef.current = true
    try {
      const hostUid = session?.uid
      if (!hostUid) return
      const hostNotifRef = doc(db, 'notifications', hostUid, 'items', roomId)
      const existing = await getDoc(hostNotifRef)
      if (existing.exists()) return
      const sortedLeaderboard = sortPlayers([...players]).map((p, i) => ({ rank: i + 1, user_id: p.user_id, nickname: p.nickname, score: p.score }))
      const winner = sortedLeaderboard[0] || null
      await setDoc(hostNotifRef, { type: 'game_finished', room_id: roomId, room_title: room.title || roomId, total_players: players.length, winner_nickname: winner?.nickname || null, results_url: `/host/game/${roomId}`, created_at: serverTimestamp(), read: false })
      await Promise.all(sortedLeaderboard.map(async (entry, idx) => {
        const playerNotifRef = doc(db, 'notifications', entry.user_id, 'items', roomId)
        const playerExisting = await getDoc(playerNotifRef)
        if (playerExisting.exists()) return
        return setDoc(playerNotifRef, { type: 'game_finished', room_id: roomId, room_title: room.title || roomId, my_rank: idx + 1, my_score: entry.score, total_players: players.length, full_leaderboard: sortedLeaderboard, created_at: serverTimestamp(), read: false })
      }))
    } catch (err) { console.error('[Notifications] Failed to write game notifications:', err) }
  }

  const ffaResultsWrittenRef = useRef(false)
  const writeTournamentFFAResults = useCallback(async (tournamentId) => {
    if (ffaResultsWrittenRef.current) return
    ffaResultsWrittenRef.current = true
    try {
      const sorted = sortPlayers([...players])
      const topCutSnap = await getDoc(doc(db, 'tournaments', tournamentId))
      const actualTopCut = topCutSnap.data()?.actual_top_cut || 8
      const hasSameStats = (a, b) =>
        a.score === b.score &&
        (a.correct_count ?? 0) === (b.correct_count ?? 0) &&
        (a.total_reaction_ms ?? 0) === (b.total_reaction_ms ?? 0)
      let finalOrder = sorted
      if (sorted.length > actualTopCut) {
        const cutPlayer  = sorted[actualTopCut - 1]
        const nextPlayer = sorted[actualTopCut]
        if (hasSameStats(cutPlayer, nextPlayer)) {
          const firstTiedIdx = sorted.findIndex(p => hasSameStats(p, cutPlayer))
          const tiedGroup    = sorted.filter(p => hasSameStats(p, cutPlayer))
          const shuffledTied = [...tiedGroup].sort(() => Math.random() - 0.5)
          finalOrder = [...sorted.slice(0, firstTiedIdx), ...shuffledTied]
          console.log(`[Tournament FFA] Random tie-break at cut ${actualTopCut}: ${tiedGroup.length} tied players shuffled`)
        }
      }
      const batch = writeBatch(db)
      finalOrder.forEach((p, i) => {
        const rank = i + 1; const advanced = rank <= actualTopCut
        batch.set(doc(db, 'tournaments', tournamentId, 'ffa_results', p.user_id), {
          uid: p.user_id, nickname: p.nickname, avatar_url: p.avatar_url || null,
          score: p.score, correct_count: p.correct_count ?? 0, total_reaction_ms: p.total_reaction_ms ?? 0,
          rank, advanced,
        })
      })
      await batch.commit()
      await updateDoc(doc(db, 'tournaments', tournamentId), { status: 'bracket', current_round: 1 })
    } catch (err) { console.error('[Tournament] Failed to write FFA results:', err) }
  }, [players])

  useEffect(() => {
    if (room?.status === 'finished' && !gameResults) {
      collectGameResults()
      writeGameNotifications()
      if (room?.tournament_id) { writeTournamentFFAResults(room.tournament_id) }
    }
  }, [room?.status, room?.questions, gameResults, roomId, players])

  const nextQImg = room?.questions?.questions?.[room?.current_question_index + 1]?.image_url
  useEffect(() => {
    if (!nextQImg) return
    const img = new Image(); img.src = nextQImg
  }, [nextQImg])

  // ── Loading ───────────────────────────────────────────────────────────────
  if (!room) return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--ink-3)' }} />
      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-4)', letterSpacing: '0.1em' }}>LOADING ROOM…</span>
    </div>
  )

  const currentQ      = room.questions?.questions?.[room.current_question_index]
  const isRevealPhase = room.status === 'revealing'
  const totalPlayers  = players.length
  const answeredCount = answers.length
  const config        = room.config || { scoring_mode: 'classic' }

  const openPlayerProfile = (p) => setProfileModal(p)

  const card = (children, style = {}) => (
    <div style={{ border: '1px solid var(--rule)', borderBottomWidth: 2, background: 'var(--paper)', ...style }}>
      {children}
    </div>
  )

  const statusColor = { playing: 'var(--success)', revealing: 'var(--gold)', finished: 'var(--navy)', lobby: 'var(--ink-3)' }[room.status] || 'var(--ink-3)'

  return (
    <div className="paper-grain" style={{ minHeight: '100svh', background: 'var(--paper)', color: 'var(--ink)' }}>

      {/* ── Player Profile Modal ── */}
      {profileModal && <PlayerProfileModal player={profileModal} onClose={() => setProfileModal(null)} />}

      {/* ── Toast notifications ── */}
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', right: 16, top: 80, zIndex: 200, display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none', maxWidth: 220 }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--paper)', border: '1px solid var(--success)', borderBottomWidth: 2,
              padding: '8px 12px',
            }}>
              <CheckCircle size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>{t.nickname}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)', flexShrink: 0 }}>{t.time_ms}ms</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 20px 60px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Header ── */}
        <div style={{ borderBottom: '3px double var(--rule-strong)', paddingBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 2 }}>
              HOST · GAME ROOM
            </p>
            <h1 dir={getDir(room.title, room.force_rtl)} style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 'clamp(20px, 4vw, 30px)', color: 'var(--ink)', margin: '0 0 6px', lineHeight: 1.1 }}>
              {room.title}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--navy)', letterSpacing: '0.18em' }}>
                JOIN: {roomId}
              </p>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
                padding: '2px 8px', border: `1px solid ${statusColor}`, color: statusColor,
              }}>{room.status}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {/* Quick toggles */}
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { key: 'auto_mode', label: 'AUTO', color: 'var(--gold)', icon: <Zap size={11} /> },
                { key: 'auto_accept', label: 'ACCEPT', color: 'var(--success)', icon: <UserCheck size={11} /> },
                { key: 'unattended_mode', label: 'AWAY', color: 'var(--burgundy)', icon: <Moon size={11} /> },
              ].map(t => (
                <button key={t.key}
                  onClick={() => {
                    if (t.key === 'unattended_mode') {
                      const next = !gameConfig.unattended_mode
                      setGameConfig(prev => next ? { ...prev, unattended_mode: true, auto_accept: true, auto_mode: true } : { ...prev, unattended_mode: false })
                    } else {
                      setGameConfig(prev => ({ ...prev, [t.key]: !prev[t.key] }))
                    }
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                    border: `1px solid ${gameConfig[t.key] ? t.color : 'var(--rule)'}`,
                    background: gameConfig[t.key] ? `color-mix(in srgb, ${t.color} 10%, transparent)` : 'none',
                    color: gameConfig[t.key] ? t.color : 'var(--ink-4)',
                    cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em',
                  }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            <div style={{ textAlign: 'right' }}>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>{totalPlayers}</p>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--ink-4)', letterSpacing: '0.1em' }}>PLAYERS</p>
            </div>

            {room.status !== 'finished' && (
              <button onClick={endCompetition} disabled={endingGame} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                border: '1px solid var(--alert)', background: 'none', cursor: endingGame ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'var(--alert)', opacity: endingGame ? 0.5 : 1,
              }}>
                <StopCircle size={12} /> {endingGame ? 'ENDING…' : 'END'}
              </button>
            )}
          </div>
        </div>

        {/* ── LOBBY ── */}
        {room.status === 'lobby' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>

            {/* Join Requests */}
            {card(
              <>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <p style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>JOIN REQUESTS</p>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: requests.length > 0 ? 'var(--burgundy)' : 'var(--ink-4)' }}>{requests.length}</span>
                </div>
                <div style={{ maxHeight: 280, overflowY: 'auto', padding: '8px 0' }}>
                  {requests.length === 0 ? (
                    <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-4)', textAlign: 'center', padding: '24px 16px', letterSpacing: '0.08em' }}>NO REQUESTS…</p>
                  ) : requests.map(req => {
                    const playCount = playHistory[req.key] || 0
                    const isRepeater = playCount > 0
                    const isBlocked  = isRepeater && gameConfig.repeat_entry === 'block'
                    return (
                      <div key={req.key} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 16px', borderBottom: '1px solid var(--rule)',
                        borderRight: isBlocked ? '2px solid var(--alert)' : 'none',
                        background: isBlocked ? 'rgba(181,67,44,0.03)' : 'var(--paper)',
                      }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            {req.player_avatar && <img src={req.player_avatar} alt="" style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0 }} />}
                            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {req.player_name}
                            </span>
                            {isRepeater && gameConfig.repeat_entry !== 'allow' && (
                              <span style={{
                                fontFamily: 'var(--mono)', fontSize: 9, padding: '1px 5px',
                                border: `1px solid ${isBlocked ? 'var(--alert)' : 'var(--gold)'}`,
                                color: isBlocked ? 'var(--alert)' : 'var(--gold)',
                              }}>{isBlocked ? '🚫' : '⚠️'} {playCount}x</span>
                            )}
                          </div>
                          <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.player_email}</p>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          {processingRequests.has(req.key) ? (
                            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--ink-3)' }} />
                          ) : (
                            <>
                              <button onClick={() => handleRequest(req.key, 'approved')} disabled={isBlocked} style={{
                                background: 'none', border: '1px solid var(--success)', padding: '4px 8px', cursor: isBlocked ? 'not-allowed' : 'pointer',
                                color: 'var(--success)', display: 'flex', alignItems: 'center', opacity: isBlocked ? 0.3 : 1,
                              }}><CheckCircle size={14} /></button>
                              <button onClick={() => handleRequest(req.key, 'rejected')} style={{
                                background: 'none', border: '1px solid var(--alert)', padding: '4px 8px', cursor: 'pointer',
                                color: 'var(--alert)', display: 'flex', alignItems: 'center',
                              }}><XCircle size={14} /></button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* Right column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Players ready */}
              {card(
                <>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <p style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>READY</p>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: totalPlayers > 0 ? 'var(--success)' : 'var(--ink-4)' }}>{totalPlayers}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, padding: 12, maxHeight: 120, overflowY: 'auto' }}>
                    {totalPlayers === 0 ? (
                      <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.08em', gridColumn: '1/-1' }}>WAITING FOR PLAYERS…</p>
                    ) : players.map(p => (
                      <button key={p.user_id} onClick={() => openPlayerProfile(p)} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                        border: '1px solid var(--rule)', background: 'none', cursor: 'pointer',
                        textAlign: 'left', transition: 'border-color 150ms',
                      }}>
                        {p.avatar_url ? <img src={p.avatar_url} alt="" style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0 }} /> : <UserCheck size={13} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />}
                        <span style={{ fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.nickname}</span>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: presence[p.user_id]?.online ? 'var(--success)' : 'var(--rule)' }} />
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Config */}
              <GameConfigPanel config={gameConfig} onChange={setGameConfig} />

              {/* Start */}
              <button onClick={startGame} disabled={totalPlayers === 0} style={{
                width: '100%', padding: '14px 0',
                background: totalPlayers === 0 ? 'var(--rule)' : 'var(--ink)',
                color: totalPlayers === 0 ? 'var(--ink-4)' : 'var(--paper)',
                border: 'none', cursor: totalPlayers === 0 ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--serif)', fontStyle: 'italic', fontWeight: 300, fontSize: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                transition: 'opacity 150ms',
              }}>
                <Play size={18} fill="currentColor" />
                Start Game
              </button>
            </div>
          </div>
        )}

        {/* ── PLAYING & REVEALING ── */}
        {(room.status === 'playing' || room.status === 'revealing') && currentQ && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Question card */}
            {card(
              <div style={{ padding: '20px 20px 0' }}>
                {/* Progress + meta */}
                <div style={{ height: 2, background: 'var(--rule)', marginBottom: 16, position: 'relative' }}>
                  <div style={{
                    position: 'absolute', inset: 0, background: 'var(--ink)',
                    width: `${((room.current_question_index + 1) / room.questions.questions.length) * 100}%`,
                    transition: 'width 300ms',
                  }} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--navy)', letterSpacing: '0.1em' }}>
                    Q {room.current_question_index + 1} / {room.questions.questions.length}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)', padding: '2px 8px', border: '1px solid var(--rule)' }}>
                      {config.scoring_mode === 'classic' ? 'CLASSIC' : config.scoring_mode === 'custom' ? `${config.first_correct_points}/${config.other_correct_points}` : `RANKED ${config.first_correct_points}−${config.points_decrement}`}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: answeredCount === totalPlayers ? 'var(--success)' : 'var(--ink-3)', fontWeight: answeredCount === totalPlayers ? 700 : 400 }}>
                      {answeredCount}/{totalPlayers}
                    </span>
                  </div>
                </div>

                {room.countdown_started_at && (
                  <div style={{ marginBottom: 14 }}>
                    <CountdownBar startedAt={room.countdown_started_at} duration={room.countdown_duration} />
                  </div>
                )}

                <h2 dir={getDir(currentQ.question, room.force_rtl)} style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 'clamp(16px, 2.5vw, 22px)', color: 'var(--ink)', margin: '0 0 16px', lineHeight: 1.45 }}>
                  <MathText text={currentQ.question} dir={room.force_rtl ? 'rtl' : 'auto'} />
                </h2>

                {currentQ.image_url && (
                  <div style={{ marginBottom: 16 }}>
                    <QuestionImage src={currentQ.image_url} style={{ width: '100%', maxHeight: 220, objectFit: 'contain', border: '1px solid var(--rule)' }} />
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                  {currentQ.choices.map((choice, i) => {
                    const isCorrect = i === room.revealed_correct_index
                    const count     = answers.filter(a => a.selected_choice === i).length
                    return (
                      <div key={i} dir={getDir(choice, room.force_rtl)} style={{
                        padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        border: isRevealPhase
                          ? isCorrect ? '2px solid var(--success)' : '1px solid var(--rule)'
                          : '1px solid var(--rule)',
                        borderBottomWidth: isRevealPhase && isCorrect ? 3 : isRevealPhase ? 1 : 2,
                        background: isRevealPhase && isCorrect ? 'rgba(60,110,71,0.06)' : isRevealPhase ? 'var(--paper-2)' : 'var(--paper)',
                        opacity: isRevealPhase && !isCorrect ? 0.55 : 1,
                        transition: 'all 200ms',
                      }}>
                        <span style={{ fontSize: 14, color: isRevealPhase && isCorrect ? 'var(--success)' : 'var(--ink)', fontWeight: isRevealPhase && isCorrect ? 600 : 400 }}>
                          <MathText text={choice} dir={room.force_rtl ? 'rtl' : 'auto'} />
                        </span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: isRevealPhase && isCorrect ? 'var(--success)' : 'var(--ink-3)', marginLeft: 10, flexShrink: 0 }}>
                          {count}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* Honor roll */}
                {isRevealPhase && revealResult && (
                  <div style={{ borderTop: '1px solid var(--rule)', padding: '16px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Star size={13} style={{ color: 'var(--gold)' }} />
                        <p className="folio" style={{ fontSize: 9 }}>لوحة شرف السؤال</p>
                      </div>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)' }}>{revealResult.correct_count} إجابة صحيحة</span>
                    </div>

                    {revealResult.winners?.length > 0 ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                        {revealResult.winners.map(w => (
                          <div key={w.user_id} style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                            border: `1px solid ${w.rank === 1 ? 'var(--gold)' : 'var(--rule)'}`,
                            borderBottomWidth: w.rank <= 3 ? 2 : 1,
                          }}>
                            <span style={{
                              fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, flexShrink: 0,
                              color: w.rank === 1 ? 'var(--gold)' : w.rank === 2 ? 'var(--ink-3)' : w.rank === 3 ? 'var(--burgundy)' : 'var(--ink-4)',
                            }}>#{w.rank}</span>
                            <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.nickname}</span>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <p style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--navy)' }}>+{w.points}</p>
                              <p style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--ink-4)' }}>{w.time_ms}ms</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <XCircle size={28} style={{ color: 'var(--rule)', display: 'block', margin: '0 auto 8px' }} />
                        <p className="ar" style={{ fontSize: 13, color: 'var(--ink-4)' }}>ما حدش أجاب صح!</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Controls */}
                <div style={{ borderTop: '1px solid var(--rule)', padding: '14px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  {room.status === 'playing' ? (
                    <button onClick={startCountdown} disabled={!!room.countdown_started_at || startingCountdown} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                      border: '1px solid var(--rule)', borderBottomWidth: 2,
                      background: 'none', cursor: (room.countdown_started_at || startingCountdown) ? 'not-allowed' : 'pointer',
                      fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
                      color: room.countdown_started_at ? 'var(--ink-4)' : 'var(--ink)',
                      opacity: (room.countdown_started_at || startingCountdown) ? 0.4 : 1,
                    }}>
                      <Timer size={13} />
                      {room.countdown_started_at ? 'COUNTING…' : `COUNTDOWN ${room.config?.timer_seconds || 30}s`}
                    </button>
                  ) : <div />}

                  <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                    {room.status === 'playing' && (
                      <button onClick={revealAnswer} disabled={isRevealing} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px',
                        background: 'var(--gold)', color: 'var(--paper)',
                        border: 'none', cursor: isRevealing ? 'not-allowed' : 'pointer',
                        fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                        opacity: isRevealing ? 0.5 : 1,
                      }}>
                        <Eye size={14} /> {isRevealing ? '…' : 'REVEAL'}
                      </button>
                    )}
                    {room.status === 'revealing' && (
                      <button onClick={nextQuestion} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px',
                        background: 'var(--ink)', color: 'var(--paper)',
                        border: 'none', cursor: 'pointer',
                        fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                      }}>
                        NEXT <SkipForward size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Live Leaderboard */}
            {card(
              <>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Trophy size={13} style={{ color: 'var(--gold)' }} />
                  <p style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>LIVE LEADERBOARD</p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6, padding: 12 }}>
                  {players.slice(0, 8).map((p, idx) => (
                    <button key={p.user_id} onClick={() => openPlayerProfile(p)} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                      border: '1px solid var(--rule)', background: 'none', cursor: 'pointer',
                      transition: 'border-color 150ms',
                    }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-4)', flexShrink: 0 }}>#{idx + 1}</span>
                      <span style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nickname}</span>
                      {!presence[p.user_id]?.online && <WifiOff size={11} style={{ color: 'var(--alert)', flexShrink: 0 }} />}
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--navy)', flexShrink: 0 }}>{p.score}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Late-join requests */}
            {requests.length > 0 && (
              <div style={{ border: '1px solid var(--gold)', borderBottomWidth: 2, background: 'rgba(176,137,68,0.04)' }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(176,137,68,0.3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <UserCheck size={13} style={{ color: 'var(--gold)' }} />
                  <p className="ar" style={{ fontFamily: 'var(--arabic)', fontSize: 13, fontWeight: 600, color: 'var(--gold)' }}>
                    طلبات دخول متأخر — فاتهم {room.current_question_index} سؤال
                  </p>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px', border: '1px solid var(--gold)', color: 'var(--gold)' }}>{requests.length}</span>
                </div>
                <div style={{ padding: '8px 0' }}>
                  {requests.map(req => (
                    <div key={req.key} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 16px', borderBottom: '1px solid rgba(176,137,68,0.15)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                        {req.player_avatar && <img src={req.player_avatar} alt="" style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0 }} />}
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.player_name}</p>
                          <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.player_email}</p>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 10 }}>
                        {processingRequests.has(req.key) ? (
                          <Loader2 size={14} className="animate-spin" style={{ color: 'var(--ink-3)' }} />
                        ) : (
                          <>
                            <button onClick={() => handleRequest(req.key, 'approved')} style={{ background: 'none', border: '1px solid var(--success)', padding: '3px 7px', cursor: 'pointer', color: 'var(--success)', display: 'flex', alignItems: 'center' }}><CheckCircle size={13} /></button>
                            <button onClick={() => handleRequest(req.key, 'rejected')} style={{ background: 'none', border: '1px solid var(--alert)', padding: '3px 7px', cursor: 'pointer', color: 'var(--alert)', display: 'flex', alignItems: 'center' }}><XCircle size={13} /></button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── FINISHED ── */}
        {room.status === 'finished' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Tab bar */}
            <div style={{ display: 'flex', borderBottom: '3px double var(--rule-strong)' }}>
              {[
                { key: 'leaderboard', label: 'ترتيب الأبطال', icon: <Trophy size={13} /> },
                { key: 'security',    label: 'التحقيق الأمني', icon: <Shield size={13} /> },
              ].map(t => (
                <button key={t.key} onClick={() => setResultTab(t.key)} className="ar" style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '12px 20px',
                  border: 'none', borderBottom: `3px solid ${resultTab === t.key ? 'var(--ink)' : 'transparent'}`,
                  marginBottom: -3, background: 'none', cursor: 'pointer',
                  fontFamily: 'var(--arabic)', fontWeight: 600, fontSize: 13,
                  color: resultTab === t.key ? 'var(--ink)' : 'var(--ink-4)',
                }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {selectedPlayer ? (
              <div>
                <button onClick={() => setSelectedPlayer(null)} style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16,
                  padding: '8px 16px', border: '1px solid var(--rule)', background: 'none',
                  cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10,
                  letterSpacing: '0.1em', color: 'var(--ink-3)',
                }}>
                  ← BACK TO REPORT
                </button>
                <ActivityLogViewer username={selectedPlayer.username} activityLog={selectedPlayer.activityLog} suspicionIndicators={selectedPlayer.indicators || []} />
              </div>
            ) : resultTab === 'leaderboard' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Top 3 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {players.slice(0, 3).map((p, idx) => {
                    const rankColor = ['var(--gold)', 'var(--ink-3)', 'var(--burgundy)'][idx]
                    const medals    = ['🥇', '🥈', '🥉']
                    return (
                      <div key={p.user_id} style={{
                        border: `1px solid ${rankColor}`, borderBottomWidth: 3,
                        padding: '20px 16px', textAlign: 'center',
                        background: `color-mix(in srgb, ${rankColor} 4%, transparent)`,
                      }}>
                        <p style={{ fontSize: 28, marginBottom: 8 }}>{medals[idx]}</p>
                        <h3 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 18, color: 'var(--ink)', margin: '0 0 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nickname}</h3>
                        <p style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: rankColor }}>{p.score}</p>
                        <p className="folio" style={{ fontSize: 9, marginTop: 4 }}>{['CHAMPION', 'RUNNER-UP', 'THIRD'][idx]}</p>
                      </div>
                    )
                  })}
                </div>

                {/* Full table */}
                {card(
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--rule-strong)' }}>
                        <th className="folio" style={{ padding: '10px 16px', textAlign: 'left', fontSize: 9 }}>#</th>
                        <th className="folio" style={{ padding: '10px 16px', textAlign: 'left', fontSize: 9 }}>PLAYER</th>
                        <th className="folio" style={{ padding: '10px 16px', textAlign: 'center', fontSize: 9 }}>SCORE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {players.map((p, idx) => (
                        <tr key={p.user_id} onClick={() => openPlayerProfile(p)} style={{
                          borderBottom: '1px solid var(--rule)',
                          background: idx < 3 ? `color-mix(in srgb, var(--gold) 3%, transparent)` : 'transparent',
                          cursor: 'pointer',
                        }}>
                          <td style={{ padding: '10px 16px' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: idx < 3 ? 'var(--gold)' : 'var(--ink-4)' }}>#{idx + 1}</span>
                          </td>
                          <td style={{ padding: '10px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              {p.avatar_url ? (
                                <img src={p.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--rule)', objectFit: 'cover', flexShrink: 0 }} />
                              ) : (
                                <div style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--rule)', background: 'var(--paper-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  <span style={{ fontFamily: 'var(--serif)', fontSize: 11, color: 'var(--ink-3)' }}>{p.nickname?.[0]}</span>
                                </div>
                              )}
                              <span style={{ fontFamily: 'var(--sans)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{p.nickname}</span>
                            </div>
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 15, color: 'var(--navy)' }}>{p.score}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {room?.tournament_id && (
                  <div style={{ border: '1px solid var(--navy)', borderBottomWidth: 2, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, background: 'rgba(45,62,92,0.04)' }}>
                    <div>
                      <p className="ar" style={{ fontFamily: 'var(--arabic)', fontWeight: 600, fontSize: 14, color: 'var(--navy)' }}>انتهت مرحلة FFA 🏆</p>
                      <p className="ar" style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 4 }}>تحقق من النتائج أدناه، ثم انتقل للـ Bracket من لوحة التحكم.</p>
                    </div>
                    <button onClick={() => navigate('/host/dashboard')} style={{
                      flexShrink: 0, padding: '8px 16px', border: '1px solid var(--rule)',
                      background: 'none', cursor: 'pointer', fontFamily: 'var(--mono)',
                      fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink-3)',
                    }}>← DASHBOARD</button>
                  </div>
                )}
                {gameResults ? (
                  <HostGameReport gameResults={gameResults} onViewDetails={setSelectedPlayer} />
                ) : (
                  <div style={{ padding: '64px 0', textAlign: 'center' }}>
                    <Loader2 size={32} className="animate-spin" style={{ color: 'var(--ink-3)', display: 'block', margin: '0 auto 16px' }} />
                    <p className="ar" style={{ color: 'var(--ink-4)', fontSize: 14 }}>جاري تحضير تقرير التحقيق…</p>
                  </div>
                )}
              </div>
            )}

            {/* Footer actions */}
            <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={downloadLogs} disabled={downloadingLogs} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px',
                border: '1px solid var(--rule)', background: 'none', cursor: downloadingLogs ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink-3)',
                opacity: downloadingLogs ? 0.5 : 1,
              }}>
                {downloadingLogs ? <><Loader2 size={13} className="animate-spin" /> DOWNLOADING…</> : <><Trophy size={13} style={{ color: 'var(--gold)' }} /> DOWNLOAD LOGS (.txt)</>}
              </button>
              <button onClick={() => navigate('/host/dashboard')} style={{
                padding: '10px 28px', background: 'var(--ink)', color: 'var(--paper)',
                border: 'none', cursor: 'pointer',
                fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
              }}>← DASHBOARD</button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
