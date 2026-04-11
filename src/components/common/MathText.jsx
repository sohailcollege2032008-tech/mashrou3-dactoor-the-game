import React, { useEffect, useRef } from 'react'

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

  // If there's no MathML, just render normally to avoid overhead
  if (!text || !text.includes('<math')) {
    return <span className={className} dir={dir}>{text}</span>
  }

  return (
    <span
      ref={containerRef}
      className={`math-container ${className}`}
      dir={dir}
      dangerouslySetInnerHTML={{ __html: text }}
    />
  )
}
