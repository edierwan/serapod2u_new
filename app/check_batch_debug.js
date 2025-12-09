const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkBatch() {
  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_no')
    .eq('order_no', 'ORD-HM-1225-07')
    .single();

  if (!orders) {
    console.log('Order not found');
    return;
  }

  const { data: batch } = await supabase
    .from('qr_batches')
    .select('*')
    .eq('order_id', orders.id)
    .single();

  console.log('Batch:', batch);
}

checkBatch();
