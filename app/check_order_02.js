const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkOrder02() {
  const orderId = '43e5f22c-851a-4f89-b545-29c4ba264429';
  console.log(`Checking Order ID: ${orderId}`);
  
  const { data: order } = await supabase
    .from('orders')
    .select(`
      id, 
      order_no, 
      order_type, 
      status,
      buyer_org_id,
      seller_org_id
    `)
    .eq('id', orderId)
    .single();
    
  if (order) {
      console.log('Order Found:', order);
  } else {
      console.log('Order NOT found by ID');
  }
}

checkOrder02();
