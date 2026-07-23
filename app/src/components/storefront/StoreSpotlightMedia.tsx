'use client'

import { useState } from 'react'
import { Package } from 'lucide-react'

/**
 * Spotlight media — fills the panel like category tiles (object-cover),
 * with soft stage underlay. Prefer still image; video as fallback.
 */
function getMediaType(url: string | null): 'image' | 'video' | 'animation' {
  if (!url) return 'image'
  const lower = url.toLowerCase()
  if (lower.match(/\.(mp4|webm|mov)($|\?)/)) return 'video'
  if (lower.match(/\.(json|lottie)($|\?)/)) return 'animation'
  return 'image'
}

interface StoreSpotlightMediaProps {
  imageUrl: string | null
  animationUrl: string | null
  alt: string
}

export default function StoreSpotlightMedia({
  imageUrl,
  animationUrl,
  alt,
}: StoreSpotlightMediaProps) {
  const image = imageUrl?.trim() || null
  const animation = animationUrl?.trim() || null
  const animationIsVideo = animation ? getMediaType(animation) === 'video' : false

  const candidates = [
    image,
    animationIsVideo ? animation : null,
  ].filter(Boolean) as string[]

  const [candidateIndex, setCandidateIndex] = useState(0)
  const [failed, setFailed] = useState(false)

  const displayUrl = !failed ? candidates[candidateIndex] ?? null : null
  const mediaType = displayUrl ? getMediaType(displayUrl) : 'image'

  const handleMediaError = () => {
    const next = candidateIndex + 1
    if (next < candidates.length) {
      setCandidateIndex(next)
    } else {
      setFailed(true)
    }
  }

  return (
    <div className="relative h-full min-h-[280px] overflow-hidden bg-[var(--sera-surface)] sm:min-h-[360px]">
      {displayUrl && mediaType !== 'animation' ? (
        mediaType === 'video' ? (
          <video
            key={displayUrl}
            src={displayUrl}
            muted
            loop
            playsInline
            autoPlay
            className="absolute inset-0 h-full w-full object-cover"
            onError={handleMediaError}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={displayUrl}
            src={displayUrl}
            alt={alt}
            className="absolute inset-0 h-full w-full object-cover"
            onError={handleMediaError}
          />
        )
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--sera-muted)]/50">
          <Package className="h-14 w-14" />
          <span className="text-xs font-medium tracking-wide">No image</span>
        </div>
      )}
    </div>
  )
}
