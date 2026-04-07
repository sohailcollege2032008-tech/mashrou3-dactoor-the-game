import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useServerClock
 *
 * Performs an SNTP-style clock synchronization against the Supabase server.
 * Takes 3 round-trip measurements and uses the median offset to minimize
 * the effect of network jitter.
 *
 * Returns a ref whose `.current` value is `clockOffsetMs`:
 *   serverTimeNow = Date.now() + clockOffsetMs
 *
 * Usage:
 *   const clockOffset = useServerClock()
 *   const serverNow = () => Date.now() + clockOffset.current
 */
export function useServerClock() {
  const offsetRef = useRef(0)

  useEffect(() => {
    let cancelled = false

    const sync = async () => {
      const SAMPLES = 3
      const offsets = []

      for (let i = 0; i < SAMPLES; i++) {
        const t0 = Date.now()

        const { data: serverMs, error } = await supabase.rpc('get_server_time')

        if (error || serverMs == null) continue

        const t1 = Date.now()
        const rtt = t1 - t0

        // Classic SNTP offset formula:
        // offset = serverTime_at_receipt - t1
        // serverTime_at_receipt ≈ serverMs + rtt/2
        const offset = (Number(serverMs) + rtt / 2) - t1
        offsets.push(offset)

        // Small gap between samples to avoid burst
        if (i < SAMPLES - 1) await new Promise(r => setTimeout(r, 120))
      }

      if (cancelled || offsets.length === 0) return

      // Use median to discard outliers from variable RTT
      offsets.sort((a, b) => a - b)
      const median = offsets[Math.floor(offsets.length / 2)]

      offsetRef.current = median

      if (process.env.NODE_ENV === 'development') {
        console.log(`[Clock Sync] offset = ${median > 0 ? '+' : ''}${median.toFixed(1)} ms (${offsets.length} samples)`)
      }
    }

    sync()

    // Re-sync every 60 seconds in case of drift over long sessions
    const interval = setInterval(sync, 60_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return offsetRef
}
