'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

export default function DatabaseSetup() {
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Array<{step: string, success: boolean, message: string}>>([])
  const supabase = createClient()
  const supabaseAdmin = createAdminClient()

  const runSetup = async () => {
    setLoading(true)
    setResults([])
    const steps: Array<{step: string, success: boolean, message: string}> = []

    try {
      // Step 1: Create organization types first (using admin client)
      console.log('Creating organization types...')
      const { error: orgTypeError } = await supabaseAdmin
        .from('organization_types')
        .upsert({
          type_code: 'HQ',
          type_name: 'Headquarters',
          type_description: 'Corporate headquarters and main office',
          hierarchy_level: 1,
          is_active: true
        } as any)

      if (orgTypeError) {
        steps.push({step: 'Create organization types', success: false, message: orgTypeError.message})
      } else {
        steps.push({step: 'Create organization types', success: true, message: 'Organization type created successfully'})
      }

      // Step 2: Create SERA organization if not exists (using admin client)
      console.log('Creating SERA organization...')
      const { error: orgError } = await supabaseAdmin
        .from('organizations')
        .upsert({
          id: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
          org_code: 'SERA',
          org_name: 'Sera Pod Headquarters',
          org_type_code: 'HQ',
          address: 'Kuala Lumpur',
          city: 'Kuala Lumpur',
          postal_code: '50000',
          country_code: 'MY',
          contact_phone: '+60-3-12345678',
          contact_email: 'admin@serapod.com',
          website: 'https://serapod.com',
          is_active: true
        } as any)

      if (orgError) {
        steps.push({step: 'Create SERA organization', success: false, message: orgError.message})
      } else {
        steps.push({step: 'Create SERA organization', success: true, message: 'Organization created successfully'})
      }

      // Step 3: Create SUPERADMIN role if not exists (using admin client)
      console.log('Creating SUPERADMIN role...')
      const { error: roleError } = await supabaseAdmin
        .from('roles')
        .upsert({
          role_code: 'SUPERADMIN',
          role_name: 'Super Administrator',
          role_level: 1,
          role_description: 'Full system access with all permissions',
          permissions: {all: true},
          is_active: true
        } as any)

      if (roleError) {
        steps.push({step: 'Create SUPERADMIN role', success: false, message: roleError.message})
      } else {
        steps.push({step: 'Create SUPERADMIN role', success: true, message: 'Role created successfully'})
      }

      // Step 4: Create super admin user (using admin client)
      console.log('Creating super admin user...')
      const { error: userError } = await supabaseAdmin
        .from('users')
        .upsert({
          id: '1bd978bb-4f56-4d02-b4e0-48220413e242',
          email: 'super@dev.com',
          full_name: 'Super Administrator',
          phone: '+60-12-3456789',
          role_code: 'SUPERADMIN',
          organization_id: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
          is_active: true,
          is_verified: true
        } as any)

      if (userError) {
        steps.push({step: 'Create super admin user', success: false, message: userError.message})
      } else {
        steps.push({step: 'Create super admin user', success: true, message: 'Super admin user created successfully'})
      }

      // Step 5: Verify user creation (using regular client)
      console.log('Verifying user...')
      const { data: userData, error: verifyError } = await supabase
        .rpc('get_user_by_email', { p_email: 'super@dev.com' })

      if (verifyError) {
        steps.push({step: 'Verify user creation', success: false, message: verifyError.message})
      } else if (!userData || userData.length === 0) {
        steps.push({step: 'Verify user creation', success: false, message: 'User verification failed - no user found'})
      } else {
        const user = Array.isArray(userData) ? userData[0] : userData
        steps.push({step: 'Verify user creation', success: true, message: `User verified: ${user.full_name || user.email}`})
      }

      setResults(steps)

    } catch (error) {
      console.error('Setup error:', error)
      steps.push({step: 'Database setup', success: false, message: `Unexpected error: ${error}`})
      setResults(steps)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Database Setup</CardTitle>
          <CardDescription>
            Set up the database with necessary data and create the super admin user
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            onClick={runSetup} 
            disabled={loading}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running Setup...
              </>
            ) : (
              'Run Database Setup'
            )}
          </Button>

          {results.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold">Setup Results:</h3>
              {results.map((result, index) => (
                <div key={index} className={`p-3 rounded-lg border ${result.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                  <div className="flex items-center gap-2">
                    {result.success ? (
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-600" />
                    )}
                    <span className={result.success ? 'text-green-800' : 'text-red-800'}>
                      <strong>{result.step}:</strong> {result.message}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.length > 0 && results.every(r => r.success) && (
            <div className="p-4 rounded-lg border border-green-200 bg-green-50">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-green-800">
                  <strong>Setup completed successfully!</strong> You can now login with super@dev.com
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}