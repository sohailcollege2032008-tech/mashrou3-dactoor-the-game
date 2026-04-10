import { useState } from 'react'

/**
 * Lazy-loading question image with:
 * - Shimmer pulse placeholder while loading
 * - Blur-to-sharp transition on load
 * - Silent error handling (renders nothing on broken URL)
 */
export default function QuestionImage({ src, alt = '', className = '' }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError]   = useState(false)

  if (!src || error) return null

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Shimmer placeholder */}
      {!loaded && (
        <div className="absolute inset-0 bg-gray-800 animate-pulse rounded-xl" />
      )}

      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`transition-all duration-500 ${className} ${
          loaded ? 'opacity-100 blur-0' : 'opacity-0 blur-sm'
        }`}
      />
    </div>
  )
}
