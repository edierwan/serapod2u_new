#!/bin/bash

# Serapod2u Pre-Deployment Test Suite
# Run this before merging to staging or production

set -e

echo "🚀 Serapod2u Pre-Deployment Test Suite"
echo "========================================"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Change to app directory
cd "$(dirname "$0")"

# Function to print status
print_status() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
    else
        echo -e "${RED}✗${NC} $1"
        exit 1
    fi
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# 1. Clean install dependencies
echo "📦 Step 1: Clean dependency install..."
rm -rf node_modules package-lock.json
npm install
print_status "Dependencies installed"

# 2. Run TypeScript type checking
echo ""
echo "🔍 Step 2: Type checking..."
npx tsc --noEmit
print_status "Type check passed"

# 3. Run ESLint
echo ""
echo "🔧 Step 3: Linting..."
npm run lint
print_status "Lint check passed"

# 4. Run production build
echo ""
echo "🏗️  Step 4: Production build..."
npm run build
print_status "Production build successful"

# 5. Check bundle size
echo ""
echo "📊 Step 5: Analyzing bundle size..."
if [ -d ".next" ]; then
    BUNDLE_SIZE=$(du -sh .next | cut -f1)
    echo "   Build size: $BUNDLE_SIZE"
    
    # Check if build is too large (> 50MB warning)
    SIZE_BYTES=$(du -s .next | cut -f1)
    if [ $SIZE_BYTES -gt 51200 ]; then
        print_warning "Build size is large. Consider optimization."
    else
        print_status "Bundle size is acceptable"
    fi
fi

# 6. Check for security vulnerabilities
echo ""
echo "🔒 Step 6: Security audit..."
npm audit --audit-level=moderate || print_warning "Some vulnerabilities found. Review npm audit output."

# 7. Check environment variables
echo ""
echo "🔐 Step 7: Environment check..."
if [ -f ".env.production" ]; then
    print_status "Production environment file exists"
else
    print_warning "No .env.production file found"
fi

# 8. Verify critical files
echo ""
echo "📁 Step 8: Verifying critical files..."
CRITICAL_FILES=(
    "src/app/layout.tsx"
    "src/components/providers/AuthProvider.tsx"
    "src/lib/supabase/client.ts"
    "src/lib/supabase/server.ts"
    "public/manifest.json"
)

for file in "${CRITICAL_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "   ${GREEN}✓${NC} $file"
    else
        echo -e "   ${RED}✗${NC} $file - MISSING"
        exit 1
    fi
done

# 9. Check for common issues
echo ""
echo "🔍 Step 9: Checking for common issues..."

# Check for console.log in production code
CONSOLE_COUNT=$(grep -r "console\.log" src/ --include="*.ts" --include="*.tsx" | grep -v "//.*console\.log" | wc -l)
if [ $CONSOLE_COUNT -gt 0 ]; then
    print_warning "Found $CONSOLE_COUNT console.log statements (will be removed in production build)"
else
    print_status "No console.log statements found"
fi

# Check for TODO comments
TODO_COUNT=$(grep -r "TODO\|FIXME" src/ --include="*.ts" --include="*.tsx" | wc -l)
if [ $TODO_COUNT -gt 0 ]; then
    print_warning "Found $TODO_COUNT TODO/FIXME comments"
fi

# 10. Mobile optimization check
echo ""
echo "📱 Step 10: Mobile optimization check..."

# Check for viewport meta tag
if grep -q "viewport" "src/app/layout.tsx"; then
    print_status "Viewport meta configuration found"
else
    print_warning "Missing viewport configuration"
fi

# Check for manifest
if [ -f "public/manifest.json" ]; then
    print_status "PWA manifest exists"
else
    print_warning "PWA manifest missing"
fi

# Summary
echo ""
echo "========================================"
echo -e "${GREEN}✓ All critical tests passed!${NC}"
echo ""
echo "📋 Next Steps:"
echo "   1. Review any warnings above"
echo "   2. Test on local server: npm run start"
echo "   3. Test mobile responsiveness on real devices"
echo "   4. Commit changes to develop branch"
echo "   5. Merge to staging for final testing"
echo "   6. Deploy to production after staging validation"
echo ""
echo "🚢 Ready for deployment!"
