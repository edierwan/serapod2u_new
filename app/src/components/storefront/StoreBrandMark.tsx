'use client'

const WORDMARK_SRC = '/brand/serapod-wordmark.png'
const WORDMARK_LIGHT_SRC = '/brand/serapod-wordmark-light.png'

interface StoreBrandMarkProps {
  /** Use light wordmark on dark backgrounds */
  variant?: 'dark' | 'light'
  className?: string
  priority?: boolean
}

/** Brand wordmark only — visual, no routing logic. */
export default function StoreBrandMark({
  variant = 'dark',
  className = 'h-8 w-auto',
  priority,
}: StoreBrandMarkProps) {
  const src = variant === 'light' ? WORDMARK_LIGHT_SRC : WORDMARK_SRC
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Serapod"
      className={className}
      decoding="async"
      {...(priority ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })}
    />
  )
}

export { WORDMARK_SRC, WORDMARK_LIGHT_SRC }
