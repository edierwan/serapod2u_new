import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'
import { parsePhone, formatPhoneDisplay } from '@/utils/phone'

export const dynamic = 'force-dynamic'

const GRAPH_API_VERSION = 'v23.0'

type MetaTestRequest = {
  action?: 'connection' | 'test-message'
  to?: string
  provider_name?: string
  config?: Record<string, unknown>
  credentials?: Record<string, unknown>
}

const asString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

// Show only the last 4 characters of an identifier. Used so we can surface *which*
// Phone Number ID / config was used without ever exposing the full value in logs or UI.
const maskTail = (value: string) => {
  if (!value) return ''
  if (value.length <= 4) return '*'.repeat(value.length)
  return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`
}

type MetaError = {
  message: string
  code: number | null
  subcode: number | null
  type: string | null
  fbtrace_id: string | null
}

// Pull the full structured error from Meta so the caller can see the real cause
// (code/subcode/type) instead of only a generic message.
const parseMetaError = async (response: Response): Promise<MetaError> => {
  const body = await response.json().catch(() => null)
  const err = (body?.error || {}) as Record<string, any>
  return {
    message: err.message || `Meta Cloud API returned HTTP ${response.status}`,
    code: typeof err.code === 'number' ? err.code : null,
    subcode: typeof err.error_subcode === 'number' ? err.error_subcode : null,
    type: typeof err.type === 'string' ? err.type : null,
    fbtrace_id: typeof err.fbtrace_id === 'string' ? err.fbtrace_id : null,
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!await isAdminUser(supabase, user.id)) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    const body = await request.json() as MetaTestRequest
    const action = body.action
    const providerName = asString(body.provider_name) || 'whatsapp_business'
    const phoneNumberId = asString(body.config?.phone_number_id)
    const accessToken = asString(body.credentials?.access_token)

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json({ error: 'Phone Number ID and Permanent Access Token are required.' }, { status: 400 })
    }

    // Resolve the org + saved provider record so we can report which config the
    // credentials came from and detect stale/mismatched credentials (e.g. a Phone
    // Number ID that does not match the one persisted for this provider).
    const { data: userProfile } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()
    const orgId = userProfile?.organization_id || null

    let savedConfig: { id?: string; config_public?: Record<string, any>; is_active?: boolean } | null = null
    if (orgId) {
      const { data } = await supabase
        .from('notification_provider_configs')
        .select('id, config_public, is_active')
        .eq('org_id', orgId)
        .eq('channel', 'whatsapp')
        .eq('provider_name', providerName)
        .maybeSingle()
      savedConfig = (data as any) || null
    }

    const savedPhoneNumberId = asString(savedConfig?.config_public?.phone_number_id)
    const phoneNumberIdMatchesSaved = savedPhoneNumberId ? savedPhoneNumberId === phoneNumberId : null

    // Safe metadata only — no access token, app secret, or full Phone Number ID.
    const diagnostic = {
      provider: providerName,
      config_record_id: savedConfig?.id || null,
      credential_source: savedConfig?.id ? 'saved_provider_config' : 'request_only',
      graph_api_version: GRAPH_API_VERSION,
      phone_number_id_masked: maskTail(phoneNumberId),
      saved_phone_number_id_masked: savedPhoneNumberId ? maskTail(savedPhoneNumberId) : null,
      phone_number_id_matches_saved: phoneNumberIdMatchesSaved,
    }

    // Persist the test outcome so the Connection Status UI can show a verified state
    // that survives reloads. Best-effort: never let persistence failure break the test.
    const persistTestResult = async (status: 'success' | 'error', errorMessage?: string) => {
      if (!orgId || !savedConfig?.id) return
      try {
        await supabase
          .from('notification_provider_configs')
          .update({
            last_test_status: status,
            last_test_at: new Date().toISOString(),
            last_test_error: status === 'error' ? (errorMessage || null) : null,
          })
          .eq('id', savedConfig.id)
      } catch (persistError) {
        console.error('[meta-test] failed to persist test result:', persistError)
      }
    }

    const graphUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}`
    const headers = { Authorization: `Bearer ${accessToken}` }

    if (action === 'connection') {
      const response = await fetch(`${graphUrl}?fields=display_phone_number,verified_name,quality_rating`, {
        headers,
        cache: 'no-store'
      })

      if (!response.ok) {
        const metaError = await parseMetaError(response)
        await persistTestResult('error', metaError.message)
        // Log safe metadata only.
        console.error('[meta-test] connection failed', {
          ...diagnostic,
          meta_error_code: metaError.code,
          meta_error_subcode: metaError.subcode,
          meta_error_type: metaError.type,
        })
        return NextResponse.json({ error: metaError.message, meta_error: metaError, diagnostic }, { status: 502 })
      }

      const result = await response.json()
      await persistTestResult('success')
      return NextResponse.json({
        success: true,
        phone_number: result.display_phone_number || null,
        verified_name: result.verified_name || null,
        quality_rating: result.quality_rating || null,
        diagnostic
      })
    }

    if (action === 'test-message') {
      // Normalize with the SHARED phone helper so the Test Message path and real
      // notification delivery treat numbers identically (requirement: one source of
      // truth). Malaysian inputs — 0192277233, +60192277233, 60192277233, and values
      // with spaces/dashes — all resolve to Meta's E.164 digits-only form 60192277233.
      // We re-normalize here even though the UI also normalizes, so a raw/legacy
      // client cannot bypass it. A bare 0192277233 was the cause of Meta error
      // #131030: without the 60 country code Meta never matched the allowlisted number.
      const parsed = parsePhone(body.to, { defaultCountryCode: '60' })
      if (!parsed.valid || !parsed.provider) {
        return NextResponse.json({ error: 'Enter a valid recipient phone number, e.g. 0192277233 or +60192277233.' }, { status: 400 })
      }
      const recipient = parsed.provider           // digits only, e.g. 60192277233 — used for Meta `to`, allowlist + log/webhook matching
      const recipientE164 = parsed.e164 || `+${recipient}` // +60192277233 — canonical key for delivery-log / webhook matching
      const recipientDisplay = formatPhoneDisplay(recipientE164) || recipientE164

      // Resolve the configured approved TEMPLATE. A template (not free-form text) is
      // required so the test can be delivered outside the 24h customer-service window.
      // We never hardcode a template name — the admin must configure one that is
      // actually approved on their WABA (e.g. the default parameter-free `hello_world`).
      const templateName = asString(body.config?.test_template_name)
        || asString(savedConfig?.config_public?.test_template_name)
      const templateLanguage = asString(body.config?.default_template_language)
        || asString(savedConfig?.config_public?.default_template_language)
        || 'en_US'

      if (!templateName) {
        return NextResponse.json({
          error: 'No approved test template is configured. Set a "Test Template Name" (an approved, parameter-free WhatsApp template such as hello_world) and its language in the WhatsApp configuration before sending a test.',
          setup_required: true,
          diagnostic: { ...diagnostic, normalized_recipient: recipient, recipient_e164: recipientE164, recipient_display: recipientDisplay },
        }, { status: 400 })
      }

      const messageDiagnostic = {
        ...diagnostic,
        normalized_recipient: recipient,
        recipient_e164: recipientE164,
        recipient_display: recipientDisplay,
        template_name: templateName,
        template_language: templateLanguage,
      }

      const response = await fetch(`${graphUrl}/messages`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'template',
          template: { name: templateName, language: { code: templateLanguage } }
        })
      })

      if (!response.ok) {
        const metaError = await parseMetaError(response)
        await persistTestResult('error', metaError.message)
        console.error('[meta-test] test-message failed', {
          ...messageDiagnostic,
          meta_error_code: metaError.code,
          meta_error_subcode: metaError.subcode,
          meta_error_type: metaError.type,
        })

        // Error 131030 = recipient not in the allowed list of the Phone Number ID's WABA.
        // Surface a clear, actionable message (showing the normalized number we sent)
        // instead of the raw "(#131030) Recipient phone number not in allowed list".
        let hint: string | undefined
        if (metaError.code === 131030) {
          hint = phoneNumberIdMatchesSaved === false
            ? `This sandbox/test number can only message recipients on its allowed list. We sent to ${recipientDisplay} (${recipient}), but the Phone Number ID ${diagnostic.phone_number_id_masked} does NOT match the saved provider config (${diagnostic.saved_phone_number_id_masked}) — the request is using stale or mismatched credentials.`
            : `This sandbox/test number can only message recipients on its allowed list. Add ${recipientDisplay} (${recipient}) under WhatsApp Manager → API Setup → "To" recipient phone numbers, and confirm the access token belongs to the SAME Meta app/test WABA as Phone Number ID ${diagnostic.phone_number_id_masked}.`
        }

        return NextResponse.json({
          error: metaError.message,
          meta_error: metaError,
          diagnostic: messageDiagnostic,
          ...(hint ? { hint } : {})
        }, { status: 502 })
      }

      const result = await response.json()
      // A WAMID is the ONLY proof Meta queued the message. HTTP 200 alone is not
      // enough — only report "accepted" when Meta returns a real message id.
      const wamid: string | null = result.messages?.[0]?.id || null
      if (!wamid) {
        await persistTestResult('error', 'Meta returned no message id (WAMID).')
        console.error('[meta-test] test-message accepted with no WAMID', messageDiagnostic)
        return NextResponse.json({
          error: 'Meta accepted the request but returned no message id (WAMID), so the message was not queued.',
          diagnostic: messageDiagnostic
        }, { status: 502 })
      }

      await persistTestResult('success')

      // Store the outbound message keyed by WAMID so the Meta status webhook can
      // match sent/delivered/read/failed updates back to it. Reuses the existing
      // whatsapp_message_logs delivery-log table (no new table needed). Best-effort:
      // a logging failure must not turn a real "accepted" into an error for the user.
      const acceptedAt = new Date().toISOString()
      try {
        const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (serviceUrl && serviceKey) {
          const admin = createServiceClient(serviceUrl, serviceKey, { auth: { persistSession: false } })
          await admin.from('whatsapp_message_logs').insert({
            tenant_id: orgId,
            action: 'meta_test_message',
            direction: 'outbound',
            phone_e164: recipientE164,
            external_message_id: wamid,
            status: 'accepted',
            metadata: {
              provider: providerName,
              config_record_id: savedConfig?.id || null,
              template_name: templateName,
              template_language: templateLanguage,
              recipient_display: recipientDisplay,
              phone_number_id_masked: diagnostic.phone_number_id_masked,
              accepted_at: acceptedAt,
              timestamps: { accepted: acceptedAt },
            },
          })
        }
      } catch (logError) {
        console.error('[meta-test] failed to write outbound delivery log:', logError)
      }

      return NextResponse.json({
        success: true,
        message_id: wamid,                       // WAMID — store + match against sent/delivered/read/failed status webhooks
        recipient,                               // 60192277233
        recipient_e164: recipientE164,           // +60192277233
        recipient_display: recipientDisplay,     // +60 19-227 7233
        template_name: templateName,
        template_language: templateLanguage,
        accepted_at: acceptedAt,
        // "accepted" ≠ "delivered". A WAMID only means Meta queued the message.
        // Actual delivery is confirmed exclusively by a `delivered` status webhook
        // (POST /api/webhooks/whatsapp/meta), matched to this WAMID. Because we now
        // send an approved TEMPLATE, delivery no longer requires an open 24h window —
        // but we still must not claim "delivered" until the webhook confirms it.
        delivery_status: 'accepted',
        delivery_note: 'Message accepted by Meta (WAMID issued). Delivery is NOT yet confirmed — it is confirmed only by a "delivered" status webhook matched to this WAMID. If it never advances past "accepted", verify the template is approved and that your webhook is subscribed to "messages" for this WABA.',
        diagnostic: messageDiagnostic
      })
    }

    return NextResponse.json({ error: 'Unsupported Meta test action.' }, { status: 400 })
  } catch (error: any) {
    console.error('Meta WhatsApp provider test failed:', error?.message || error)
    return NextResponse.json({ error: error?.message || 'Meta Cloud API request failed' }, { status: 500 })
  }
}
