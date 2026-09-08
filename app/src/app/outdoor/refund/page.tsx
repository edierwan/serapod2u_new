import { OutdoorDocPage } from '@/components/outdoor/OutdoorDocPage'

export const metadata = { title: 'Refund Policy' }

export default function OutdoorRefundPage() {
  return (
    <OutdoorDocPage
      title="Refund Policy"
      intro="When and how we refund Outdoor orders."
      sections={[
        {
          heading: 'When refunds apply',
          body: [
            'Payment failed or cancelled before fulfilment — no charge should remain; contact us if your bank statement differs.',
            'Item not received after an unreasonable delay caused by our fulfilment error.',
            'Damaged, defective, or wrong item confirmed by our team after you report it with evidence.',
            'Approved returns under Shipping & Returns.',
          ],
        },
        {
          heading: 'How to request a refund',
          body: [
            'Use the Contact page with your order reference, email used at checkout, and a short description of the issue.',
            'For damaged goods, include clear photos of the product and packaging.',
          ],
        },
        {
          heading: 'Method & timing',
          body: [
            'Approved refunds are returned via the original payment method where possible (Billplz, CHIP, or the active gateway).',
            'After we approve a refund, bank or e-wallet posting typically takes 5–14 business days depending on the provider.',
          ],
        },
        {
          heading: 'Non-refundable cases',
          body: [
            'Change of mind after the parcel has been shipped may be declined or limited to store credit, unless required by law.',
            'Items returned used, incomplete, or without original packaging may be refused.',
            'Shipping fees are refundable only when the return is due to our error.',
          ],
        },
      ]}
    />
  )
}
