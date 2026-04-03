import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Papa from 'papaparse'
import ExcelJS from 'exceljs'

// CSV/Excel column → DB field mapping with known aliases
const COLUMN_MAP: Record<string, string> = {
  // Malay names
  'nama kedai': 'org_name',
  'branch': 'branch',
  'name': 'contact_name',
  'telephone': 'contact_phone',
  'alamat': 'address',
  'negeri': 'state',
  'adakah kedai ini menjual flavour serapod?': 'sells_serapod_flavour',
  'adakah kedai ini menjual flavour serapod': 'sells_serapod_flavour',
  'adakah kedai ini menjual s.box?': 'sells_sbox',
  'adakah kedai ini menjual s.box': 'sells_sbox',
  'adakah kedai ini menjual s.box special edition': 'sells_sbox_special_edition',
  'brand flavour hot': 'hot_flavour_brands',
  // English aliases
  'shop name': 'org_name',
  'organization name': 'org_name',
  'org name': 'org_name',
  'store name': 'org_name',
  'phone': 'contact_phone',
  'phone number': 'contact_phone',
  'contact': 'contact_name',
  'contact person': 'contact_name',
  'contact name': 'contact_name',
  'address': 'address',
  'state': 'state',
  'sells serapod': 'sells_serapod_flavour',
  'sells sbox': 'sells_sbox',
  'sells sbox special edition': 'sells_sbox_special_edition',
  'hot brands': 'hot_flavour_brands',
}

// System fields available for import
const SYSTEM_FIELDS = [
  { key: 'org_name', label: 'Organization Name', required: true },
  { key: 'branch', label: 'Branch' },
  { key: 'contact_name', label: 'Contact Person' },
  { key: 'contact_phone', label: 'Phone' },
  { key: 'address', label: 'Address' },
  { key: 'state', label: 'State' },
  { key: 'city', label: 'City' },
  { key: 'postal_code', label: 'Postal Code' },
  { key: 'contact_email', label: 'Contact Email' },
  { key: 'registration_no', label: 'Registration No' },
  { key: 'sells_serapod_flavour', label: 'Sells Serapod Flavour' },
  { key: 'sells_sbox', label: 'Sells S.Box' },
  { key: 'sells_sbox_special_edition', label: 'Sells S.Box Special Edition' },
  { key: 'hot_flavour_brands', label: 'Hot Flavour Brands' },
]

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[?\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ')
}

function autoMapColumns(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const h of headers) {
    const norm = normalizeHeader(h)
    if (COLUMN_MAP[norm]) {
      mapping[h] = COLUMN_MAP[norm]
    }
  }
  return mapping
}

function parseBooleanMY(val: string | null | undefined): boolean {
  if (!val) return false
  const v = val.trim().toLowerCase()
  return v === 'ya' || v === 'yes' || v === 'true' || v === '1' || v === 'y'
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  let p = phone.toString().trim().replace(/[^0-9+]/g, '')
  // Normalize Malaysian phone: 601... format
  if (p.startsWith('0')) p = '60' + p.substring(1)
  if (!p.startsWith('+') && p.startsWith('60')) p = '+' + p
  return p || null
}

interface ImportRow {
  rowNum: number
  data: Record<string, any>
  errors: string[]
  warnings: string[]
  isDuplicate: boolean
  matchedOrgId?: string
}

