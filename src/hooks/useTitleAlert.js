/**
 * useTitleAlert — call the player back to a tab they are not looking at.
 *
 * A tournament match starts on the server's clock, not on the player's
 * attention. The wait screen plays a sound and navigates them into the duel,
 * but a backgrounded tab is exactly where audio is most likely to be blocked
 * (no gesture, no focus) — so a player checking something else came back to a
 * question that had been counting down without them.
 *
 * The browser tab strip is the one surface that reaches them with no
 * permission prompt and no dependency: flash the title while the tab is
 * hidden, restore it the moment they look. Nothing here fires while the tab is
 * visible, so a player who is watching sees their normal title throughout.
 *
 * @param {boolean} active   whether there is something to be called back to
 * @param {string}  message  what the tab should say (kept short — a tab is narrow)
 */
import { useEffect, useRef } from 'react'

export default function useTitleAlert(active, message) {
  const originalRef = useRef(null)

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (originalRef.current === null) originalRef.current = document.title
    const original = originalRef.current

    if (!active) {
      document.title = original
      return
    }

    let timer = null
    let on = false

    const stop = () => {
      if (timer) { clearInterval(timer); timer = null }
      document.title = original
    }

    const start = () => {
      if (timer) return
      on = false
      timer = setInterval(() => {
        on = !on
        document.title = on ? message : original
      }, 1100)
      document.title = message
      on = true
    }

    const sync = () => (document.hidden ? start() : stop())

    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      stop()
    }
  }, [active, message])
}
