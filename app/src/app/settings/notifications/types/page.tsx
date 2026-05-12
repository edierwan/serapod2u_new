import DashboardContent from '@/components/dashboard/DashboardContent'
import { getSettingsPageContext } from '@/app/settings/_lib'
import { createAdminClient } from '@/lib/supabase/admin'

async function ensureNotificationTypes() {
    try {
        const adminClient = createAdminClient()
        await (adminClient as any)
            .from('notification_types')
            .upsert([
                {
                    category: 'user',
                    event_code: 'user_created_shop',
                    event_name: 'User Create New Shop',
                    event_description: 'Sent when a user successfully creates a new shop from the QR profile flow.',
                    default_enabled: false,
                    available_channels: ['whatsapp', 'sms', 'email'],
                    is_system: false,
                    sort_order: 15,
                },
                {
                    category: 'order',
                    event_code: 'qr_batch_generated',
                    event_name: 'QR Batch Generated',
                    event_description: 'Sent when all QR codes for an order batch have been generated and the Excel file is ready.',
                    default_enabled: false,
                    available_channels: ['whatsapp', 'sms', 'email'],
                    is_system: false,
                    sort_order: 60,
                },
                {
                    category: 'order',
                    event_code: 'manufacturer_scan_complete',
                    event_name: 'Manufacture Completed His Order',
                    event_description: 'Sent when the manufacturer completes the production process and the batch is ready for shipment.',
                    default_enabled: false,
                    available_channels: ['whatsapp', 'sms', 'email'],
                    is_system: false,
                    sort_order: 65,
                },
                {
                    category: 'order',
                    event_code: 'warehouse_received',
                    event_name: 'Warehouse Receive Order',
                    event_description: 'Sent when warehouse receiving is complete and inventory has been updated.',
                    default_enabled: false,
                    available_channels: ['whatsapp', 'sms', 'email'],
                    is_system: false,
                    sort_order: 70,
                }
            ], { onConflict: 'event_code' })
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
