'use client'

import { useState } from 'react'

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
