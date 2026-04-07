import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Link } from 'react-router-dom'
import UploadQuestionsModal from '../../components/host/UploadQuestionsModal'

export default function HostDashboard() {
  const { profile } = useAuth()
  const [banks, setBanks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    fetchBanks()
  }, [])

  const fetchBanks = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('question_sets')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) console.error('Error fetching question banks:', error)
    else setBanks(data || [])
    setLoading(false)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('حذف بنك الأسئلة ده؟ مش هترجعه.')) return
    setDeletingId(id)
    const { error } = await supabase.from('question_sets').delete().eq('id', id)
    if (error) alert('خطأ في الحذف: ' + error.message)
    else setBanks(prev => prev.filter(b => b.id !== id))
    setDeletingId(null)
  }

  const handleStartGame = async (bank) => {
    if (!profile) return
    const code = Math.random().toString(36).substring(2, 8).toUpperCase()
    const { data, error } = await supabase.from('rooms').insert({
      code,
      host_id: profile.id,
      question_set_id: bank.id,
      title: bank.title + ' Room',
      questions: bank.questions,
      status: 'lobby'
    }).select().single()

    if (error) alert('Error creating room: ' + error.message)
    else window.location.href = `/host/game/${data.id}`
  }

  return (
    <div className="min-h-screen bg-background text-white p-8">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* Header */}
        <header className="flex justify-between items-center bg-gray-900/50 p-6 rounded-2xl border border-gray-800 backdrop-blur-sm">
          <div>
            <h1 className="text-3xl font-display font-bold text-primary">Host Dashboard</h1>
            <p className="text-gray-400 mt-2 font-sans">Manage your Question Banks and Game Rooms</p>
          </div>
          <Link to="/" className="text-gray-400 hover:text-white transition-colors font-sans">Return Home</Link>
        </header>

        {/* Question Banks section */}
        <section className="bg-gray-900/50 p-6 rounded-2xl border border-gray-800 backdrop-blur-sm shadow-xl">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold font-display">My Question Banks</h2>
            <button
              onClick={() => setShowUpload(true)}
              className="bg-primary text-background font-bold px-5 py-2.5 rounded-xl hover:bg-[#00D4FF] hover:scale-105 active:scale-95 transition-all text-sm"
            >
              + رفع بنك أسئلة
            </button>
          </div>

          {loading ? (
            <div className="text-primary animate-pulse py-6 text-center font-mono">Loading banks...</div>
          ) : banks.length === 0 ? (
            <div className="text-center py-14 space-y-3">
              <div className="text-5xl">📚</div>
              <p className="text-gray-400 font-bold text-lg">مفيش بنوك أسئلة لحد دلوقتي</p>
              <p className="text-gray-600 text-sm">ارفع ملف JSON أو استخدم الذكاء الاصطناعي لاستخراج الأسئلة</p>
              <button
                onClick={() => setShowUpload(true)}
                className="mt-2 bg-primary/10 border border-primary/30 text-primary px-6 py-2 rounded-xl hover:bg-primary/20 transition-all font-bold text-sm"
              >
                + رفع أول بنك أسئلة
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {banks.map(bank => (
                <div
                  key={bank.id}
                  className="bg-gray-800/80 p-5 rounded-xl border border-gray-700 hover:border-primary/50 transition-all flex flex-col justify-between shadow-lg hover:shadow-primary/10 group"
                >
                  <div>
                    <h3 className="text-lg font-bold mb-2 font-display leading-snug">{bank.title}</h3>
                    <div className="flex flex-wrap gap-2 text-xs text-gray-400 mb-4 font-mono">
                      <span className="bg-gray-700/80 px-2 py-1 rounded-md">{bank.question_count} سؤال</span>
                      <span className="bg-gray-700/80 px-2 py-1 rounded-md uppercase">{bank.source_type}</span>
                      <span className="bg-gray-700/80 px-2 py-1 rounded-md">
                        {new Date(bank.created_at).toLocaleDateString('ar-EG')}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button
                      onClick={() => handleStartGame(bank)}
                      className="bg-green-500/10 text-green-400 py-2 rounded-lg hover:bg-green-500/20 transition-colors font-bold text-sm border border-green-500/30"
                    >
                      ▶ Host Game
                    </button>
                    <button
                      onClick={() => handleDelete(bank.id)}
                      disabled={deletingId === bank.id}
                      className="bg-red-500/10 text-red-400 py-2 rounded-lg hover:bg-red-500/20 transition-colors font-bold text-sm border border-red-500/30 disabled:opacity-40"
                    >
                      {deletingId === bank.id ? '...' : '🗑 حذف'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Upload Modal */}
      {showUpload && (
        <UploadQuestionsModal
          onClose={() => setShowUpload(false)}
          onSuccess={fetchBanks}
        />
      )}
    </div>
  )
}
