import React, { useState, useRef, useCallback } from 'react'
import MathText from '../common/MathText'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { X, Loader2, Upload, FileJson, Copy, Check } from 'lucide-react'

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
4. LANGUAGE POLICY: Do NOT translate the questions. If the text is in Arabic, extract it in Arabic. If English, extract it in English.
   - For ARABIC questions: Set both "question" and "question_ar" to the Arabic text.
   - For ENGLISH questions: Set "question" to the English text and "question_ar" to null.
5. Preserve the original wording of questions and choices exactly as written.
6. If choices are labeled A/B/C/D or 1/2/3/4, remove the labels and just keep the text.
7. Set "needs_image" to true if the question refers to a figure, image, photograph, diagram, graph, table, or any visual element that is required to answer correctly. Set to false otherwise.
8. Return ONLY the JSON object. No markdown backticks, no commentary.
9. USE MathML for EVERYTHING that is not plain text. This is MANDATORY for:
   - ALL subscripts and superscripts (e.g., use <msub> for q1, F2).
   - ALL vector symbols (e.g., use <mover> with an arrow for vectors).
   - ALL mathematical operators, fractions, and complex expressions.
   - Ensure all <math> tags and their children are properly closed and valid.
10. If the question contains a mix of Arabic and English (common in medical exams), preserve the mixture in both "question" and "question_ar".
11. ARABIC MATH SYMBOLS: When extracting Arabic math variables (like ق, س, ص, ع):
   - ALWAYS use <math dir="rtl"> for the root element of Arabic equations. This is CRITICAL for correct alignment and right-to-left layout.
   - Use <mi> for the Arabic letter.
   - FOR SUBSCRIPTS: Use standard <msub> (e.g., ق١ becomes <math dir="rtl"><msub><mi>ق</mi><mn>١</mn></msub></math>).
   - FOR VECTORS: Use <mover> (e.g., <math dir="rtl"><mover><mi>ق</mi><mo>→</mo></mover></math>). Use the standard right arrow →.
   - FOR BOTH: Nest them (e.g., <math dir="rtl"><msub><mover><mi>ق</mi><mo>→</mo></mover><mn>١</mn></msub></math>).
   - Match the numeral style (Arabic 1, 2 or Arabic-Indic ١, ٢) EXACTLY as per the source.`

// ── Questions preview ──────────────────────────────────────────────────────────
function QuestionsPreview({ data }) {
  const needsImg = data.questions.filter(q => q.needs_image && !q.image_url).length
  const noAnswer = data.questions.filter(q => q.correct === -1).length

  return (
    <div style={{
      border: '1px solid var(--rule)', borderRadius: 4, overflow: 'hidden',
      background: 'var(--paper-2)',
    }}>
      {/* Title row */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 16, fontWeight: 500, color: 'var(--ink)', marginBottom: 8 }} className="ar">
            {data.title}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span className="folio" style={{ color: 'var(--success)', border: '1px solid var(--success)', padding: '2px 8px' }}>
              {data.questions.length} QUESTIONS
            </span>
            {noAnswer > 0 && (
              <span className="folio" style={{ color: 'var(--gold)', border: '1px solid var(--gold)', padding: '2px 8px' }}>
                {noAnswer} NO ANSWER
              </span>
            )}
            {needsImg > 0 && (
              <span className="folio" style={{ color: 'var(--gold)', border: '1px solid var(--gold)', padding: '2px 8px' }}>
                {needsImg} NEEDS IMAGE
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <span className="folio" style={{ color: 'var(--ink-3)', fontSize: 9 }}>
            {data.model_used || 'Gemini'}
          </span>
          {data.is_rollback && (
            <span className="folio" style={{ color: 'var(--gold)', fontSize: 9, border: '1px solid var(--gold)', padding: '1px 6px' }}>
              ROLLBACK
            </span>
          )}
        </div>
      </div>

      {/* Questions sample */}
      <div style={{ maxHeight: 200, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.questions.slice(0, 5).map((q, i) => (
          <div key={i} style={{ paddingBottom: 8, borderBottom: i < Math.min(4, data.questions.length - 1) ? '1px solid var(--rule)' : 'none' }}>
            <p style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink)', marginBottom: 6 }} className="ar">
              {i + 1}. <MathText text={q.question} />
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {q.choices.map((c, ci) => (
                <span key={ci} style={{
                  fontFamily: 'var(--mono)', fontSize: 11, padding: '2px 8px',
                  border: `1px solid ${ci === q.correct ? 'var(--success)' : 'var(--rule)'}`,
                  color: ci === q.correct ? 'var(--success)' : 'var(--ink-3)',
                  background: ci === q.correct ? 'color-mix(in srgb, var(--success) 8%, var(--paper))' : 'transparent',
                }}>
                  <MathText text={c} />
                </span>
              ))}
            </div>
          </div>
        ))}
        {data.questions.length > 5 && (
          <p className="folio" style={{ color: 'var(--ink-4)', textAlign: 'center', paddingTop: 4 }}>
            + {data.questions.length - 5} MORE
          </p>
        )}
      </div>
    </div>
  )
}

// ── File Upload Tab ────────────────────────────────────────────────────────────
function FileUploadTab({ session, onSuccess, onClose }) {
  const [dragOver, setDragOver]     = useState(false)
  const [status, setStatus]         = useState('idle')
  const [statusMsg, setStatusMsg]   = useState('')
  const [parsed, setParsed]         = useState(null)
  const [sourceData, setSourceData] = useState(null)
  const [saving, setSaving]         = useState(false)
  const fileInputRef                = useRef(null)

  const ACCEPTED = '.pdf,.pptx,.ppt,.docx,.doc,.txt,image/*'

  const processFile = async (file) => {
    if (!file) return
    if (!CLOUD_RUN_URL) {
      setStatus('error')
      setStatusMsg('VITE_CLOUD_RUN_URL غير مضبوط — تواصل مع المسؤول')
      return
    }
    setParsed(null); setSourceData(null)
    setStatus('uploading'); setStatusMsg('جاري رفع الملف والأرشفة...')
    try {
      let archiveUrl = null
      try {
        const uniqueId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
        const path = `question_sources/${session.uid}/${uniqueId}_${file.name}`
        const sRef = storageRef(storage, path)
        await uploadBytes(sRef, file)
        archiveUrl = await getDownloadURL(sRef)
        setSourceData({ url: archiveUrl, filename: file.name })
      } catch (storageErr) {
        console.warn('Failed to archive source file:', storageErr)
      }

      const formData = new FormData()
      formData.append('file', file)
      setStatusMsg('جاري المعالجة بنظام Multi-Model Fallback...')

      const res = await fetch(`${CLOUD_RUN_URL}/process`, {
        method: 'POST',
        headers: API_SECRET ? { 'x-api-secret': API_SECRET } : {},
        body: formData,
      })

      if (!res.ok) {
        let detail = `خطأ ${res.status}`
        try {
          const errJson = await res.json()
          detail = errJson.detail?.message || errJson.detail || detail
        } catch (_) {}
        throw new Error(detail)
      }

      const data = await res.json()
      if (!data.questions || !Array.isArray(data.questions) || data.questions.length === 0)
        throw new Error('الـ AI مرجعش أسئلة صالحة — تأكد إن الملف فيه MCQs')

      setParsed(data); setStatus('done'); setStatusMsg('')
    } catch (err) {
      setStatus('error'); setStatusMsg(err.message)
    }
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false)
    processFile(e.dataTransfer.files[0])
  }, [])

  const handleSave = async () => {
    if (!parsed || !session) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'question_sets'), {
        host_id:         session.uid,
        title:           parsed.title,
        questions:       parsed,
        question_count:  parsed.questions.length,
        source_type:     'ai',
        source_file_url: sourceData?.url || null,
        source_filename: sourceData?.filename || null,
        created_at:      serverTimestamp(),
      })
      onSuccess(); onClose()
    } catch (e) {
      setStatus('error'); setStatusMsg('خطأ في الحفظ: ' + e.message)
      setSaving(false)
    }
  }

  const reset = () => {
    setStatus('idle'); setStatusMsg(''); setParsed(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Drop zone */}
      {status === 'idle' && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--ink)' : 'var(--rule-strong)'}`,
            borderRadius: 4, padding: '40px 24px', textAlign: 'center', cursor: 'pointer',
            background: dragOver ? 'color-mix(in srgb, var(--ink) 4%, var(--paper))' : 'var(--paper-2)',
            transition: 'all 150ms', userSelect: 'none',
          }}
        >
          <input
            ref={fileInputRef} type="file" accept={ACCEPTED}
            style={{ display: 'none' }}
            onChange={(e) => processFile(e.target.files[0])}
          />
          <Upload size={28} style={{ color: 'var(--ink-3)', margin: '0 auto 12px' }} />
          <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 6, textAlign: 'center' }}>
            اسحب الملف هنا أو انقر للاختيار
          </p>
          <p className="folio" style={{ color: 'var(--ink-4)', marginBottom: 14, textAlign: 'center' }}>
            PDF · PPTX · DOCX · TXT · IMAGE
          </p>
          <p className="ar" style={{
            fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--ink-4)',
            border: '1px solid var(--rule)', padding: '6px 12px', display: 'inline-block',
            textAlign: 'center',
          }}>
            Gemini 3.1 & 2.5 & 2 + Gemma 4 — تبديل تلقائي عند الفشل
          </p>
        </div>
      )}

      {/* Processing */}
      {status === 'uploading' && (
        <div style={{
          border: '1px solid var(--rule)', borderRadius: 4, padding: '40px 24px',
          textAlign: 'center', background: 'var(--paper-2)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
        }}>
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--ink)' }} />
          <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 14, color: 'var(--ink-2)' }}>{statusMsg}</p>
          <p className="folio" style={{ color: 'var(--ink-4)', fontSize: 9 }}>لا تغلق النافذة</p>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div style={{
          border: '1px solid var(--alert)', borderRadius: 4, padding: '16px',
          background: 'color-mix(in srgb, var(--alert) 6%, var(--paper))',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <p className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 14, color: 'var(--alert)' }}>{statusMsg}</p>
          <button onClick={reset} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-3)',
            textDecoration: 'underline', alignSelf: 'flex-start', padding: 0,
          }} className="ar">
            حاول مرة تانية
          </button>
        </div>
      )}

      {/* Done — preview + save */}
      {status === 'done' && parsed && (
        <>
          <QuestionsPreview data={parsed} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSave} disabled={saving}
              style={{
                flex: 1, padding: '12px 0',
                background: saving ? 'var(--paper-2)' : 'var(--ink)',
                color: saving ? 'var(--ink-3)' : 'var(--paper)',
                border: '1px solid var(--ink)', borderRadius: 4,
                fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 14,
                cursor: saving ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: saving ? 0.6 : 1, transition: 'all 150ms',
              }}
            >
              {saving
                ? <><Loader2 size={15} className="animate-spin" /><span className="ar">جاري الحفظ...</span></>
                : <span className="ar">حفظ في بنك الأسئلة</span>
              }
            </button>
            <button onClick={reset} style={{
              padding: '12px 20px', background: 'var(--paper-2)',
              border: '1px solid var(--rule)', borderRadius: 4,
              fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-3)',
              cursor: 'pointer', transition: 'all 150ms',
            }} className="ar">
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
  const [text, setText]         = useState('')
  const [parsed, setParsed]     = useState(null)
  const [errors, setErrors]     = useState([])
  const [saving, setSaving]     = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef            = useRef(null)

  const parseText = useCallback((raw) => {
    setErrors([]); setParsed(null)
    if (!raw.trim()) return
    try {
      const json = JSON.parse(raw)
      const errs = validateSchema(json)
      if (errs.length > 0) { setErrors(errs); return }
      setParsed({ ...json, questions: json.questions.map((q, i) => ({ ...q, id: i + 1 })) })
    } catch (e) {
      setErrors(['JSON غير صالح — تأكد من الصياغة'])
    }
  }, [])

  const loadFile = async (file) => {
    if (!file || !file.name.endsWith('.json')) { setErrors(['يُسمح فقط بملفات .json']); return }
    try {
      const raw = await readFileAsText(file)
      setText(raw); parseText(raw)
    } catch (e) { setErrors([e.message]) }
  }

  const handleTextChange = (e) => {
    const val = e.target.value
    setText(val); parseText(val)
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false)
    loadFile(e.dataTransfer.files[0])
  }, [])

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

  const reset = () => { setText(''); setParsed(null); setErrors([]) }

  const borderColor = dragOver ? 'var(--ink)'
    : parsed ? 'var(--success)'
    : errors.length ? 'var(--alert)'
    : 'var(--rule-strong)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Label + file button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="folio" style={{ color: 'var(--ink-4)' }}>الصق JSON هنا أو اكتبه مباشرة</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: '1px solid var(--rule)', borderRadius: 4,
              padding: '4px 10px', cursor: 'pointer',
              fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--ink-3)', transition: 'all 150ms',
            }}
          >
            <FileJson size={12} /> رفع .json
          </button>
          <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }}
            onChange={(e) => loadFile(e.target.files[0])} />
        </div>
      </div>

      {/* Textarea */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{ border: `2px dashed ${borderColor}`, borderRadius: 4, transition: 'border-color 150ms' }}
      >
        <textarea
          value={text}
          onChange={handleTextChange}
          placeholder={'{\n  "title": "اسم البنك",\n  "questions": [...]\n}'}
          rows={10}
          spellCheck={false}
          style={{
            width: '100%', background: 'var(--paper-2)', borderRadius: 4,
            padding: '12px 14px', color: 'var(--ink)', fontFamily: 'var(--mono)',
            fontSize: 12, outline: 'none', resize: 'none', border: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
      {text && (
        <button onClick={reset} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)',
          letterSpacing: '0.06em', textTransform: 'uppercase', alignSelf: 'flex-start',
        }}>
          CLEAR ×
        </button>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div style={{
          border: '1px solid var(--alert)', borderRadius: 4, padding: '14px 16px',
          background: 'color-mix(in srgb, var(--alert) 6%, var(--paper))',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {errors.map((e, i) => (
            <p key={i} className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--alert)', margin: 0 }}>
              {e}
            </p>
          ))}
        </div>
      )}

      {/* Preview + save */}
      {parsed && (
        <>
          <QuestionsPreview data={parsed} />
          <button onClick={handleSave} disabled={saving} style={{
            width: '100%', padding: '12px 0',
            background: saving ? 'var(--paper-2)' : 'var(--ink)',
            color: saving ? 'var(--ink-3)' : 'var(--paper)',
            border: '1px solid var(--ink)', borderRadius: 4,
            fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 14,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1, transition: 'all 150ms',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            {saving
              ? <><Loader2 size={15} className="animate-spin" /><span className="ar">جاري الحفظ...</span></>
              : <span className="ar">حفظ في بنك الأسئلة</span>
            }
          </button>
        </>
      )}
    </div>
  )
}

