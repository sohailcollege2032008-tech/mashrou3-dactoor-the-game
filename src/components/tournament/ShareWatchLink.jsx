/**
 * ShareWatchLink.jsx — hand someone the live bracket.
 *
 * The spectator page (`/tournament/:id/live`) was reachable only from inside
 * the app: a player found it from their dashboard, and everyone else — the
 * friend watching from home, the group chat, the room with a projector — had
 * no way to be given it. The host had no way to send it either.
 *
 * `navigator.share` where it exists (that is the phone, where the host
 * actually is during an event), clipboard everywhere else, and if both are
 * refused the URL is shown as selectable text rather than lost.
 *
 * Anyone signed in can watch, which is why the hint says so out loud — a link
 * that silently bounces the recipient to a login screen looks broken.
 */
import React, { useCallback, useState } from 'react'
import { Share2, Check, Link2 } from 'lucide-react'
import { soundManager } from '../../utils/soundManager'

const TONES = {
  paper: { rule: 'var(--rule)', ink: 'var(--ink-3)', ink4: 'var(--ink-4)', ok: 'var(--success)' },
  dark:  { rule: '#3A362C',     ink: '#C9C4B6',      ink4: '#6F6C63',      ok: '#7FA86A' },
}

function watchUrl(tournamentId) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/tournament/${tournamentId}/live`
}

export default function ShareWatchLink({
  tournamentId,
  title = '',
  tone = 'paper',
  hint = true,
  label = 'رابط المشاهدة',
}) {
  const [state, setState] = useState('idle')   // idle | copied | shared | failed
  const T   = TONES[tone] || TONES.paper
  const url = watchUrl(tournamentId)

  const share = useCallback(async () => {
    soundManager.playButtonClick()
    if (navigator.share) {
      try {
        await navigator.share({
          title: title ? `${title} — لايف` : 'شجرة البطولة — لايف',
          text:  'تابع الشجرة لايف',
          url,
        })
        setState('shared')
        setTimeout(() => setState('idle'), 2200)
        return
      } catch (e) {
        // The sheet was dismissed — that is an answer, not a failure.
        if (e?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
      setTimeout(() => setState('idle'), 2200)
    } catch {
      setState('failed')
    }
  }, [title, url])

  const done = state === 'copied' || state === 'shared'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <button
        onClick={share}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 14px', border: `1px solid ${done ? T.ok : T.rule}`, borderRadius: 4,
          background: 'none', cursor: 'pointer',
          fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: done ? T.ok : T.ink, transition: 'all 150ms',
        }}
      >
        {done ? <Check size={12} /> : <Share2 size={12} />}
        <span className="ar" style={{ fontFamily: 'var(--sans)', letterSpacing: 0, textTransform: 'none' }}>
          {state === 'copied' ? 'اتنسخ' : state === 'shared' ? 'اتبعت' : label}
        </span>
      </button>

      {state === 'failed' && (
        <input
          readOnly
          value={url}
          onFocus={e => e.target.select()}
          dir="ltr"
          style={{
            width: '100%', maxWidth: 260, padding: '6px 8px',
            border: `1px solid ${T.rule}`, borderRadius: 3, background: 'none',
            fontFamily: 'var(--mono)', fontSize: 10, color: T.ink,
          }}
        />
      )}

      {hint && state !== 'failed' && (
        <span className="ar" style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontFamily: 'var(--sans)', fontSize: 9.5, color: T.ink4,
        }}>
          <Link2 size={9} />
          أي حد مسجّل دخول يقدر يتابع من الرابط
        </span>
      )}
    </div>
  )
}
