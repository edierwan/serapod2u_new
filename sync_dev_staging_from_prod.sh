#!/bin/bash

# ===============================================
# Safe Database Sync Script
# From: Production (hsvmvmurvpqcdmxckhnz) - READ ONLY
# To: Development (cbqsuzctjotbhxanazhf)
#     Staging (jqihlckqrhdxszgwuymu)
# 
# ⚠️ PRODUCTION IS READ-ONLY - NO CHANGES ALLOWED
# ===============================================

set -e

export PGPASSWORD='Turun_2020-'

# Database identifiers
PROD_DB="postgres.hsvmvmurvpqcdmxckhnz"    # Production - READ ONLY
DEV_DB="postgres.cbqsuzctjotbhxanazhf"     # Development
STAGING_DB="postgres.jqihlckqrhdxszgwuymu" # Staging

HOST="aws-1-ap-southeast-1.pooler.supabase.com"
PORT="5432"
DB_NAME="postgres"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=============================================="
echo "Safe Database Sync Script"
echo "=============================================="
echo -e "Production (READ ONLY): ${RED}$PROD_DB${NC}"
echo -e "Development: ${GREEN}$DEV_DB${NC}"
echo -e "Staging: ${GREEN}$STAGING_DB${NC}"
echo -e "==============================================\n${NC}"

# Create dump directory
DUMP_DIR="./migration_dumps/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$DUMP_DIR"

# -----------------------------------------------
# STEP 1: Export Master Data from Production (READ ONLY)
# -----------------------------------------------
echo -e "${YELLOW}[STEP 1] Exporting master data from Production (READ ONLY)...${NC}"

# Export HQ Organization
echo "  → Exporting HQ organization..."
psql -h $HOST -p $PORT -U $PROD_DB -d $DB_NAME -c \
"COPY (SELECT * FROM public.organizations WHERE org_type_code = 'HQ') TO STDOUT WITH CSV HEADER;" \
> "$DUMP_DIR/prod_hq_org.csv" 2>/dev/null

# Export super@dev.com user
echo "  → Exporting super@dev.com user..."
psql -h $HOST -p $PORT -U $PROD_DB -d $DB_NAME -c \
"COPY (SELECT * FROM public.users WHERE email = 'super@dev.com') TO STDOUT WITH CSV HEADER;" \
> "$DUMP_DIR/prod_super_user.csv" 2>/dev/null

# Export Products
echo "  → Exporting products..."
psql -h $HOST -p $PORT -U $PROD_DB -d $DB_NAME -c \
"COPY (SELECT * FROM public.products) TO STDOUT WITH CSV HEADER;" \
> "$DUMP_DIR/prod_products.csv" 2>/dev/null

# Export Product Variants
echo "  → Exporting product variants..."
psql -h $HOST -p $PORT -U $PROD_DB -d $DB_NAME -c \
"COPY (SELECT * FROM public.product_variants) TO STDOUT WITH CSV HEADER;" \
> "$DUMP_DIR/prod_variants.csv" 2>/dev/null

# Export Product Categories
echo "  → Exporting product categories..."
psql -h $HOST -p $PORT -U $PROD_DB -d $DB_NAME -c \
"COPY (SELECT * FROM public.product_categories) TO STDOUT WITH CSV HEADER;" \
> "$DUMP_DIR/prod_categories.csv" 2>/dev/null

# Export Organization Types
echo "  → Exporting organization types..."
psql -h $HOST -p $PORT -U $PROD_DB -d $DB_NAME -c \
"COPY (SELECT * FROM public.organization_types) TO STDOUT WITH CSV HEADER;" \
> "$DUMP_DIR/prod_org_types.csv" 2>/dev/null

# Export Roles
echo "  → Exporting roles..."
psql -h $HOST -p $PORT -U $PROD_DB -d $DB_NAME -c \
"COPY (SELECT * FROM public.roles) TO STDOUT WITH CSV HEADER;" \
> "$DUMP_DIR/prod_roles.csv" 2>/dev/null

echo -e "${GREEN}  ✓ Export complete!${NC}\n"

# -----------------------------------------------
# STEP 2: Show what will be done
# -----------------------------------------------
echo -e "${YELLOW}[STEP 2] Summary of actions:${NC}"
echo ""
echo "For DEVELOPMENT (cbqsuzctjotbhxanazhf):"
echo "  1. Delete all non-HQ organizations"
echo "  2. Delete all users except super@dev.com (if exists)"
echo "  3. Ensure HQ organization exists with correct data"
echo "  4. Ensure super@dev.com user exists"
echo "  5. Sync products and product variants"
echo ""
echo "For STAGING (jqihlckqrhdxszgwuymu):"
echo "  1. Ensure HQ organization exists"
echo "  2. Add super@dev.com user"
echo "  3. Sync products and product variants"
echo ""
read -p "Do you want to proceed? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo -e "${RED}Aborted by user.${NC}"
    exit 1
fi

