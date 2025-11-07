'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState, useEffect } from 'react'
import { Menu, X } from 'lucide-react'

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? 'bg-white/95 backdrop-blur-sm shadow-md'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/images/logo.png"
              alt="Serapod2u Logo"
              width={32}
              height={32}
              className="w-8 h-8"
            />
            <span
              className={`text-xl font-bold transition-colors ${
                isScrolled ? 'text-gray-900' : 'text-white'
              }`}
            >
              Serapod2u
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            <Link
              href="#features"
              className={`font-medium transition-colors hover:text-blue-600 ${
                isScrolled ? 'text-gray-700' : 'text-white hover:text-blue-200'
              }`}
            >
              Features
            </Link>
            <Link
              href="#benefits"
              className={`font-medium transition-colors hover:text-blue-600 ${
                isScrolled ? 'text-gray-700' : 'text-white hover:text-blue-200'
              }`}
            >
              Solutions
            </Link>
            <Link
              href="#demo"
              className={`font-medium transition-colors hover:text-blue-600 ${
                isScrolled ? 'text-gray-700' : 'text-white hover:text-blue-200'
              }`}
            >
              Request Demo
            </Link>

            {/* CTA Buttons */}
            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className={`px-4 py-2 font-medium rounded-lg transition-colors ${
                  isScrolled
                    ? 'text-gray-700 hover:bg-gray-100'
                    : 'text-white hover:bg-white/10'
                }`}
              >
                Log In
              </Link>
              <Link
                href="#demo"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                Get Started
              </Link>
            </div>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className={`md:hidden p-2 rounded-lg transition-colors ${
              isScrolled
                ? 'text-gray-700 hover:bg-gray-100'
                : 'text-white hover:bg-white/10'
            }`}
          >
            {isMobileMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-white border-t border-gray-200 shadow-lg">
          <div className="px-4 py-6 space-y-4">
            <Link
              href="#features"
              onClick={() => setIsMobileMenuOpen(false)}
              className="block py-2 text-gray-700 hover:text-blue-600 font-medium"
            >
              Features
            </Link>
            <Link
              href="#benefits"
              onClick={() => setIsMobileMenuOpen(false)}
              className="block py-2 text-gray-700 hover:text-blue-600 font-medium"
            >
              Solutions
            </Link>
            <Link
              href="#demo"
              onClick={() => setIsMobileMenuOpen(false)}
              className="block py-2 text-gray-700 hover:text-blue-600 font-medium"
            >
              Request Demo
            </Link>
            <div className="pt-4 border-t border-gray-200 space-y-3">
              <Link
                href="/login"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block py-2 text-center border border-blue-600 text-blue-600 font-medium rounded-lg hover:bg-blue-50"
              >
                Log In
              </Link>
              <Link
                href="#demo"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block py-2 text-center bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
