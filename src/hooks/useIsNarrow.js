/**
 * useIsNarrow — true while the viewport is too narrow for a wide layout.
 *
 * Used by anything that has a genuinely different shape on a phone rather than
 * a reflowed one: the bracket is a column tree on a laptop and a round-by-round
 * list on a phone, and that is a different component, not a media query.
 *
 * Initialised from the same query the listener watches, so the first render is
 * already correct and the effect only follows changes.
 */
import { useEffect, useState } from 'react'

export default function useIsNarrow(maxWidth = 860) {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(`(max-width: ${maxWidth}px)`).matches
      : false)

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`)
    const on = e => setNarrow(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [maxWidth])

  return narrow
}
