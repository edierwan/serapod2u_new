import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import JourneyBuilderV2 from '@/components/journey/JourneyBuilderV2'

export const metadata = {
    title: 'Journey Builder | Consumer Engagement',
    description: 'Create consumer journey experiences for QR code scans',
}

export default async function JourneyBuilderPage() {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    // Get user profile with organization
    const { data: profile } = await supabase
        .from('users')
        .select(`
      id,
      full_name,
      email,
      role_level,
      organization_id,
      organizations!fk_users_organization (
        id,
        org_name,
        org_type_code
      )
    `)
        .eq('id', user.id)
        .single()

    if (!profile || profile.role_level > 30) {
        redirect('/dashboard')
    }

    return (
        <div className="container mx-auto py-6 px-4">
            <JourneyBuilderV2 userProfile={profile as any} />
        </div>
    )
}
