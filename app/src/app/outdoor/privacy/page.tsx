import { OutdoorDocPage } from '@/components/outdoor/OutdoorDocPage'

export const metadata = { title: 'Privacy Policy' }

export default function OutdoorPrivacyPage() {
  return (
    <OutdoorDocPage
      title="Privacy Policy"
      intro="How we handle your information when you shop or contact Serapod Outdoor."
      sections={[
        {
          heading: 'Information we collect',
          body: [
            'Account and checkout details such as name, email, phone, and delivery address.',
            'Order history, payment status references from our payment provider, and shipping/tracking details.',
            'Messages you send via Contact or newsletter subscriptions.',
            'Basic technical data needed to run the site securely (for example session and device signals used by our hosting platform).',
          ],
        },
        {
          heading: 'How we use information',
          body: [
            'To process and fulfil orders, arrange delivery, and provide tracking updates.',
            'To respond to support requests and improve the Outdoor shopping experience.',
            'To send newsletter updates only if you subscribe (you can stop at any time by contacting us).',
            'We do not sell personal information.',
          ],
        },
        {
          heading: 'Sharing',
          body: [
            'We share data only with service providers required to operate the store — for example payment gateways and courier partners such as EasyParcel — under contractual and security controls.',
            'We may disclose information if required by Malaysian law or to protect Serapod, our customers, or the public.',
          ],
        },
        {
          heading: 'Retention & security',
          body: [
            'Order and account records are kept as long as needed for fulfilment, accounting, dispute handling, and legal obligations.',
            'We apply reasonable technical and organisational measures; no method of transmission is 100% secure.',
          ],
        },
        {
          heading: 'Your choices',
          body: [
            'You may request access to or correction of your profile details via your Outdoor account or by contacting us.',
            'For privacy questions, use the Contact page on Serapod Outdoor.',
          ],
        },
      ]}
    />
  )
}
