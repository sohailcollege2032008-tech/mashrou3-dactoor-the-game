import React, { useState, useRef, useCallback } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'

const CLOUD_RUN_URL  = import.meta.env.VITE_CLOUD_RUN_URL
const API_SECRET     = import.meta.env.VITE_CLOUD_RUN_SECRET || ''

// ── Schema validation ──────────────────────────────────────────────────────────
function validateSchema(json) {
  const errors = []
  if (!json || typeof json !== 'object') return ['الملف لا يحتوي على JSON صالح']
  if (!json.title || typeof json.title !== 'string') errors.push('حقل "title" مطلوب ويجب أن يكون نصاً')
  if (!Array.isArray(json.questions) || json.questions.length === 0)
    errors.push('حقل "questions" مطلوب ويجب أن يكون مصفوفة غير فارغة')
  else {
    json.questions.forEach((q, i) => {
      if (!q.question) errors.push(`سؤال #${i + 1}: حقل "question" مطلوب`)
      if (!Array.isArray(q.choices) || q.choices.length < 2)
        errors.push(`سؤال #${i + 1}: يجب أن يكون لديه خيارين على الأقل`)
      if (q.correct === undefined || q.correct === null)
        errors.push(`سؤال #${i + 1}: حقل "correct" مطلوب`)
    })
  }
  return errors
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(new Error('فشل في قراءة الملف'))
    reader.readAsText(file, 'UTF-8')
  })
}

const AI_PROMPT = `You are a medical exam question extractor. You receive a document (PDF, PPTX, DOCX, image, etc.) that contains multiple-choice questions (MCQs).

Your task is to extract ALL questions from the document and return them in this EXACT JSON format. Return ONLY valid JSON, no markdown, no explanation.

{
  "title": "<infer a title from the document content>",
  "questions": [
    {
      "id": 1,
      "question": "<the question text in its original language>",
      "question_ar": "<Arabic version if the original is in Arabic, otherwise null>",
      "choices": ["<choice A>", "<choice B>", "<choice C>", "<choice D>"],
      "correct": <0-indexed position of the correct answer>,
      "needs_image": false,
      "image_url": null
    }
  ]
}

RULES:
1. Extract every single MCQ from the document — do not skip any.
2. The "correct" field must be the 0-based index of the correct answer in the choices array.
3. If the correct answer is marked/highlighted/bolded/starred, use that. If no answer is marked, set "correct" to -1.
4. If the question is in Arabic, put it in both "question" and "question_ar". If in English, put in "question" only and set "question_ar" to null.
5. Preserve the original wording of questions and choices exactly as written.
6. If choices are labeled A/B/C/D or 1/2/3/4, remove the labels and just keep the text.
7. Set "needs_image" to true if the question refers to a figure, image, photograph, diagram, graph, table, or any visual element that is required to answer correctly. Set to false otherwise.
8. Return ONLY the JSON object. No markdown backticks, no commentary.`

// ── Questions preview ──────────────────────────────────────────────────────────
function QuestionsPreview({ data }) {
  const needsImg = data.questions.filter(q => q.needs_image && !q.image_url).length
  return (
    <div className="bg-gray-800/60 border border-primary/30 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white leading-tight">{data.title}</h3>
          <p className="text-primary font-mono text-sm mt-1">
            ✅ {data.questions.length} سؤال
            {data.questions.filter(q => q.correct === -1).length > 0 && (
              <span className="text-amber-400 mr-2"> ⚠️ {data.questions.filter(q => q.correct === -1).length} بدون إجابة</span>
            )}
            {needsImg > 0 && (
              <span className="text-amber-400 mr-2"> 🖼 {needsImg} تحتاج صورة</span>
            )}
          </p>
        </div>
        <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-mono border border-primary/30 flex-shrink-0">
          AI ✨
        </span>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {data.questions.slice(0, 5).map((q, i) => (
          <div key={i} className="bg-gray-700/50 rounded-lg p-3">
            <p className="text-gray-200 text-sm font-bold mb-1 line-clamp-2">{i + 1}. {q.question}</p>
            <div className="flex flex-wrap gap-1">
              {q.choices.map((c, ci) => (
                <span key={ci} className={`text-xs px-2 py-0.5 rounded font-mono ${
                  ci === q.correct ? 'bg-green-500/20 text-green-400 border border-green-500/40' : 'bg-gray-600/50 text-gray-400'
                }`}>{c}</span>
              ))}
            </div>
          </div>
        ))}
        {data.questions.length > 5 && (
          <p className="text-gray-500 text-xs text-center font-mono py-1">
            + {data.questions.length - 5} سؤال آخر...
          </p>
        )}
      </div>
    </div>
  )
}

