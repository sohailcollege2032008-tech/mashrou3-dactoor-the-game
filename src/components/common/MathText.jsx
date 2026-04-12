import React, { useEffect, useRef } from 'react'

/**
 * MathText handles rendering of text that might contain MathML.
 * It uses the global MathJax instance to typeset the content.
 * 
 * @param {string} text - The text content to render (can include MathML <math> tags)
 * @param {string} dir - 'rtl' or 'ltr' or 'auto'
 */
export default function MathText({ text = '', dir = 'auto' }) {
  const containerRef = useRef(null)

  useEffect(() => {
    // If MathJax is loaded, trigger a re-typeset when text changes
    if (window.MathJax && containerRef.current) {
      window.MathJax.typesetPromise([containerRef.current]).catch((err) => {
        console.error('MathJax typeset failed:', err)
      })
    }
  }, [text])

  // Split text by MathML tags to ensure they stay in their own flow
  // but for now, we just dangerouslySetInnerHTML because MathML is HTML.
  return (
    <span
      ref={containerRef}
      className="math-text-container"
      style={{ 
        display: 'inline-block',
        unicodeBidi: 'plaintext',
        textAlign: 'inherit'
      }}
      dir={dir}
      dangerouslySetInnerHTML={{ __html: text }}
    />
  )
}
