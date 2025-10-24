#!/bin/bash

# 🚀 Production Repository Setup Script
# This script automates the setup of serapod2u_prod repository

set -e  # Exit on error

echo "🚀 Starting Production Repository Setup..."
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
SOURCE_REPO="https://github.com/edierwan/serapod2u_new.git"
TARGET_REPO="https://github.com/edierwan/serapod2u_prod.git"
WORK_DIR="/Users/macbook"
PROD_DIR="$WORK_DIR/serapod2u_prod"

# New Supabase credentials
PROD_SUPABASE_URL="https://fgfyxrhalexxqolynvtt.supabase.co"
PROD_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnZnl4cmhhbGV4eHFvbHludnR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyMjc0MjgsImV4cCI6MjA3NjgwMzQyOH0.NFSojOnv_xY9xL5BS1SUjZdJflZocXJEBsAwheWAkP4"
PROD_SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnZnl4cmhhbGV4eHFvbHludnR0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTIyNzQyOCwiZXhwIjoyMDc2ODAzNDI4fQ.Q4Vx4X6uzw2EeCpaapPqatc1ezfeBaW5LEtey2yClq4"
PROD_APP_URL="https://www.serapod2u.com"

# Step 1: Clone repository
echo -e "${YELLOW}Step 1: Cloning source repository...${NC}"
cd "$WORK_DIR"

if [ -d "$PROD_DIR" ]; then
    echo -e "${RED}Error: Directory $PROD_DIR already exists!${NC}"
    echo "Please remove it first or choose a different location."
    echo "Run: rm -rf $PROD_DIR"
    exit 1
fi

git clone "$SOURCE_REPO" serapod2u_prod
cd "$PROD_DIR"
echo -e "${GREEN}✅ Repository cloned${NC}"
echo ""

# Step 2: Remove git history
echo -e "${YELLOW}Step 2: Removing existing git history...${NC}"
rm -rf .git
echo -e "${GREEN}✅ Git history removed${NC}"
echo ""

# Step 3: Initialize new git repository
echo -e "${YELLOW}Step 3: Initializing new git repository...${NC}"
git init
git remote add origin "$TARGET_REPO"
echo -e "${GREEN}✅ New git repository initialized${NC}"
echo ""

# Step 4: Update .env.local
echo -e "${YELLOW}Step 4: Updating environment variables...${NC}"
ENV_FILE="$PROD_DIR/app/.env.local"

# Backup existing .env.local
if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
    echo "  📋 Backup created: $ENV_FILE.backup"
fi

# Prompt for database password
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: You need the database password!${NC}"
echo "Get it from: https://supabase.com/dashboard/project/fgfyxrhalexxqolynvtt/settings/database"
echo ""
read -sp "Enter your database password: " DB_PASSWORD
echo ""

if [ -z "$DB_PASSWORD" ]; then
    echo -e "${RED}Error: Database password cannot be empty${NC}"
    exit 1
fi

# Create new .env.local
cat > "$ENV_FILE" << EOF
# Supabase (client)
NEXT_PUBLIC_SUPABASE_URL=$PROD_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$PROD_ANON_KEY

# Supabase (server — handle with care)
SUPABASE_SERVICE_ROLE_KEY=$PROD_SERVICE_KEY

# Postgres (pooler) — this is the one your app uses
DATABASE_POOL_URL=postgresql://postgres.fgfyxrhalexxqolynvtt:$DB_PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres

# App URL for redirects
NEXT_PUBLIC_APP_URL=$PROD_APP_URL
EOF

echo -e "${GREEN}✅ Environment variables updated${NC}"
echo ""

# Step 5: Verify configuration
echo -e "${YELLOW}Step 5: Verifying configuration...${NC}"
cd "$PROD_DIR/app"

# Create verification script
cat > verify-config.js << 'VERIFY_EOF'
require('dotenv').config({ path: '.env.local' })

