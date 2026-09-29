const CONFETTI_COLORS = ['#76232f', '#5e6738', '#c1c6c8', '#3f1c1f', '#d9b44a', '#f1e6b2']
const CONFETTI_COUNT = 18

const confetti = Array.from({ length: CONFETTI_COUNT }, (_, index) => {
  const angle = (-165 + (150 / (CONFETTI_COUNT - 1)) * index) * (Math.PI / 180)
  const distance = 70 + (index % 3) * 18
  return {
    dx: Math.round(Math.cos(angle) * distance),
    dy: Math.round(Math.sin(angle) * distance) - 10,
    rot: (index % 2 ? 1 : -1) * (180 + index * 25),
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
    round: index % 4 === 0,
    delay: (index % 5) * 0.03,
  }
})

/** Gift box that drops in, wiggles, and pops open with confetti. Static when reduced motion is on. */
export default function OutdoorThankYouGift() {
  return (
    <div className="out-gift relative mx-auto h-36 w-36" aria-hidden>
      <div className="out-gift-glow absolute inset-3 rounded-full bg-[var(--out-cream)]" />
      <div className="absolute left-1/2 top-[42%]">
        {confetti.map((piece, index) => (
          <span
            key={index}
            className="out-confetti absolute block"
            style={
              {
                '--dx': `${piece.dx}px`,
                '--dy': `${piece.dy}px`,
                '--rot': `${piece.rot}deg`,
                '--delay': `${piece.delay}s`,
                background: piece.color,
                width: piece.round ? 7 : 6,
                height: piece.round ? 7 : 11,
                borderRadius: piece.round ? 999 : 2,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <svg viewBox="0 0 140 140" className="relative h-full w-full overflow-visible">
        <g className="out-gift-float">
          <g className="out-gift-box">
            <ellipse cx="70" cy="128" rx="40" ry="5" fill="#3f1c1f" opacity="0.12" />
            <rect x="28" y="64" width="84" height="60" rx="8" fill="#3f1c1f" />
            <rect x="28" y="64" width="84" height="10" fill="#2e1416" opacity="0.55" />
            <rect x="64" y="64" width="12" height="60" fill="#f1e6b2" />
            <g className="out-gift-lid">
              <rect x="22" y="48" width="96" height="20" rx="6" fill="#76232f" />
              <rect x="64" y="48" width="12" height="20" fill="#f1e6b2" />
              <path d="M70 48 C58 30 40 34 46 44 C50 50 62 49 70 48 Z" fill="#f1e6b2" />
              <path d="M70 48 C82 30 100 34 94 44 C90 50 78 49 70 48 Z" fill="#f1e6b2" />
              <circle cx="70" cy="47" r="5" fill="#d9b44a" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  )
}
