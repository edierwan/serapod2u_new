export type Channel = 'whatsapp' | 'sms' | 'email';
export type NotificationKey = 
    | 'order_approved' 
    | 'order_rejected'
    | 'order_submitted'
    | 'inventory_alert'
    | 'qr_verify'
    | 'user_activity'
    | 'generic'; // Fallback

export interface Template {
    id: string;
    name: string;
    description?: string;
    channel: Channel;
    subject?: string; // For email
    body: string;
}

export const notificationTemplates: Record<string, Template[]> = {
    'order_approved': [
        {
            id: 'oa_wa_1',
            name: 'Standard Approval',
            channel: 'whatsapp',
            body: `Hello {{customer_name}}, your order #{{order_no}} has been *APPROVED* by {{approved_by}}.\n\nAmount: RM {{amount}}\nStatus: {{status}}`
        },
        {
            id: 'oa_email_1',
            name: 'Official Approval',
            channel: 'email',
            subject: 'Order #{{order_no}} Approved',
            body: `Dear {{customer_name}},\n\nWe are pleased to inform you that your order #{{order_no}} has been approved.\n\nTotal Amount: RM {{amount}}\n\nYou can view your order here: {{order_url}}`
        },
        {
            id: 'oa_sms_1',
            name: 'Short Alert',
            channel: 'sms',
            body: `Order {{order_no}} is APPROVED. Total: RM {{amount}}. Status: {{status}}.`
        }
    ],
    'order_rejected': [
        {
            id: 'or_wa_1',
            name: 'Rejection Notice',
            channel: 'whatsapp',
            body: `Hi {{customer_name}}, sadly your order #{{order_no}} was rejected.\nReason: {{reason}}\n\nPlease contact support if you have questions.`
        },
        {
            id: 'or_email_1',
            name: 'Order Rejection',
            channel: 'email',
            subject: 'Update on Order #{{order_no}}',
            body: `Dear {{customer_name}},\n\nYour order #{{order_no}} has been rejected.\nReason: {{reason}}\n\nAmount refunded: {{amount}}`
        }
    ],
    // Fallback/Generic templates if code doesn't match
    'generic': [
        {
            id: 'gen_wa_1',
            name: 'Simple Message',
            channel: 'whatsapp',
            body: `Update: {{event_name}} has occurred.\nReference: {{reference_id}}`
        }
    ]
};

export const getTemplatesForEvent = (eventCode: string, channel: string): Template[] => {
    // Try exact match first, then fallbacks or empty
    const templates = notificationTemplates[eventCode] || notificationTemplates['generic'] || [];
    return templates.filter(t => t.channel === channel);
};
