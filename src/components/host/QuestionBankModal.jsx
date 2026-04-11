import React, { useState, useRef, useEffect, useCallback, memo } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../../lib/firebase'
import { compressImage, formatBytes } from '../../utils/imageCompressor'
import {
  X, Edit2, Save, XCircle, Image,
  ChevronDown, ChevronUp, Camera, Trash2, AlertTriangle, Clipboard
} from 'lucide-react'

// ── Upload helper (shared between file input & paste) ─────────────────────────
function useImageUpload(bankId, index, onUploaded) {
  const [uploadProgress, setUploadProgress] = useState(null)   // null | 'compressing' | 0–100
  const [uploadInfo, setUploadInfo]         = useState(null)   // { original, compressed }

  const uploadFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      alert('يُسمح بالصور فقط')
      return
    }

    try {
      setUploadProgress('compressing')
      setUploadInfo(null)

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
          try {
            const url = await getDownloadURL(task.snapshot.ref)
            onUploaded(url)
          } catch (e) {
            alert('فشل في الحصول على رابط الصورة: ' + e.message)
          } finally {
            setUploadProgress(null)
          }
        }
      )
    } catch (err) {
      console.error('uploadFile error:', err)
      alert('خطأ أثناء رفع الصورة: ' + err.message)
      setUploadProgress(null)
      setUploadInfo(null)
    }
  }, [bankId, index, onUploaded])

  return { uploadProgress, uploadInfo, uploadFile }
}

