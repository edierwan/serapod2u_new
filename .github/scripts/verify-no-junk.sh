#!/bin/bash
# Verify No Junk Files - prevents non-runtime files from being committed
# Run this as a pre-commit hook or CI check

set -e

echo "🔍 Verifying repository cleanliness..."

# Check for prohibited file patterns
PROHIBITED_FILES=$(git ls-files | grep -E '\.(sql|xlsx|csv|log)$|^(apply-|check_|diagnose|find_|fix_|test-)' | grep -v '^supabase/migrations/' || true)

if [ -n "$PROHIBITED_FILES" ]; then
    echo "❌ ERROR: Found prohibited files that should not be committed:"
    echo "$PROHIBITED_FILES"
    echo ""
    echo "These files should be in .gitignore or removed from the repository."
    exit 1
fi

# Check for root-level package files (should be in app/ instead)
if [ -f "package.json" ] || [ -f "package-lock.json" ]; then
    echo "❌ ERROR: Found root-level package.json or package-lock.json"
    echo "   These should only exist in app/ directory."
    exit 1
fi

# Check for test files
TEST_FILES=$(git ls-files | grep -E '\.test\.(ts|js)$|\.spec\.(ts|js)$|/__tests__/' || true)
if [ -n "$TEST_FILES" ]; then
    echo "❌ ERROR: Found test files that should not be committed:"
    echo "$TEST_FILES"
    exit 1
fi

# Check for markdown docs (except essential ones)
DOC_FILES=$(git ls-files '*.md' | grep -vE '^(README\.md|CHANGELOG\.md|LICENSE\.md|app/README\.md)$' || true)
if [ -n "$DOC_FILES" ]; then
    echo "❌ ERROR: Found documentation files that should not be committed:"
    echo "$DOC_FILES"
    echo "   Only README.md, CHANGELOG.md, and LICENSE.md should be in the repository."
    exit 1
fi

echo "✅ Repository is clean - no prohibited files found!"
exit 0
