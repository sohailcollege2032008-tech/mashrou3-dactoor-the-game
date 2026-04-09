import React, { useState, useRef } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'

const CLOUD_RUN_URL = import.meta.env.VITE_CLOUD_RUN_URL   // e.g. https://dactoor-processor-xxxx-uc.a.run.app
const API_SECRET    = import.meta.env.VITE_CLOUD_RUN_SECRET || ''

export default function FileUploadButton({ onUploadSuccess }) {
  const [loading, setLoading]   = useState(false)
  const [progress, setProgress] = useState('')   // human-readable status
  const fileInputRef            = useRef(null)
  const { session }             = useAuth()

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    if (!CLOUD_RUN_URL) {
      alert('VITE_CLOUD_RUN_URL is not set in .env.local — deploy the Cloud Run service first.')
      return
    }

    setLoading(true)
    setProgress('⏫ جاري رفع الملف...')

    try {
      // ── Send file to Cloud Run ──────────────────────────────────────────────
      const formData = new FormData()
      formData.append('file', file)

      setProgress('🤖 Gemini بيحلل الملف...')

      const res = await fetch(`${CLOUD_RUN_URL}/process`, {
        method: 'POST',
        headers: {
          ...(API_SECRET ? { 'x-api-secret': API_SECRET } : {}),
        },
        body: formData,
      })

      if (!res.ok) {
        let detail = `Server error ${res.status}`
        try {
          const errJson = await res.json()
          detail = errJson.detail || detail
        } catch (_) {}
        throw new Error(detail)
      }

      const data = await res.json()

      if (!data.title || !Array.isArray(data.questions) || data.questions.length === 0) {
        throw new Error('الـ AI مرجعش أسئلة صالحة — تأكد إن الملف فيه MCQs')
      }

      // ── Save to Firestore ───────────────────────────────────────────────────
      setProgress('💾 جاري الحفظ في Firestore...')

      await addDoc(collection(db, 'question_sets'), {
        host_id:         session.uid,
        title:           data.title,
        questions:       data,
        question_count:  data.questions.length,
        source_type:     file.name.split('.').pop().toLowerCase() || 'other',
        source_filename: file.name,
        created_at:      serverTimestamp(),
      })

      onUploadSuccess()

    } catch (err) {
      console.error('[FileUploadButton]', err)
      alert('خطأ: ' + err.message)
    } finally {
      setLoading(false)
      setProgress('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div>
      <input
        type="file"
        accept=".pdf,.pptx,.ppt,.docx,.doc,image/*"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current.click()}
        disabled={loading}
        className="bg-primary text-background font-bold px-6 py-3 rounded-xl hover:bg-[#00D4FF] hover:scale-105 active:scale-95 transition-all outline-none disabled:opacity-60 disabled:scale-100"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
            {progress || 'جاري المعالجة...'}
          </span>
        ) : (
          'Upload Bank (PDF / PPTX / صورة)'
        )}
      </button>
    </div>
  )
}
