import DatabaseSetup from '@/components/setup/DatabaseSetup'
import AuthDiagnostic from '@/components/setup/AuthDiagnostic'

export default function SetupPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 space-y-8">
      <AuthDiagnostic />
      <DatabaseSetup />
    </div>
  )
}