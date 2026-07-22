'use client'

/**
 * Visual-only login hero product — real Serapod device render.
 * Tall image fills vertical space so centered copy does not leave empty bands.
 */
export default function LoginProductStage3D() {
  return (
    <div className="login-stage3d" aria-hidden="true">
      <div className="login-stage3d__glow" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/serapod-device-hero.png"
        alt=""
        className="login-stage3d__photo"
        width={936}
        height={1024}
        decoding="async"
        fetchPriority="high"
      />
    </div>
  )
}