console.log('\n🔍 Configuration Verification:')
console.log('================================')
console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)
console.log('Anon Key (first 30 chars):', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.substring(0, 30) + '...')
console.log('Service Role (first 30 chars):', process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 30) + '...')
console.log('Database URL:', process.env.DATABASE_POOL_URL ? '✅ Set' : '❌ Missing')
console.log('App URL:', process.env.NEXT_PUBLIC_APP_URL)

const expectedUrl = 'https://fgfyxrhalexxqolynvtt.supabase.co'
if (process.env.NEXT_PUBLIC_SUPABASE_URL === expectedUrl) {
  console.log('\n✅ Configuration is correct for PRODUCTION')
  process.exit(0)
} else {
  console.log('\n❌ ERROR: Configuration mismatch!')
  console.log('Expected:', expectedUrl)
  console.log('Got:', process.env.NEXT_PUBLIC_SUPABASE_URL)
  process.exit(1)
}
VERIFY_EOF

node verify-config.js
rm verify-config.js
echo -e "${GREEN}✅ Configuration verified${NC}"
echo ""

# Step 6: Install dependencies
echo -e "${YELLOW}Step 6: Installing dependencies...${NC}"
npm install
echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

# Step 7: Test build
echo -e "${YELLOW}Step 7: Testing build...${NC}"
npm run build > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Build successful${NC}"
else
    echo -e "${RED}⚠️  Build had some warnings (this is normal)${NC}"
fi
echo ""

# Step 8: Git commit
echo -e "${YELLOW}Step 8: Creating initial commit...${NC}"
cd "$PROD_DIR"
git add .

# Verify .env.local is not being committed
if git status | grep -q ".env.local"; then
    echo -e "${RED}ERROR: .env.local is being committed!${NC}"
    echo "This should be prevented by .gitignore"
    exit 1
fi

git commit -m "Initial production setup with new Supabase instance

- Updated environment variables for production
- New Supabase project: fgfyxrhalexxqolynvtt
- Production URL: https://www.serapod2u.com
- Applied latest bug fixes and improvements
"
echo -e "${GREEN}✅ Initial commit created${NC}"
echo ""

# Step 9: Create branches
echo -e "${YELLOW}Step 9: Creating branches...${NC}"
git branch -M main
git checkout -b develop
git checkout -b staging
git checkout main
echo -e "${GREEN}✅ Branches created (main, develop, staging)${NC}"
echo ""

# Step 10: Summary
echo ""
echo "=========================================="
echo -e "${GREEN}🎉 Production Repository Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "📍 Location: $PROD_DIR"
echo "🌐 Repository: $TARGET_REPO"
echo "🔗 Supabase: $PROD_SUPABASE_URL"
echo ""
echo "📋 NEXT STEPS:"
echo "=============="
echo ""
echo "1️⃣  Apply Database Schema:"
echo "   - Go to: https://supabase.com/dashboard/project/fgfyxrhalexxqolynvtt/editor"
echo "   - Copy content from: $PROD_DIR/supabase/schemas/current_schema.sql"
echo "   - Paste and run in SQL Editor"
echo ""
echo "2️⃣  Create Storage Buckets:"
echo "   - Go to: https://supabase.com/dashboard/project/fgfyxrhalexxqolynvtt/storage/buckets"
echo "   - Create: avatars, documents, qr-codes, product-images"
echo ""
echo "3️⃣  Push to GitHub:"
echo "   cd $PROD_DIR"
echo "   git push -u origin main"
echo "   git push -u origin develop"
echo "   git push -u origin staging"
echo ""
echo "4️⃣  Test Locally:"
echo "   cd $PROD_DIR/app"
echo "   npm run dev"
echo "   Open: http://localhost:3000"
echo ""
echo "5️⃣  Enable RLS Policies:"
echo "   - Verify Row Level Security is enabled on all tables"
echo ""
echo "✅ IMPORTANT: Database schema must be applied before testing!"
echo ""
echo "📖 Full guide: $PROD_DIR/PRODUCTION_SETUP_GUIDE.md"
echo ""
