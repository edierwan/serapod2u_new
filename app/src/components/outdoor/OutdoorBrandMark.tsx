interface OutdoorBrandMarkProps {
  variant?: 'dark' | 'light' | 'onDark'
  className?: string
  priority?: boolean
}

export default function OutdoorBrandMark({
  variant = 'dark',
  className = 'h-8 w-auto',
  priority,
}: OutdoorBrandMarkProps) {
  const src = variant === 'light' ? '/outdoor/brand/logo-white.png' : '/outdoor/brand/logo-black.png'
  const onDark = variant === 'onDark' ? 'brightness-0 invert sepia-[.18] saturate-[.35]' : ''
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="SeraOutdoor"
      className={`${className} ${onDark}`.trim()}
      decoding="async"
      {...(priority ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })}
    />
  )
}
