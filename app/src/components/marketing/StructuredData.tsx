export function StructuredData() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Serapod2u Supply Chain Management',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD'
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      ratingCount: '50'
    },
    description: 'Complete supply chain management platform for tracking products from manufacturer to retail with QR code technology.',
    featureList: [
      'QR Code Generation and Management',
      'Real-time Product Tracking',
      'Journey Builder',
      'Multi-Organization Support',
      'Analytics and Reporting',
      'Inventory Management'
    ],
    screenshot: 'https://serapod2u.com/images/features/SupplyChainStatusFlow.png'
  }

  const organizationData = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Serapod2u',
    url: 'https://serapod2u.com',
    logo: 'https://serapod2u.com/images/logo.png',
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: '+60-12-345-6789',
      contactType: 'Sales',
      email: 'info@serapod2u.com',
      areaServed: 'MY',
      availableLanguage: ['English', 'Malay']
    },
    sameAs: [
      'https://www.linkedin.com/company/serapod2u',
      'https://twitter.com/serapod2u',
      'https://www.facebook.com/serapod2u'
    ]
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationData) }}
      />
    </>
  )
}
