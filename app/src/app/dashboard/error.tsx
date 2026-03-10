'use client'

import { useEffect } from 'react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Dashboard Error Boundary]', error)
  }, [error])

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="max-w-md w-full mx-4 p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-xl font-bold text-red-600 mb-2">Dashboard Error</h2>
        <p className="text-gray-700 mb-1">Something went wrong loading the dashboard.</p>
        <pre className="text-xs text-gray-500 bg-gray-100 p-3 rounded mb-4 overflow-auto max-h-40 whitespace-pre-wrap">
          {error.message}
          {error.digest ? `\nDigest: ${error.digest}` : ''}
          {error.stack ? `\n\n${error.stack}` : ''}
        </pre>
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            Try Again
          </button>
          <a
            href="/login"
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
          >
            Back to Login
          </a>
        </div>
      </div>
    </div>
  )
}