// ── File Upload Tab (Cloud Run → Gemini) ───────────────────────────────────────
function FileUploadTab({ session, onSuccess, onClose }) {
  const [dragOver, setDragOver]   = useState(false)
  const [status, setStatus]       = useState('idle')   // idle | uploading | done | error
  const [statusMsg, setStatusMsg] = useState('')
  const [parsed, setParsed]       = useState(null)
  const [saving, setSaving]       = useState(false)
  const fileInputRef              = useRef(null)

  const ACCEPTED = '.pdf,.pptx,.ppt,.docx,.doc,image/*'

  const processFile = async (file) => {
    if (!file) return

    if (!CLOUD_RUN_URL) {
      setStatus('error')
      setStatusMsg('VITE_CLOUD_RUN_URL غير مضبوط — تواصل مع المسؤول')
      return
    }

    setParsed(null)
    setStatus('uploading')
    setStatusMsg('⏫ جاري رفع الملف...')

    try {
      const formData = new FormData()
      formData.append('file', file)

      setStatusMsg('🤖 Gemini بيحلل الملف — قد يأخذ بضع ثوانٍ...')

      const res = await fetch(`${CLOUD_RUN_URL}/process`, {
        method: 'POST',
        headers: API_SECRET ? { 'x-api-secret': API_SECRET } : {},
        body: formData,
      })

      if (!res.ok) {
        let detail = `خطأ ${res.status}`
        try { detail = (await res.json()).detail || detail } catch (_) {}
        throw new Error(detail)
      }

      const data = await res.json()
      if (!data.title || !Array.isArray(data.questions) || data.questions.length === 0)
        throw new Error('الـ AI مرجعش أسئلة صالحة — تأكد إن الملف فيه MCQs')

      setParsed(data)
      setStatus('done')
      setStatusMsg('')

    } catch (err) {
      setStatus('error')
      setStatusMsg(err.message)
    }
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    processFile(e.dataTransfer.files[0])
  }, [])

  const handleSave = async () => {
    if (!parsed) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'question_sets'), {
        host_id:         session.uid,
        title:           parsed.title,
        questions:       parsed,
        question_count:  parsed.questions.length,
        source_type:     'ai',
        source_filename: null,
        created_at:      serverTimestamp(),
      })
      onSuccess()
      onClose()
    } catch (e) {
      setStatus('error')
      setStatusMsg('خطأ في الحفظ: ' + e.message)
      setSaving(false)
    }
  }

  const reset = () => {
    setStatus('idle')
    setStatusMsg('')
    setParsed(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="space-y-5">
      {/* Drop zone — hide when processing or done */}
      {status === 'idle' && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all select-none
            ${dragOver ? 'border-primary bg-primary/10 scale-[1.01]' : 'border-gray-600 hover:border-primary/60 hover:bg-gray-800/40'}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => processFile(e.target.files[0])}
          />
          <div className="text-5xl mb-3">📂</div>
          <p className="ar text-gray-200 font-bold text-lg">اسحب الملف هنا أو انقر للاختيار</p>
          <p className="text-gray-500 text-sm mt-2 font-mono">PDF · PPTX · DOCX · صورة</p>
          <p className="ar text-gray-600 text-xs mt-3">
            الملف بيتبعت لـ Gemini 3.1 Flash Lite مباشرة ويطلع JSON تلقائياً
          </p>
        </div>
      )}

      {/* Processing state */}
      {status === 'uploading' && (
        <div className="border border-primary/30 bg-primary/5 rounded-xl p-8 text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
          <p className="ar text-primary font-bold">{statusMsg}</p>
          <p className="ar text-gray-500 text-xs">لا تغلق النافذة</p>
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 space-y-3">
          <p className="ar text-red-400 font-bold">❌ {statusMsg}</p>
          <button
            onClick={reset}
            className="ar text-sm text-gray-400 hover:text-white underline transition-colors"
          >
            ← حاول مرة تانية
          </button>
        </div>
      )}

      {/* Success — show preview + save */}
      {status === 'done' && parsed && (
        <>
          <QuestionsPreview data={parsed} />
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-primary text-background font-bold py-3 rounded-xl hover:bg-[#00D4FF] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <><div className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin" /> جاري الحفظ...</>
              ) : '💾 حفظ في بنك الأسئلة'}
            </button>
            <button
              onClick={reset}
              className="px-5 py-3 bg-gray-800 text-gray-400 rounded-xl hover:bg-gray-700 transition-all font-bold text-sm"
            >
              إعادة
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── JSON Upload Tab ────────────────────────────────────────────────────────────
function JsonUploadTab({ session, onSuccess, onClose }) {
  const [dragOver, setDragOver] = useState(false)
  const [parsed, setParsed]     = useState(null)
  const [errors, setErrors]     = useState([])
  const [saving, setSaving]     = useState(false)
  const fileInputRef            = useRef(null)

  const processFile = async (file) => {
    if (!file || !file.name.endsWith('.json')) { setErrors(['يُسمح فقط بملفات .json']); return }
    setErrors([]); setParsed(null)
    try {
      const text = await readFileAsText(file)
      const json = JSON.parse(text)
      const validationErrors = validateSchema(json)
      if (validationErrors.length > 0) { setErrors(validationErrors); return }
      setParsed({ ...json, questions: json.questions.map((q, i) => ({ ...q, id: i + 1 })) })
    } catch (e) {
      setErrors([e.message.includes('JSON') ? 'الملف لا يحتوي على JSON صالح' : e.message])
    }
  }

  const handleDrop = useCallback((e) => { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files[0]) }, [])

  const handleSave = async () => {
    if (!parsed) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'question_sets'), {
        host_id: session.uid, title: parsed.title, questions: parsed,
        question_count: parsed.questions.length, source_type: 'json',
        source_filename: null, created_at: serverTimestamp()
      })
      onSuccess(); onClose()
    } catch (e) {
      setErrors(['خطأ في الحفظ: ' + e.message])
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all
          ${dragOver ? 'border-primary bg-primary/10 scale-[1.01]' : 'border-gray-600 hover:border-primary/60 hover:bg-gray-800/40'}`}
      >
        <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={(e) => processFile(e.target.files[0])} />
        <div className="text-5xl mb-3">📄</div>
        <p className="ar text-gray-300 font-bold text-lg">اسحب ملف JSON هنا أو انقر للاختيار</p>
        <p className="text-gray-500 text-sm mt-1 font-mono">.json only</p>
      </div>

      {errors.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 space-y-1">
          {errors.map((e, i) => <p key={i} className="text-red-400 text-sm font-mono">❌ {e}</p>)}
        </div>
      )}

      {parsed && (
        <>
          <QuestionsPreview data={parsed} />
          <button onClick={handleSave} disabled={saving}
            className="w-full bg-primary text-background font-bold py-3 rounded-xl hover:bg-[#00D4FF] transition-all disabled:opacity-50">
            {saving ? '⏳ جاري الحفظ...' : '💾 حفظ في بنك الأسئلة'}
          </button>
        </>
      )}
    </div>
  )
}

// ── AI Prompt Tab ──────────────────────────────────────────────────────────────
function AiPromptTab() {
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard.writeText(AI_PROMPT); setCopied(true); setTimeout(() => setCopied(false), 2500) }

  return (
    <div className="space-y-4">
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
        <p className="ar text-amber-300 text-sm font-bold mb-1">📋 لو عايز تستخدم AI خارجي</p>
        <ol className="ar text-gray-300 text-sm space-y-1 list-decimal list-inside">
          <li>انسخ البرومت أدناه</li>
          <li>افتح ChatGPT أو Gemini أو Claude</li>
          <li>أرسل البرومت مع ملفك (PDF / PPTX / صورة)</li>
          <li>الـ AI هيرجعلك JSON جاهز — ارفعه من تاب "JSON"</li>
        </ol>
      </div>
      <div className="relative">
        <pre className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-xs text-gray-300 font-mono overflow-auto max-h-64 whitespace-pre-wrap">{AI_PROMPT}</pre>
        <button onClick={copy} className={`absolute top-3 right-3 px-3 py-1 rounded-lg text-xs font-bold transition-all
          ${copied ? 'bg-green-500/20 text-green-400 border border-green-500/40' : 'bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600'}`}>
          {copied ? '✅ تم النسخ!' : '📋 نسخ'}
        </button>
      </div>
    </div>
  )
}

// ── Main Modal ─────────────────────────────────────────────────────────────────
export default function UploadQuestionsModal({ onClose, onSuccess }) {
  const [tab, setTab] = useState('file')
  const { session }   = useAuth()

  const tabs = [
    { id: 'file', label: '✨ رفع ملف بالـ AI' },
    { id: 'json', label: '📄 رفع JSON' },
    { id: 'prompt', label: '📋 البرومت' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-[#0D1321] border border-gray-700 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-xl font-bold font-display text-white">رفع بنك أسئلة</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none transition-colors">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-3 text-sm font-bold transition-all ${
                tab === t.id
                  ? 'text-primary border-b-2 border-primary bg-primary/5'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {tab === 'file'   && <FileUploadTab   session={session} onSuccess={onSuccess} onClose={onClose} />}
          {tab === 'json'   && <JsonUploadTab   session={session} onSuccess={onSuccess} onClose={onClose} />}
          {tab === 'prompt' && <AiPromptTab />}
        </div>
      </div>
    </div>
  )
}
