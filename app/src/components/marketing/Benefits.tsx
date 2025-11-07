'use client'

import { CheckCircle2 } from 'lucide-react'

const benefits = [
  {
    category: 'For Manufacturers',
    items: [
      'Generate QR codes at scale (100K+ codes in minutes)',
      'Track products from production to end consumer',
      'Reduce counterfeiting with secure QR authentication',
      'Gather consumer insights and engagement data'
    ],
    gradient: 'from-blue-500 to-indigo-600'
  },
  {
    category: 'For Distributors',
    items: [
      'Manage inventory across multiple warehouses',
      'Scan-based intake and shipment tracking',
      'Real-time visibility of product movement',
      'Automated compliance and documentation'
    ],
    gradient: 'from-purple-500 to-pink-600'
  },
  {
    category: 'For Retail Partners',
    items: [
      'Verify product authenticity before shelving',
      'Track stock levels and reorder points',
      'Connect with consumers via QR scanning',
      'Access product journey and origin data'
    ],
    gradient: 'from-green-500 to-teal-600'
  }
]

export function Benefits() {
  return (
    <section className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Built for Every Role in Your Supply Chain
          </h2>
          <p className="text-xl text-gray-600">
            Tailored features for manufacturers, distributors, and retail partners
          </p>
        </div>

        {/* Benefits Grid */}
        <div className="grid md:grid-cols-3 gap-8">
          {benefits.map((benefit) => (
            <div
              key={benefit.category}
              className="relative rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 p-8 shadow-lg border border-gray-200 hover:shadow-xl transition-shadow"
            >
              {/* Gradient Header */}
              <div className={`absolute top-0 left-0 right-0 h-1.5 rounded-t-2xl bg-gradient-to-r ${benefit.gradient}`} />

              <h3 className="text-2xl font-bold text-gray-900 mb-6">
                {benefit.category}
              </h3>

              <ul className="space-y-4">
                {benefit.items.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="h-6 w-6 text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700 leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* CTA Section */}
        <div className="mt-20 text-center">
          <div className="inline-flex flex-col items-center gap-4 px-8 py-10 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200">
            <h3 className="text-2xl font-bold text-gray-900">
              Ready to Transform Your Supply Chain?
            </h3>
            <p className="text-gray-600 max-w-2xl">
              Join leading manufacturers and distributors using Serapod2u to track millions of products across Southeast Asia
            </p>
            <a
              href="#demo"
              className="inline-flex items-center justify-center px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-lg"
            >
              Schedule a Demo
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
