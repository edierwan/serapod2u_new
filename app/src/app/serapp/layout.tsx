import { redirect } from 'next/navigation'
import type { Metadata, Viewport } from 'next'
import SerappShell from '@/modules/serapp/components/SerappShell'
import SerappPwaBootstrap from '@/modules/serapp/components/SerappPwaBootstrap'
import { getSerappPageContext } from './_lib'
import './serapp.css'

export const metadata: Metadata = {
  title: 'Serapp · Serapod',
  description: 'Distributor ordering companion for Serapod2U',
  manifest: '/serapp-manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Serapp',
  },
  icons: {
    icon: [
      { url: '/icons/serapp-homescreen-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/serapp-homescreen-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/serapp-homescreen-192.png',
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
    themeColor: '#141210',
  }
}

export default async function SerappLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userProfile, access, canUseSerapp } = await getSerappPageContext()

  if (!canUseSerapp) {
    redirect(`/dashboard?serapp_denied=${encodeURIComponent(access.reason)}`)
  }

  return (
    <>
      <SerappPwaBootstrap />
      <SerappShell
        userProfile={userProfile}
        isDistributor={access.isDistributor}
        isHqSupport={access.isHqSupport}
      >
        {children}
      </SerappShell>
    </>
  )
}
