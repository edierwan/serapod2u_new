export const ATTRIBUTE_TYPES = ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'LIST', 'JSON'] as const

export type AttributeType = (typeof ATTRIBUTE_TYPES)[number]

export interface StructuredAttribute {
  id?: string
  attribute_name: string
  attribute_value: string
  attribute_type: AttributeType
  unit_of_measure: string | null
  attribute_group?: string | null
  is_searchable?: boolean | null
  is_filterable?: boolean | null
  display_order: number
}

export interface AttributeValidationResult {
  attributes: StructuredAttribute[]
  errors: Record<number, string>
  isValid: boolean
}

export const COMMON_ATTRIBUTE_NAMES = [
  'Colour',
  'Colour Hex',
  'Capacity',
  'Size',
  'Weight',
  'Material',
  'Max Load',
  'Power',
  'Volume',
] as const

export function emptyStructuredAttribute(displayOrder = 0): StructuredAttribute {
  return {
    attribute_name: '',
    attribute_value: '',
    attribute_type: 'TEXT',
    unit_of_measure: null,
    display_order: displayOrder,
  }
}

export function normalizeAttributeName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function validateStructuredAttributes(rows: StructuredAttribute[]): AttributeValidationResult {
  const errors: Record<number, string> = {}
  const names = new Map<string, number>()
  const attributes: StructuredAttribute[] = []

  rows.forEach((row, index) => {
    const name = row.attribute_name.trim().replace(/\s+/g, ' ')
    const value = row.attribute_value.trim()
    const unit = row.unit_of_measure?.trim() || null

    // A wholly blank row is only an unfinished UI row and is never persisted.
    if (!name && !value && !unit) return
    if (!name) errors[index] = 'Attribute name is required.'
    else if (!value) errors[index] = 'Attribute value is required.'

    const normalizedName = normalizeAttributeName(name)
    if (normalizedName) {
      const duplicateIndex = names.get(normalizedName)
      if (duplicateIndex !== undefined) {
        errors[index] = 'Attribute names must be unique.'
        errors[duplicateIndex] = 'Attribute names must be unique.'
      } else {
        names.set(normalizedName, index)
      }
    }

    if (name && value) {
      attributes.push({
        ...row,
        attribute_name: name,
        attribute_value: value,
        attribute_type: ATTRIBUTE_TYPES.includes(row.attribute_type) ? row.attribute_type : 'TEXT',
        unit_of_measure: unit,
        display_order: attributes.length,
      })
    }
  })

  return { attributes, errors, isValid: Object.keys(errors).length === 0 }
}

type AttributeOwner = { productId: string; variantId?: never } | { productId?: never; variantId: string }

export function attributeInsertRows(owner: AttributeOwner, rows: StructuredAttribute[]) {
  const validated = validateStructuredAttributes(rows)
  if (!validated.isValid) throw new Error('Please fix the Additional Attributes errors before saving.')

  return validated.attributes.map((row) => ({
    product_id: 'productId' in owner ? owner.productId : null,
    variant_id: 'variantId' in owner ? owner.variantId : null,
    attribute_name: row.attribute_name,
    attribute_value: row.attribute_value,
    attribute_type: row.attribute_type,
    unit_of_measure: row.unit_of_measure,
    attribute_group: row.attribute_group || null,
    is_searchable: row.is_searchable ?? false,
    is_filterable: row.is_filterable ?? false,
    display_order: row.display_order,
  }))
}

export async function loadStructuredAttributes(client: any, owner: AttributeOwner): Promise<StructuredAttribute[]> {
  let query = client
    .from('product_attributes')
    .select('id, attribute_name, attribute_value, attribute_type, unit_of_measure, attribute_group, is_searchable, is_filterable, display_order')

  query = 'productId' in owner
    ? query.eq('product_id', owner.productId).is('variant_id', null)
    : query.eq('variant_id', owner.variantId).is('product_id', null)

  const { data, error } = await query.order('display_order', { ascending: true }).order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).map((row: any, index: number) => ({
    ...row,
    attribute_type: ATTRIBUTE_TYPES.includes(row.attribute_type) ? row.attribute_type : 'TEXT',
    unit_of_measure: row.unit_of_measure || null,
    display_order: row.display_order ?? index,
  }))
}

export async function syncStructuredAttributes(client: any, owner: AttributeOwner, rows: StructuredAttribute[]) {
  const validated = validateStructuredAttributes(rows)
  if (!validated.isValid) throw new Error('Please fix the Additional Attributes errors before saving.')
  const desiredRows = attributeInsertRows(owner, validated.attributes)
  const existing = await loadStructuredAttributes(client, owner)
  const desiredIds = new Set(validated.attributes.map((row) => row.id).filter(Boolean))
  const removedIds = existing.map((row) => row.id).filter((id): id is string => Boolean(id) && !desiredIds.has(id))

  if (removedIds.length > 0) {
    const { error } = await client.from('product_attributes').delete().in('id', removedIds)
    if (error) throw error
  }

  for (let index = 0; index < desiredRows.length; index += 1) {
    const source = validated.attributes[index]
    const payload = desiredRows[index]
    if (source?.id) {
      const { error } = await client.from('product_attributes').update(payload).eq('id', source.id)
      if (error) throw error
    } else {
      const { error } = await client.from('product_attributes').insert(payload)
      if (error) throw error
    }
  }
}

function attributeKey(name: string) {
  return normalizeAttributeName(name).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/** Structured rows override matching legacy JSONB keys; unrelated legacy flags remain available. */
export function mergeStructuredAttributes(
  legacy: Record<string, unknown> | null | undefined,
  structured: Array<Pick<StructuredAttribute, 'attribute_name' | 'attribute_value' | 'unit_of_measure'>> | null | undefined,
) {
  const merged: Record<string, unknown> = { ...(legacy || {}) }
  for (const row of structured || []) {
    const key = attributeKey(row.attribute_name)
    if (!key || !row.attribute_value?.trim()) continue
    const equivalentKeys = key === 'colour'
      ? new Set(['colour', 'color'])
      : key === 'colour_hex'
        ? new Set(['colour_hex', 'color_hex', 'hex'])
        : new Set([key])
    for (const existingKey of Object.keys(merged)) {
      if (equivalentKeys.has(attributeKey(existingKey))) delete merged[existingKey]
    }
    const unit = row.unit_of_measure?.trim()
    merged[key] = `${row.attribute_value.trim()}${unit ? ` ${unit}` : ''}`
  }
  return merged
}

export function isRawHexVariantName(name: string) {
  return /^#[0-9a-f]{6}$/i.test(name.trim())
}
