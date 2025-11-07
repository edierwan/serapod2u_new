'use client'

import Image from 'next/image'
import { Package, Truck, BarChart3, Users, QrCode, FileText } from 'lucide-react'

const features = [
  {
    title: 'QR Code Management',
    description: 'Generate and manage QR codes at scale for product tracking. Support for master codes (cases) and individual product codes with automatic journey creation.',
    icon: QrCode,
    image: '/images/features/Product Catalog.png',
    color: 'from-blue-500 to-blue-600'
  },
  {
    title: 'Journey Builder',
    description: 'Design custom product journeys with interactive touchpoints. Track consumer engagement, location data, and build powerful marketing campaigns.',
    icon: Package,
    image: '/images/features/Journey Builder.png',
    color: 'from-purple-500 to-purple-600'
  },
  {
    title: 'Supply Chain Status Flow',
    description: 'Real-time visibility across your entire supply chain. Track products from manufacturer → warehouse → distributor → retail with automated status updates.',
    icon: Truck,
    image: '/images/features/SupplyChainStatusFlow.png',
    color: 'from-green-500 to-green-600'
  },
  {
    title: 'User Management',
    description: 'Multi-organization support with role-based access control. Manage manufacturers, distributors, warehouses, and retail partners from a single platform.',
    icon: Users,
    image: '/images/features/User Management.png',
    color: 'from-orange-500 to-orange-600'
  },
  {
    title: 'Data Migration & Import',
    description: 'Seamlessly import existing product catalogs, customer lists, and inventory data. Support for CSV, Excel, and API integrations with validation and error handling.',
    icon: FileText,
    image: '/images/features/Data Migration.png',
    color: 'from-indigo-500 to-indigo-600'
  },
  {
    title: 'Analytics & Reporting',
    description: 'Comprehensive dashboards with real-time metrics. Track scan rates, geographic distribution, product performance, and supply chain efficiency.',
    icon: BarChart3,
    image: '/images/features/SupplyChainStatusFlow.png',
    color: 'from-pink-500 to-pink-600'
  }
]

export function Features() {
  return (
    <section className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Everything You Need to Manage Your Supply Chain
          </h2>
          <p className="text-xl text-gray-600">
            Powerful features designed for manufacturers, distributors, and retail businesses
          </p>
        </div>

        {/* Features Grid */}
        <div className="space-y-24">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className={`grid lg:grid-cols-2 gap-12 items-center ${
                index % 2 === 1 ? 'lg:flex-row-reverse' : ''
              }`}
            >
              {/* Content */}
              <div className={`space-y-6 ${index % 2 === 1 ? 'lg:order-2' : ''}`}>
                <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br ${feature.color} text-white`}>
                  <feature.icon className="h-8 w-8" />
                </div>

                <h3 className="text-3xl font-bold text-gray-900">
                  {feature.title}
                </h3>

                <p className="text-lg text-gray-600 leading-relaxed">
                  {feature.description}
                </p>

                <div className="flex flex-wrap gap-2">
                  {getFeatureTags(feature.title).map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 bg-white border border-gray-200 text-sm font-medium text-gray-700 rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Image */}
              <div className={index % 2 === 1 ? 'lg:order-1' : ''}>
                <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-gray-200 bg-white p-2">
                  <Image
                    src={feature.image}
                    alt={feature.title}
                    width={800}
                    height={600}
                    className="w-full h-auto rounded-lg"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function getFeatureTags(title: string): string[] {
  const tags: Record<string, string[]> = {
    'QR Code Management': ['Batch Generation', 'Master Codes', 'Individual Codes'],
    'Journey Builder': ['Interactive Touchpoints', 'Location Tracking', 'Marketing Tools'],
    'Supply Chain Status Flow': ['Real-time Updates', 'Multi-stage Tracking', 'Automated Alerts'],
    'User Management': ['Multi-org', 'Role-based Access', 'Team Collaboration'],
    'Data Migration & Import': ['CSV/Excel Import', 'API Integration', 'Bulk Operations'],
    'Analytics & Reporting': ['Real-time Metrics', 'Custom Reports', 'Export Data']
  }
  return tags[title] || []
}
