import React, { useState, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

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
      else if (Array.isArray(q.choices) && q.correct !== -1 && (q.correct < 0 || q.correct >= q.choices.length))
        errors.push(`سؤال #${i + 1}: قيمة "correct" خارج النطاق (0 → ${q.choices.length - 1})`)
    })
  }
  return errors
}

// ── Read file as text (Promise wrapper) ───────────────────────────────────────
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(new Error('فشل في قراءة الملف'))
    reader.readAsText(file, 'UTF-8')
  })
}

// ── AI Prompt (copied from PRD) ───────────────────────────────────────────────
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
      "time_limit": 20,
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
7. Set time_limit to 20 for normal questions, 30 for long/complex ones, 10 for simple recall.
8. Return ONLY the JSON object. No markdown backticks, no commentary.`

// ── Tab components ─────────────────────────────────────────────────────────────

function JsonUploadTab({ session, onSuccess, onClose }) {
  const [dragOver, setDragOver] = useState(false)
  const [parsed, setParsed] = useState(null)
  const [errors, setErrors] = useState([])
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  const processFile = async (file) => {
    if (!file || !file.name.endsWith('.json')) {
      setErrors(['يُسمح فقط بملفات .json'])
      return
    }
    setErrors([])
    setParsed(null)
    try {
      const text = await readFileAsText(file)
      const json = JSON.parse(text)
      const validationErrors = validateSchema(json)
      if (validationErrors.length > 0) {
        setErrors(validationErrors)
        return
      }
      // Normalise IDs
      const normalised = {
        ...json,
        questions: json.questions.map((q, i) => ({ ...q, id: i + 1 }))
      }
      setParsed(normalised)
    } catch (e) {
      setErrors([e.message.includes('JSON') ? 'الملف لا يحتوي على JSON صالح — تحقق من الصيغة' : e.message])
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
      const { error } = await supabase.from('question_sets').insert({
        host_id: session.user.id,
        title: parsed.title,
        questions: parsed,
        source_type: 'json',
        source_filename: null
      })
      if (error) throw error
      onSuccess()
      onClose()
    } catch (e) {
      setErrors(['خطأ في الحفظ: ' + e.message])
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all
          ${dragOver ? 'border-primary bg-primary/10 scale-[1.01]' : 'border-gray-600 hover:border-primary/60 hover:bg-gray-800/40'}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => processFile(e.target.files[0])}
        />
        <div className="text-5xl mb-3">📄</div>
        <p className="text-gray-300 font-bold text-lg">اسحب ملف JSON هنا أو انقر للاختيار</p>
        <p className="text-gray-500 text-sm mt-1 font-mono">.json only</p>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 space-y-1">
          {errors.map((e, i) => (
            <p key={i} className="text-red-400 text-sm font-mono">❌ {e}</p>
          ))}
        </div>
      )}

      {/* Preview */}
      {parsed && (
        <div className="bg-gray-800/60 border border-primary/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-white">{parsed.title}</h3>
              <p className="text-primary font-mono text-sm mt-1">
                {parsed.questions.length} سؤال ✅
                {parsed.questions.filter(q => q.correct === -1).length > 0 &&
                  <span className="text-amber-400 ml-2">
                    ⚠️ {parsed.questions.filter(q => q.correct === -1).length} بدون إجابة
                  </span>}
              </p>
            </div>
            <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-mono border border-primary/30">JSON</span>
          </div>

          {/* First 3 questions preview */}
          <div className="space-y-2">
            {parsed.questions.slice(0, 3).map((q, i) => (
              <div key={i} className="bg-gray-700/50 rounded-lg p-3">
                <p className="text-gray-200 text-sm font-bold mb-1">
                  {i + 1}. {q.question}
                </p>
                <div className="flex flex-wrap gap-1">
                  {q.choices.map((c, ci) => (
                    <span key={ci}
                      className={`text-xs px-2 py-0.5 rounded font-mono ${ci === q.correct ? 'bg-green-500/20 text-green-400 border border-green-500/40' : 'bg-gray-600/50 text-gray-400'}`}>
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {parsed.questions.length > 3 && (
              <p className="text-gray-500 text-xs text-center font-mono">
                + {parsed.questions.length - 3} سؤال آخر...
              </p>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-primary text-background font-bold py-3 rounded-xl hover:bg-[#00D4FF] transition-all disabled:opacity-50"
          >
            {saving ? '⏳ جاري الحفظ...' : '💾 حفظ في بنك الأسئلة'}
          </button>
        </div>
      )}
    </div>
  )
}

function AiPromptTab() {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(AI_PROMPT)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
        <p className="text-amber-300 text-sm font-bold mb-1">📋 طريقة الاستخدام</p>
        <ol className="text-gray-300 text-sm space-y-1 list-decimal list-inside">
          <li>انسخ البرومت أدناه</li>
          <li>افتح ChatGPT أو Gemini أو Claude</li>
          <li>أرسل البرومت مع ملفك (PDF / PPTX / صورة)</li>
          <li>الـ AI هيرجعلك JSON جاهز — ارفعه هنا</li>
        </ol>
      </div>

      <div className="relative">
        <pre className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-xs text-gray-300 font-mono overflow-auto max-h-64 whitespace-pre-wrap">
          {AI_PROMPT}
        </pre>
        <button
          onClick={copy}
          className={`absolute top-3 right-3 px-3 py-1 rounded-lg text-xs font-bold transition-all
            ${copied ? 'bg-green-500/20 text-green-400 border border-green-500/40' : 'bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600'}`}
        >
          {copied ? '✅ تم النسخ!' : '📋 نسخ'}
        </button>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3">
        <p className="text-blue-300 text-xs font-mono">
          🔮 <strong>قريباً:</strong> رفع الملف مباشرة → معالجة تلقائية بالذكاء الاصطناعي عبر Cloud Run
        </p>
      </div>
    </div>
  )
}

// ── Main Modal ─────────────────────────────────────────────────────────────────

export default function UploadQuestionsModal({ onClose, onSuccess }) {
  const [tab, setTab] = useState('json')
  const { session } = useAuth()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-2xl bg-[#0D1321] border border-gray-700 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-xl font-bold font-display text-white">رفع بنك أسئلة</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl leading-none transition-colors"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setTab('json')}
            className={`flex-1 py-3 text-sm font-bold transition-all
              ${tab === 'json' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-gray-400 hover:text-gray-200'}`}
          >
            📄 رفع JSON مباشر
          </button>
          <button
            onClick={() => setTab('ai')}
            className={`flex-1 py-3 text-sm font-bold transition-all
              ${tab === 'ai' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-gray-400 hover:text-gray-200'}`}
          >
            🤖 توليد بالذكاء الاصطناعي
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {tab === 'json' ? (
            <JsonUploadTab session={session} onSuccess={onSuccess} onClose={onClose} />
          ) : (
            <AiPromptTab />
          )}
        </div>
      </div>
    </div>
  )
}
