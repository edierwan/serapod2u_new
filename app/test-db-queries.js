// Test database queries
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hsvmvmurvpqcdmxckhnz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzdm12bXVydnBxY2RteGNraG56Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDUyMTg5OSwiZXhwIjoyMDc2MDk3ODk5fQ.F40dYLD1EJH0BUwrjTf277qB7JQC9aaOtevP98amVHQ';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testQueries() {
  console.log("Testing database queries...\n");
  
  // Test 1: Query master code
  const masterCode = "MASTER-ORD-HM-1125-01-CASE-001-c03d54e4ec7d";
  console.log(`\n1. Testing master code: ${masterCode}`);
  
  const { data: masterData, error: masterError } = await supabase
    .from('qr_master_codes')
    .select('id, master_code, status, warehouse_org_id, warehouse_received_at')
    .eq('master_code', masterCode)
    .maybeSingle();
  
  if (masterError) {
    console.log("  ❌ Master query error:", masterError);
  } else if (!masterData) {
    console.log("  ⚠️  Master code not found");
  } else {
    console.log("  ✅ Master code found!");
    console.log("     ID:", masterData.id);
    console.log("     Status:", masterData.status);
    console.log("     Warehouse Org:", masterData.warehouse_org_id);
    console.log("     Warehouse Received At:", masterData.warehouse_received_at);
  }
  
  // Test 3: Query unique code
  const uniqueCode = "PROD-TREFL4498-GRA-209892-ORD-HM-1125-01-00101-ca1905681e4b";
  console.log(`\n3. Testing unique code: ${uniqueCode}`);
  
  const { data: uniqueData, error: uniqueError } = await supabase
    .from('qr_codes')
    .select('id, code, status, current_location_org_id')
    .eq('code', uniqueCode)
    .maybeSingle();
  
  if (uniqueError) {
    console.log("  ❌ Unique query error:", uniqueError);
  } else if (!uniqueData) {
    console.log("  ⚠️  Unique code not found");
  } else {
    console.log("  ✅ Unique code found!");
    console.log("     ID:", uniqueData.id);
  console.log("     Status:", uniqueData.status);
  console.log("     Current Location Org:", uniqueData.current_location_org_id);
  }
}

testQueries()
  .then(() => {
    console.log("\n✅ Test complete!");
    process.exit(0);
  })
  .catch(err => {
    console.error("\n❌ Test failed:", err);
    process.exit(1);
  });
