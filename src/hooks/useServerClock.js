import { useEffect, useRef } from 'react'
import { ref, onValue } from 'firebase/database'
import { rtdb } from '../lib/firebase'

/**
 * useServerClock
 *
 * Uses Firebase RTDB's built-in .info/serverTimeOffset to get the
 * difference between server time and client time.
 *
 * Returns a ref whose `.current` value is `clockOffsetMs`:
 *   serverTimeNow = Date.now() + clockOffsetMs
 */
export function useServerClock() {
  const offsetRef = useRef(0)

  useEffect(() => {
    const offsetRef_ = ref(rtdb, '.info/serverTimeOffset')
    const unsubscribe = onValue(offsetRef_, (snap) => {
      offsetRef.current = snap.val() || 0
    })
    return () => unsubscribe()
  }, [])

  return offsetRef
}
