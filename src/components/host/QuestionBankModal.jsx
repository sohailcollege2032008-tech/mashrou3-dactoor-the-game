import React, { useState, useRef, useEffect, useCallback, memo } from 'react'
import MathText from '../common/MathText'
import { doc, updateDoc } from 'firebase/firestore'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../../lib/firebase'
import { compressImage, formatBytes } from '../../utils/imageCompressor'
import { hasArabic, getDir } from '../../utils/rtlUtils'
import {
  X, Edit2, Save, XCircle, Image,
  ChevronDown, ChevronUp, Camera, Trash2, AlertTriangle, Clipboard, Loader2
} from 'lucide-react'

// ── Upload helper ──────────────────────────────────────────────────────────────
function useImageUpload(bankId, index, onUploaded) {
  const [uploadProgress, setUploadProgress] = useState(null)
  const [uploadInfo, setUploadInfo]         = useState(null)

  const uploadFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) { alert('يُسمح بالصور فقط'); return }
    try {
      setUploadProgress('compressing'); setUploadInfo(null)
      const compressed = await compressImage(file)
      setUploadInfo({ original: file.size, compressed: compressed.size })
      setUploadProgress(0)
      const path = `question_images/${bankId}/q${index}_${Date.now()}`
      const ref  = storageRef(storage, path)
      const task = uploadBytesResumable(ref, compressed)
      task.on(
        'state_changed',
        snap => setUploadProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
        err  => { alert('فشل الرفع: ' + err.message); setUploadProgress(null); setUploadInfo(null) },
        async () => {
          try { const url = await getDownloadURL(task.snapshot.ref); onUploaded(url) }
          catch (e) { alert('فشل في الحصول على رابط الصورة: ' + e.message) }
          finally { setUploadProgress(null) }
        }
      )
    } catch (err) { console.error(err); alert('خطأ: ' + err.message); setUploadProgress(null); setUploadInfo(null) }
  }, [bankId, index, onUploaded])

  return { uploadProgress, uploadInfo, uploadFile }
}

