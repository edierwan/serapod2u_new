interface OutdoorBrandMarkProps {
  variant?: 'dark' | 'light'
  className?: string
  priority?: boolean
}

export default function OutdoorBrandMark({
  variant = 'dark',
  className = 'h-8 w-auto',
  priority,
}: OutdoorBrandMarkProps) {
  const src = variant === 'light' ? '/outdoor/brand/logo-white.png' : '/outdoor/brand/logo-black.png'
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="SeraOutdoor"
      className={className}
      decoding="async"
      {...(priority ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })}
    />
  )
}
