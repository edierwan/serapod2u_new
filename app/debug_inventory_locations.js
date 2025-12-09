const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugInventory() {
  console.log('--- Debugging Organizations ---');
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, org_name, org_type_code, parent_org_id');
    
  const orgMap = {};
  orgs.forEach(o => {
    orgMap[o.id] = o;
    console.log(`${o.org_name} (${o.org_type_code}) - ID: ${o.id} - Parent: ${o.parent_org_id}`);
  });

  console.log('\n--- Debugging Inventory for Cellera Hero ---');
  // Fetch inventory for one of the variants seen in screenshot
  // I'll search by product name if possible, or just list all inventory for these orgs
  
  const { data: inventory } = await supabase
    .from('product_inventory')
    .select(`
      id, 
      organization_id, 
      quantity_on_hand, 
      quantity_allocated, 
      variant_id,
      product_variants (
        variant_name,
        products (product_name)
      )
    `)
    .gt('quantity_on_hand', 0)
    .order('quantity_on_hand', { ascending: false });

  inventory.forEach(inv => {
    const org = orgMap[inv.organization_id];
    const variant = inv.product_variants;
    const product = variant?.products;
    const name = `${product?.product_name} [${variant?.variant_name}]`;
    
    if (name.includes('Cellera Hero')) {
        console.log(`Org: ${org?.org_name} (${org?.org_type_code}) | Item: ${name} | OnHand: ${inv.quantity_on_hand} | Allocated: ${inv.quantity_allocated}`);
    }
  });
}

debugInventory();
