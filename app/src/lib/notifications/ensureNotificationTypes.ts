import { createAdminClient } from '@/lib/supabase/admin'
import { REQUIRED_NOTIFICATION_TYPES } from '@/lib/notifications/notificationEventCatalog'

/** Upsert catalog rows so Notification Types UI always has the latest system events. */
export async function ensureNotificationTypes(): Promise<void> {
    try {
        const adminClient = createAdminClient()
        await (adminClient as any)
            .from('notification_types')
            .upsert([...REQUIRED_NOTIFICATION_TYPES], { onConflict: 'event_code' })
    } catch (error) {
        console.error('Failed to ensure notification types:', error)
    }
}
