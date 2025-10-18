'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { diagnoseAuthIssues } from '@/lib/utils/authDiagnostic'

/**
 * Component for debugging auth in React
 */
export function AuthDiagnosticComponent() {
  const [diagnosticRun, setDiagnosticRun] = useState(false)
  const [authState, setAuthState] = useState<any>(null)
  const supabase = createClient()

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setAuthState({
        isAuthenticated: !!user,
        user: user?.email || null,
        userId: user?.id || null
      })
    }
    checkAuth()
  }, [])

  const runDiagnostic = async () => {
    setDiagnosticRun(true)
    await diagnoseAuthIssues()
    setDiagnosticRun(false)
  }

  return (
    <div className="p-4 bg-gray-100 rounded-lg border border-gray-300">
      <h3 className="font-bold mb-4">Authentication Diagnostic</h3>
      <div className="mb-4 p-3 bg-white rounded border">
        <p className="text-sm">
          <strong>Auth Status:</strong> {authState?.isAuthenticated ? '✓ Authenticated' : '❌ Not Authenticated'}
        </p>
        {authState?.user && <p className="text-sm"><strong>User:</strong> {authState.user}</p>}
        {authState?.userId && <p className="text-sm"><strong>UID:</strong> {authState.userId}</p>}
      </div>
      <button
        onClick={runDiagnostic}
        disabled={diagnosticRun}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {diagnosticRun ? 'Running diagnostic...' : 'Run Diagnostic'}
      </button>
      <p className="text-xs text-gray-600 mt-2">Check browser console for detailed output</p>
    </div>
  )
}
