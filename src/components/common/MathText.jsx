import React, { useEffect, useRef } from 'react'
import { hasArabic } from '../../utils/rtlUtils'
import { loadMathJax } from '../../utils/mathjaxLoader'

// In RTL context, MathJax renders LTR which puts the variable (LHS) on the left.
// An Arabic reader reads right-to-left, so they hit the expression (RHS) first, then "=", then the variable.
// Fix: swap LHS and RHS around <mo>=</mo> so MathJax places the variable on the RIGHT — read first in RTL.
// This avoids dir="rtl" on <math> which would reverse arrow glyphs (→ becomes ←).
function swapEquationSidesForRtl(text) {
  return text.replace(/<math([^>]*)>([\s\S]*?)<\/math>/gi, (match, attrs, content) => {
    const eqMatches = content.match(/<mo>\s*=\s*<\/mo>/g)
    if (!eqMatches || eqMatches.length !== 1) return match
    const eqTag = eqMatches[0]
    const eqIndex = content.indexOf(eqTag)
    const lhs = content.slice(0, eqIndex)
    const rhs = content.slice(eqIndex + eqTag.length)
    return `<math${attrs}>${rhs}${eqTag}${lhs}</math>`
  })
}

export default function MathText({ text, className = "", dir = "auto" }) {
  const containerRef = useRef(null)
  const isMath = !!text && text.includes('<math')

  useEffect(() => {
    if (!isMath || !containerRef.current) return

    let isMounted = true

    loadMathJax().then((mj) => {
      if (!isMounted || !containerRef.current || !mj?.typesetPromise) return
      try {
        mj.typesetPromise([containerRef.current]).catch(err => {
          console.error('[MathJax] typeset failed:', err)
        })
      } catch (e) {
        console.warn('[MathJax] typeset error:', e)
      }
    }).catch(() => {})

    return () => {
      isMounted = false
    }
  }, [text, isMath])

  const finalDir = dir === 'auto' ? (hasArabic(text) ? 'rtl' : 'ltr') : dir

  if (!isMath) {
    return <span className={className} dir={finalDir}>{text}</span>
  }

  const processedText = finalDir === 'rtl' ? swapEquationSidesForRtl(text) : text

  return (
    <span
      ref={containerRef}
      className={`math-container ${className}`}
      dir={finalDir}
      style={{ display: 'inline' }}
      dangerouslySetInnerHTML={{ __html: processedText }}
    />
  )
}

