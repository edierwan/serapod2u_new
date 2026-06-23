import { apiErrorResponse, getEllbowMemberContext } from '@/lib/server/ellbow-catalog'

export async function GET() {
  try {
    const { admin, user, program, organizationId } = await getEllbowMemberContext()
    const { data, error } = await admin.from('ellbow_point_transactions').select('*')
      .eq('organization_id', organizationId).eq('loyalty_program_id', program.id).eq('owner_user_id', user.id)
      .in('transaction_type', ['qr_scan','roadtour_bonus']).order('created_at', { ascending: false }).limit(500)
    if (error) throw error
    const grouped = new Map<string, any>()
    for (const row of data ?? []) { const key = row.source_id || row.scan_id || row.id; const current = grouped.get(key) || { product_name: row.description || 'Ellbow Pet Food scan', variant_name: row.source_type === 'roadtour_scan' ? 'RoadTour' : row.wallet_lane, image_url: null, scan_count: 0, total_points: 0, last_scanned_at: row.created_at }; current.scan_count += 1; current.total_points += Math.max(0, Number(row.points_delta)); grouped.set(key, current) }
    return Response.json({ success: true, scans: Array.from(grouped.values()) })
  } catch (error) { return apiErrorResponse(error) }
}
