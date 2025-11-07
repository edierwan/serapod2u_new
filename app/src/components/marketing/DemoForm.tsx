'use client'

import { useState } from 'react'
import { Mail, Phone, Building2, User, MessageSquare, ArrowRight } from 'lucide-react'

export function DemoForm() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    message: ''
  })
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // TODO: Integrate with your backend API
    console.log('Demo request:', formData)
    setSubmitted(true)
    setTimeout(() => setSubmitted(false), 3000)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }))
  }

  return (
    <section id="demo" className="py-24 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Column - Info */}
          <div className="space-y-8">
            <h2 className="text-4xl md:text-5xl font-bold">
              Request a Personalized Demo
            </h2>
            <p className="text-xl text-blue-100 leading-relaxed">
              See how Serapod2u can transform your supply chain operations. Our team will walk you through:
            </p>

            <ul className="space-y-4">
              {[
                'QR code generation and batch management',
                'Real-time tracking and journey builder',
                'Multi-organization setup and permissions',
                'Analytics dashboard and reporting',
                'API integration and data migration'
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <ArrowRight className="h-6 w-6 text-blue-300 flex-shrink-0 mt-0.5" />
                  <span className="text-lg text-blue-50">{item}</span>
                </li>
              ))}
            </ul>

            <div className="pt-8 border-t border-white/20">
              <p className="text-sm text-blue-200 mb-4">Or contact us directly:</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Mail className="h-5 w-5 text-blue-300" />
                  <a href="mailto:info@serapod2u.com" className="hover:text-blue-200 transition-colors">
                    info@serapod2u.com
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-5 w-5 text-blue-300" />
                  <a href="tel:+60123456789" className="hover:text-blue-200 transition-colors">
                    +60 12-345 6789
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Form */}
          <div className="bg-white rounded-2xl p-8 shadow-2xl">
            {submitted ? (
              <div className="text-center py-12">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                  <ArrowRight className="h-8 w-8 text-green-600" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  Thank You!
                </h3>
                <p className="text-gray-600">
                  We'll get back to you within 24 hours.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                    Full Name *
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                      type="text"
                      id="name"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      required
                      className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                      placeholder="John Doe"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    Work Email *
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                      type="email"
                      id="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      required
                      className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                      placeholder="john@company.com"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="company" className="block text-sm font-medium text-gray-700 mb-2">
                    Company Name *
                  </label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                      type="text"
                      id="company"
                      name="company"
                      value={formData.company}
                      onChange={handleChange}
                      required
                      className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                      placeholder="Acme Corporation"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                      type="tel"
                      id="phone"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                      placeholder="+60 12-345 6789"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
                    Tell us about your needs
                  </label>
                  <div className="relative">
                    <MessageSquare className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                    <textarea
                      id="message"
                      name="message"
                      value={formData.message}
                      onChange={handleChange}
                      rows={4}
                      className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                      placeholder="Tell us about your supply chain challenges..."
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 rounded-lg transition-colors shadow-lg"
                >
                  Request Demo
                </button>

                <p className="text-xs text-gray-500 text-center">
                  By submitting this form, you agree to our Privacy Policy and Terms of Service
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