// ── Single Question Editor ────────────────────────────────────────────────────
function QuestionEditor({ question, index, bankId, onSave, onClose }) {
  const [q, setQ]     = useState({ ...question })
  const [saving, setSaving] = useState(false)
  const fileInputRef  = useRef(null)

  const handleUploaded = useCallback((url) => {
    setQ(prev => ({ ...prev, image_url: url, needs_image: false }))
  }, [])

  const { uploadProgress, uploadInfo, uploadFile } = useImageUpload(bankId, index, handleUploaded)

  // ── Ctrl+V / paste support ──────────────────────────────────────────────────
  useEffect(() => {
    const onPaste = (e) => {
      // Don't hijack paste inside text inputs
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) { uploadFile(file); e.preventDefault() }
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [uploadFile])

  const handleChoiceChange = (i, value) => {
    const choices = [...q.choices]
    choices[i] = value
    setQ(prev => ({ ...prev, choices }))
  }

  const removeImage = () => setQ(prev => ({ ...prev, image_url: null }))

  const handleSave = async () => {
    if (!q.question.trim()) { alert('نص السؤال مطلوب'); return }
    if (q.choices.some(c => !c.trim())) { alert('كل الخيارات مطلوبة'); return }
    if (q.correct < 0 || q.correct >= q.choices.length) { alert('اختار الإجابة الصحيحة'); return }
    setSaving(true)
    await onSave(index, q)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-[#0D1321] border border-gray-700 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 flex-shrink-0">
          <h3 className="text-lg font-bold text-white font-display">تعديل سؤال #{index + 1}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-5 flex-1">

          {/* Question text */}
          <div>
            <label className="text-sm text-gray-400 font-bold mb-2 block">نص السؤال</label>
            <textarea
              value={q.question}
              onChange={e => setQ(prev => ({ ...prev, question: e.target.value }))}
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary resize-none transition-colors"
            />
          </div>

          {/* Image section */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Image size={14} className="text-gray-400" />
              <label className="text-sm text-gray-400 font-bold">صورة السؤال</label>
              {q.needs_image && !q.image_url && (
                <span className="text-amber-400 text-xs font-mono flex items-center gap-1">
                  <AlertTriangle size={12} /> AI: يحتاج صورة
                </span>
              )}
              {!q.image_url && (
                <span className="mr-auto text-xs text-gray-600 flex items-center gap-1 font-mono">
                  <Clipboard size={11} /> Ctrl+V للصق
                </span>
              )}
            </div>

            {q.image_url ? (
              <div className="relative rounded-xl overflow-hidden border border-gray-700">
                <img src={q.image_url} alt="question" className="w-full max-h-48 object-contain bg-gray-900" />
                <button
                  onClick={removeImage}
                  className="absolute top-2 right-2 bg-red-500/80 hover:bg-red-500 text-white p-1.5 rounded-lg transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  q.needs_image
                    ? 'border-amber-500/60 bg-amber-500/5 hover:bg-amber-500/10'
                    : 'border-gray-600 hover:border-primary/60 hover:bg-gray-800/40'
                }`}
              >
                <Camera size={28} className={`mx-auto mb-2 ${q.needs_image ? 'text-amber-400' : 'text-gray-500'}`} />
                <p className={`text-sm font-bold ${q.needs_image ? 'text-amber-300' : 'text-gray-400'}`}>
                  {q.needs_image ? 'هذا السؤال يحتاج صورة' : 'إضافة صورة (اختياري)'}
                </p>
                <p className="text-gray-500 text-xs mt-1">اضغط للاختيار · أو Ctrl+V للصق من الكليبورد</p>
              </div>
            )}

            {uploadProgress !== null && (
              <div className="mt-2 space-y-1">
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-200"
                    style={{ width: uploadProgress === 'compressing' ? '0%' : `${uploadProgress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400 font-mono">
                    {uploadProgress === 'compressing' ? '🗜️ جاري الضغط...' : `⬆️ جاري الرفع... ${uploadProgress}%`}
                  </p>
                  {uploadInfo && (
                    <p className="text-xs font-mono text-green-400">
                      {formatBytes(uploadInfo.original)} → {formatBytes(uploadInfo.compressed)}
                      {uploadInfo.compressed < uploadInfo.original && (
                        <span className="text-green-300 mr-1">
                          ({Math.round((1 - uploadInfo.compressed / uploadInfo.original) * 100)}%↓)
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => uploadFile(e.target.files[0])}
            />
          </div>

          {/* Choices */}
          <div>
            <label className="text-sm text-gray-400 font-bold mb-2 block">الخيارات</label>
            <div className="space-y-2">
              {q.choices.map((choice, i) => (
                <div key={i} className="flex items-center gap-3">
                  <button
                    onClick={() => setQ(prev => ({ ...prev, correct: i }))}
                    className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-sm transition-colors ${
                      q.correct === i
                        ? 'bg-green-500 text-white shadow-[0_0_10px_rgba(34,197,94,0.4)]'
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                  >
                    {String.fromCharCode(65 + i)}
                  </button>
                  <input
                    value={choice}
                    onChange={e => handleChoiceChange(i, e.target.value)}
                    className={`flex-1 bg-gray-800 border rounded-lg px-4 py-2.5 text-white focus:outline-none transition-colors ${
                      q.correct === i ? 'border-green-500/60 focus:border-green-500' : 'border-gray-700 focus:border-primary'
                    }`}
                    placeholder={`الخيار ${String.fromCharCode(65 + i)}`}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">اضغط على الحرف لتحديد الإجابة الصحيحة</p>
          </div>

        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-700 flex-shrink-0">
          <button
            onClick={handleSave}
            disabled={saving || uploadProgress !== null}
            className="flex-1 bg-primary text-background font-bold py-3 rounded-xl hover:bg-[#00D4FF] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Save size={16} /> {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 bg-gray-800 text-gray-300 rounded-xl hover:bg-gray-700 transition-colors font-bold"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Question row — memoized so only changed rows re-render ────────────────────
const QuestionItem = memo(function QuestionItem({
  q, i, isExpanded, onEdit, onToggleExpand
}) {
  const hasImage = !!q.image_url
  const needsImg = q.needs_image && !hasImage
  const correctLabel = q.choices?.[q.correct] ?? '—'

  return (
    <div className={`rounded-xl border ${needsImg ? 'border-amber-500/30 bg-amber-500/5' : 'border-gray-800 bg-gray-900/50'}`}>
      {/* Header row */}
      <div className="flex items-center gap-3 p-4">
        <span className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-400 flex-shrink-0">
          {i + 1}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-white font-medium text-sm leading-snug line-clamp-2">{q.question}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-green-400 font-mono truncate max-w-[160px]">{correctLabel}</span>
            {hasImage && (
              <span className="flex items-center gap-1 text-xs text-blue-400">
                <Image size={10} /> صورة
              </span>
            )}
            {needsImg && (
              <span className="flex items-center gap-1 text-xs text-amber-400">
                <AlertTriangle size={10} /> يحتاج صورة
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onEdit(i)}
            className="p-2 text-gray-400 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
            title="تعديل"
          >
            <Edit2 size={15} />
          </button>
          <button
            onClick={() => onToggleExpand(i)}
            className="p-2 text-gray-500 hover:text-gray-300 rounded-lg transition-colors"
          >
            {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {/* Expanded choices */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-3 border-t border-gray-800/60 space-y-2">
          {hasImage && (
            <img
              src={q.image_url}
              alt="question"
              loading="lazy"
              className="w-full max-h-40 object-contain bg-gray-900 rounded-lg mb-3 border border-gray-700"
            />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {q.choices.map((choice, ci) => (
              <div
                key={ci}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                  ci === q.correct
                    ? 'bg-green-500/15 border border-green-500/30 text-green-300'
                    : 'bg-gray-800/60 border border-gray-700 text-gray-400'
                }`}
              >
                <span className="font-bold font-mono w-5 flex-shrink-0">{String.fromCharCode(65 + ci)}</span>
                <span className="flex-1 min-w-0">{choice}</span>
                {ci === q.correct && <span className="text-green-500 text-xs font-bold ml-auto">✓</span>}
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
  const [questions, setQuestions]     = useState(bank.questions?.questions || [])
  const [editingIndex, setEditingIndex] = useState(null)
  const [expandedIndex, setExpandedIndex] = useState(null)
  const [bankTitle, setBankTitle]     = useState(bank.title)
  const [editingTitle, setEditingTitle] = useState(false)
  const [savingTitle, setSavingTitle] = useState(false)

  // Global deck settings
  const [isGlobal, setIsGlobal]         = useState(bank.is_global || false)
  const [tags, setTags]                 = useState((bank.tags || []).join(', '))
  const [forceRtl, setForceRtl]         = useState(bank.force_rtl || false)
  const [savingGlobal, setSavingGlobal] = useState(false)

  const saveGlobalSettings = async () => {
    setSavingGlobal(true)
    try {
      const tagsArray = tags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)
      await updateDoc(doc(db, 'question_sets', bank.id), {
        is_global: isGlobal,
        tags: tagsArray,
        force_rtl: forceRtl,
      })
    } catch (e) {
      alert('فشل الحفظ: ' + e.message)
    } finally {
      setSavingGlobal(false)
    }
  }

  const needsImageCount = questions.filter(q => q.needs_image && !q.image_url).length

  // Stable callbacks — prevent QuestionItem re-renders
  const handleEdit = useCallback((i) => setEditingIndex(i), [])
  const handleToggleExpand = useCallback((i) => {
    setExpandedIndex(prev => prev === i ? null : i)
  }, [])

  const saveQuestion = useCallback(async (index, updatedQ) => {
    const newQuestions = [...questions]
    newQuestions[index] = updatedQ
    setQuestions(newQuestions)
    const updatedData = { ...bank.questions, questions: newQuestions }
    await updateDoc(doc(db, 'question_sets', bank.id), {
      questions: updatedData,
      question_count: newQuestions.length
    })
    onUpdate?.(bank.id, updatedData, bankTitle)
  }, [questions, bank, bankTitle, onUpdate])

  const saveTitle = async () => {
    if (!bankTitle.trim()) return
    setSavingTitle(true)
    await updateDoc(doc(db, 'question_sets', bank.id), { title: bankTitle.trim() })
    onUpdate?.(bank.id, bank.questions, bankTitle.trim())
    setSavingTitle(false)
    setEditingTitle(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* No backdrop-blur — it kills performance on long lists */}
      <div className="absolute inset-0 bg-black/75" onClick={onClose} />

      <div className="relative w-full max-w-3xl bg-[#0A0E1A] border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-800 flex-shrink-0">
          <div className="flex-1 mr-4 min-w-0">
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  value={bankTitle}
                  onChange={e => setBankTitle(e.target.value)}
                  className="flex-1 bg-gray-800 border border-primary rounded-lg px-3 py-1.5 text-white font-bold text-lg focus:outline-none"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && saveTitle()}
                />
                <button onClick={saveTitle} disabled={savingTitle} className="p-1.5 bg-primary/20 text-primary rounded-lg hover:bg-primary/30 transition-colors">
                  <Save size={16} />
                </button>
                <button onClick={() => { setEditingTitle(false); setBankTitle(bank.title) }} className="p-1.5 bg-gray-700 text-gray-400 rounded-lg hover:bg-gray-600 transition-colors">
                  <XCircle size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white font-display truncate">{bankTitle}</h2>
                <button onClick={() => setEditingTitle(true)} className="p-1 text-gray-500 hover:text-primary transition-colors flex-shrink-0">
                  <Edit2 size={14} />
                </button>
              </div>
            )}
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-gray-400 font-mono">{questions.length} سؤال</span>
              {needsImageCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-amber-400 font-mono bg-amber-400/10 px-2 py-0.5 rounded-full">
                  <AlertTriangle size={11} /> {needsImageCount} تحتاج صورة
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors flex-shrink-0">
            <X size={20} />
          </button>
        </div>

        {/* Global Deck Settings */}
        <div className="px-6 py-4 border-b border-gray-800 flex-shrink-0 bg-gray-900/30 space-y-3">

          {/* is_global row */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-gray-300">عام (Deck مرئي للطلاب)</span>
            <button
              onClick={() => setIsGlobal(prev => !prev)}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${isGlobal ? 'bg-primary' : 'bg-gray-700'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isGlobal ? 'left-5.5 right-0.5' : 'left-0.5'}`} />
            </button>
          </div>

          {/* Tags row (only when global) */}
          {isGlobal && (
            <input
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="أناتومي، فيزيولوجي، ..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary transition-colors placeholder:text-gray-600"
            />
          )}

          {/* force_rtl row */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-bold text-gray-300">اتجاه النص: RTL إجباري</span>
              <p className="text-xs text-gray-600 mt-0.5 font-mono">
                {forceRtl ? 'النص دايماً من اليمين' : 'تلقائي (عربي RTL · إنجليزي LTR)'}
              </p>
            </div>
            <button
              onClick={() => setForceRtl(prev => !prev)}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${forceRtl ? 'bg-primary' : 'bg-gray-700'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${forceRtl ? 'left-5.5 right-0.5' : 'left-0.5'}`} />
            </button>
          </div>

          {/* Save button */}
          <button
            onClick={saveGlobalSettings}
            disabled={savingGlobal}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
          >
            {savingGlobal ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
          </button>
        </div>

        {/* Questions list */}
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {questions.map((q, i) => (
            <QuestionItem
              key={i}
              q={q}
              i={i}
              isExpanded={expandedIndex === i}
              onEdit={handleEdit}
              onToggleExpand={handleToggleExpand}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 flex-shrink-0 flex justify-between items-center">
          <p className="text-xs text-gray-500 font-mono">اضغط ✏️ لتعديل · Ctrl+V لصق صورة داخل المحرر</p>
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-gray-800 text-gray-300 rounded-xl hover:bg-gray-700 transition-colors font-bold text-sm"
          >
            إغلاق
          </button>
        </div>
      </div>

      {/* Question editor overlay */}
      {editingIndex !== null && (
        <QuestionEditor
          question={questions[editingIndex]}
          index={editingIndex}
          bankId={bank.id}
          onSave={saveQuestion}
          onClose={() => setEditingIndex(null)}
        />
      )}
    </div>
  )
}
