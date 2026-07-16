export interface ExistingStockBalance {
  quantity_on_hand: number
  quantity_allocated: number
  quantity_available: number
  warehouse_name: string
  warehouse_location: string | null
  average_cost: number | null
}

interface ExistingStockRow {
  quantity_on_hand: number | null
  quantity_allocated: number | null
  quantity_available: number | null
  warehouse_location: string | null
  average_cost: number | null
  organization: { org_name?: string | null } | { org_name?: string | null }[] | null
}

export async function fetchExistingStockForWarehouse(
  supabase: any,
  warehouseId: string,
  variantId: string
): Promise<ExistingStockBalance | null> {
  if (!warehouseId || !variantId) return null

  const { data, error } = await supabase
    .from('product_inventory')
    .select(`
      quantity_on_hand,
      quantity_allocated,
      quantity_available,
      warehouse_location,
      average_cost,
      organization:organizations(org_name)
    `)
    .eq('organization_id', warehouseId)
    .eq('variant_id', variantId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as ExistingStockRow
  const organization = Array.isArray(row.organization) ? row.organization[0] : row.organization
  const quantityOnHand = Number(row.quantity_on_hand ?? 0)
  const quantityAllocated = Number(row.quantity_allocated ?? 0)

  return {
    quantity_on_hand: quantityOnHand,
    quantity_allocated: quantityAllocated,
    quantity_available: Number(row.quantity_available ?? (quantityOnHand - quantityAllocated)),
    warehouse_name: organization?.org_name || 'Unknown warehouse',
    warehouse_location: row.warehouse_location,
    average_cost: row.average_cost === null ? null : Number(row.average_cost),
  }
}

interface AddStockMovementInput {
  variantId: string
  warehouseId: string
  quantity: number
  unitCost: number | null
  manufacturerId: string | null
  warehouseLocation: string | null
  notes: string | null
  companyId: string
  createdBy: string
}

export function buildAddStockMovementParams(input: AddStockMovementInput) {
  if (!input.warehouseId) throw new Error('A warehouse must be selected')

  return {
    p_movement_type: 'manual_in',
    p_variant_id: input.variantId,
    p_organization_id: input.warehouseId,
    p_quantity_change: input.quantity,
    p_unit_cost: input.unitCost,
    p_manufacturer_id: input.manufacturerId,
    p_warehouse_location: input.warehouseLocation,
    p_reason: 'Manual stock addition',
    p_notes: input.notes,
    p_reference_type: 'manual',
    p_reference_id: null,
    p_reference_no: null,
    p_company_id: input.companyId,
    p_created_by: input.createdBy,
  }
}
