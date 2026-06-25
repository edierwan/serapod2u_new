import type { Metadata } from 'next'
import { LegalPageLayout, LegalSection, SUPPORT_EMAIL } from '@/components/legal/LegalPageLayout'

const LAST_UPDATED = '25 June 2026'

export const metadata: Metadata = {
  title: 'Data Deletion Instructions | Serapod2U',
  description: 'How to request deletion of personal data associated with Serapod2U.',
}

export default function DataDeletionPage() {
  return (
    <LegalPageLayout
      title="Data Deletion Instructions"
      lastUpdated={LAST_UPDATED}
      intro="This page explains how to request deletion of personal data associated with your Serapod2U account. It is an instruction page for submitting a request to us."
    >
      <LegalSection heading="1. Your Right to Request Deletion">
        <p>
          You may request the deletion of personal data associated with your Serapod2U account.
          Because this involves verifying your identity and reviewing related records, deletion is
          handled as a manual request rather than an automatic, instant process.
        </p>
      </LegalSection>

      <LegalSection heading="2. How to Submit a Request">
        <p>
          Send a data-deletion request by email to{' '}
          <a className="text-blue-600 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>{' '}
          using the subject line &quot;Data Deletion Request&quot;.
        </p>
      </LegalSection>

      <LegalSection heading="3. Information to Include">
        <p>To help us locate your account and process your request, please provide:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your registered name.</li>
          <li>Your registered phone number or email address.</li>
          <li>Your organization or shop name, where applicable.</li>
          <li>A clear statement that you wish to delete your account and/or personal data.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. Identity Verification">
        <p>
          To protect your account, we will take reasonable steps to verify your identity before
          acting on a deletion request. We may contact you using the registered email or phone number
          on file, or ask for additional information to confirm that the request is genuinely yours.
        </p>
      </LegalSection>

      <LegalSection heading="5. Data That May Be Deleted or Anonymized">
        <p>
          Once verified, we will delete or anonymize personal data associated with your account, which
          may include your name, contact details (phone number and email), profile information, and
          related personal identifiers held in the platform.
        </p>
      </LegalSection>

      <LegalSection heading="6. Data That May Be Retained">
        <p>
          Some records may need to be retained where required for legal, tax, accounting, security, or
          legitimate business purposes—for example, transaction and order records. Where such records
          must be kept, we will limit them to what is required and remove or anonymize personal
          identifiers where possible.
        </p>
      </LegalSection>

      <LegalSection heading="7. Processing Timeframe">
        <p>
          We aim to acknowledge and process verified deletion requests within a reasonable period
          after we confirm your identity. The exact timeframe may vary depending on the nature of the
          request and any legal retention requirements that apply.
        </p>
      </LegalSection>

      <LegalSection heading="8. Confirmation">
        <p>
          After your request has been processed, we will confirm completion using the contact details
          we have verified for you.
        </p>
      </LegalSection>

      <LegalSection heading="9. Important Security Notice">
        <p className="font-medium text-gray-900">
          Do not include passwords, one-time passcodes (OTPs), or access tokens in your request.
        </p>
        <p>
          Serapod2U will never ask you to send your password, OTP, or access tokens by email to
          process a deletion request. Sharing these can put your account at risk.
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