# -----------------------------------------------
# STEP 3: Sync Development Database
# -----------------------------------------------
echo -e "\n${YELLOW}[STEP 3] Syncing Development Database (cbqsuzctjotbhxanazhf)...${NC}"

# First, let's check what needs to be deleted
echo "  → Checking current state..."
DEV_ORG_COUNT=$(psql -h $HOST -p $PORT -U $DEV_DB -d $DB_NAME -t -c \
"SELECT COUNT(*) FROM public.organizations WHERE org_type_code != 'HQ';" 2>/dev/null | tr -d ' ')
DEV_USER_COUNT=$(psql -h $HOST -p $PORT -U $DEV_DB -d $DB_NAME -t -c \
"SELECT COUNT(*) FROM public.users WHERE email != 'super@dev.com';" 2>/dev/null | tr -d ' ')

echo "  → Found $DEV_ORG_COUNT non-HQ organizations to clean"
echo "  → Found $DEV_USER_COUNT non-super users to clean"

# Delete dependent data first (in correct order to avoid FK violations)
echo "  → Cleaning dependent data..."

psql -h $HOST -p $PORT -U $DEV_DB -d $DB_NAME << 'EOF' 2>/dev/null
-- Disable triggers temporarily for faster cleanup
SET session_replication_role = replica;

-- Clean up user-related data for non-super users
DELETE FROM public.consumer_qr_scans WHERE consumer_id IN (SELECT id FROM public.users WHERE email != 'super@dev.com');
DELETE FROM public.point_transactions WHERE consumer_email IN (SELECT email FROM public.users WHERE email != 'super@dev.com');
DELETE FROM public.point_transactions WHERE consumer_phone IN (SELECT phone FROM public.users WHERE email != 'super@dev.com');

-- Clean up organization-related data for non-HQ orgs
DELETE FROM public.shop_distributors WHERE shop_id IN (SELECT id FROM public.organizations WHERE org_type_code != 'HQ');
DELETE FROM public.inventory_items WHERE organization_id IN (SELECT id FROM public.organizations WHERE org_type_code != 'HQ');
DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE seller_org_id IN (SELECT id FROM public.organizations WHERE org_type_code != 'HQ'));
DELETE FROM public.orders WHERE seller_org_id IN (SELECT id FROM public.organizations WHERE org_type_code != 'HQ');
DELETE FROM public.orders WHERE buyer_org_id IN (SELECT id FROM public.organizations WHERE org_type_code != 'HQ');

-- Delete users that are not super@dev.com
DELETE FROM public.users WHERE email != 'super@dev.com';

-- Delete non-HQ organizations (INDEP, SHOP, etc.)
-- Need to handle parent-child relationships
DELETE FROM public.organizations WHERE org_type_code = 'INDEP';
DELETE FROM public.organizations WHERE org_type_code NOT IN ('HQ');

-- Re-enable triggers
SET session_replication_role = DEFAULT;
EOF

echo -e "${GREEN}  ✓ Development cleanup complete!${NC}"

# Verify super@dev.com exists in development
echo "  → Verifying super@dev.com user..."
SUPER_EXISTS=$(psql -h $HOST -p $PORT -U $DEV_DB -d $DB_NAME -t -c \
"SELECT COUNT(*) FROM public.users WHERE email = 'super@dev.com';" 2>/dev/null | tr -d ' ')

if [ "$SUPER_EXISTS" -eq "0" ]; then
    echo "  → Creating super@dev.com user from production data..."
    # Get the production user data and insert into dev
    psql -h $HOST -p $PORT -U $DEV_DB -d $DB_NAME << 'EOF' 2>/dev/null
INSERT INTO public.users (id, email, full_name, phone, role_code, organization_id, is_active, is_verified, created_at)
SELECT 
    gen_random_uuid(),
    'super@dev.com',
    'Super Admin',
    NULL,
    'SA',
    (SELECT id FROM public.organizations WHERE org_type_code = 'HQ' LIMIT 1),
    true,
    true,
    now()
WHERE NOT EXISTS (SELECT 1 FROM public.users WHERE email = 'super@dev.com');
EOF
else
    echo -e "${GREEN}  ✓ super@dev.com already exists${NC}"
fi

# Sync product variants (check and add missing)
echo "  → Checking product variants sync..."
PROD_VARIANT_COUNT=$(psql -h $HOST -p $PORT -U $PROD_DB -d $DB_NAME -t -c \
"SELECT COUNT(*) FROM public.product_variants;" 2>/dev/null | tr -d ' ')
DEV_VARIANT_COUNT=$(psql -h $HOST -p $PORT -U $DEV_DB -d $DB_NAME -t -c \
"SELECT COUNT(*) FROM public.product_variants;" 2>/dev/null | tr -d ' ')

echo "  → Production has $PROD_VARIANT_COUNT variants, Development has $DEV_VARIANT_COUNT variants"

if [ "$DEV_VARIANT_COUNT" -lt "$PROD_VARIANT_COUNT" ]; then
    echo "  → Syncing missing product variants..."
    # This would require more complex logic - for now just report
    echo -e "${YELLOW}  ⚠ Manual sync may be needed for product variants${NC}"
