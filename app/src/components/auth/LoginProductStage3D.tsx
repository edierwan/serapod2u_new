'use client'

/**
 * Visual-only login/signup product — Serapod Black Edition (transparent PNG).
 */
export default function LoginProductStage3D() {
  return (
    <div className="login-stage3d" aria-hidden="true">
      <div className="login-stage3d__glow" />
      <div className="login-stage3d__rim" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/serapod-device-hero.png"
        alt=""
        className="login-stage3d__photo"
        width={437}
        height={2030}
        decoding="async"
        fetchPriority="high"
      />
    </div>
  )
}
