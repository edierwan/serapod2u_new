import DashboardContent from '@/components/dashboard/DashboardContent'
import { getSettingsPageContext } from '@/app/settings/_lib'
import { createAdminClient } from '@/lib/supabase/admin'

async function ensureUserCreatedShopNotificationType() {
    try {
        const adminClient = createAdminClient()
        await (adminClient as any)
            .from('notification_types')
            .upsert({
                category: 'user',
                event_code: 'user_created_shop',
                event_name: 'User Create New Shop',
                event_description: 'Sent when a user successfully creates a new shop from the QR profile flow.',
                default_enabled: false,
                available_channels: ['whatsapp', 'sms', 'email'],
                is_system: false,
                sort_order: 15,
            }, { onConflict: 'event_code' })
    } catch (error) {
        console.error('Failed to ensure user_created_shop notification type:', error)
    }
}

export default async function SettingsNotificationTypesPage() {
    await ensureUserCreatedShopNotificationType()
    const { userProfile, canViewSettings } = await getSettingsPageContext()
    if (!canViewSettings) return <div className="p-8"><h2 className="text-xl font-semibold">Unauthorized</h2></div>
    return <DashboardContent userProfile={userProfile} initialView="settings/notifications/types" />
}
