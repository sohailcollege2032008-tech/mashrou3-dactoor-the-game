/**
 * QuestionAssignmentPanel.jsx
 * Full-screen drag-and-drop (+ tap-to-assign fallback) panel for assigning
 * deck questions to tournament rounds AND the FFA phase.
 *
 * Props:
 *   deckQs         – array of question objects { question, choices, correct }
 *   roundQuestions – { "ffa": number[], "1": number[], "2": number[], … }
 *   totalRounds    – initial bracket round count (null = auto → defaults to 3)
 *   isAutoMode     – if true, user can freely change roundCount (1–7)
 *   lockedRounds   – array of bracket round numbers already played (read-only)
 *   ffaLocked      – if true, FFA slot is read-only (FFA already happened)
 *   onSave         – (newRoundQuestions) => void
 *   onClose        – () => void
 */
import React, { useState, useCallback } from 'react'
import { X, Plus, Minus, GripVertical, Lock, BookOpen, CheckCircle2, Zap } from 'lucide-react'

function getRoundName(round, total) {
  if (round === total)     return 'النهائي'
  if (round === total - 1) return 'نصف النهائي'
  if (round === total - 2) return 'ربع النهائي'
  return `الجولة ${round}`
}

export default function QuestionAssignmentPanel({
  deckQs         = [],
  roundQuestions = {},
  totalRounds    = null,
  isAutoMode     = false,
  lockedRounds   = [],
  ffaLocked      = false,
  onSave,
  onClose,
}) {
  const initCount = Math.max(totalRounds || 3, 1)

  const [roundCount, setRoundCount] = useState(initCount)
  const [assignments, setAssignments] = useState(() => {
    const init = { ffa: [...(roundQuestions['ffa'] || [])] }
    for (let r = 1; r <= initCount; r++) init[r] = [...(roundQuestions[String(r)] || [])]
    return init
  })

  // Drag state
  const [dragIdx,  setDragIdx]  = useState(null)   // deckQs index
  const [dragFrom, setDragFrom] = useState(null)   // null=pool | 'ffa' | round number
  const [dragOver, setDragOver] = useState(null)   // null | 'pool' | 'ffa' | round number

  // Tap-to-assign fallback
  const [tapIdx,   setTapIdx]   = useState(null)

  // ── Helpers ────────────────────────────────────────────────────────────────
  const isSlotLocked = (slot) =>
    slot === 'ffa' ? ffaLocked : lockedRounds.includes(slot)

  /** Deep-copy all relevant slots */
  const copyAll = (prev) => {
    const copy = { ffa: [...(prev['ffa'] || [])] }
    for (let r = 1; r <= roundCount; r++) copy[r] = [...(prev[r] || [])]
    return copy
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const allAssigned = new Set(
    Object.entries(assignments)
      .filter(([k]) => k === 'ffa' || Number(k) <= roundCount)
      .flatMap(([, idxs]) => idxs)
  )
  const pool = deckQs.map((_, i) => i).filter(i => !allAssigned.has(i))

  // ── Round count ────────────────────────────────────────────────────────────
  const changeRoundCount = useCallback((delta) => {
    const next = Math.max(1, Math.min(7, roundCount + delta))
    if (next === roundCount) return
    setAssignments(prev => {
      const copy = { ...prev }
      if (next < roundCount) {
        for (let r = next + 1; r <= roundCount; r++) delete copy[r]
      } else {
        for (let r = roundCount + 1; r <= next; r++) copy[r] = copy[r] || []
      }
      return copy
    })
    setRoundCount(next)
  }, [roundCount])

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const onDragStart = useCallback((e, idx, fromSlot) => {
    setDragIdx(idx)
    setDragFrom(fromSlot)
    setTapIdx(null)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }, [])

  const onDragEnd = useCallback(() => {
    setDragIdx(null)
    setDragFrom(null)
    setDragOver(null)
  }, [])

  const dropOnSlot = useCallback((e, toSlot) => {
    e.preventDefault()
    if (dragIdx === null || isSlotLocked(toSlot)) return
    setAssignments(prev => {
      const copy = copyAll(prev)
      // Remove from source
      if (dragFrom !== null && copy[dragFrom] !== undefined) {
        copy[dragFrom] = copy[dragFrom].filter(i => i !== dragIdx)
      }
      // Add to target
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
      if (copy[dragFrom] !== undefined) {
        copy[dragFrom] = copy[dragFrom].filter(i => i !== dragIdx)
      }
      return copy
    })
    onDragEnd()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragIdx, dragFrom, roundCount, onDragEnd])

  // ── Tap-to-assign ──────────────────────────────────────────────────────────
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

  // ── Remove question ────────────────────────────────────────────────────────
  const removeQ = (slot, idx) => {
    setAssignments(prev => ({
      ...prev,
      [slot]: (prev[slot] || []).filter(i => i !== idx),
    }))
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = () => {
    const result = { ffa: assignments['ffa'] || [] }
    for (let r = 1; r <= roundCount; r++) result[String(r)] = assignments[r] || []
    onSave(result)
  }

  // ── Slot renderer (shared between FFA and bracket rounds) ─────────────────
  const renderSlot = (slotKey, label, accent, icon) => {
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
        className={`rounded-xl border p-3 min-h-[80px] transition-all ${
          isLocked
            ? 'border-gray-800 bg-gray-900/40 opacity-60 cursor-default'
            : isDropping
            ? `border-${accent} bg-${accent}/10 shadow-[0_0_18px_rgba(0,0,0,0.3)] cursor-copy`
            : isTapReady
            ? `border-${accent}/50 bg-${accent}/5 cursor-pointer`
            : 'border-gray-700 bg-gray-900 hover:border-gray-600 cursor-default'
        }`}
        style={
          isDropping
            ? { borderColor: accent === 'yellow-400' ? '#facc15' : '#00B8D9', backgroundColor: accent === 'yellow-400' ? 'rgba(234,179,8,.08)' : 'rgba(0,184,217,.08)' }
            : isTapReady
            ? { borderColor: accent === 'yellow-400' ? 'rgba(234,179,8,.4)' : 'rgba(0,184,217,.4)' }
            : {}
        }
      >
        {/* Slot header */}
        <div className="flex items-center gap-1.5 mb-2">
          {isLocked ? <Lock size={10} className="text-gray-600 shrink-0" /> : icon}
          <span className={`ar text-xs font-bold ${isLocked ? 'text-gray-600' : 'text-gray-200'}`}>
            {label}
          </span>
          <span className="ar text-[10px] text-gray-600 mr-auto">
            {isLocked
              ? 'منتهية'
              : slotQs.length > 0 ? `${slotQs.length} سؤال` : 'فارغة (تلقائي)'}
          </span>
        </div>

        {/* Empty hint */}
        {slotQs.length === 0 && !isLocked && (
          <p className="ar text-[10px] text-gray-700 italic text-center py-1">
            {isDropping ? '⬇ أفلت هنا' : 'اسحب أسئلة هنا، أو اتركها فارغة للاختيار التلقائي'}
          </p>
        )}

        {/* Question chips */}
        {slotQs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {slotQs.map(idx => (
              <div
                key={idx}
                draggable={!isLocked}
                onDragStart={e => { e.stopPropagation(); !isLocked && onDragStart(e, idx, slotKey) }}
                onDragEnd={onDragEnd}
                onClick={e => e.stopPropagation()}
                className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs border select-none transition-colors ${
                  isLocked
                    ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-default'
                    : dragIdx === idx && dragFrom === slotKey
                    ? 'opacity-30 border-gray-600 bg-gray-800/50 text-gray-500'
                    : 'bg-gray-800 border-gray-600 text-gray-200 cursor-grab active:cursor-grabbing hover:border-primary/40'
                }`}
              >
                {!isLocked && <GripVertical size={8} className="text-gray-600 shrink-0" />}
                <span className="font-mono text-[10px] text-primary/70">{idx + 1}</span>
                <span className="ar max-w-[90px] truncate text-[11px]">
                  {deckQs[idx]?.question?.slice(0, 28) || '—'}
                </span>
                {!isLocked && (
                  <button
                    onClick={e => { e.stopPropagation(); removeQ(slotKey, idx) }}
                    onMouseDown={e => e.stopPropagation()}
                    className="text-gray-600 hover:text-red-400 transition-colors ml-0.5 text-sm leading-none"
                  >×</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-[#0A0E1A] flex flex-col" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <h2 className="ar font-bold text-white text-base">تخصيص أسئلة الجولات</h2>
        <div className="flex items-center gap-2">
          {isAutoMode && (
            <div className="flex items-center gap-1.5 bg-gray-800 rounded-xl px-3 py-1.5 border border-gray-700">
              <span className="ar text-xs text-gray-400 ml-1">جولات Bracket</span>
              <button
                onClick={() => changeRoundCount(-1)}
                disabled={roundCount <= 1}
                className="w-6 h-6 rounded-lg bg-gray-700 flex items-center justify-center text-gray-300 hover:bg-gray-600 disabled:opacity-30 transition-colors"
              >
                <Minus size={11} />
              </button>
              <span className="text-primary font-black text-sm w-5 text-center">{roundCount}</span>
              <button
                onClick={() => changeRoundCount(+1)}
                disabled={roundCount >= 7}
                className="w-6 h-6 rounded-lg bg-gray-700 flex items-center justify-center text-gray-300 hover:bg-gray-600 disabled:opacity-30 transition-colors"
              >
                <Plus size={11} />
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          >
            <X size={17} />
          </button>
        </div>
      </div>

      {/* Tap-to-assign hint */}
      {tapIdx !== null && (
        <div className="bg-primary/10 border-b border-primary/30 px-4 py-2 shrink-0 flex items-center gap-2">
          <CheckCircle2 size={13} className="text-primary" />
          <p className="ar text-xs text-primary">
            سؤال #{tapIdx + 1} محدد — اضغط على أي slot لإضافته
          </p>
          <button onClick={() => setTapIdx(null)} className="mr-auto text-gray-500 hover:text-gray-300">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Question Pool (right in RTL) ── */}
        <div
          className={`w-48 sm:w-56 shrink-0 flex flex-col border-l border-gray-800 transition-colors ${
            dragOver === 'pool' ? 'bg-primary/5' : ''
          }`}
          onDragOver={e => { e.preventDefault(); setDragOver('pool') }}
          onDragLeave={() => dragOver === 'pool' && setDragOver(null)}
          onDrop={dropOnPool}
        >
          <div className="px-3 pt-3 pb-2 border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-1.5">
              <BookOpen size={12} className="text-primary" />
              <span className="ar text-xs font-bold text-gray-300">بنك الأسئلة</span>
              <span className="ar text-[10px] text-gray-600 mr-auto">{pool.length}/{deckQs.length}</span>
            </div>
            <p className="ar text-[10px] text-gray-600 mt-0.5">اسحب أو اضغط ثم اضغط الـ slot</p>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {pool.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-gray-700">
                <BookOpen size={22} />
                <p className="ar text-xs text-center leading-relaxed">كل الأسئلة<br />مخصصة</p>
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
                  className={`rounded-xl p-2 select-none transition-all cursor-grab active:cursor-grabbing ${
                    dragIdx === idx
                      ? 'opacity-30 border border-primary/20 bg-primary/5'
                      : isTapped
                      ? 'border border-primary bg-primary/10 shadow-[0_0_10px_rgba(0,184,217,0.2)]'
                      : 'border border-gray-700 bg-gray-900 hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-start gap-1.5">
                    <GripVertical size={10} className="text-gray-600 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <span className="font-mono text-[10px] text-primary/60 block">#{idx + 1}</span>
                      <span className="ar text-[11px] text-gray-300 leading-snug line-clamp-2">
                        {deckQs[idx]?.question}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Slots: FFA first, then bracket rounds ── */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          <p className="ar text-[10px] text-gray-600 text-center sticky top-0 bg-[#0A0E1A] py-1 z-10">
            اسحب الأسئلة أو اضغط سؤال ثم اضغط الـ slot
          </p>

          {/* FFA slot */}
          {renderSlot(
            'ffa',
            'FFA — مرحلة التصفية',
            'yellow-400',
            <Zap size={11} className="text-yellow-400 shrink-0" />
          )}

          {/* Separator */}
          <div className="flex items-center gap-2 py-1">
            <div className="flex-1 h-px bg-gray-800" />
            <span className="ar text-[10px] text-gray-700">جولات الـ Bracket</span>
            <div className="flex-1 h-px bg-gray-800" />
          </div>

          {/* Bracket rounds */}
          {Array.from({ length: roundCount }, (_, i) => i + 1).map(round =>
            renderSlot(
              round,
              getRoundName(round, roundCount),
              'primary',
              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0 mt-px" />
            )
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-800 shrink-0 flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 py-3 rounded-xl bg-gray-800 text-gray-300 text-sm ar font-bold hover:bg-gray-700 transition-colors"
        >
          إغلاق بدون حفظ
        </button>
        <button
          onClick={handleSave}
          className="flex-[3] py-3 rounded-xl bg-primary text-background text-sm ar font-black hover:bg-[#00D4FF] active:scale-95 transition-all"
        >
          حفظ التخصيص
        </button>
      </div>
    </div>
  )
}
