import { OutdoorDocPage } from '@/components/outdoor/OutdoorDocPage'

export const metadata = { title: 'Shipping & Returns' }

export default function OutdoorShippingPage() {
  return (
    <OutdoorDocPage
      title="Shipping & Returns"
      intro="Delivery in Malaysia and what to do if you need to return something."
      sections={[
        {
          heading: 'Shipping coverage',
          body: [
            'We ship within Malaysia using courier partners connected through EasyParcel (once credentials are live).',
            'At checkout you can choose available courier rates for your postcode and state. Shipping cost is added to the order total before payment.',
          ],
        },
        {
          heading: 'Processing time',
          body: [
            'Paid orders enter our fulfilment desk for packing. We aim to hand parcels to the courier within 1–3 business days after payment confirmation, unless a product note states otherwise.',
            'Public holidays and peak seasons may add delay.',
          ],
        },
        {
          heading: 'Tracking',
          body: [
            'When your order ships, a tracking number is stored on the order. Use Track Order with your order reference and checkout email to view status and courier updates.',
          ],
        },
        {
          heading: 'Failed delivery',
          body: [
            'If a courier cannot complete delivery due to an incorrect address, unreachable recipient, or refusal, re-delivery or return-to-sender rules of the courier apply. Extra fees may be charged in those cases.',
          ],
        },
        {
          heading: 'Returns',
          body: [
            'If an item arrives damaged, defective, or incorrect, contact us within 7 days of delivery with photos and your order reference.',
            'Unused items in original packaging may be eligible for return subject to product type and approval. Hygiene-sensitive or custom items may be excluded.',
            'Approved returns are handled under the Refund Policy.',
          ],
        },
      ]}
    />
  )
}
