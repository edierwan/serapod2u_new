import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AllActivitiesView from '@/components/dashboard/AllActivitiesView'

export default async function ActivitiesPage() {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    // Get user profile
    const { data: profile } = await supabase
        .from('users')
        .select(`
      id,
      full_name,
      email,
      organization_id,
      organizations!fk_users_organization (
        id,
        org_name,
        org_type_code
      )
    `)
        .eq('id', user.id)
        .single()

    if (!profile) {
        redirect('/login')
    }

    return (
        <div className="container mx-auto py-6 px-4">
            <AllActivitiesView userProfile={profile as any} />
        </div>
    )
}
