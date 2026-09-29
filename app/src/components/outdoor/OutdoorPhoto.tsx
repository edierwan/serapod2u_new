'use client'

import { useState } from 'react'

/** Centred label over a sold-out photo; the parent needs `relative` and `out-sold-out` to fade the image. */
export function OutdoorSoldOutTag({ large = false }: { large?: boolean }) {
  return (
    <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" role="status">
      <span
        className={`rounded-full bg-[var(--out-bark)] font-semibold uppercase tracking-[0.18em] text-[var(--out-cream)] shadow-lg ${
          large ? 'px-5 py-2 text-sm' : 'px-3.5 py-1.5 text-[11px]'
        }`}
      >
        Sold out
      </span>
    </span>
  )
}

/** A master-data photo that swaps to the bundled packshot, if there is one, when it fails to load. */
export default function OutdoorPhoto({
  src,
  backup,
  alt,
  className,
}: {
  src: string
  backup?: string | null
  alt: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const shown = failed && backup ? backup : src
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={shown}
      alt={alt}
      className={className}
      onError={() => {
        if (!failed && backup && backup !== src) setFailed(true)
      }}
    />
  )
}
