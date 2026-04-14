/**
 * useUnattendedGameRunner
 *
 * When `room.config.unattended_mode` is true, any connected player client
 * acts as a backup game-runner.  It watches the question timer and the
 * revealing delay and, if the host is offline, atomically claims the
 * operation via an RTDB transaction (reveal_lock_q{n} / next_lock_q{n})
 * so that exactly one client performs each step.
 *
 * This lets the host start a game and walk away — as long as at least one
 * player tab stays open, the game continues to completion automatically.
 */
import { useEffect, useRef } from 'react'
import { ref, runTransaction } from 'firebase/database'
import { rtdb } from '../lib/firebase'
import { performReveal, performNextQuestion } from '../utils/gameRunner'

export function useUnattendedGameRunner({ roomId, room, session }) {
  const revealingRef = useRef(false)
  const nextingRef   = useRef(false)

  // ── Auto-reveal: fires when unattended mode on AND timer expires ─────────
  useEffect(() => {
    if (!room || !session)                          return
    if (room.status !== 'playing')                  return
    if (!room.config?.unattended_mode)              return
    if (revealingRef.current)                       return

    const autoTimer        = room.config?.auto_timer || 45
    const questionStarted  = room.question_started_at
    if (!questionStarted) return

    const elapsed   = (Date.now() - questionStarted) / 1000
    const remaining = Math.max(0, autoTimer - elapsed)

    const trigger = () => attemptReveal(room, session.uid)

    // Already expired — fire immediately (next tick to avoid render-loop)
    if (remaining <= 0) {
      const t = setTimeout(trigger, 50)
      return () => clearTimeout(t)
    }

    const t = setTimeout(trigger, remaining * 1000)
    return () => clearTimeout(t)

  // Re-evaluate whenever question changes (new question_started_at)
  }, [
    room?.status,
    room?.current_question_index,
    room?.question_started_at,
    room?.config?.unattended_mode,
    room?.config?.auto_timer,
    session?.uid,
  ])

  // ── Also reveal if every player has already answered ────────────────────
  useEffect(() => {
    if (!room || !session)             return
    if (room.status !== 'playing')     return
    if (!room.config?.unattended_mode) return
    if (revealingRef.current)          return

    const players = room.players ? Object.values(room.players) : []
    if (players.length === 0) return

    const qIdx   = room.current_question_index
    const answers = room.answers?.[qIdx]
      ? Object.values(room.answers[qIdx])
      : []

    if (answers.length >= players.length) {
      const t = setTimeout(() => attemptReveal(room, session.uid), 200)
      return () => clearTimeout(t)
    }
  }, [
    room?.status,
    room?.current_question_index,
    room?.answers,
    room?.players,
    room?.config?.unattended_mode,
    session?.uid,
  ])

  // ── Auto-advance: 8 s after revealing, move to next question ────────────
  useEffect(() => {
    if (!room || !session)             return
    if (room.status !== 'revealing')   return
    if (!room.config?.unattended_mode) return
    if (nextingRef.current)            return

    const t = setTimeout(() => attemptNext(room, session.uid), 8000)
    return () => clearTimeout(t)
  }, [
    room?.status,
    room?.current_question_index,
    room?.config?.unattended_mode,
    session?.uid,
  ])

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function attemptReveal(currentRoom, uid) {
    if (revealingRef.current) return
    const qIdx = currentRoom?.current_question_index
    if (qIdx === undefined) return

    // Atomic claim: first client to write wins
    const lockRef = ref(rtdb, `rooms/${roomId}/reveal_locks/${qIdx}`)
    let claimed = false
    try {
      const result = await runTransaction(lockRef, current => {
        if (current !== null) return undefined   // abort — already claimed
        return uid
      })
      claimed = result.committed
    } catch (e) {
      console.warn('[UnattendedRunner] reveal lock tx failed:', e)
      return
    }
    if (!claimed) return

    revealingRef.current = true
    try {
      const players = currentRoom.players ? Object.values(currentRoom.players) : []
      await performReveal(roomId, currentRoom, players)
    } catch (err) {
      console.error('[UnattendedRunner] reveal failed:', err)
    } finally {
      revealingRef.current = false
    }
  }

  async function attemptNext(currentRoom, uid) {
    if (nextingRef.current) return
    const qIdx = currentRoom?.current_question_index
    if (qIdx === undefined) return

    const lockRef = ref(rtdb, `rooms/${roomId}/next_locks/${qIdx}`)
    let claimed = false
    try {
      const result = await runTransaction(lockRef, current => {
        if (current !== null) return undefined
        return uid
      })
      claimed = result.committed
    } catch (e) {
      console.warn('[UnattendedRunner] next lock tx failed:', e)
      return
    }
    if (!claimed) return

    nextingRef.current = true
    try {
      await performNextQuestion(roomId, currentRoom, currentRoom.host_id)
    } catch (err) {
      console.error('[UnattendedRunner] next question failed:', err)
    } finally {
      nextingRef.current = false
    }
  }
}
