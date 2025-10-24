import DatabaseSetup from '@/components/setup/DatabaseSetup'
import AuthDiagnostic from '@/components/setup/AuthDiagnostic'

// Force dynamic rendering to prevent static generation during build
// This page requires Supabase client which needs runtime environment variables
export const dynamic = 'force-dynamic'

export default function SetupPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 space-y-8">
      <AuthDiagnostic />
      <DatabaseSetup />
    </div>
  )
}