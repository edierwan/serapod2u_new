#!/bin/bash

# Import organizations with circular FK handling
# This script temporarily drops the self-referencing FK, imports data, then recreates it

export PGPASSWORD='Turun_2020-'
TARGET_HOST="aws-1-ap-southeast-1.pooler.supabase.com"
TARGET_USER="postgres.cbqsuzctjotbhxanazhf"
SOURCE_USER="postgres.bamybvzufxijghzqdytu"
PORT="5432"
DB_NAME="postgres"

echo "=== Importing Organizations with Circular FK Handling ==="

# Step 1: Find and drop the self-referencing FK constraint
echo ""
echo "Step 1: Identifying self-referencing FK constraints..."

psql -h "$TARGET_HOST" -p "$PORT" -U "$TARGET_USER" -d "$DB_NAME" << 'EOF'
-- Find the constraint name
SELECT conname 
FROM pg_constraint 
WHERE conrelid = 'public.organizations'::regclass 
  AND confrelid = 'public.organizations'::regclass;

-- Temporarily drop the parent_org_id FK constraint
DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    -- Find self-referencing FK
    SELECT conname INTO v_constraint_name
    FROM pg_constraint 
    WHERE conrelid = 'public.organizations'::regclass 
      AND confrelid = 'public.organizations'::regclass
    LIMIT 1;
    
    IF v_constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS ' || v_constraint_name;
        RAISE NOTICE 'Dropped constraint: %', v_constraint_name;
    END IF;
END $$;
EOF

echo ""
echo "Step 2: Generating INSERT statements from source..."

# Generate INSERT statements (without parent_org_id initially)
psql -h "$TARGET_HOST" -p "$PORT" -U "$SOURCE_USER" -d "$DB_NAME" -t -A << 'EOF' > /tmp/org_inserts.sql
SELECT 
    'INSERT INTO public.organizations (id, org_type_code, org_code, org_name, registration_no, tax_id, website, address, address_line2, city, state_id, district_id, postal_code, country_code, latitude, longitude, settings, is_active, created_at, updated_at, created_by, updated_by, contact_name, contact_title, contact_phone, contact_email, logo_url, default_warehouse_org_id, scan_activation_point, payment_term_id, warranty_bonus) VALUES (' ||
    quote_literal(id) || '::uuid, ' ||
    quote_literal(org_type_code) || ', ' ||
    COALESCE(quote_literal(org_code), 'NULL') || ', ' ||
    quote_literal(org_name) || ', ' ||
    COALESCE(quote_literal(registration_no), 'NULL') || ', ' ||
    COALESCE(quote_literal(tax_id), 'NULL') || ', ' ||
    COALESCE(quote_literal(website), 'NULL') || ', ' ||
    COALESCE(quote_literal(address), 'NULL') || ', ' ||
    COALESCE(quote_literal(address_line2), 'NULL') || ', ' ||
    COALESCE(quote_literal(city), 'NULL') || ', ' ||
    COALESCE(quote_literal(state_id), 'NULL') || '::uuid, ' ||
    COALESCE(quote_literal(district_id), 'NULL') || '::uuid, ' ||
    COALESCE(quote_literal(postal_code), 'NULL') || ', ' ||
    COALESCE(quote_literal(country_code), 'NULL') || ', ' ||
    COALESCE(latitude::text, 'NULL') || ', ' ||
    COALESCE(longitude::text, 'NULL') || ', ' ||
    quote_literal(COALESCE(settings::text, '{}')) || '::jsonb, ' ||
    is_active || ', ' ||
    quote_literal(created_at) || '::timestamptz, ' ||
    quote_literal(updated_at) || '::timestamptz, ' ||
    COALESCE(quote_literal(created_by), 'NULL') || '::uuid, ' ||
    COALESCE(quote_literal(updated_by), 'NULL') || '::uuid, ' ||
    COALESCE(quote_literal(contact_name), 'NULL') || ', ' ||
    COALESCE(quote_literal(contact_title), 'NULL') || ', ' ||
    COALESCE(quote_literal(contact_phone), 'NULL') || ', ' ||
    COALESCE(quote_literal(contact_email), 'NULL') || ', ' ||
    COALESCE(quote_literal(logo_url), 'NULL') || ', ' ||
    COALESCE(quote_literal(default_warehouse_org_id), 'NULL') || '::uuid, ' ||
    COALESCE(quote_literal(scan_activation_point), 'NULL') || ', ' ||
    COALESCE(quote_literal(payment_term_id), 'NULL') || '::uuid, ' ||
    COALESCE(warranty_bonus::text, 'NULL') ||
    ') ON CONFLICT (id) DO NOTHING;'
FROM public.organizations
ORDER BY CASE WHEN parent_org_id IS NULL THEN 0 ELSE 1 END, created_at;
EOF

echo ""
echo "Step 3: Importing organizations..."

psql -h "$TARGET_HOST" -p "$PORT" -U "$TARGET_USER" -d "$DB_NAME" -f /tmp/org_inserts.sql

echo ""
echo "Step 4: Updating parent_org_id values..."

# Generate UPDATE statements for parent_org_id
psql -h "$TARGET_HOST" -p "$PORT" -U "$SOURCE_USER" -d "$DB_NAME" -t -A << 'EOF' > /tmp/org_parents.sql
SELECT 
    'UPDATE public.organizations SET parent_org_id = ' || quote_literal(parent_org_id) || '::uuid WHERE id = ' || quote_literal(id) || '::uuid;'
FROM public.organizations
WHERE parent_org_id IS NOT NULL;
EOF

psql -h "$TARGET_HOST" -p "$PORT" -U "$TARGET_USER" -d "$DB_NAME" -f /tmp/org_parents.sql

echo ""
echo "Step 5: Updating default_warehouse_org_id values..."

# Generate UPDATE statements for default_warehouse_org_id
psql -h "$TARGET_HOST" -p "$PORT" -U "$SOURCE_USER" -d "$DB_NAME" -t -A << 'EOF' > /tmp/org_warehouses.sql
SELECT 
    'UPDATE public.organizations SET default_warehouse_org_id = ' || quote_literal(default_warehouse_org_id) || '::uuid WHERE id = ' || quote_literal(id) || '::uuid;'
FROM public.organizations
WHERE default_warehouse_org_id IS NOT NULL;
EOF

psql -h "$TARGET_HOST" -p "$PORT" -U "$TARGET_USER" -d "$DB_NAME" -f /tmp/org_warehouses.sql

echo ""
echo "Step 6: Recreating FK constraints..."

psql -h "$TARGET_HOST" -p "$PORT" -U "$TARGET_USER" -d "$DB_NAME" << 'EOF'
-- Recreate the self-referencing FK constraint
ALTER TABLE public.organizations 
    ADD CONSTRAINT organizations_parent_org_id_fkey 
    FOREIGN KEY (parent_org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Recreate the default_warehouse FK if exists
-- This may already exist or not, depending on schema
EOF

echo ""
echo "Step 7: Verifying import..."

psql -h "$TARGET_HOST" -p "$PORT" -U "$TARGET_USER" -d "$DB_NAME" -c "SELECT COUNT(*) as org_count FROM public.organizations;"

echo ""
echo "=== Organizations Import Complete ==="
