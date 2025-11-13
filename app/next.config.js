/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Temporarily ignore TypeScript errors during build
  // Types are generated and available for editor autocomplete
  typescript: {
    ignoreBuildErrors: true,
  },

  // Set output file tracing root for both local dev and Vercel deployment
  // This tells Next.js where the project root is for proper dependency tracing
  // Works in both environments: __dirname points to /app locally and on Vercel
  outputFileTracingRoot: __dirname,

  // Turbopack configuration - must match outputFileTracingRoot
  // This prevents the warning: "Both outputFileTracingRoot and turbopack.root are set"
  turbopack: {
    root: __dirname,
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
        hostname: 'hsvmvmurvpqcdmxckhnz.supabase.co',
      },
    ],
  },

  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },

  // Exclude problematic packages from being bundled as external modules
  // This prevents Turbopack warnings about fstream/rimraf (legacy dependencies from exceljs)
  serverExternalPackages: [
    'archiver',
    'exceljs',
    'pdfkit',
    'googleapis',
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