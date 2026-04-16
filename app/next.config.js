const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Standalone output for optimized Docker/self-hosted deployments
  output: 'standalone',

  // Temporarily ignore TypeScript errors during build
  // Types are generated and available for editor autocomplete
  typescript: {
    ignoreBuildErrors: true,
  },

  // Set output file tracing root for dependency tracing in production builds
  outputFileTracingRoot: path.join(__dirname, '..'),

  // Turbopack configuration - must match outputFileTracingRoot
  // This prevents the warning: "Both outputFileTracingRoot and turbopack.root are set"
  turbopack: {
    root: path.join(__dirname, '..'),
  },

  allowedDevOrigins: ['192.168.1.5', 'localhost'],

  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cbqsuzctjotbhxanazhf.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'hsvmvmurvpqcdmxckhnz.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'bamybvzufxijghzqdytu.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'jqihlckqrhdxszgwuymu.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'serapod2u.com',
      },
      {
        protocol: 'https',
        hostname: 'www.serapod2u.com',
      },
      {
        protocol: 'https',
        hostname: 'dev.serapod2u.com',
      },
      {
        protocol: 'https',
        hostname: 'www.dev.serapod2u.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'sb-stg-serapod.getouch.co',
      },
    ],
  },

  compiler: {
    // Keep console logs in staging for debugging
    removeConsole: process.env.NODE_ENV === 'production' && process.env.REMOVE_CONSOLE === 'true',
  },

  // Exclude problematic packages from being bundled as external modules
  // This prevents Turbopack warnings about fstream/rimraf (legacy dependencies from exceljs)
  serverExternalPackages: [
    'archiver',
    'exceljs',
    'pdfkit',
    'googleapis',
    'qrcode',
  ],

  experimental: {
    optimizeCss: true,
  },

  async headers() {
    return [
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/manifest+json',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/icons/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig