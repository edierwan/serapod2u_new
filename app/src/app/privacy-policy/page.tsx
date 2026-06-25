import type { Metadata } from 'next'
import { LegalPageLayout, LegalSection, SUPPORT_EMAIL } from '@/components/legal/LegalPageLayout'

const LAST_UPDATED = '25 June 2026'

export const metadata: Metadata = {
  title: 'Privacy Policy | Serapod2U',
  description: 'How Serapod2U collects, uses, and protects your information.',
}

export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      lastUpdated={LAST_UPDATED}
      intro="This Privacy Policy explains how Serapod2U collects, uses, shares, and protects information when you use our platform and related services."
    >
      <LegalSection heading="1. Introduction and Scope">
        <p>
          Serapod2U (&quot;Serapod2U&quot;, &quot;we&quot;, &quot;us&quot; or &quot;our&quot;) provides a
          business platform for supply chain management, product tracking, ordering, inventory,
          loyalty/rewards, and business notifications. This policy applies to information processed
          through our web application and associated business communication features, including
          messages delivered via the WhatsApp Business Platform.
        </p>
        <p>
          This policy describes only information genuinely processed by Serapod2U. It does not apply
          to third-party services that operate under their own privacy policies.
        </p>
      </LegalSection>

      <LegalSection heading="2. Information We Collect">
        <p>Depending on how you use Serapod2U, we may collect the following:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Name and account information (such as your user profile and login identity).</li>
          <li>Phone number, used for account contact and business messaging.</li>
          <li>Email address.</li>
          <li>Organization, shop, or business information associated with your account.</li>
          <li>Orders and transaction records you create or manage on the platform.</li>
          <li>Product and inventory activity, including tracking and catalog data.</li>
          <li>
            Notification and message-delivery metadata (for example, delivery status and timestamps
            of business messages we send on your behalf or to you).
          </li>
          <li>
            Technical logs needed for security, troubleshooting, and to keep the service running
            reliably (such as error logs and basic request information).
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. How We Use Information">
        <ul className="list-disc space-y-1 pl-5">
          <li>To provide, operate, and maintain the platform and its features.</li>
          <li>To process orders, inventory, rewards, and related business activity.</li>
          <li>To send account, transactional, and business notifications you have configured.</li>
          <li>To provide customer support and respond to your requests.</li>
          <li>To secure the platform, prevent abuse, and troubleshoot technical issues.</li>
          <li>To comply with applicable legal, tax, and accounting obligations.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. WhatsApp Business Platform and Meta">
        <p>
          Serapod2U uses the WhatsApp Business Platform, provided by Meta, as a service provider to
          deliver business notifications and to receive related business messages. When messages are
          sent or received through this channel, the necessary information (such as the recipient
          phone number and message content for that business notification) is processed by Meta in
          order to deliver the message.
        </p>
        <p>
          Serapod2U does not access or read your private, personal WhatsApp conversations. We only
          process the business messages and delivery metadata that pass through our integration for
          the purpose of providing the service. Your use of WhatsApp is also subject to Meta&apos;s
          own terms and privacy policy.
        </p>
      </LegalSection>

      <LegalSection heading="5. Other Service Providers">
        <p>
          We rely on a limited number of trusted service providers to host the platform, store data,
          and deliver notifications (for example, hosting/database infrastructure and email
          delivery). These providers process information only as needed to perform services for us
          and are required to protect it.
        </p>
      </LegalSection>

      <LegalSection heading="6. Data Sharing Limitations">
        <p>
          We do not sell your personal information. We share information only: (a) with service
          providers acting on our behalf; (b) within your own organization as required for the
          platform to function; (c) when you direct us to; or (d) where required by law or to protect
          the rights, safety, and security of users and the platform.
        </p>
      </LegalSection>

      <LegalSection heading="7. Data Retention">
        <p>
          We retain information for as long as your account is active or as needed to provide the
          service. Some records (such as transaction, tax, accounting, security, or legal records)
          may be retained for longer where required to meet legal or regulatory obligations, after
          which they are deleted or anonymized.
        </p>
      </LegalSection>

      <LegalSection heading="8. Security Measures">
        <p>
          We use reasonable technical and organizational measures to protect information, including
          access controls, encryption in transit, and authenticated access. No method of transmission
          or storage is completely secure, but we work to protect your information and continuously
          improve our safeguards.
        </p>
      </LegalSection>

      <LegalSection heading="9. Your Rights and Access/Correction Requests">
        <p>
          Subject to applicable law, you may request access to, correction of, or a copy of the
          personal information we hold about you. You can update much of your account information
          directly within the platform, or contact us at{' '}
          <a className="text-blue-600 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="10. Data-Deletion Requests">
        <p>
          You may request deletion of personal data associated with your Serapod2U account. Please
          see our{' '}
          <a className="text-blue-600 hover:underline" href="/data-deletion">
            Data Deletion instructions
          </a>{' '}
          for how to submit a request and what to expect.
        </p>
      </LegalSection>

      <LegalSection heading="11. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. When we do, we will revise the
          &quot;Last updated&quot; date above. Material changes will be communicated through the
          platform where appropriate.
        </p>
      </LegalSection>

      <LegalSection heading="12. Contact Information">
        <p>
          If you have questions about this Privacy Policy or our handling of your information, contact
          us at{' '}
          <a className="text-blue-600 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
