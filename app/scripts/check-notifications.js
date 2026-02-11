// Quick diagnostic: Check notification outbox and settings
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
    console.error('Missing env vars. Source .env.local first.');
    process.exit(1);
}

const c = createClient(url, key);

async function main() {
    // Check outbox
    const { data: outbox, error: e1 } = await c
        .from('notifications_outbox')
        .select('id, event_code, channel, status, to_phone, error, retry_count')
        .order('created_at', { ascending: false })
        .limit(10);
    console.log('=== OUTBOX (last 10) ===');
    if (e1) console.error('Error:', e1.message);
    else console.log(JSON.stringify(outbox, null, 2));

    // Check notification_settings for order_submitted
    const { data: settings, error: e2 } = await c
        .from('notification_settings')
        .select('*')
        .eq('event_code', 'order_submitted');
    console.log('\n=== SETTINGS (order_submitted) ===');
    if (e2) console.error('Error:', e2.message);
    else console.log(JSON.stringify(settings, null, 2));

    // Check logs
    const { data: logs, error: e3 } = await c
        .from('notification_logs')
        .select('id, event_code, channel, status, error_message, recipient_value, created_at')
        .order('created_at', { ascending: false })
        .limit(10);
    console.log('\n=== LOGS (last 10) ===');
    if (e3) console.error('Error:', e3.message);
    else console.log(JSON.stringify(logs, null, 2));

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
