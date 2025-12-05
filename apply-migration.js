#!/usr/bin/env node

/**
 * Apply Inventory Allocation Migration
 * This script applies the migration directly to the Supabase database
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Read environment variables
require('dotenv').config({ path: path.join(__dirname, 'app', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials in app/.env.local');
  console.error('   Required: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Create Supabase admin client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyMigration() {
  console.log('🚀 Applying Inventory Allocation Migration...\n');
  
  // Read migration file
  const migrationPath = path.join(__dirname, 'supabase', 'migrations', '086_add_inventory_allocation_functions.sql');
  
  if (!fs.existsSync(migrationPath)) {
    console.error('❌ Migration file not found:', migrationPath);
    process.exit(1);
  }
  
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  
  console.log('📋 Migration will create:');
  console.log('   ✅ allocate_inventory_for_order() function');
  console.log('   ✅ release_allocation_for_order() function');
  console.log('   ✅ Updated orders_approve() function');
  console.log('');
  
  try {
    console.log('🔨 Executing SQL migration...');
    
    // Execute the migration
    const { data, error } = await supabase.rpc('exec_sql', { 
      sql: migrationSQL 
    });
    
    if (error) {
      // If exec_sql doesn't exist, try direct execution
      console.log('⚠️  exec_sql RPC not available, using direct SQL execution...');
      
      // Split into individual statements and execute
      const statements = migrationSQL
        .split(/;\s*$/m)
        .filter(stmt => stmt.trim().length > 0 && !stmt.trim().startsWith('--'));
      
      for (const statement of statements) {
        const { error: stmtError } = await supabase.rpc('exec_sql', { 
          query: statement + ';'
        });
        
        if (stmtError) {
          console.error('❌ Error executing statement:', stmtError);
          throw stmtError;
        }
      }
    }
    
    console.log('');
    console.log('✅ Migration applied successfully!');
    console.log('');
    
    // Verify functions exist
    console.log('🔍 Verifying functions...');
    
    const { data: testData, error: testError } = await supabase
      .rpc('allocate_inventory_for_order', { 
        p_order_id: '00000000-0000-0000-0000-000000000000' 
      });
    
    if (testError && !testError.message.includes('Order not found')) {
      console.error('⚠️  Warning: Function may not be available yet');
      console.error('   Error:', testError.message);
      console.log('');
      console.log('💡 If you see "function does not exist", please apply migration manually:');
      console.log('   1. Go to Supabase Dashboard → SQL Editor');
      console.log('   2. Copy content from: supabase/migrations/086_add_inventory_allocation_functions.sql');
      console.log('   3. Paste and click "Run"');
    } else {
      console.log('✅ Functions are available!');
    }
    
    console.log('');
    console.log('Next steps:');
    console.log('1. Restart your dev server (if running)');
    console.log('2. Try creating a D2H or S2D order');
    console.log('3. Check inventory view - "Allocated" column should update');
    console.log('');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.log('');
    console.log('📖 Manual migration steps:');
    console.log('1. Open Supabase Dashboard: https://supabase.com/dashboard/project/bamybvzufxijghzqdytu');
    console.log('2. Go to SQL Editor');
    console.log('3. Copy the entire migration file:');
    console.log('   supabase/migrations/086_add_inventory_allocation_functions.sql');
    console.log('4. Paste into SQL Editor and click "Run"');
    console.log('');
    process.exit(1);
  }
}

applyMigration();
