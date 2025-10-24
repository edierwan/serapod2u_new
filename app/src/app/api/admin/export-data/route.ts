import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/admin/export-data
 * Export all system data as JSON backup
 * SUPER ADMIN ONLY (role_level = 1)
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if user is Super Admin
    const { data: profile } = await supabase
      .from('users')
      .select('role_code, roles(role_level)')
      .eq('id', user.id)
      .single()

    if (!profile || (profile.roles as any).role_level !== 1) {
      return NextResponse.json(
        { error: 'Access denied. Super Admin only.' },
        { status: 403 }
      )
    }

    console.log('📦 EXPORTING DATA - Started by:', user.email)

    const exportData: any = {
      export_info: {
        exported_at: new Date().toISOString(),
        exported_by: user.email,
        version: '1.0',
        app: 'Serapod2U Supply Chain'
      },
      transaction_data: {},
      master_data: {},
      statistics: {}
    }

    // ========================================
    // TRANSACTION DATA
    // ========================================
    console.log('📊 Exporting transaction data...')

    // Orders
    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
    exportData.transaction_data.orders = orders || []

    // Order Items
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('*')
      .order('created_at', { ascending: false })
    exportData.transaction_data.order_items = orderItems || []

    // QR Batches
    const { data: qrBatches } = await supabase
      .from('qr_batches')
      .select('*')
      .order('created_at', { ascending: false })
    exportData.transaction_data.qr_batches = qrBatches || []

    // QR Codes
    const { data: qrCodes } = await supabase
      .from('qr_codes')
      .select('*')
      .order('created_at', { ascending: false })
    exportData.transaction_data.qr_codes = qrCodes || []

    // QR Master Codes
    const { data: qrMasterCodes } = await supabase
      .from('qr_master_codes')
      .select('*')
      .order('created_at', { ascending: false })
    exportData.transaction_data.qr_master_codes = qrMasterCodes || []

    // Invoices
    const { data: invoices } = await supabase
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false })
    exportData.transaction_data.invoices = invoices || []

    // Payments
    const { data: payments } = await supabase
      .from('payments')
      .select('*')
      .order('created_at', { ascending: false })
    exportData.transaction_data.payments = payments || []

    // Shipments
    const { data: shipments } = await supabase
      .from('shipments')
      .select('*')
      .order('created_at', { ascending: false })
    exportData.transaction_data.shipments = shipments || []

    // Document Workflows
    const { data: docWorkflows } = await supabase
      .from('document_workflows')
      .select('*')
      .order('created_at', { ascending: false })
    exportData.transaction_data.document_workflows = docWorkflows || []

    console.log('✓ Transaction data exported')

    // ========================================
    // MASTER DATA
    // ========================================
    console.log('📊 Exporting master data...')

    // Organizations
    const { data: organizations } = await supabase
      .from('organizations')
      .select('*')
      .order('org_name', { ascending: true })
    exportData.master_data.organizations = organizations || []

    // Users (exclude passwords)
    const { data: users } = await supabase
      .from('users')
      .select('id, email, full_name, phone, role_code, organization_id, is_active, is_verified, created_at, updated_at')
      .order('created_at', { ascending: false })
    exportData.master_data.users = users || []

    // Products
    const { data: products } = await supabase
      .from('products')
      .select('*')
      .order('product_name', { ascending: true })
    exportData.master_data.products = products || []

    // Product Variants
    const { data: variants } = await supabase
      .from('product_variants')
      .select('*')
      .order('variant_name', { ascending: true })
    exportData.master_data.product_variants = variants || []

    // Brands
    const { data: brands } = await supabase
      .from('brands')
      .select('*')
      .order('brand_name', { ascending: true })
    exportData.master_data.brands = brands || []

    // Categories
    const { data: categories } = await supabase
      .from('categories')
      .select('*')
      .order('category_name', { ascending: true })
    exportData.master_data.categories = categories || []

    // Shop Distributors
    const { data: shopDistributors } = await supabase
      .from('shop_distributors')
      .select('*')
      .order('created_at', { ascending: false })
    exportData.master_data.shop_distributors = shopDistributors || []

    console.log('✓ Master data exported')

    // ========================================
    // SYSTEM REFERENCE DATA
    // ========================================
    console.log('📊 Exporting system reference data...')

    // Roles
    const { data: roles } = await supabase
      .from('roles')
      .select('*')
      .order('role_level', { ascending: true })
    exportData.master_data.roles = roles || []

    // Organization Types
    const { data: orgTypes } = await supabase
      .from('organization_types')
      .select('*')
      .order('org_type_name', { ascending: true })
    exportData.master_data.organization_types = orgTypes || []

    // Countries
    const { data: countries } = await supabase
      .from('countries')
      .select('*')
      .order('country_name', { ascending: true })
    exportData.master_data.countries = countries || []

    // States
    const { data: states } = await supabase
      .from('states')
      .select('*')
      .order('state_name', { ascending: true })
    exportData.master_data.states = states || []

    // Districts
    const { data: districts } = await supabase
      .from('districts')
      .select('*')
      .order('district_name', { ascending: true })
    exportData.master_data.districts = districts || []

    console.log('✓ System reference data exported')

    // ========================================
    // STATISTICS
    // ========================================
    exportData.statistics = {
      transaction_data: {
        orders: orders?.length || 0,
        order_items: orderItems?.length || 0,
        qr_batches: qrBatches?.length || 0,
        qr_codes: qrCodes?.length || 0,
        qr_master_codes: qrMasterCodes?.length || 0,
        invoices: invoices?.length || 0,
        payments: payments?.length || 0,
        shipments: shipments?.length || 0,
        document_workflows: docWorkflows?.length || 0
      },
      master_data: {
        organizations: organizations?.length || 0,
        users: users?.length || 0,
        products: products?.length || 0,
        product_variants: variants?.length || 0,
        brands: brands?.length || 0,
        categories: categories?.length || 0,
        shop_distributors: shopDistributors?.length || 0
      },
      system_data: {
        roles: roles?.length || 0,
        organization_types: orgTypes?.length || 0,
        countries: countries?.length || 0,
        states: states?.length || 0,
        districts: districts?.length || 0
      }
    }

    // Calculate totals
    const transactionTotal = Object.values(exportData.statistics.transaction_data).reduce((a, b) => (a as number) + (b as number), 0) as number
    const masterTotal = Object.values(exportData.statistics.master_data).reduce((a, b) => (a as number) + (b as number), 0) as number
    const systemTotal = Object.values(exportData.statistics.system_data).reduce((a, b) => (a as number) + (b as number), 0) as number
    const totalRecords = transactionTotal + masterTotal + systemTotal

    exportData.statistics.total_records = totalRecords

    console.log(`✅ Export complete - ${totalRecords} records`)

    // ========================================
    // RETURN JSON FILE
    // ========================================
    const jsonString = JSON.stringify(exportData, null, 2)
    const blob = Buffer.from(jsonString, 'utf-8')

    return new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="serapod2u-backup-${new Date().toISOString().split('T')[0]}.json"`,
        'Content-Length': blob.length.toString()
      }
    })

  } catch (error: any) {
    console.error('❌ Export error:', error)
    return NextResponse.json(
      { error: 'Failed to export data', details: error.message },
      { status: 500 }
    )
  }
}
