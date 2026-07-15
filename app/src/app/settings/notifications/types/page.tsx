import DashboardContent from '@/components/dashboard/DashboardContent'
import { getSettingsPageContext } from '@/app/settings/_lib'
import { createAdminClient } from '@/lib/supabase/admin'
import { REQUIRED_NOTIFICATION_TYPES } from '@/lib/notifications/notificationEventCatalog'

async function ensureNotificationTypes() {
    try {
        const adminClient = createAdminClient()
        await (adminClient as any)
            .from('notification_types')
            .upsert([...REQUIRED_NOTIFICATION_TYPES], { onConflict: 'event_code' })
    } catch (error) {
        console.error('Failed to ensure notification types:', error)
    }
}

export default async function SettingsNotificationTypesPage() {
    await ensureNotificationTypes()
    const { userProfile, canViewSettings } = await getSettingsPageContext()
    if (!canViewSettings) return <div className="p-8"><h2 className="text-xl font-semibold">Unauthorized</h2></div>
    return <DashboardContent userProfile={userProfile} initialView="settings/notifications/types" />
}
