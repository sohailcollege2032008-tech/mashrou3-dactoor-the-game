import { useState, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'

function getInitialTheme() {
  const stored = localStorage.getItem('mr-theme')
  if (stored) return stored === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(dark) {
  if (dark) {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

export default function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    try { return getInitialTheme() } catch { return false }
  })

  // Apply on mount + whenever dark changes
  useEffect(() => {
    applyTheme(dark)
    localStorage.setItem('mr-theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <button
      onClick={() => setDark(d => !d)}
      title={dark ? 'Light mode' : 'Dark mode'}
      className="
        fixed bottom-16 right-5 z-40
        w-8 h-8 flex items-center justify-center
        rounded-xl
        bg-black/40 backdrop-blur-sm
        border border-white/10
        text-white/30 hover:text-white/70
        hover:border-white/25 hover:bg-black/60
        transition-all duration-200 active:scale-90
      "
    >
      {dark ? <Sun size={13} /> : <Moon size={13} />}
    </button>
  )
}