// ── Single Question Editor ─────────────────────────────────────────────────────
function QuestionEditor({ question, index, bankId, onSave, onClose, forceRtl }) {
  const [q, setQ]     = useState({ ...question })
  const [saving, setSaving] = useState(false)
  const fileInputRef  = useRef(null)

  const handleUploaded = useCallback((url) => setQ(prev => ({ ...prev, image_url: url, needs_image: false })), [])
  const { uploadProgress, uploadInfo, uploadFile } = useImageUpload(bankId, index, handleUploaded)

  useEffect(() => {
    const onPaste = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) { const file = item.getAsFile(); if (file) { uploadFile(file); e.preventDefault() }; break }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [uploadFile])

  const handleChoiceChange = (i, value) => { const choices = [...q.choices]; choices[i] = value; setQ(prev => ({ ...prev, choices })) }
  const removeImage = () => setQ(prev => ({ ...prev, image_url: null }))

  const handleSave = async () => {
    if (!q.question.trim()) { alert('نص السؤال مطلوب'); return }
    if (q.choices.some(c => !c.trim())) { alert('كل الخيارات مطلوبة'); return }
    if (q.correct < 0 || q.correct >= q.choices.length) { alert('اختار الإجابة الصحيحة'); return }
    setSaving(true); await onSave(index, q); setSaving(false); onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,26,0.7)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 600,
        background: 'var(--paper)', border: '1px solid var(--rule)',
        borderTop: '3px double var(--rule-strong)',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4,
        boxShadow: '0 16px 48px rgba(26,26,26,0.18)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--rule)', flexShrink: 0 }}>
          <div>
            <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 2, fontSize: 9 }}>QUESTION EDITOR</div>
            <span style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 500, color: 'var(--ink)' }}>
              #{index + 1}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: 20, flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Question text */}
          <div>
            <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 8, fontSize: 9 }}>نص السؤال</div>
            <textarea
              value={q.question}
              onChange={e => setQ(prev => ({ ...prev, question: e.target.value }))}
              rows={3}
              dir={forceRtl ? 'rtl' : 'auto'}
              style={{
                width: '100%', fontFamily: 'var(--sans)', fontSize: 14,
                padding: '10px 12px', background: 'var(--paper-2)',
                border: '1px solid var(--rule)', borderBottom: '2px solid var(--ink)',
                borderRadius: 0, color: 'var(--ink)', outline: 'none', resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            {q.question.includes('<math') && (
              <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 4, fontSize: 13, color: 'var(--navy)' }}>
                <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 4, fontSize: 8 }}>PREVIEW</div>
                <MathText text={q.question} />
              </div>
            )}
          </div>

          {/* Image */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Image size={13} style={{ color: 'var(--ink-3)' }} />
              <div className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>صورة السؤال</div>
              {q.needs_image && !q.image_url && (
                <span className="folio" style={{ color: 'var(--gold)', fontSize: 8, marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle size={11} /> AI: يحتاج صورة
                </span>
              )}
              {!q.image_url && (
                <span style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clipboard size={10} style={{ color: 'var(--ink-4)' }} />
                  <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 8 }}>CTRL+V</span>
                </span>
              )}
            </div>
            {q.image_url ? (
              <div style={{ position: 'relative', border: '1px solid var(--rule)', overflow: 'hidden', borderRadius: 4 }}>
                <img src={q.image_url} alt="question" style={{ width: '100%', maxHeight: 192, objectFit: 'contain', background: 'var(--paper-2)', display: 'block' }} />
                <button onClick={removeImage} style={{
                  position: 'absolute', top: 8, right: 8, padding: '4px 6px',
                  background: 'var(--alert)', border: 'none', cursor: 'pointer', color: 'var(--paper)', borderRadius: 3,
                }}>
                  <Trash2 size={13} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${q.needs_image ? 'var(--gold)' : 'var(--rule)'}`,
                  padding: '24px 16px', textAlign: 'center', cursor: 'pointer', borderRadius: 4,
                  background: q.needs_image ? 'color-mix(in srgb, var(--gold) 5%, var(--paper))' : 'var(--paper-2)',
                }}
              >
                <Camera size={24} style={{ margin: '0 auto 8px', color: q.needs_image ? 'var(--gold)' : 'var(--ink-4)', display: 'block' }} />
                <p style={{ fontFamily: 'var(--sans)', fontSize: 13, color: q.needs_image ? 'var(--gold)' : 'var(--ink-3)', margin: '0 0 4px' }}>
                  {q.needs_image ? 'هذا السؤال يحتاج صورة' : 'إضافة صورة (اختياري)'}
                </p>
                <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)', margin: 0 }}>
                  اضغط للاختيار · أو Ctrl+V للصق
                </p>
              </div>
            )}
            {uploadProgress !== null && (
              <div style={{ marginTop: 8 }}>
                <div style={{ height: 2, background: 'var(--rule)', borderRadius: 1, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', background: 'var(--ink)', transition: 'width 200ms',
                    width: uploadProgress === 'compressing' ? '0%' : `${uploadProgress}%`,
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>
                    {uploadProgress === 'compressing' ? 'COMPRESSING…' : `UPLOADING ${uploadProgress}%`}
                  </span>
                  {uploadInfo && (
                    <span className="folio" style={{ color: 'var(--success)', fontSize: 9 }}>
                      {formatBytes(uploadInfo.original)} → {formatBytes(uploadInfo.compressed)}
                    </span>
                  )}
                </div>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => uploadFile(e.target.files[0])} />
          </div>

          {/* Choices */}
          <div>
            <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 10, fontSize: 9 }}>الخيارات</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {q.choices.map((choice, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={() => setQ(prev => ({ ...prev, correct: i }))}
                    style={{
                      width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 12,
                      border: `2px solid ${q.correct === i ? 'var(--success)' : 'var(--rule)'}`,
                      background: q.correct === i ? 'var(--success)' : 'var(--paper-2)',
                      color: q.correct === i ? 'var(--paper)' : 'var(--ink-3)',
                      cursor: 'pointer', transition: 'all 150ms',
                    }}
                  >
                    {String.fromCharCode(65 + i)}
                  </button>
                  <input
                    value={choice}
                    onChange={e => handleChoiceChange(i, e.target.value)}
                    dir={forceRtl ? 'rtl' : 'auto'}
                    style={{
                      flex: 1, fontFamily: 'var(--sans)', fontSize: 14,
                      padding: '8px 12px', background: 'var(--paper-2)',
                      border: `1px solid ${q.correct === i ? 'var(--success)' : 'var(--rule)'}`,
                      borderBottom: `2px solid ${q.correct === i ? 'var(--success)' : 'var(--ink)'}`,
                      borderRadius: 0, color: 'var(--ink)', outline: 'none',
                    }}
                    placeholder={`الخيار ${String.fromCharCode(65 + i)}`}
                  />
                </div>
              ))}
            </div>
            {q.choices.some(c => c.includes('<math')) && (
              <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 4 }}>
                <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 8, fontSize: 8 }}>CHOICES PREVIEW</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {q.choices.map((c, ci) => (
                    <div key={ci} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--navy)' }}>
                      <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink-4)', fontWeight: 600 }}>{String.fromCharCode(65 + ci)}.</span>
                      <MathText text={c} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="folio" style={{ color: 'var(--ink-4)', marginTop: 6, fontSize: 9 }}>اضغط على الحرف لتحديد الإجابة الصحيحة</p>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--rule)', flexShrink: 0 }}>
          <button
            onClick={handleSave}
            disabled={saving || uploadProgress !== null}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '11px 0', background: 'var(--ink)', color: 'var(--paper)',
              border: '1px solid var(--ink)', borderRadius: 4, cursor: 'pointer',
              fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 14,
              opacity: saving || uploadProgress !== null ? 0.6 : 1,
            }}
          >
            <Save size={14} /> {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
          </button>
          <button onClick={onClose} style={{
            padding: '11px 20px', background: 'var(--paper-2)', color: 'var(--ink-2)',
            border: '1px solid var(--rule)', borderRadius: 4, cursor: 'pointer',
            fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 14,
          }}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Question row ───────────────────────────────────────────────────────────────
const QuestionItem = memo(function QuestionItem({ q, i, isExpanded, onEdit, onToggleExpand, forceRtl }) {
  const hasImage = !!q.image_url
  const needsImg = q.needs_image && !hasImage
  const correctLabel = q.choices?.[q.correct] ?? '—'
  const itemDir = getDir(q.question, forceRtl)

  return (
    <div style={{
      border: `1px solid ${needsImg ? 'var(--gold)' : 'var(--rule)'}`,
      borderRadius: 4,
      background: needsImg ? 'color-mix(in srgb, var(--gold) 4%, var(--paper))' : 'var(--paper)',
    }}>
      <div dir={itemDir} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14 }}>
        <span style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
          background: 'var(--paper-2)', color: 'var(--ink-3)', border: '1px solid var(--rule)',
        }}>
          {i + 1}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: 'var(--sans)', fontSize: 14, color: 'var(--ink)', margin: '0 0 4px', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            <MathText text={q.question} dir={itemDir} />
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--success)' }}>
              <MathText text={correctLabel} dir={itemDir} />
            </span>
            {hasImage && <span className="folio" style={{ color: 'var(--navy)', fontSize: 8 }}>+ IMG</span>}
            {needsImg && <span className="folio" style={{ color: 'var(--gold)', fontSize: 8, display: 'flex', alignItems: 'center', gap: 3 }}><AlertTriangle size={9} /> NEEDS IMG</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <button onClick={() => onEdit(i)} style={{ padding: 6, background: 'none', border: '1px solid var(--rule)', borderRadius: 3, cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}>
            <Edit2 size={13} />
          </button>
          <button onClick={() => onToggleExpand(i)} style={{ padding: 6, background: 'none', border: '1px solid var(--rule)', borderRadius: 3, cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}>
            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div dir={itemDir} style={{ padding: '12px 14px 14px', borderTop: '1px solid var(--rule)' }}>
          {hasImage && (
            <img src={q.image_url} alt="question" loading="lazy"
              style={{ width: '100%', maxHeight: 160, objectFit: 'contain', background: 'var(--paper-2)', borderRadius: 4, marginBottom: 10, border: '1px solid var(--rule)', display: 'block' }} />
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {q.choices.map((choice, ci) => (
              <div key={ci} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                border: `1px solid ${ci === q.correct ? 'var(--success)' : 'var(--rule)'}`,
                background: ci === q.correct ? 'color-mix(in srgb, var(--success) 6%, var(--paper))' : 'var(--paper-2)',
                borderRadius: 3,
              }}>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 12, color: ci === q.correct ? 'var(--success)' : 'var(--ink-3)', flexShrink: 0 }}>
                  {String.fromCharCode(65 + ci)}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-2)' }}>
                  <MathText text={choice} dir={itemDir} />
                </span>
                {ci === q.correct && <span className="folio" style={{ color: 'var(--success)', fontSize: 8, flexShrink: 0 }}>✓</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

// ── Main Modal ─────────────────────────────────────────────────────────────────
export default function QuestionBankModal({ bank, onClose, onUpdate }) {
  const [questions, setQuestions]       = useState(bank.questions?.questions || [])
  const [editingIndex, setEditingIndex] = useState(null)
  const [expandedIndex, setExpandedIndex] = useState(null)
  const [bankTitle, setBankTitle]       = useState(bank.title)
  const [editingTitle, setEditingTitle] = useState(false)
  const [savingTitle, setSavingTitle]   = useState(false)
  const [isGlobal, setIsGlobal]         = useState(bank.is_global || false)
  const [tags, setTags]                 = useState((bank.tags || []).join(', '))
  const [forceRtl, setForceRtl]         = useState(bank.force_rtl || false)
  const [savingGlobal, setSavingGlobal] = useState(false)

  useEffect(() => {
    setIsGlobal(bank.is_global || false)
    setTags((bank.tags || []).join(', '))
    setForceRtl(bank.force_rtl || false)
    setBankTitle(bank.title)
    if (bank.questions?.questions) setQuestions(bank.questions.questions)
  }, [bank])

  const saveGlobalSettings = async (overrides = {}) => {
    setSavingGlobal(true)
    try {
      const finalIsGlobal = overrides.hasOwnProperty('isGlobal') ? overrides.isGlobal : isGlobal
      const finalTags = overrides.hasOwnProperty('tags') ? overrides.tags : tags
      const finalForceRtl = overrides.hasOwnProperty('forceRtl') ? overrides.forceRtl : forceRtl
      const tagsArray = finalTags.split(',').map(t => t.trim()).filter(Boolean)
      const updatePayload = { is_global: finalIsGlobal, tags: tagsArray, force_rtl: finalForceRtl }
      await updateDoc(doc(db, 'question_sets', bank.id), updatePayload)
      onUpdate?.(bank.id, bank.questions, bankTitle, { ...bank, ...updatePayload })
    } catch (e) { alert('فشل الحفظ: ' + e.message) }
    finally { setSavingGlobal(false) }
  }

  const handleForceRtlToggle = async () => { const v = !forceRtl; setForceRtl(v); await saveGlobalSettings({ forceRtl: v }) }
  const handleIsGlobalToggle = async () => { const v = !isGlobal; setIsGlobal(v); await saveGlobalSettings({ isGlobal: v }) }

  const needsImageCount = questions.filter(q => q.needs_image && !q.image_url).length
  const handleEdit = useCallback((i) => setEditingIndex(i), [])
  const handleToggleExpand = useCallback((i) => setExpandedIndex(prev => prev === i ? null : i), [])

  const saveQuestion = useCallback(async (index, updatedQ) => {
    const newQuestions = [...questions]; newQuestions[index] = updatedQ; setQuestions(newQuestions)
    const updatedData = { ...bank.questions, questions: newQuestions }
    await updateDoc(doc(db, 'question_sets', bank.id), { questions: updatedData, question_count: newQuestions.length })
    onUpdate?.(bank.id, updatedData, bankTitle)
  }, [questions, bank, bankTitle, onUpdate])

  const saveTitle = async () => {
    if (!bankTitle.trim()) return; setSavingTitle(true)
    await updateDoc(doc(db, 'question_sets', bank.id), { title: bankTitle.trim() })
    onUpdate?.(bank.id, bank.questions, bankTitle.trim())
    setSavingTitle(false); setEditingTitle(false)
  }

  const Toggle = ({ on, onToggle }) => (
    <button onClick={onToggle} style={{
      position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', flexShrink: 0,
      background: on ? 'var(--ink)' : 'var(--rule)', transition: 'background 200ms',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 20 : 2,
        width: 18, height: 18, borderRadius: '50%', background: 'var(--paper)',
        boxShadow: '0 1px 3px rgba(26,26,26,0.2)', transition: 'left 200ms',
      }} />
    </button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,26,0.65)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 720,
        background: 'var(--paper)', border: '1px solid var(--rule)',
        borderTop: '3px double var(--rule-strong)',
        display: 'flex', flexDirection: 'column', maxHeight: '93vh', borderRadius: 4,
        boxShadow: '0 16px 48px rgba(26,26,26,0.18)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--rule)', flexShrink: 0 }}>
          <div style={{ flex: 1, marginRight: 16, minWidth: 0 }}>
            {editingTitle ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  value={bankTitle}
                  onChange={e => setBankTitle(e.target.value)}
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && saveTitle()}
                  style={{
                    flex: 1, fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 500,
                    padding: '6px 10px', background: 'var(--paper-2)',
                    border: '1px solid var(--rule)', borderBottom: '2px solid var(--ink)',
                    borderRadius: 0, color: 'var(--ink)', outline: 'none',
                  }}
                />
                <button onClick={saveTitle} disabled={savingTitle}
                  style={{ padding: 7, background: 'var(--ink)', border: 'none', borderRadius: 3, cursor: 'pointer', color: 'var(--paper)', display: 'flex' }}>
                  <Save size={14} />
                </button>
                <button onClick={() => { setEditingTitle(false); setBankTitle(bank.title) }}
                  style={{ padding: 7, background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 3, cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}>
                  <XCircle size={14} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 500, margin: 0, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
                  {bankTitle}
                </h2>
                <button onClick={() => setEditingTitle(true)} style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', display: 'flex', flexShrink: 0 }}>
                  <Edit2 size={13} />
                </button>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>{questions.length} سؤال</span>
              {needsImageCount > 0 && (
                <span className="folio" style={{ color: 'var(--gold)', fontSize: 8, display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--gold)', padding: '2px 6px', borderRadius: 2 }}>
                  <AlertTriangle size={9} /> {needsImageCount} NEED IMG
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        {/* Global Settings */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--rule)', flexShrink: 0, background: 'var(--paper-2)' }}>
          <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 12, fontSize: 9 }}>DECK SETTINGS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-2)' }}>عام — مرئي للطلاب في DeckBrowser</span>
              <Toggle on={isGlobal} onToggle={handleIsGlobalToggle} />
            </div>
            {isGlobal && (
              <input
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder="أناتومي، فيزيولوجي، ..."
                style={{
                  width: '100%', fontFamily: 'var(--sans)', fontSize: 13,
                  padding: '8px 10px', background: 'var(--paper)',
                  border: '1px solid var(--rule)', borderBottom: '2px solid var(--ink)',
                  borderRadius: 0, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box',
                }}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-2)' }}>اتجاه النص RTL إجباري</span>
                <div className="folio" style={{ color: 'var(--ink-4)', marginTop: 2, fontSize: 8 }}>
                  {forceRtl ? 'النص دائماً من اليمين' : 'تلقائي (عربي RTL · إنجليزي LTR)'}
                </div>
              </div>
              <Toggle on={forceRtl} onToggle={handleForceRtlToggle} />
            </div>
            <button onClick={saveGlobalSettings} disabled={savingGlobal}
              className="folio"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--ink-4)', fontSize: 9, textDecoration: 'underline',
                textAlign: 'left', opacity: savingGlobal ? 0.5 : 1,
              }}>
              {savingGlobal ? 'SAVING…' : 'SAVE SETTINGS'}
            </button>
          </div>
        </div>

        {/* Questions list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {questions.map((q, i) => (
            <QuestionItem
              key={i} q={q} i={i}
              isExpanded={expandedIndex === i}
              onEdit={handleEdit}
              onToggleExpand={handleToggleExpand}
              forceRtl={forceRtl}
            />
          ))}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--rule)', flexShrink: 0 }}>
          <span className="folio" style={{ color: 'var(--ink-4)', fontSize: 8 }}>
            اضغط ✏️ لتعديل · Ctrl+V لصق صورة داخل المحرر
          </span>
          <button onClick={onClose} style={{
            padding: '8px 20px', background: 'var(--paper-2)', color: 'var(--ink-2)',
            border: '1px solid var(--rule)', borderRadius: 4, cursor: 'pointer',
            fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 13,
          }}>
            إغلاق
          </button>
        </div>
      </div>

      {editingIndex !== null && (
        <QuestionEditor
          question={questions[editingIndex]}
          index={editingIndex}
          bankId={bank.id}
          onSave={saveQuestion}
          onClose={() => setEditingIndex(null)}
          forceRtl={forceRtl}
        />
      )}
    </div>
  )
}
