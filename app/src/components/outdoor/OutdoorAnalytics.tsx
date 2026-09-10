import Script from 'next/script'

/**
 * Loads GA4 only when NEXT_PUBLIC_OUTDOOR_GA_ID is set.
 * Search Console verification uses meta tag via layout metadata when
 * NEXT_PUBLIC_OUTDOOR_GSC_VERIFICATION is set.
 */
export default function OutdoorAnalytics() {
  const gaId = String(process.env.NEXT_PUBLIC_OUTDOOR_GA_ID || '').trim()
  if (!gaId) return null

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
      <Script id="outdoor-ga4" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}');
        `}
      </Script>
    </>
  )
}
