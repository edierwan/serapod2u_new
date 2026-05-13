import { NextRequest, NextResponse } from 'next/server'

import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getTemplateByKey, type RecoveryPurpose } from '@/lib/wa-recovery/templates'
import { loadRecoveryTemplates, saveRecoveryTemplate } from '@/lib/wa-recovery/template-store'

export const dynamic = 'force-dynamic'

async function requireAdminContext() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }

    const adminAllowed = await isAdminUser(supabase as any, user.id)
    if (!adminAllowed) {
        return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    }

    const admin = createAdminClient()
    const { data: profile } = await (admin as any)
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single()

    if (!profile?.organization_id) {
        return { error: NextResponse.json({ error: 'No organization found' }, { status: 400 }) }
    }

    return { admin, userId: user.id, orgId: profile.organization_id }
}

export async function GET() {
    const context = await requireAdminContext()
    if ('error' in context) return context.error

    const templates = await loadRecoveryTemplates(context.admin as any, context.orgId)
    return NextResponse.json({ templates })
}

export async function POST(request: NextRequest) {
    const context = await requireAdminContext()
    if ('error' in context) return context.error

    try {
        const body = await request.json()
        const key = String(body.key || '').trim() as RecoveryPurpose
        const template = getTemplateByKey(key)
        if (!template) {
            return NextResponse.json({ error: 'Invalid template key' }, { status: 400 })
        }

        const saved = await saveRecoveryTemplate(context.admin as any, context.orgId, {
            key,
            body: String(body.body || ''),
            isActive: body.isActive !== false,
        })

        return NextResponse.json({ ok: true, template: saved })
    } catch (error: any) {
        console.error('[wa-recovery/templates]', error)
        return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
    }
}