'use client'

import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, CheckCircle2, Package, Truck, BarChart3, Users } from 'lucide-react'

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white">
      <div className="absolute inset-0 bg-grid-white/[0.05] bg-[size:20px_20px]" />
      
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Column - Content */}
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-green-300" />
              <span>Trusted by manufacturers across Southeast Asia</span>
            </div>

            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight">
              Complete Supply Chain{' '}
              <span className="text-blue-200">Visibility</span>
            </h1>

            <p className="text-xl md:text-2xl text-blue-100 leading-relaxed">
              Track, trace, and optimize your entire supply chain from manufacturer to retail. 
              QR-powered journey builder with real-time insights.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-blue-700 font-semibold rounded-lg hover:bg-blue-50 transition-all shadow-xl hover:shadow-2xl transform hover:-translate-y-0.5"
              >
                Log in to Dashboard
                <ArrowRight className="h-5 w-5" />
              </Link>
              
              <Link
                href="#demo"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-transparent border-2 border-white text-white font-semibold rounded-lg hover:bg-white/10 transition-all"
              >
                Request Demo
              </Link>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-6 pt-8 border-t border-white/20">
              <div>
                <div className="text-3xl font-bold">100K+</div>
                <div className="text-sm text-blue-200">Products Tracked</div>
              </div>
              <div>
                <div className="text-3xl font-bold">50+</div>
                <div className="text-sm text-blue-200">Partners</div>
              </div>
              <div>
                <div className="text-3xl font-bold">99.9%</div>
                <div className="text-sm text-blue-200">Uptime</div>
              </div>
            </div>
          </div>

          {/* Right Column - Visual */}
          <div className="relative">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl border-4 border-white/20">
              <Image
                src="/images/features/SupplyChainStatusFlow.png"
                alt="Serapod2u Supply Chain Dashboard"
                width={800}
                height={600}
                className="w-full h-auto"
                priority
              />
            </div>
            
            {/* Floating Cards */}
            <div className="absolute -top-4 -left-4 bg-white text-blue-900 px-4 py-3 rounded-lg shadow-xl">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-blue-600" />
                <span className="font-semibold">Real-time Tracking</span>
              </div>
            </div>
            
            <div className="absolute -bottom-4 -right-4 bg-white text-blue-900 px-4 py-3 rounded-lg shadow-xl">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-green-600" />
                <span className="font-semibold">Analytics Dashboard</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Wave Separator */}
      <div className="absolute bottom-0 left-0 right-0">
        <svg className="w-full h-16 fill-current text-white" viewBox="0 0 1200 120" preserveAspectRatio="none">
          <path d="M321.39,56.44c58-10.79,114.16-30.13,172-41.86,82.39-16.72,168.19-17.73,250.45-.39C823.78,31,906.67,72,985.66,92.83c70.05,18.48,146.53,26.09,214.34,3V0H0V27.35A600.21,600.21,0,0,0,321.39,56.44Z" />
        </svg>
      </div>
    </section>
  )
}
