'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-white text-slate-900 border-b border-slate-100">
      {/* Subtle background pattern - Enterprise-grade minimalism */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
      
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-32 md:py-48 text-center">
        <div className="space-y-10">
          {/* Removed: "Trusted by" badge (Marketing hype) */}

          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-slate-900">
            Complete Supply Chain{' '}
            <span className="text-blue-600">Visibility</span>
          </h1>

          <p className="max-w-2xl mx-auto text-xl md:text-2xl text-slate-600 leading-relaxed">
            Track, trace, and optimize your entire supply chain from manufacturer to retail. 
            QR-powered journey builder with real-time insights.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 transition-colors shadow-sm"
            >
              Log in to Dashboard
              <ArrowRight className="h-5 w-5" />
            </Link>
            
            <Link
              href="#demo"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white border border-slate-200 text-slate-700 font-semibold rounded-md hover:bg-slate-50 transition-colors"
            >
              Request Demo
            </Link>
          </div>

          {/* Removed: Quick Stats (Fake metrics/Social proof) */}
          {/* Removed: Right Column Visuals (Decorative elements) */}
        </div>
      </div>

      {/* Removed: Wave Separator (Marketing decorative element) */}
    </section>
  )
}
