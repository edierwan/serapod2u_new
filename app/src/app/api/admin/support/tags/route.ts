import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}

async function checkAdminRole(supabaseAdmin: any, userId: string): Promise<boolean> {
  const { data: userData, error } = await supabaseAdmin
    .from('users')
    .select('role_code')
    .eq('id', userId)
    .single()

  if (error || !userData) return false
  return ['SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'admin', 'super_admin', 'hq_admin'].includes(userData.role_code)
}

/**
 * GET /api/admin/support/tags
 * Get all available tags
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getAdminClient()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!await checkAdminRole(supabaseAdmin, user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: tags, error } = await supabaseAdmin
      .from('support_tags')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (error) {
      console.error('Error fetching tags:', error)
      return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 })
    }

    return NextResponse.json({ tags: tags || [] })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * POST /api/admin/support/tags
 * Create a new tag
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseAdmin = getAdminClient()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!await checkAdminRole(supabaseAdmin, user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { name, color, description } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })
    }

    const { data: tag, error } = await supabaseAdmin
      .from('support_tags')
      .insert({
        name: name.trim().toLowerCase(),
        color: color || '#6B7280',
        description: description?.trim() || null
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Tag already exists' }, { status: 400 })
      }
      console.error('Error creating tag:', error)
      return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 })
    }

    return NextResponse.json({ tag })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
