import React, { useState, useRef } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { Loader2 } from 'lucide-react'

const CLOUD_RUN_URL = import.meta.env.VITE_CLOUD_RUN_URL
const API_SECRET    = import.meta.env.VITE_CLOUD_RUN_SECRET || ''

export default function FileUploadButton({ onUploadSuccess }) {
  const [loading, setLoading]   = useState(false)
  const [progress, setProgress] = useState('')
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
    setProgress('جاري رفع الملف...')

    try {
      const formData = new FormData()
      formData.append('file', file)
      setProgress('Gemini بيحلل الملف...')

      const res = await fetch(`${CLOUD_RUN_URL}/process`, {
        method: 'POST',
        headers: API_SECRET ? { 'x-api-secret': API_SECRET } : {},
        body: formData,
      })

      if (!res.ok) {
        let detail = `Server error ${res.status}`
        try { const errJson = await res.json(); detail = errJson.detail || detail } catch (_) {}
        throw new Error(detail)
      }

      const data = await res.json()
      if (!data.title || !Array.isArray(data.questions) || data.questions.length === 0)
        throw new Error('الـ AI مرجعش أسئلة صالحة — تأكد إن الملف فيه MCQs')

      setProgress('جاري الحفظ...')
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
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '10px 20px',
          background: loading ? 'var(--paper-2)' : 'var(--ink)',
          color: loading ? 'var(--ink-3)' : 'var(--paper)',
          border: '1px solid var(--ink)',
          borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 14,
          letterSpacing: '0.01em', transition: 'all 150ms',
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading
          ? <><Loader2 size={14} className="animate-spin" /><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{progress || 'جاري...'}</span></>
          : 'Upload Bank (PDF / PPTX / صورة)'
        }
      </button>
    </div>
  )
}