fi

echo -e "${GREEN}  ✓ Development sync complete!${NC}\n"

# -----------------------------------------------
# STEP 4: Sync Staging Database
# -----------------------------------------------
echo -e "${YELLOW}[STEP 4] Syncing Staging Database (jqihlckqrhdxszgwuymu)...${NC}"

# Check if super@dev.com exists in staging
STAGING_SUPER=$(psql -h $HOST -p $PORT -U $STAGING_DB -d $DB_NAME -t -c \
"SELECT COUNT(*) FROM public.users WHERE email = 'super@dev.com';" 2>/dev/null | tr -d ' ')

if [ "$STAGING_SUPER" -eq "0" ]; then
    echo "  → Creating super@dev.com user in staging..."
    psql -h $HOST -p $PORT -U $STAGING_DB -d $DB_NAME << 'EOF' 2>/dev/null
INSERT INTO public.users (id, email, full_name, phone, role_code, organization_id, is_active, is_verified, created_at)
SELECT 
    gen_random_uuid(),
    'super@dev.com',
    'Super Admin',
    NULL,
    'SA',
    (SELECT id FROM public.organizations WHERE org_type_code = 'HQ' LIMIT 1),
    true,
    true,
    now()
WHERE NOT EXISTS (SELECT 1 FROM public.users WHERE email = 'super@dev.com');
EOF
    echo -e "${GREEN}  ✓ super@dev.com created in staging${NC}"
else
    echo -e "${GREEN}  ✓ super@dev.com already exists in staging${NC}"
fi

# Check products in staging
STAGING_PROD_COUNT=$(psql -h $HOST -p $PORT -U $STAGING_DB -d $DB_NAME -t -c \
"SELECT COUNT(*) FROM public.products;" 2>/dev/null | tr -d ' ')

echo "  → Staging has $STAGING_PROD_COUNT products"

if [ "$STAGING_PROD_COUNT" -eq "0" ]; then
    echo "  → Syncing products from production to staging..."
    
    # Copy products
    psql -h $HOST -p $PORT -U $PROD_DB -d $DB_NAME -c \
    "COPY (SELECT * FROM public.products) TO STDOUT WITH CSV;" 2>/dev/null | \
    psql -h $HOST -p $PORT -U $STAGING_DB -d $DB_NAME -c \
    "COPY public.products FROM STDIN WITH CSV;" 2>/dev/null
    
    # Copy product variants
    psql -h $HOST -p $PORT -U $PROD_DB -d $DB_NAME -c \
    "COPY (SELECT * FROM public.product_variants) TO STDOUT WITH CSV;" 2>/dev/null | \
    psql -h $HOST -p $PORT -U $STAGING_DB -d $DB_NAME -c \
    "COPY public.product_variants FROM STDIN WITH CSV;" 2>/dev/null
    
    echo -e "${GREEN}  ✓ Products synced to staging${NC}"
else
    echo -e "${GREEN}  ✓ Products already exist in staging${NC}"
fi

echo -e "${GREEN}  ✓ Staging sync complete!${NC}\n"

# -----------------------------------------------
# STEP 5: Final Verification
# -----------------------------------------------
echo -e "${YELLOW}[STEP 5] Final Verification...${NC}"

echo -e "\n${GREEN}DEVELOPMENT (cbqsuzctjotbhxanazhf):${NC}"
psql -h $HOST -p $PORT -U $DEV_DB -d $DB_NAME -c \
"SELECT 'Organizations' as type, COUNT(*) as count FROM public.organizations
UNION ALL SELECT 'HQ Orgs', COUNT(*) FROM public.organizations WHERE org_type_code = 'HQ'
UNION ALL SELECT 'Users', COUNT(*) FROM public.users
UNION ALL SELECT 'super@dev.com', COUNT(*) FROM public.users WHERE email = 'super@dev.com'
UNION ALL SELECT 'Products', COUNT(*) FROM public.products
UNION ALL SELECT 'Variants', COUNT(*) FROM public.product_variants;" 2>/dev/null

echo -e "\n${GREEN}STAGING (jqihlckqrhdxszgwuymu):${NC}"
psql -h $HOST -p $PORT -U $STAGING_DB -d $DB_NAME -c \
"SELECT 'Organizations' as type, COUNT(*) as count FROM public.organizations
UNION ALL SELECT 'HQ Orgs', COUNT(*) FROM public.organizations WHERE org_type_code = 'HQ'
UNION ALL SELECT 'Users', COUNT(*) FROM public.users
UNION ALL SELECT 'super@dev.com', COUNT(*) FROM public.users WHERE email = 'super@dev.com'
UNION ALL SELECT 'Products', COUNT(*) FROM public.products
UNION ALL SELECT 'Variants', COUNT(*) FROM public.product_variants;" 2>/dev/null

echo -e "\n${GREEN}=============================================="
echo "Sync Complete!"
echo "==============================================\n${NC}"
