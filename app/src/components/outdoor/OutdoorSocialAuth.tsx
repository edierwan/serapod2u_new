'use client'

import SocialAuthButtons from '@/components/auth/SocialAuthButtons'

export default function OutdoorSocialAuth({
  nextPath,
  disabled,
  onError,
}: {
  nextPath: string
  disabled?: boolean
  onError: (message: string) => void
}) {
  return <SocialAuthButtons nextPath={nextPath} disabled={disabled} onError={onError} variant="outdoor" />
}
