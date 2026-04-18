/**
 * QuestionAssignmentPanel.jsx
 * Full-screen drag-and-drop (+ tap-to-assign fallback) panel for assigning
 * deck questions to tournament rounds.
 *
 * Props:
 *   deckQs         – array of question objects { question, choices, correct }
 *   roundQuestions – { "1": number[], "2": number[], … }  (existing assignments)
 *   totalRounds    – initial round count (null = unknown/auto → defaults to 3)
 *   isAutoMode     – if true the user can freely change roundCount (1–7)
 *   lockedRounds   – array of round numbers that are already played (read-only)
 *   onSave         – (newRoundQuestions: { [roundStr]: number[] }) => void
 *   onClose        – () => void
 */
import React, { useState, useCallback } from 'react'
import { X, Plus, Minus, GripVertical, Lock, BookOpen, CheckCircle2 } from 'lucide-react'

function getRoundName(round, total) {
  if (round === total)     return 'النهائي'
  if (round === total - 1) return 'نصف النهائي'
  if (round === total - 2) return 'ربع النهائي'
  return `الجولة ${round}`
}

export default function QuestionAssignmentPanel({
  deckQs       = [],
  roundQuestions = {},
  totalRounds  = null,
  isAutoMode   = false,
  lockedRounds = [],
  onSave,
  onClose,
}) {
  const initCount = Math.max(totalRounds || 3, 1)

  const [roundCount, setRoundCount] = useState(initCount)
  const [assignments, setAssignments] = useState(() => {
    const init = {}
    for (let r = 1; r <= initCount; r++) init[r] = [...(roundQuestions[String(r)] || [])]
    return init
  })

  // Drag state
  const [dragIdx,  setDragIdx]  = useState(null)  // deckQs index
  const [dragFrom, setDragFrom] = useState(null)  // null=pool | round number
  const [dragOver, setDragOver] = useState(null)  // null | 'pool' | round number

  // Tap-to-assign fallback (touch-friendly)
  const [tapIdx,   setTapIdx]   = useState(null)  // index selected from pool

  // ── Derived ────────────────────────────────────────────────────────────────
  // Only count assignments within current roundCount to determine pool
  const allAssigned = new Set(
    Object.entries(assignments)
      .filter(([r]) => Number(r) <= roundCount)
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
  const onDragStart = useCallback((e, idx, fromRound) => {
    setDragIdx(idx)
    setDragFrom(fromRound)
    setTapIdx(null)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }, [])

  const onDragEnd = useCallback(() => {
    setDragIdx(null)
    setDragFrom(null)
    setDragOver(null)
  }, [])

  const dropOnRound = useCallback((e, toRound) => {
    e.preventDefault()
    if (dragIdx === null || lockedRounds.includes(toRound)) return
    setAssignments(prev => {
      const copy = {}
      for (let r = 1; r <= roundCount; r++) copy[r] = [...(prev[r] || [])]
      if (dragFrom !== null && copy[dragFrom]) {
        copy[dragFrom] = copy[dragFrom].filter(i => i !== dragIdx)
      }
      if (!copy[toRound]) copy[toRound] = []
      if (!copy[toRound].includes(dragIdx)) copy[toRound] = [...copy[toRound], dragIdx]
      return copy
    })
    onDragEnd()
  }, [dragIdx, dragFrom, lockedRounds, roundCount, onDragEnd])

  const dropOnPool = useCallback((e) => {
    e.preventDefault()
    if (dragIdx === null || dragFrom === null) return
    setAssignments(prev => {
      const copy = {}
      for (let r = 1; r <= roundCount; r++) copy[r] = [...(prev[r] || [])]
      copy[dragFrom] = (copy[dragFrom] || []).filter(i => i !== dragIdx)
      return copy
    })
    onDragEnd()
  }, [dragIdx, dragFrom, roundCount, onDragEnd])

  // ── Tap-to-assign (touch fallback) ─────────────────────────────────────────
  const tapPool = (idx) => {
    setTapIdx(prev => prev === idx ? null : idx)
  }
  const tapRound = (round) => {
    if (tapIdx === null || lockedRounds.includes(round)) return
    setAssignments(prev => {
      const copy = {}
      for (let r = 1; r <= roundCount; r++) copy[r] = [...(prev[r] || [])]
      if (!copy[round].includes(tapIdx)) copy[round] = [...copy[round], tapIdx]
      return copy
    })
    setTapIdx(null)
  }

  // ── Remove question from round ─────────────────────────────────────────────
  const removeQ = (round, idx) => {
    setAssignments(prev => ({
      ...prev,
      [round]: (prev[round] || []).filter(i => i !== idx),
    }))
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = () => {
    const result = {}
    for (let r = 1; r <= roundCount; r++) result[String(r)] = assignments[r] || []
    onSave(result)
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
              <span className="ar text-xs text-gray-400 ml-1">الجولات</span>
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
            سؤال #{tapIdx + 1} محدد — اضغط على الجولة المطلوبة لإضافته
          </p>
          <button onClick={() => setTapIdx(null)} className="mr-auto text-gray-500 hover:text-gray-300">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Body: Pool (right) | Rounds (left) — RTL so first child = right */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Question Pool (right side) ── */}
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
            <p className="ar text-[10px] text-gray-600 mt-0.5 leading-relaxed">
              اسحب أو اضغط ثم اضغط على الجولة
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {pool.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-gray-700">
                <BookOpen size={22} />
                <p className="ar text-xs text-center leading-relaxed">كل الأسئلة<br />مخصصة للجولات</p>
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

        {/* ── Rounds (left side) ── */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          <p className="ar text-[10px] text-gray-600 text-center sticky top-0 bg-[#0A0E1A] py-1 z-10">
            اسحب الأسئلة هنا — أو اضغط سؤال ثم اضغط الجولة
          </p>

          {Array.from({ length: roundCount }, (_, i) => i + 1).map(round => {
            const isLocked   = lockedRounds.includes(round)
            const rqs        = assignments[round] || []
            const isDropping = dragOver === round && !isLocked
            const isTapTarget = tapIdx !== null && !isLocked

            return (
              <div
                key={round}
                onDragOver={e => { if (!isLocked) { e.preventDefault(); setDragOver(round) } }}
                onDragLeave={() => dragOver === round && setDragOver(null)}
                onDrop={e => dropOnRound(e, round)}
                onClick={() => tapRound(round)}
                className={`rounded-xl border p-3 min-h-[80px] transition-all ${
                  isLocked
                    ? 'border-gray-800 bg-gray-900/40 opacity-60 cursor-default'
                    : isDropping
                    ? 'border-primary bg-primary/10 shadow-[0_0_20px_rgba(0,184,217,0.25)] cursor-copy'
                    : isTapTarget
                    ? 'border-primary/50 bg-primary/5 cursor-pointer'
                    : 'border-gray-700 bg-gray-900 hover:border-gray-600 cursor-default'
                }`}
              >
                {/* Round header */}
                <div className="flex items-center gap-2 mb-2">
                  {isLocked
                    ? <Lock size={10} className="text-gray-600 shrink-0" />
                    : <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0 mt-px" />
                  }
                  <span className={`ar text-xs font-bold ${isLocked ? 'text-gray-600' : 'text-gray-200'}`}>
                    {getRoundName(round, roundCount)}
                  </span>
                  {!isLocked && (
                    <span className="ar text-[10px] text-gray-600 mr-auto">
                      {rqs.length > 0 ? `${rqs.length} سؤال` : 'فارغة (تلقائي)'}
                    </span>
                  )}
                  {isLocked && (
                    <span className="ar text-[10px] text-gray-600 mr-auto">منتهية</span>
                  )}
                </div>

                {/* Empty state */}
                {rqs.length === 0 && !isLocked && (
                  <p className="ar text-[10px] text-gray-700 italic text-center py-2">
                    {isDropping ? '⬇ أفلت هنا' : 'اسحب أسئلة هنا، أو اتركها فارغة للاختيار التلقائي'}
                  </p>
                )}

                {/* Question chips */}
                {rqs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {rqs.map(idx => (
                      <div
                        key={idx}
                        draggable={!isLocked}
                        onDragStart={e => { e.stopPropagation(); !isLocked && onDragStart(e, idx, round) }}
                        onDragEnd={onDragEnd}
                        onClick={e => e.stopPropagation()}
                        className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs border select-none transition-colors ${
                          isLocked
                            ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-default'
                            : dragIdx === idx && dragFrom === round
                            ? 'opacity-30 border-primary/20 bg-primary/5 text-gray-500'
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
                            onClick={e => { e.stopPropagation(); removeQ(round, idx) }}
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
          })}
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
