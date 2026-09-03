import { getVariantFlavour } from '@/lib/products/variant-master-data'

/** Display only master-data identity; destination mapping stays on the receipt item. */
export function ReceiveItemLabel({ product_name, variant_name, product_code }: {
  product_name: string
  variant_name: string
  product_code?: string | null
}) {
  return <>
    <div className="font-medium text-gray-900">{product_name}</div>
    <div className="text-xs text-gray-500">{[getVariantFlavour(variant_name), product_code?.trim()].filter(Boolean).join(' - ')}</div>
  </>
}
