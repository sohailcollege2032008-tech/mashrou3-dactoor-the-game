import React, { useEffect, useRef } from 'react'
import { hasArabic } from '../../utils/rtlUtils'

/**
 * MathText Component
 * Renders text that may contain MathML tags.
 * It uses dangerouslySetInnerHTML to allow MathML tags to exist in the DOM,
 * and then triggers MathJax to typeset the current component.
 */
export default function MathText({ text, className = "", dir = "auto" }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (window.MathJax && containerRef.current) {
      // Trigger MathJax to process this specific container
      // MathJax 3.x uses typesetPromise or typeset
      try {
        window.MathJax.typesetPromise([containerRef.current]).catch(err => {
          console.error('MathJax typeset failed:', err)
        })
      } catch (e) {
        console.warn('MathJax not ready or failed:', e)
      }
    }
  }, [text])

  // Automatic RTL detection if dir is "auto"
  const finalDir = dir === 'auto' ? (hasArabic(text) ? 'rtl' : 'ltr') : dir

  // Runtime fix: Inject dir="rtl" into <math> tags if we are in RTL mode
  // and the AI didn't already provide it.
  let processedText = text
  if (finalDir === 'rtl' && text?.includes('<math')) {
    processedText = text.replace(/<math([^>]*)>/g, (match, attrs) => {
      if (attrs.includes('dir=')) return match
      const spaceOrEmpty = attrs.trim() ? ' ' : ''
      return `<math${attrs}${spaceOrEmpty}dir="rtl">`
    })
  }

  // If there's no MathML, just render normally to avoid overhead
  if (!text || !text.includes('<math')) {
    return <span className={className} dir={finalDir}>{text}</span>
  }

  return (
    <span
      ref={containerRef}
      className={`math-container ${className}`}
      dir={finalDir}
      style={{ display: 'inline-block' }}
      dangerouslySetInnerHTML={{ __html: processedText }}
    />
  )
}
