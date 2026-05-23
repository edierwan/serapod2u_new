import { NextRequest, NextResponse } from 'next/server'

import { LANDING_PAGE_EVENT_TYPES } from '@/lib/landing-pages/types'
import { createAdminClient } from '@/lib/supabase/admin'

const eventTypeSet = new Set<string>(LANDING_PAGE_EVENT_TYPES)

function cleanText(value: unknown, max = 300) {
    return typeof value === 'string' ? value.slice(0, max) : ''
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const eventType = cleanText(body.eventType || body.event_type, 80)
        const landingPageId = cleanText(body.landingPageId || body.landing_page_id || body.attribution?.landingPageId, 80)
        const landingPageSlug = cleanText(body.landingPageSlug || body.landing_page_slug || body.attribution?.landingPageSlug, 120)
        const landingPageSessionId = cleanText(body.landingPageSessionId || body.landing_page_session_id || body.attribution?.landingPageSessionId, 80)

        if (!eventTypeSet.has(eventType)) {
            return NextResponse.json({ success: false, error: 'Invalid event type.' }, { status: 400 })
        }
        if (!landingPageId || !landingPageSessionId) {
            return NextResponse.json({ success: false, error: 'Landing page and session are required.' }, { status: 400 })
        }

        const adminClient = createAdminClient() as any
        const { data: page, error: pageError } = await adminClient
            .from('landing_pages')
            .select('id, slug, status')
            .eq('id', landingPageId)
            .eq('status', 'published')
            .maybeSingle()

        if (pageError || !page) {
            return NextResponse.json({ success: false, error: 'Landing page is not public.' }, { status: 404 })
        }

        const attribution = body.attribution || {}
        const sessionPayload = {
            id: landingPageSessionId,
            landing_page_id: landingPageId,
            landing_page_slug: landingPageSlug || page.slug,
            source_code: cleanText(body.sourceCode || attribution.sourceCode),
            utm_source: cleanText(body.utmSource || attribution.utmSource),
            utm_medium: cleanText(body.utmMedium || attribution.utmMedium),
            utm_campaign: cleanText(body.utmCampaign || attribution.utmCampaign),
            utm_content: cleanText(body.utmContent || attribution.utmContent),
            utm_term: cleanText(body.utmTerm || attribution.utmTerm),
            fbclid: cleanText(body.fbclid || attribution.fbclid, 500),
            referrer_domain: cleanText(body.referrerDomain || attribution.referrerDomain),
            updated_at: new Date().toISOString(),
        }

        await adminClient
            .from('landing_page_sessions')
            .upsert(sessionPayload, { onConflict: 'id' })

        const { error: eventError } = await adminClient
            .from('landing_page_events')
            .insert({
                landing_page_id: landingPageId,
                landing_page_slug: landingPageSlug || page.slug,
                landing_page_session_id: landingPageSessionId,
                event_type: eventType,
                product_id: cleanText(body.productId || body.product_id, 80) || null,
                variant_id: cleanText(body.variantId || body.variant_id, 80) || null,
                metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : {},
            })

        if (eventError) throw eventError
        return NextResponse.json({ success: true })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
    }
}