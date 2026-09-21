export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

export function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#1877F2" aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

export function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="url(#ig)" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4.2" stroke="url(#ig)" strokeWidth="1.8" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="#E1306C" />
      <defs>
        <linearGradient id="ig" x1="3" y1="21" x2="21" y2="3">
          <stop stopColor="#F58529" />
          <stop offset="0.5" stopColor="#DD2A7B" />
          <stop offset="1" stopColor="#8134AF" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M14.5 3c.4 2.6 2.1 4.4 4.6 4.7v3.1c-1.6 0-3.1-.5-4.4-1.4v6.4c0 3.4-2.7 6.2-6.1 6.2S2.5 19.2 2.5 15.8c0-3.3 2.6-6 5.9-6.2v3.2c-1.5.2-2.6 1.4-2.6 3 0 1.6 1.3 2.9 3 2.9s3-1.3 3-2.9V3h2.7z"
      />
    </svg>
  )
}

export function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M14.7 10.3 22.2 2h-1.8l-6.5 7.2L8.7 2H2l8 11.3L2 22h1.8l7-7.8L15.3 22H22l-7.3-11.7zm-2.5 2.7-.8-1.1L4.5 3.3h2.7l5.2 7.3.8 1.1 6.8 9h-2.7l-5.1-7.7z" />
    </svg>
  )
}
