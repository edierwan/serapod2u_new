import type { Metadata } from 'next'
import { LegalPageLayout, LegalSection, SUPPORT_EMAIL } from '@/components/legal/LegalPageLayout'

const LAST_UPDATED = '25 June 2026'

export const metadata: Metadata = {
  title: 'Terms of Service | Serapod2U',
  description: 'The terms that govern your use of the Serapod2U platform.',
}

export default function TermsOfServicePage() {
  return (
    <LegalPageLayout
      title="Terms of Service"
      lastUpdated={LAST_UPDATED}
      intro="These Terms of Service govern your access to and use of the Serapod2U platform. By using the service, you agree to these terms."
    >
      <LegalSection heading="1. Acceptance of Terms">
        <p>
          By accessing or using Serapod2U, you agree to be bound by these Terms of Service. If you do
          not agree, do not use the platform.
        </p>
      </LegalSection>

      <LegalSection heading="2. Eligibility and Authorized Business Use">
        <p>
          Serapod2U is intended for legitimate business use. By using the platform, you represent that
          you are authorized to act on behalf of the organization or shop associated with your
          account and that you will use the service for lawful business purposes.
        </p>
      </LegalSection>

      <LegalSection heading="3. Account Responsibility">
        <p>
          You are responsible for maintaining the confidentiality of your login credentials and for
          all activity that occurs under your account. Notify us promptly of any unauthorized use.
          Do not share passwords, one-time codes, or access tokens.
        </p>
      </LegalSection>

      <LegalSection heading="4. Permitted Use">
        <p>
          You may use Serapod2U to manage supply chain, ordering, inventory, product tracking,
          loyalty/rewards, and business notification features made available to your account, in
          accordance with these terms and applicable law.
        </p>
      </LegalSection>

      <LegalSection heading="5. Prohibited Misuse">
        <ul className="list-disc space-y-1 pl-5">
          <li>Using the platform for unlawful, fraudulent, or harmful activity.</li>
          <li>Sending unsolicited, deceptive, or non-compliant messages through messaging features.</li>
          <li>Attempting to gain unauthorized access to the platform, accounts, or data.</li>
          <li>Interfering with, disrupting, or overloading the service or its infrastructure.</li>
          <li>Reverse engineering, copying, or reselling the platform except as permitted by law.</li>
          <li>Uploading malicious code or violating the rights of others.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. Orders, Inventory, Rewards, and Notifications">
        <p>
          The platform provides tools for orders, inventory management, loyalty/rewards programs, and
          notifications. You are responsible for the accuracy of the data you enter and for ensuring
          your use of these features—including any messages you send—complies with applicable laws
          and third-party platform policies.
        </p>
      </LegalSection>

      <LegalSection heading="7. Third-Party Services">
        <p>
          Serapod2U integrates with third-party services, including the WhatsApp Business Platform
          provided by Meta, to deliver business notifications. Your use of such features is also
          subject to the applicable third-party terms and policies. We are not responsible for the
          availability or actions of third-party services.
        </p>
      </LegalSection>

      <LegalSection heading="8. Service Availability">
        <p>
          We aim to keep the platform available and reliable, but the service is provided on an
          &quot;as available&quot; basis. We may modify, suspend, or discontinue features, and
          maintenance or factors outside our control may affect availability.
        </p>
      </LegalSection>

      <LegalSection heading="9. Intellectual Property">
        <p>
          The Serapod2U platform, including its software, design, and branding, is owned by Serapod2U
          and protected by intellectual property laws. These terms do not grant you any rights in our
          intellectual property except the limited right to use the service as permitted. Data you
          submit remains yours.
        </p>
      </LegalSection>

      <LegalSection heading="10. Suspension and Termination">
        <p>
          We may suspend or terminate access to the platform if these terms are violated, if required
          by law, or to protect the security and integrity of the service. You may stop using the
          service at any time.
        </p>
      </LegalSection>

      <LegalSection heading="11. Disclaimer and Limitation of Liability">
        <p>
          To the maximum extent permitted by applicable law, the platform is provided without
          warranties of any kind, express or implied. To the extent permitted by law, Serapod2U shall
          not be liable for indirect, incidental, or consequential damages arising from your use of
          the service. Nothing in these terms limits liability that cannot be limited under applicable
          law.
        </p>
      </LegalSection>

      <LegalSection heading="12. Changes to These Terms">
        <p>
          We may update these Terms of Service from time to time. When we do, we will revise the
          &quot;Last updated&quot; date above. Continued use of the platform after changes take effect
          constitutes acceptance of the updated terms.
        </p>
      </LegalSection>

      <LegalSection heading="13. Governing Law">
        <p>
          These terms are intended to be governed by the laws of the jurisdiction in which Serapod2U
          operates. The specific governing-law jurisdiction is to be confirmed and will be stated here
          once finalized.
        </p>
      </LegalSection>

      <LegalSection heading="14. Contact Information">
        <p>
          For questions about these Terms of Service, contact us at{' '}
          <a className="text-blue-600 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