// POST /api/organizations/import - parse and preview
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Auth check
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('users')
      .select('id, role_code, organization_id, roles(role_level)')
      .eq('id', user.id)
      .single()

    const roleLevel = (profile?.roles as any)?.role_level
    if (!profile || (roleLevel > 50 && profile.role_code !== 'MANAGER')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const action = formData.get('action') as string // 'preview' or 'import'
    const mappingJson = formData.get('mapping') as string | null
    const importMode = (formData.get('importMode') as string) || 'insert_only'
    const parentOrgId = formData.get('parentOrgId') as string | null
    const orgTypeCode = (formData.get('orgTypeCode') as string) || 'SHOP'

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    // Parse file
    let rows: Record<string, string>[] = []
    let headers: string[] = []

    const fileName = file.name.toLowerCase()
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      // Excel
      const ab = await file.arrayBuffer()
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(ab as any)
      const worksheet = workbook.worksheets[0]
      if (!worksheet || worksheet.rowCount < 2) {
        return NextResponse.json({ error: 'Empty worksheet or no data rows' }, { status: 400 })
      }
      const headerRow = worksheet.getRow(1)
      headers = headerRow.values
        ? (headerRow.values as any[]).slice(1).map(v => String(v || '').trim())
        : []

      for (let i = 2; i <= worksheet.rowCount; i++) {
        const row = worksheet.getRow(i)
        const record: Record<string, string> = {}
        let hasData = false
        headers.forEach((h, idx) => {
          const val = row.getCell(idx + 1).text?.trim() || ''
          record[h] = val
          if (val) hasData = true
        })
        if (hasData) rows.push(record)
      }
    } else {
      // CSV
      const text = await file.text()
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
      headers = parsed.meta.fields || []
      rows = parsed.data as Record<string, string>[]
    }

    if (headers.length === 0 || rows.length === 0) {
      return NextResponse.json({ error: 'No data found in file' }, { status: 400 })
    }

    // Auto-map or use provided mapping
    const mapping: Record<string, string> = mappingJson
      ? JSON.parse(mappingJson)
      : autoMapColumns(headers)

    if (action === 'preview') {
      return NextResponse.json({
        headers,
        mapping,
        systemFields: SYSTEM_FIELDS,
        rowCount: rows.length,
        preview: rows.slice(0, 20).map((r, i) => ({ rowNum: i + 2, data: r })),
      })
    }

    // ─── Import action ───────────────────────────────────────────────
    // Fetch states for name→id mapping
    const { data: statesData } = await supabase
      .from('states')
      .select('id, state_name, state_code')
      .eq('is_active', true)

    const stateMap = new Map<string, string>()
    for (const s of statesData || []) {
      stateMap.set(s.state_name.toLowerCase(), s.id)
      stateMap.set(s.state_code.toLowerCase(), s.id)
    }

    // Fetch existing orgs for duplicate detection
    const { data: existingOrgs } = await supabase
      .from('organizations')
      .select('id, org_name, contact_phone, org_type_code')
      .eq('org_type_code', orgTypeCode)
      .eq('is_active', true) as { data: any[] | null }

    // Generate org codes: find max existing
    const prefixMap: Record<string, string> = {
      HQ: 'HQ', MANU: 'MN', DIST: 'DT', WH: 'WH', SHOP: 'SH'
    }
    const prefix = prefixMap[orgTypeCode] || orgTypeCode.substring(0, 2)
    const { data: allCodes } = await supabase
      .from('organizations')
      .select('org_code')
      .eq('org_type_code', orgTypeCode)
    let maxCode = 0
    for (const c of allCodes || []) {
      if (c.org_code?.startsWith(prefix)) {
        const n = parseInt(c.org_code.substring(prefix.length))
        if (!isNaN(n) && n > maxCode) maxCode = n
      }
    }

    // Process rows
    const results: ImportRow[] = []
    const toInsert: any[] = []
    const toUpdate: { id: string; data: any }[] = []
    let skipped = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const mapped: Record<string, any> = {}
      for (const [csvCol, sysField] of Object.entries(mapping)) {
        if (sysField && row[csvCol] !== undefined) {
          mapped[sysField] = row[csvCol]
        }
      }

      const errors: string[] = []
      const warnings: string[] = []

      // Required field check
      const orgName = (mapped.org_name || '').trim()
      if (!orgName) {
        errors.push('Organization name is required')
      }

      // Transform values
      const branch = (mapped.branch || '').trim() || null
      const contactName = (mapped.contact_name || '').trim() || null
      const contactPhone = normalizePhone(mapped.contact_phone)
      const address = (mapped.address || '').trim() || null
      const stateName = (mapped.state || '').trim()
      const stateId = stateName ? (stateMap.get(stateName.toLowerCase()) || null) : null
      if (stateName && !stateId) {
        warnings.push(`State "${stateName}" not found in system`)
      }

      const sellsSerapod = parseBooleanMY(mapped.sells_serapod_flavour)
      const sellsSbox = parseBooleanMY(mapped.sells_sbox)
      const sellsSboxSE = parseBooleanMY(mapped.sells_sbox_special_edition)
      const hotBrands = (mapped.hot_flavour_brands || '').trim() || null

      // Duplicate detection
      let isDuplicate = false
      let matchedOrgId: string | undefined
      if (existingOrgs && orgName) {
        const match = existingOrgs.find((o: any) => {
          const nameMatch = o.org_name?.toLowerCase().trim() === orgName.toLowerCase()
          const phoneMatch = !contactPhone || !o.contact_phone || o.contact_phone.replace(/[^0-9]/g, '') === contactPhone.replace(/[^+0-9]/g, '').replace('+', '')
          return nameMatch && phoneMatch
        })
        if (match) {
          isDuplicate = true
          matchedOrgId = match.id
        }
      }

      const importRow: ImportRow = {
        rowNum: i + 2,
        data: mapped,
        errors,
        warnings,
        isDuplicate,
        matchedOrgId,
      }
      results.push(importRow)

      if (errors.length > 0) continue

      const orgData: any = {
        org_name: orgName,
        branch,
        contact_name: contactName,
        contact_phone: contactPhone,
        address,
        state_id: stateId,
        sells_serapod_flavour: sellsSerapod,
        sells_sbox: sellsSbox,
        sells_sbox_special_edition: sellsSboxSE,
        hot_flavour_brands: hotBrands,
        is_active: true,
      }

      if (isDuplicate && matchedOrgId) {
        if (importMode === 'update_existing') {
          toUpdate.push({ id: matchedOrgId, data: { ...orgData, updated_by: profile.id } })
        } else {
          skipped++
        }
      } else {
        maxCode++
        orgData.org_code = `${prefix}${String(maxCode).padStart(3, '0')}`
        orgData.org_type_code = orgTypeCode
        orgData.parent_org_id = parentOrgId || null
        orgData.country_code = 'MY'
        orgData.created_by = profile.id
        toInsert.push(orgData)
      }
    }

    // Execute inserts in batches of 50
    let inserted = 0
    let updated = 0
    let failed = 0
    const failedRows: { rowNum: number; error: string }[] = []

    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50)
      const { error: insertErr } = await supabase
        .from('organizations')
        .insert(batch)

      if (insertErr) {
        failed += batch.length
        failedRows.push({ rowNum: 0, error: insertErr.message })
      } else {
        inserted += batch.length
      }
    }

    for (const upd of toUpdate) {
      const { error: updErr } = await supabase
        .from('organizations')
        .update(upd.data)
        .eq('id', upd.id)

      if (updErr) {
        failed++
        failedRows.push({ rowNum: 0, error: updErr.message })
      } else {
        updated++
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        total: rows.length,
        inserted,
        updated,
        skipped,
        failed,
        failedRows,
      },
      results: results.map(r => ({
        rowNum: r.rowNum,
        orgName: r.data.org_name,
        errors: r.errors,
        warnings: r.warnings,
        isDuplicate: r.isDuplicate,
      })),
    })
  } catch (err: any) {
    console.error('Organization import error:', err)
    return NextResponse.json(
      { error: err.message || 'Import failed' },
      { status: 500 }
    )
  }
}
