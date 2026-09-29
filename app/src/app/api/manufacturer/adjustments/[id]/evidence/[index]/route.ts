import { guardUserOperation, userAllowed } from '@/lib/security-access/operation'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  getEvidenceFileName,
  normalizeManufacturerWorkflowStatus,
} from '@/lib/quality-issues'
import { qualityIssueEvidencePath } from '@/lib/storage/documents-bucket'

export const dynamic = 'force-dynamic'

const EVIDENCE_BUCKET = 'documents'

function canAccessIssue(adjustment: {
  organization_id?: string | null
  target_manufacturer_org_id?: string | null
  manufacturer_status?: string | null
}, profile: { organization_id?: string | null }, isAdministrator: boolean) {
  if (isAdministrator) return true
  if (!profile.organization_id) return false

  if (profile.organization_id === adjustment.organization_id) {
    return true
  }

  return (
    profile.organization_id === adjustment.target_manufacturer_org_id &&
    normalizeManufacturerWorkflowStatus(adjustment.manufacturer_status) !== 'draft'
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const { id, index } = await params

    const evidenceIndex = Number(index)
    if (!Number.isInteger(evidenceIndex) || evidenceIndex < 0) {
      return NextResponse.json({ error: 'Invalid evidence index' }, { status: 400 })
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const saDenied = await guardUserOperation(user.id, 'manufacturing.adjustment.manage')
    if (saDenied) return saDenied

    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('organization_id, role_code')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 400 })
    }

    const { data: adjustment, error: adjustmentError } = await admin
      .from('stock_adjustments')
      .select('id, organization_id, target_manufacturer_org_id, manufacturer_status, proof_images')
      .eq('id', id)
      .single()

    if (adjustmentError || !adjustment) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
    }

    // Seeing every manufacturer's adjustments is an S&A decision
    // (manufacturing.adjustment.administer); the Super Admin rule is the legacy evaluator.
    const isAdministrator = (await userAllowed(user.id, 'manufacturing.adjustment.administer', () => userProfile.role_code === 'SA'))
    if (!canAccessIssue(adjustment, userProfile, isAdministrator)) {
      return NextResponse.json({ error: 'Not allowed to access this evidence' }, { status: 403 })
    }

    const evidenceReference = adjustment.proof_images?.[evidenceIndex]
    if (!evidenceReference) {
      return NextResponse.json({ error: 'Evidence file not found' }, { status: 404 })
    }

    const storagePath = qualityIssueEvidencePath(evidenceReference)
    if (!storagePath) {
      return NextResponse.json({ error: 'Invalid evidence storage path' }, { status: 400 })
    }

    const { data: fileData, error: downloadError } = await admin.storage
      .from(EVIDENCE_BUCKET)
      .download(storagePath)

    if (downloadError || !fileData) {
      console.error('Evidence download failed', { id, evidenceIndex, storagePath, error: downloadError })
      return NextResponse.json({ error: 'Evidence file is not available' }, { status: 404 })
    }

    const arrayBuffer = await fileData.arrayBuffer()
    const filename = getEvidenceFileName(evidenceReference)
    const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=60',
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': String(arrayBuffer.byteLength),
        'Content-Type': fileData.type || 'application/octet-stream',
      },
    })
  } catch (error: any) {
    console.error('GET /api/manufacturer/adjustments/[id]/evidence/[index] error', error)
    return NextResponse.json({ error: error?.message || 'Unable to load evidence file' }, { status: 500 })
  }
}
