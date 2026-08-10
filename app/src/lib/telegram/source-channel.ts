/** Messaging order intake channels (orders.source_channel). */
export const MESSAGING_ORDER_SOURCE_CHANNELS = ['telegram', 'whatsapp'] as const
export type MessagingOrderSourceChannel = (typeof MESSAGING_ORDER_SOURCE_CHANNELS)[number]

export const TELEGRAM_ORDER_SOURCE_CHANNEL: MessagingOrderSourceChannel = 'telegram'
