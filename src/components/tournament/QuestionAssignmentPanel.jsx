import React, { useState, useCallback } from 'react'
import { X, Plus, Minus, GripVertical, Lock, BookOpen, CheckCircle2, Zap, AlertTriangle } from 'lucide-react'
import {
  QUESTIONS_PER_MATCH, TOP_CUT_CHOICES, roundsForTopCut, validateRoundAssignments,
  assignedIndices, reshapeAssignments,
} from '../../utils/tournamentUtils'

function getRoundName(round, total) {
  if (round === total)     return 'النهائي'
  if (round === total - 1) return 'نصف النهائي'
  if (round === total - 2) return 'ربع النهائي'
  return `الجولة ${round}`
}

export default function QuestionAssignmentPanel({
  deckQs         = [],
  roundQuestions = {},
  topCut         = 8,
  totalRounds    = null,   // fixed round count (bracket phase — cap already locked)
  editableTopCut = false,
  lockedRounds   = [],
  ffaLocked      = false,
  onSave,
  onClose,
}) {
  // Round count follows the bracket cap, which is the one number the host
  // actually reasons about ("how many make it through").
  const [cap, setCap] = useState(() => topCut || 8)
  const roundCount = totalRounds ? Math.max(totalRounds, 1) : roundsForTopCut(cap)

  const [assignments, setAssignments] = useState(() => {
    const init = { ffa: [...(roundQuestions['ffa'] || [])] }
    const n = totalRounds ? Math.max(totalRounds, 1) : roundsForTopCut(topCut || 8)
    for (let r = 1; r <= n; r++) init[r] = [...(roundQuestions[String(r)] || [])]
    return init
  })

  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo,   setRangeTo]   = useState('')
  // Default to the first slot that can still receive questions, so the panel
  // doesn't open with a disabled option selected mid-bracket.
  const [rangeSlot, setRangeSlot] = useState(() => {
    if (!ffaLocked) return 'ffa'
    const n = totalRounds ? Math.max(totalRounds, 1) : roundsForTopCut(topCut || 8)
    for (let r = 1; r <= n; r++) if (!lockedRounds.some(x => Number(x) === r)) return String(r)
    return 'ffa'
  })
  const [rangeNote, setRangeNote] = useState(null)

  const [dragIdx,  setDragIdx]  = useState(null)
  const [dragFrom, setDragFrom] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const [tapIdx,   setTapIdx]   = useState(null)

  // slot arrives as a number from renderSlot and as a string from the range
  // <select>, so compare numerically — otherwise a finished round reads unlocked.
  const isSlotLocked = (slot) =>
    slot === 'ffa' ? ffaLocked : lockedRounds.some(r => Number(r) === Number(slot))

  const copyAll = (prev) => {
    const copy = { ffa: [...(prev['ffa'] || [])] }
    for (let r = 1; r <= roundCount; r++) copy[r] = [...(prev[r] || [])]
    return copy
  }

  const allAssigned = assignedIndices(assignments, roundCount)
  const pool = deckQs.map((_, i) => i).filter(i => !allAssigned.has(i))

  // Halving/doubling the cap adds or drops a round. Questions in a dropped
  // round are released back to the pool rather than thrown away — the host can
  // redistribute them across the rounds that remain.
  const changeCap = useCallback((nextCap) => {
    if (!editableTopCut || !nextCap || nextCap === cap) return
    const nextRounds = roundsForTopCut(nextCap)
    setAssignments(prev => reshapeAssignments(prev, roundsForTopCut(cap), nextRounds))
    setCap(nextCap)
    if (rangeSlot !== 'ffa' && Number(rangeSlot) > nextRounds) setRangeSlot('ffa')
  }, [cap, editableTopCut, rangeSlot])

  // Assign a whole span of the deck at once — dragging 40 questions one by one
  // was the actual bottleneck.
  const applyRange = useCallback(() => {
    const from = parseInt(rangeFrom, 10)
    const to   = parseInt(rangeTo, 10)
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return setRangeNote({ bad: true, text: 'اكتب رقم البداية والنهاية' })
    }
    const lo = Math.max(1, Math.min(from, to))
    const hi = Math.min(deckQs.length, Math.max(from, to))
    if (hi < lo) return setRangeNote({ bad: true, text: 'النطاق خارج حدود البنك' })
    if (isSlotLocked(rangeSlot)) return setRangeNote({ bad: true, text: 'الجولة دي منتهية' })

    const wanted = []
    for (let i = lo - 1; i <= hi - 1; i++) wanted.push(i)
    const free  = wanted.filter(i => !allAssigned.has(i))
    const taken = wanted.length - free.length

    if (free.length === 0) {
      return setRangeNote({ bad: true, text: 'كل الأسئلة في النطاق ده مخصصة بالفعل' })
    }

    setAssignments(prev => {
      const copy = copyAll(prev)
      if (!copy[rangeSlot]) copy[rangeSlot] = []
      copy[rangeSlot] = [...copy[rangeSlot], ...free.filter(i => !copy[rangeSlot].includes(i))]
      return copy
    })
    setRangeNote({
      bad: false,
      text: `تمت إضافة ${free.length} سؤال` + (taken ? ` — ${taken} كانوا مخصصين وتم تخطيهم` : ''),
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeFrom, rangeTo, rangeSlot, deckQs.length, assignments, roundCount])

  const onDragStart = useCallback((e, idx, fromSlot) => {
    setDragIdx(idx); setDragFrom(fromSlot); setTapIdx(null)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }, [])

  const onDragEnd = useCallback(() => { setDragIdx(null); setDragFrom(null); setDragOver(null) }, [])

  const dropOnSlot = useCallback((e, toSlot) => {
    e.preventDefault()
    if (dragIdx === null || isSlotLocked(toSlot)) return
    setAssignments(prev => {
      const copy = copyAll(prev)
      if (dragFrom !== null && copy[dragFrom] !== undefined)
        copy[dragFrom] = copy[dragFrom].filter(i => i !== dragIdx)
      if (!copy[toSlot]) copy[toSlot] = []
      if (!copy[toSlot].includes(dragIdx)) copy[toSlot] = [...copy[toSlot], dragIdx]
      return copy
    })
    onDragEnd()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragIdx, dragFrom, roundCount, ffaLocked, lockedRounds, onDragEnd])

  const dropOnPool = useCallback((e) => {
    e.preventDefault()
    if (dragIdx === null || dragFrom === null) return
    setAssignments(prev => {
      const copy = copyAll(prev)
      if (copy[dragFrom] !== undefined) copy[dragFrom] = copy[dragFrom].filter(i => i !== dragIdx)
      return copy
    })
    onDragEnd()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragIdx, dragFrom, roundCount, onDragEnd])

  const tapPool = (idx) => setTapIdx(prev => prev === idx ? null : idx)

  const tapSlot = (slot) => {
    if (tapIdx === null || isSlotLocked(slot)) return
    setAssignments(prev => {
      const copy = copyAll(prev)
      if (!copy[slot]) copy[slot] = []
      if (!copy[slot].includes(tapIdx)) copy[slot] = [...copy[slot], tapIdx]
      return copy
    })
    setTapIdx(null)
  }

  const removeQ = (slot, idx) => {
    setAssignments(prev => ({ ...prev, [slot]: (prev[slot] || []).filter(i => i !== idx) }))
  }

  const draft = (() => {
    const out = { ffa: assignments['ffa'] || [] }
    for (let r = 1; r <= roundCount; r++) out[String(r)] = assignments[r] || []
    return out
  })()
  const check = validateRoundAssignments(draft, roundCount)

  const handleSave = () => onSave(draft, editableTopCut ? cap : null)

  const renderSlot = (slotKey, label, accentColor, icon) => {
    const isLocked   = isSlotLocked(slotKey)
    const slotQs     = assignments[slotKey] || []
    const isDropping = dragOver === slotKey && !isLocked
    const isTapReady = tapIdx !== null && !isLocked

    return (
      <div
        key={String(slotKey)}
        onDragOver={e => { if (!isLocked) { e.preventDefault(); setDragOver(slotKey) } }}
        onDragLeave={() => dragOver === slotKey && setDragOver(null)}
        onDrop={e => dropOnSlot(e, slotKey)}
        onClick={() => tapSlot(slotKey)}
        style={{
          padding: 12, minHeight: 80, borderRadius: 4, cursor: isLocked ? 'default' : 'pointer',
          border: `1px solid ${isDropping ? accentColor : isTapReady ? accentColor + '88' : isLocked ? 'var(--rule)' : 'var(--rule)'}`,
          background: isDropping ? `color-mix(in srgb, ${accentColor} 8%, var(--paper))` :
                      isTapReady ? `color-mix(in srgb, ${accentColor} 4%, var(--paper))` :
                      isLocked ? 'var(--paper-2)' : 'var(--paper)',
          opacity: isLocked ? 0.6 : 1,
          transition: 'all 150ms',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          {isLocked ? <Lock size={10} style={{ color: 'var(--ink-4)' }} /> : icon}
          <span className="ar folio" style={{
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em',
            color: isLocked ? 'var(--ink-4)' : 'var(--ink-2)',
          }}>
            {label}
          </span>
          {(() => {
            const need   = slotKey === 'ffa' ? 1 : QUESTIONS_PER_MATCH
            const short  = !isLocked && slotQs.length < need
            return (
              <span className="folio" style={{
                marginRight: 'auto', fontSize: 9,
                color: isLocked ? 'var(--ink-4)' : short ? 'var(--alert)' : 'var(--success)',
              }}>
                {isLocked ? 'منتهية'
                  : short ? `${slotQs.length}/${need} سؤال — ناقص`
                  : slotKey === 'ffa' ? `${slotQs.length} سؤال`
                  /* every match in a bracket round plays the whole slot */
                  : `${slotQs.length} سؤال / ماتش`}
              </span>
            )
          })()}
        </div>

        {slotQs.length === 0 && !isLocked && (
          <p className="ar" style={{
            fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--ink-4)',
            fontStyle: 'italic', textAlign: 'center', padding: '4px 0',
          }}>
            {isDropping ? '⬇ أفلت هنا' : 'اسحب أسئلة هنا أو استخدم "إضافة بالنطاق" — التخصيص إجباري'}
          </p>
        )}

        {slotQs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {slotQs.map(idx => (
              <div
                key={idx}
                draggable={!isLocked}
                onDragStart={e => { e.stopPropagation(); !isLocked && onDragStart(e, idx, slotKey) }}
                onDragEnd={onDragEnd}
                onClick={e => e.stopPropagation()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 8px', borderRadius: 2,
                  border: `1px solid ${isLocked ? 'var(--rule)' : dragIdx === idx && dragFrom === slotKey ? 'var(--rule)' : 'var(--rule)'}`,
                  background: isLocked ? 'var(--paper-3)' : dragIdx === idx && dragFrom === slotKey ? 'var(--paper-3)' : 'var(--paper-2)',
                  opacity: dragIdx === idx && dragFrom === slotKey ? 0.3 : 1,
                  cursor: isLocked ? 'default' : 'grab',
                  userSelect: 'none',
                }}
              >
                {!isLocked && <GripVertical size={8} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />}
                <span className="folio" style={{ color: 'var(--navy)', fontSize: 9 }}>#{idx + 1}</span>
                <span className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--ink-2)', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {deckQs[idx]?.question?.slice(0, 28) || '—'}
                </span>
                {!isLocked && (
                  <button
                    onClick={e => { e.stopPropagation(); removeQ(slotKey, idx) }}
                    onMouseDown={e => e.stopPropagation()}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 14, lineHeight: 1, padding: 0, marginRight: 2 }}
                  >×</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="paper-grain" style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'var(--paper)', color: 'var(--ink)',
      display: 'flex', flexDirection: 'column',
    }} dir="rtl">

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px', borderBottom: '2px solid var(--ink)', flexShrink: 0,
      }}>
        <h2 className="ar" style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>
          تخصيص أسئلة الجولات
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {editableTopCut && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--rule)', padding: '6px 12px', borderRadius: 4 }}>
              <span className="ar folio" style={{ color: 'var(--ink-3)', fontSize: 9 }}>متأهلين البراكيت</span>
              <button
                onClick={() => changeCap(cap / 2)}
                disabled={cap <= TOP_CUT_CHOICES[0]}
                style={{ width: 24, height: 24, border: '1px solid var(--rule)', background: 'var(--paper-2)', cursor: cap <= TOP_CUT_CHOICES[0] ? 'not-allowed' : 'pointer', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', opacity: cap <= TOP_CUT_CHOICES[0] ? 0.4 : 1 }}>
                <Minus size={10} />
              </button>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, color: 'var(--ink)', minWidth: 26, textAlign: 'center' }}>{cap}</span>
              <button
                onClick={() => changeCap(cap * 2)}
                disabled={cap >= TOP_CUT_CHOICES[TOP_CUT_CHOICES.length - 1]}
                style={{ width: 24, height: 24, border: '1px solid var(--rule)', background: 'var(--paper-2)', cursor: cap >= 128 ? 'not-allowed' : 'pointer', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', opacity: cap >= 128 ? 0.4 : 1 }}>
                <Plus size={10} />
              </button>
              <span className="ar folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>
                = {roundCount} {roundCount === 1 ? 'جولة' : 'جولات'}
              </span>
            </div>
          )}
          <button onClick={onClose} style={{ padding: 8, background: 'none', border: '1px solid var(--rule)', borderRadius: 4, cursor: 'pointer', color: 'var(--ink)', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Range assignment — the fast path ─────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        padding: '10px 20px', borderBottom: '1px solid var(--rule)',
        background: 'var(--paper-2)', flexShrink: 0,
      }}>
        <span className="ar" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>إضافة بالنطاق</span>
        <span className="ar" style={{ fontSize: 12, color: 'var(--ink-3)' }}>من</span>
        <input
          type="number" min={1} max={deckQs.length} value={rangeFrom}
          onChange={e => { setRangeFrom(e.target.value); setRangeNote(null) }}
          placeholder="1"
          style={{ width: 62, padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 3, background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: 13, textAlign: 'center' }}
        />
        <span className="ar" style={{ fontSize: 12, color: 'var(--ink-3)' }}>إلى</span>
        <input
          type="number" min={1} max={deckQs.length} value={rangeTo}
          onChange={e => { setRangeTo(e.target.value); setRangeNote(null) }}
          placeholder={String(deckQs.length)}
          style={{ width: 62, padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 3, background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: 13, textAlign: 'center' }}
        />
        <select
          value={rangeSlot}
          onChange={e => { setRangeSlot(e.target.value); setRangeNote(null) }}
          style={{ padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 3, background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--arabic)', fontSize: 12, minWidth: 130 }}
        >
          <option value="ffa" disabled={ffaLocked}>التصفيات — FFA</option>
          {Array.from({ length: roundCount }, (_, i) => i + 1).map(r => (
            <option key={r} value={String(r)} disabled={isSlotLocked(r)}>
              {getRoundName(r, roundCount)}{isSlotLocked(r) ? ' — منتهية' : ''}
            </option>
          ))}
        </select>
        <button
          onClick={applyRange}
          style={{
            padding: '7px 18px', border: '1px solid var(--ink)', borderRadius: 3,
            background: 'var(--ink)', color: 'var(--paper)',
            fontFamily: 'var(--arabic)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          أضف
        </button>
        {rangeNote && (
          <span className="ar" style={{ fontSize: 11, color: rangeNote.bad ? 'var(--alert)' : 'var(--success)' }}>
            {rangeNote.text}
          </span>
        )}
      </div>

      {/* Tap hint */}
      {tapIdx !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 20px', background: 'color-mix(in srgb, var(--navy) 8%, var(--paper))',
          borderBottom: '1px solid var(--rule)', flexShrink: 0,
        }}>
          <CheckCircle2 size={13} style={{ color: 'var(--navy)' }} />
          <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--navy)', margin: 0 }}>
            سؤال #{tapIdx + 1} محدد — اضغط على أي slot لإضافته
          </p>
          <button onClick={() => setTapIdx(null)} style={{ marginRight: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)' }}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Question Pool */}
        <div
          style={{
            width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column',
            borderRight: '1px solid var(--rule)',
            background: dragOver === 'pool' ? 'color-mix(in srgb, var(--navy) 5%, var(--paper))' : 'var(--paper)',
          }}
          onDragOver={e => { e.preventDefault(); setDragOver('pool') }}
          onDragLeave={() => dragOver === 'pool' && setDragOver(null)}
          onDrop={dropOnPool}
        >
          <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--rule)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <BookOpen size={12} style={{ color: 'var(--navy)' }} />
              <span className="ar folio" style={{ color: 'var(--ink-3)', fontSize: 9 }}>بنك الأسئلة</span>
              <span className="folio" style={{ color: 'var(--ink-4)', marginRight: 'auto', fontSize: 8 }}>{pool.length}/{deckQs.length}</span>
            </div>
            <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 10, color: 'var(--ink-4)', margin: 0 }}>اسحب أو اضغط ثم اضغط الـ slot</p>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pool.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 8 }}>
                <BookOpen size={22} style={{ color: 'var(--rule)' }} />
                <p className="ar" style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 13, color: 'var(--ink-4)', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
                  كل الأسئلة<br />مخصصة
                </p>
              </div>
            ) : pool.map(idx => {
              const isTapped = tapIdx === idx
              return (
                <div
                  key={idx}
                  draggable
                  onDragStart={e => onDragStart(e, idx, null)}
                  onDragEnd={onDragEnd}
                  onClick={() => tapPool(idx)}
                  style={{
                    padding: 8, borderRadius: 4, userSelect: 'none', cursor: 'grab',
                    border: `1px solid ${isTapped ? 'var(--navy)' : dragIdx === idx ? 'var(--rule)' : 'var(--rule)'}`,
                    background: isTapped ? 'color-mix(in srgb, var(--navy) 8%, var(--paper))' : 'var(--paper-2)',
                    opacity: dragIdx === idx ? 0.3 : 1,
                    transition: 'all 120ms',
                  }}
                >
                  <div style={{ display: 'flex', gap: 6 }}>
                    <GripVertical size={10} style={{ color: 'var(--ink-4)', marginTop: 2, flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <span className="folio" style={{ color: 'var(--navy)', display: 'block', fontSize: 8 }}>#{idx + 1}</span>
                      <span className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {deckQs[idx]?.question}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Slots */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p className="ar folio" style={{ color: 'var(--ink-4)', textAlign: 'center', fontSize: 9, position: 'sticky', top: 0, background: 'var(--paper)', padding: '4px 0', zIndex: 1 }}>
            اسحب الأسئلة أو اضغط سؤال ثم اضغط الـ slot
          </p>

          {renderSlot('ffa', 'FFA — مرحلة التصفية', '#B08944', <Zap size={10} style={{ color: 'var(--gold)', flexShrink: 0 }} />)}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
            <span className="ar folio" style={{ color: 'var(--ink-4)', fontSize: 8 }}>جولات الـ BRACKET</span>
            <div style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
          </div>

          {Array.from({ length: roundCount }, (_, i) => i + 1).map(round =>
            renderSlot(round, getRoundName(round, roundCount), '#2D3E5C',
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--navy)', flexShrink: 0 }} />)
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid var(--rule)', flexShrink: 0 }}>
        {!check.ok && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 20px',
            background: 'color-mix(in srgb, var(--alert) 6%, var(--paper))',
            borderBottom: '1px solid var(--rule)',
          }}>
            <AlertTriangle size={13} style={{ color: 'var(--alert)', flexShrink: 0, marginTop: 2 }} />
            <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--alert)', margin: 0, lineHeight: 1.7 }}>
              التخصيص إجباري — ناقص: {check.missing.map(m => `${m.label} (${m.have}/${m.need})`).join('، ')}
            </p>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, padding: '14px 20px' }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '12px 0', background: 'var(--paper-2)',
            border: '1px solid var(--rule)', borderRadius: 4, cursor: 'pointer',
            fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 14, color: 'var(--ink-2)',
          }} className="ar">
            إغلاق بدون حفظ
          </button>
          <button onClick={handleSave} style={{
            flex: 3, padding: '12px 0',
            background: check.ok ? 'var(--ink)' : 'var(--paper-2)',
            border: `1px solid ${check.ok ? 'var(--ink)' : 'var(--rule)'}`,
            borderRadius: 4, cursor: 'pointer',
            fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 14,
            color: check.ok ? 'var(--paper)' : 'var(--ink-3)',
          }} className="ar">
            {check.ok ? 'حفظ التخصيص' : 'حفظ (ناقص أسئلة)'}
          </button>
        </div>
      </div>
    </div>
  )
}
