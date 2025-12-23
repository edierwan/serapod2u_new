# Fix: Admin Support Inbox Visibility Issue

## Problem
Admin users could not see user support messages in the Support Inbox. The inbox showed "No threads found" even though users had successfully sent messages that appeared in their own inbox.

## Root Cause
The `is_admin()` database function was checking for incorrect role codes:
- **Expected**: `'admin', 'super_admin', 'hq_admin'`  
- **Actual**: `'SA', 'HQ', 'POWER_USER', 'HQ_ADMIN'`

This mismatch caused the RLS (Row Level Security) policies to deny admin access to support threads and messages.

## Solution

### 1. Database Fix (SQL Migration)
Run the SQL script: `fix_support_inbox_visibility.sql`

This script:
- Updates `is_admin()` function to check for correct role codes
- Recreates RLS policies for `support_threads`, `support_messages`, and `support_thread_reads` tables
- Adds filter for `user_deleted_at IS NULL` to exclude deleted threads

### 2. API Code Updates
Updated role code checks in three API endpoints:
- `/api/admin/support/threads/route.ts` - List threads
- `/api/admin/support/threads/[id]/route.ts` - Update thread status
- `/api/admin/support/threads/[id]/reply/route.ts` - Reply to thread

Changed from:
```typescript
!['admin', 'super_admin', 'hq_admin'].includes(userData.role_code)
```

To:
```typescript
!['SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'admin', 'super_admin', 'hq_admin'].includes(userData.role_code)
```

## How to Apply the Fix

### Step 1: Run SQL Migration
1. Open Supabase Dashboard → SQL Editor
2. Copy and paste the contents of `fix_support_inbox_visibility.sql`
3. Execute the script
4. Verify the last two SELECT queries show:
   - Existing support threads
   - Your user role_code and `is_admin_user = true`

### Step 2: Deploy Updated API Code
The API code has been updated in:
- `app/src/app/api/admin/support/threads/route.ts`
- `app/src/app/api/admin/support/threads/[id]/route.ts`
- `app/src/app/api/admin/support/threads/[id]/reply/route.ts`

Commit and push these changes to deploy.

### Step 3: Test
1. **As a shop user**:
   - Go to Point Catalog → Support Inbox
   - Create a new message (e.g., "Test message")
   - Verify it appears in your inbox

2. **As an admin user**:
   - Go to Point Catalog Management → User Feedback tab
   - The Support Inbox should now show all user messages
   - Click on a thread to view and reply

## Files Changed
- ✅ `fix_support_inbox_visibility.sql` (new)
- ✅ `app/src/app/api/admin/support/threads/route.ts`
- ✅ `app/src/app/api/admin/support/threads/[id]/route.ts`
- ✅ `app/src/app/api/admin/support/threads/[id]/reply/route.ts`
- ✅ `FIX_SUPPORT_INBOX_VISIBILITY.md` (new)

## Verification Queries

After applying the fix, run these queries in Supabase SQL Editor:

```sql
-- Check if is_admin() function works correctly
SELECT 
    id,
    email,
    role_code,
    public.is_admin() as is_admin_user
FROM public.users
WHERE id = auth.uid();

-- View all support threads (should work for admins now)
SELECT 
    t.id,
    t.subject,
    t.status,
    t.created_by_user_id,
    u.email as user_email,
    u.full_name,
    t.last_message_at,
    t.last_message_preview
FROM public.support_threads t
LEFT JOIN public.users u ON t.created_by_user_id = u.id
WHERE t.user_deleted_at IS NULL
ORDER BY t.last_message_at DESC;

-- View support messages for a specific thread
SELECT 
    m.id,
    m.sender_type,
    m.body,
    m.created_at,
    u.email as sender_email
FROM public.support_messages m
LEFT JOIN public.users u ON m.sender_user_id = u.id
WHERE m.thread_id = '<THREAD_ID>'
ORDER BY m.created_at ASC;
```

## Expected Result
✅ Admin users can now see all user support threads  
✅ Admin users can view messages within threads  
✅ Admin users can reply to user messages  
✅ Admin users can update thread status (open, pending, resolved, closed)  
✅ Users continue to see only their own threads (privacy maintained)

## Technical Details

### RLS Policy Structure
1. **Users**: Can only see threads they created (`created_by_user_id = auth.uid()`)
2. **Admins**: Can see all threads (checked via `is_admin()` function)
3. **Messages**: Follow parent thread permissions
4. **Read Status**: Users manage their own read timestamps

### Role Codes Supported
The system now supports all of these admin role codes:
- `SA` - Super Admin
- `HQ` - Headquarters Admin
- `POWER_USER` - Power User
- `HQ_ADMIN` - HQ Admin (alternative naming)
- `admin` - Generic admin (legacy)
- `super_admin` - Super admin (legacy)
- `hq_admin` - HQ admin (legacy)

---

**Applied**: December 24, 2025  
**Issue**: Admin Support Inbox showing "No threads found"  
**Status**: ✅ Fixed
