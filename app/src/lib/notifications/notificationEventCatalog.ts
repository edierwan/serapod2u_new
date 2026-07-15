import { STOCK_COUNT_EVENT_CODE } from '@/lib/inventory/stock-count-verification-errors'

export const REQUIRED_NOTIFICATION_TYPES = [
    {
        category: 'user', event_code: 'user_created_shop', event_name: 'User Create New Shop',
        event_description: 'Sent when a user successfully creates a new shop from the QR profile flow.',
        default_enabled: false, available_channels: ['whatsapp', 'sms', 'email'], is_system: false, sort_order: 15,
    },
    {
        category: 'order', event_code: 'qr_batch_generated', event_name: 'QR Batch Generated',
        event_description: 'Sent when all QR codes for an order batch have been generated and the Excel file is ready.',
        default_enabled: false, available_channels: ['whatsapp', 'sms', 'email'], is_system: false, sort_order: 60,
    },
    {
        category: 'order', event_code: 'manufacturer_scan_complete', event_name: 'Manufacture Completed His Order',
        event_description: 'Sent when the manufacturer completes the production process and the batch is ready for shipment.',
        default_enabled: false, available_channels: ['whatsapp', 'sms', 'email'], is_system: false, sort_order: 65,
    },
    {
        category: 'order', event_code: 'warehouse_received', event_name: 'Warehouse Receive Order',
        event_description: 'Sent when warehouse receiving is complete and inventory has been updated.',
        default_enabled: false, available_channels: ['whatsapp', 'sms', 'email'], is_system: false, sort_order: 70,
    },
    {
        category: 'inventory', event_code: STOCK_COUNT_EVENT_CODE, event_name: 'Stock Count Posting Verification',
        event_description: 'Sends a security code to authorized recipients before inventory adjustments can be posted.',
        default_enabled: false, available_channels: ['email'], is_system: true, sort_order: 40,
    },
] as const

export const STOCK_COUNT_NOTIFICATION_TYPE = REQUIRED_NOTIFICATION_TYPES.find((type) => type.event_code === STOCK_COUNT_EVENT_CODE)!
