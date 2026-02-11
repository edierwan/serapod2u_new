// Reset failed outbox items for re-processing
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const c = createClient(url, key);

async function main() {
    // Reset failed items to queued
    const { data, error } = await c
        .from('notifications_outbox')
        .update({ status: 'queued', retry_count: 0, error: null })
        .eq('status', 'failed')
        .eq('event_code', 'order_submitted')
        .select('id, event_code, channel, status');

    console.log('Reset items:', JSON.stringify(data, null, 2));
    if (error) console.error('Error:', error.message);

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
