import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireLandingPageAdmin } from '@/lib/landing-pages/admin'
import { resolveLandingPagePreview, resolvePublicLandingPageBySlug } from '@/lib/landing-pages/resolver'
import LandingPageClient from './LandingPageClient'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ preview?: string }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const result = await resolvePublicLandingPageBySlug(slug)

  if (!result.page) {
    return { title: 'Campaign Unavailable' }
  }

  return {
    title: result.page.public_title,
    description: result.page.description || result.page.hero.subtitle || undefined,
  }
}

export default async function PublicLandingPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}

  let result
  let preview = false

  if (resolvedSearchParams.preview) {
    try {
      const { organizationId } = await requireLandingPageAdmin()
      result = await resolveLandingPagePreview(resolvedSearchParams.preview, organizationId)
      preview = true
    } catch {
      notFound()
    }
  } else {
    result = await resolvePublicLandingPageBySlug(slug)
  }

  if (result.status === 'not_found' || !result.page) {
    notFound()
  }

  return <LandingPageClient result={result} preview={preview} />
}