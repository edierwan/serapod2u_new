import { OutdoorDocPage } from '@/components/outdoor/OutdoorDocPage'

export const metadata = { title: 'Terms & Conditions' }

export default function OutdoorTermsPage() {
  return (
    <OutdoorDocPage
      title="Terms & Conditions"
      intro="Please read these terms before ordering from Serapod Outdoor."
      sections={[
        {
          heading: 'The store',
          body: [
            'Serapod Outdoor is an ecommerce storefront operated under the Serapod brand family in Malaysia.',
            'Product descriptions, imagery, and prices may change. The price confirmed at checkout (including shipping, if selected) is the price charged.',
          ],
        },
        {
          heading: 'Orders & payment',
          body: [
            'An order is created when you complete checkout. Payment is confirmed only after our payment provider verifies the transaction via webhook.',
            'We may cancel or refuse an order in cases such as payment failure, suspected fraud, pricing error, or stock unavailability. If payment was captured, eligible refunds follow our Refund Policy.',
          ],
        },
        {
          heading: 'Shipping',
          body: [
            'Delivery is arranged through our logistics partners. Estimated delivery windows are indicative and may vary by courier and location.',
            'You are responsible for providing an accurate delivery address and reachable phone number.',
          ],
        },
        {
          heading: 'Acceptable use',
          body: [
            'You agree not to misuse the site, attempt unauthorised access, scrape content aggressively, or place fraudulent orders.',
          ],
        },
        {
          heading: 'Limitation of liability',
          body: [
            'To the fullest extent permitted by law, Serapod Outdoor is not liable for indirect or consequential losses arising from use of the site or delays outside our reasonable control (including courier disruptions).',
            'Nothing in these terms excludes liability that cannot be excluded under Malaysian law.',
          ],
        },
        {
          heading: 'Contact',
          body: [
            'Questions about these terms: use the Contact page on Serapod Outdoor.',
          ],
        },
      ]}
    />
  )
}