// ── AI Prompt Tab ──────────────────────────────────────────────────────────────
function AiPromptTab() {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(AI_PROMPT)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Instruction card */}
      <div style={{
        border: '1px solid var(--gold)', borderRadius: 4, padding: '14px 16px',
        background: 'color-mix(in srgb, var(--gold) 6%, var(--paper))',
      }}>
        <div className="folio" style={{ color: 'var(--gold)', marginBottom: 10 }}>لو عايز تستخدم AI خارجي</div>
        <ol className="ar" style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--ink-2)', margin: 0, padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>انسخ البرومت أدناه</li>
          <li>افتح ChatGPT أو Gemini أو Claude</li>
          <li>أرسل البرومت مع ملفك (PDF / PPTX / صورة)</li>
          <li>الـ AI هيرجعلك JSON جاهز — ارفعه من تاب "JSON"</li>
        </ol>
      </div>

      {/* Prompt block */}
      <div style={{ position: 'relative' }}>
        <pre style={{
          border: '1px solid var(--rule)', borderRadius: 4,
          padding: '16px 14px', margin: 0,
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-2)',
          background: 'var(--paper-2)', overflowX: 'auto', maxHeight: 260,
          whiteSpace: 'pre-wrap', overflowY: 'auto', lineHeight: 1.6,
        }}>
          {AI_PROMPT}
        </pre>
        <button
          onClick={copy}
          style={{
            position: 'absolute', top: 10, right: 10,
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 10px', borderRadius: 4, cursor: 'pointer',
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
            border: `1px solid ${copied ? 'var(--success)' : 'var(--rule)'}`,
            background: copied ? 'color-mix(in srgb, var(--success) 8%, var(--paper))' : 'var(--paper)',
            color: copied ? 'var(--success)' : 'var(--ink-3)',
            transition: 'all 150ms',
          }}
        >
          {copied ? <><Check size={11} /> COPIED</> : <><Copy size={11} /> COPY</>}
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
    { id: 'file',   label: 'رفع ملف بالـ AI' },
    { id: 'json',   label: 'رفع JSON' },
    { id: 'prompt', label: 'البرومت' },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }}
      />

      {/* Panel */}
      <div style={{
        position: 'relative', width: '100%', maxWidth: 640,
        background: 'var(--paper)', color: 'var(--ink)',
        borderTop: '3px double var(--rule-strong)',
        border: '1px solid var(--rule)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--rule)',
        }}>
          <div>
            <div className="folio" style={{ color: 'var(--ink-4)', marginBottom: 2 }}>QUESTION BANK</div>
            <h2 className="ar" style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>
              رفع بنك أسئلة
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid var(--rule)', borderRadius: 4,
              padding: '6px 10px', cursor: 'pointer', color: 'var(--ink-3)',
              display: 'flex', alignItems: 'center',
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--rule)' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: '11px 0',
                fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                border: 'none', borderBottom: tab === t.id ? '2px solid var(--ink)' : '2px solid transparent',
                background: 'none', cursor: 'pointer',
                color: tab === t.id ? 'var(--ink)' : 'var(--ink-4)',
                transition: 'all 150ms',
                textAlign: 'center',
              }}
              className="ar"
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: 20, maxHeight: '70vh', overflowY: 'auto' }}>
          {tab === 'file'   && <FileUploadTab   session={session} onSuccess={onSuccess} onClose={onClose} />}
          {tab === 'json'   && <JsonUploadTab   session={session} onSuccess={onSuccess} onClose={onClose} />}
          {tab === 'prompt' && <AiPromptTab />}
        </div>
      </div>
    </div>
  )
}
