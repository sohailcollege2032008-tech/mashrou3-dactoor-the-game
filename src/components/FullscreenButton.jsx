import { useState, useEffect, useCallback, useRef } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'

/**
 * Global fullscreen toggle — fixed bottom-right corner, z-40.
 * • Single click on the button → toggle
 * • Double-tap on any empty area (non-interactive) → toggle
 *
 * Mount once in App.jsx; works across all pages.
 */
export default function FullscreenButton() {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const lastTapRef = useRef(0)

  // Track actual fullscreen state (user can press Esc to exit)
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  // Global double-tap detection (ignores interactive elements)
  useEffect(() => {
    const handleTap = (e) => {
      if (e.target.closest('button, a, input, select, textarea, [role="button"], [role="option"]')) return
      const now = Date.now()
      if (now - lastTapRef.current < 350) {
        toggleFullscreen()
        lastTapRef.current = 0
      } else {
        lastTapRef.current = now
      }
    }
    document.addEventListener('click', handleTap)
    return () => document.removeEventListener('click', handleTap)
  }, [toggleFullscreen])

  return (
    <button
      onClick={toggleFullscreen}
      title={isFullscreen ? 'تصغير الشاشة' : 'تكبير الشاشة'}
      className="
        fixed bottom-5 right-5 z-40
        w-8 h-8 flex items-center justify-center
        rounded-xl
        bg-black/40 backdrop-blur-sm
        border border-white/10
        text-white/30 hover:text-white/70
        hover:border-white/25 hover:bg-black/60
        transition-all duration-200 active:scale-90
      "
    >
      {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
    </button>
  )
}
