export interface CelleraVapeProductLike {
  is_active?: boolean | null
  is_vape?: boolean | null
  product_name?: string | null
  product_code?: string | null
}

export function isCelleraVapeVariant(product: CelleraVapeProductLike | null | undefined): boolean {
  return Boolean(
    product?.is_active && product?.is_vape &&
    (/cellera/i.test(product?.product_name || '') || /^CEL/i.test(product?.product_code || ''))
  )
}
