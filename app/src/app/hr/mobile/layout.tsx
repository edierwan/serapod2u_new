import { redirect } from 'next/navigation'
import { getHrPageContext } from '@/app/hr/_lib'
import HrMobileShell from '@/components/hr/mobile/HrMobileShell'
import type { Metadata, Viewport } from 'next'

/* ─── PWA metadata for the HR mobile scope ────────────────────────── */

export const metadata: Metadata = {
  title: 'Serapod HR',
  description: 'Employee self-service HR portal — attendance, leave, payslip',
  manifest: '/hr-manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Serapod HR',
  },
  icons: {
    icon: '/icons/icon-192x192.png',
    apple: '/icons/icon-192x192.png',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export function generateViewport(): Viewport {
  return {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: 'cover',
    themeColor: '#2563eb',
  }
}

/* ─── Layout (server component → auth → client shell) ─────────────── */

export default async function HrMobileLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Reuse the same auth guard as desktop HR pages
  const { userProfile, canViewHr } = await getHrPageContext()

  if (!canViewHr) {
    redirect('/login')
  }

  return <HrMobileShell userProfile={userProfile}>{children}</HrMobileShell>
}
