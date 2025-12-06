#!/usr/bin/env node

/**
 * Apply Order Status Fix Migration
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
  console.log('🚀 Applying Order Status Fix Migration...\n');
  
  // Read migration file
  const migrationPath = path.join(__dirname, 'supabase', 'migrations', '101_update_order_status_flow.sql');
  
  if (!fs.existsSync(migrationPath)) {
    console.error('❌ Migration file not found:', migrationPath);
    process.exit(1);
  }
  
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  
  try {
    console.log('🔨 Executing SQL migration...');
    
    // Execute the migration using exec_sql RPC if available
    // Note: exec_sql is a custom RPC that executes raw SQL. 
    // If it doesn't exist, we might need another way, but based on previous scripts it seems to exist.
    
    // We'll try to split statements and run them one by one if possible, 
    // but exec_sql usually handles blocks.
    
    const { error } = await supabase.rpc('exec_sql', { 
      sql: migrationSQL 
    });
    
    if (error) {
        console.error('❌ Error executing migration via RPC:', error);
        throw error;
    }
    
    console.log('');
    console.log('✅ Migration applied successfully!');
    console.log('');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.log('');
    console.log('📖 Manual migration steps:');
    console.log('1. Open Supabase Dashboard');
    console.log('2. Go to SQL Editor');
    console.log('3. Copy the entire migration file:');
    console.log('   supabase/migrations/101_update_order_status_flow.sql');
    console.log('4. Paste into SQL Editor and click "Run"');
    console.log('');
    process.exit(1);
  }
}

applyMigration();
