# Setup Guide & Permission Fixes

## 1. Understanding the Read-Only Issue

### Why Organization Settings are Read-Only for super@dev.com

The application uses **Supabase Row Level Security (RLS)** policies to control access. The organization settings page appears read-only because:

1. **RLS Policy Restriction**: The `organizations` table has a policy that only allows users with `is_hq_admin()` role level to UPDATE records:

```sql
CREATE POLICY orgs_admin_all ON public.organizations 
  TO authenticated 
  USING (public.is_hq_admin()) 
  WITH CHECK (public.is_hq_admin());
```

2. **Role Level Requirement**: The `is_hq_admin()` function checks if the user's role level is >= 80:
   - Super Admin (SUPERADMIN): Role Level 99 ✅
   - HQ Admin: Role Level 80 ✅
   - Other roles: < 80 ❌ (READ-ONLY)

### The Problem

Currently, `super@dev.com` cannot edit organization information because:
- The user exists in the `auth.users` table (Supabase Auth)
- BUT there's NO corresponding record in the `public.users` table
- OR the role_code assigned doesn't have the proper role level

### Solution Steps

#### Step 1: Run the Migration SQL

Execute the migration file to create/update the super admin user:

```bash
# Using Supabase CLI (recommended)
supabase db push supabase/migrations/20241201_create_super_admin.sql

# OR manually run in Supabase SQL Editor:
# Copy contents of: supabase/migrations/20241201_create_super_admin.sql
```

This SQL will:
- Create the SERA organization (if not exists)
- Create the SUPERADMIN role with role_level = 99
- Create/update the `super@dev.com` user with:
  - Role: SUPERADMIN (role_level = 99)
  - Organization: SERA (Headquarters)
  - All required permissions

#### Step 2: Verify the User Setup

After running the migration, verify in Supabase:

1. Go to **SQL Editor**
2. Run this query to verify:

```sql
SELECT 
  u.id,
  u.email,
  u.full_name,
  u.role_code,
  r.role_name,
  r.role_level,
  o.org_name,
  o.org_code,
  u.is_active
FROM public.users u
JOIN public.roles r ON u.role_code = r.role_code
JOIN public.organizations o ON u.organization_id = o.id
WHERE u.email = 'super@dev.com';
```

**Expected Result:**
| Field | Value |
|-------|-------|
| email | super@dev.com |
| role_code | SUPERADMIN |
| role_name | Super Administrator |
| role_level | 99 |
| org_name | Sera Pod Headquarters |
| org_code | SERA |
| is_active | true |

#### Step 3: Test Edit Permissions

1. Log in as `super@dev.com`
2. Go to **Settings > Organization**
3. Fields should now be **EDITABLE** (not read-only)
4. Make a test change and click **Save**

---

## 2. Database Schema Overview

### Users Table
Links Supabase Auth users to the application:
```
users (public)
├── id: UUID (Supabase auth.users.id)
├── email: VARCHAR
├── full_name: VARCHAR
├── phone: VARCHAR
├── role_code: VARCHAR (FK → roles.role_code)
├── organization_id: UUID (FK → organizations.id)
├── is_active: BOOLEAN
├── email_verified: BOOLEAN
└── timestamps: created_at, updated_at, last_login_at
```

### Roles Table
Defines roles and permission levels:
```
roles (public)
├── role_code: VARCHAR (PK)
├── role_name: VARCHAR
├── role_level: INTEGER (0-99, higher = more permissions)
├── description: VARCHAR
├── permissions: JSONB
├── is_active: BOOLEAN
└── timestamps
```

**Role Levels:**
- 99: SUPERADMIN (Full access)
- 80: HQ_ADMIN (Organization admin)
- 50: MANAGER (Team manager)
- 30: STAFF (Regular user)
- 10: GUEST (Limited access)

### Organizations Table
Organization hierarchy and information:
```
organizations (public)
├── id: UUID (PK)
├── org_code: VARCHAR (Unique)
├── org_name: VARCHAR
├── org_type_code: VARCHAR (FK → organization_types.type_code)
├── parent_org_id: UUID (Self-referencing for hierarchy)
├── address: VARCHAR
├── city: VARCHAR
├── state: VARCHAR
├── postal_code: VARCHAR
├── country: VARCHAR
├── phone: VARCHAR
├── email: VARCHAR
├── website: VARCHAR
├── is_active: BOOLEAN
└── timestamps
```

---

## 3. RLS Policies Reference

### Organizations Table Policies

**Policy 1: Admin Full Access**
```sql
CREATE POLICY orgs_admin_all ON public.organizations 
  TO authenticated 
  USING (public.is_hq_admin()) 
  WITH CHECK (public.is_hq_admin());
```
- ✅ SELECT, INSERT, UPDATE, DELETE
- ✅ Only for users with role_level >= 80

**Policy 2: Read-Only for Active Orgs**
```sql
CREATE POLICY orgs_read_all ON public.organizations 
  FOR SELECT TO authenticated 
  USING (
    (is_active = true) 
    OR (id = public.current_user_org_id()) 
    OR public.is_hq_admin()
  );
```
- ✅ SELECT only
- ✅ Can see active orgs OR own org OR if admin

---

## 4. User Management - Database Sync

The User Management page (`/dashboard?view=users`) now fully syncs with the database:

### Features:
✅ **Real-time User Listing**: Shows all users from `public.users` table
✅ **Create New Users**: 
   - Creates Supabase Auth user
   - Creates database record
   - Auto-links both

✅ **Role Assignment**: Assign roles based on permission level
✅ **Status Management**: Activate/Deactivate users
✅ **Organization Linking**: Assign users to organizations
✅ **Access Control**: Only admins (role_level >= 70) can create users

### User ID Linking:
- User ID is the same UUID in both:
  - `auth.users.id` (Supabase Auth)
  - `users.id` (public.users table)
- Organization ID is a separate UUID field that creates the relationship

---

## 5. Quick Reference - Common Issues

### Issue: "Organization information is read-only"
**Cause**: User doesn't have HQ_ADMIN role level (80+)
**Fix**: 
1. Run `20241201_create_super_admin.sql` migration
2. Verify user record exists in `public.users`
3. Verify role has level >= 80

### Issue: "Cannot create users"
**Cause**: Your role level < 70
**Fix**: Contact a super admin to elevate your permissions

### Issue: "User appears in Auth but not in User Management"
**Cause**: No record in `public.users` table
**Fix**: Manually insert into `public.users` or recreate via User Management UI

### Issue: "Unknown Role" in Settings
**Cause**: Role code not found or role_name missing
**Fix**: 
1. Verify `roles` table has the role_code
2. Verify `users` table has correct role_code
3. Run migration if needed

---

## 6. Testing Checklist

- [ ] Run `20241201_create_super_admin.sql` migration
- [ ] Log in as super@dev.com
- [ ] Verify role shows as "Super Administrator" in sidebar
- [ ] Go to Settings → Organization
- [ ] Verify fields are EDITABLE (not read-only)
- [ ] Edit organization name and save
- [ ] Go to User Management
- [ ] Verify users list displays from database
- [ ] Create a test user with appropriate role
- [ ] Verify new user appears in list
- [ ] Activate/deactivate a user and verify status updates

---

## 7. Important Notes

⚠️ **Organization Link Type**:
- Users are linked to organizations via `organization_id` (UUID)
- NOT by organization name or code
- The link is stored as a foreign key relationship
- Data is synced in real-time through database queries

⚠️ **Port Configuration**:
- Fixed to port 3000 via `package.json`
- Environment: `http://localhost:3000`
- Auto-generated org codes use prefixes (HQ, SH, MN, DT, WH)

⚠️ **Read-Only Limitation**:
- Settings page shows "read-only" visually to non-admins
- This is a SECURITY FEATURE to match RLS policies
- Non-admins CAN view organization info but cannot modify
- This ensures data integrity and audit trails

---

## 8. Additional Resources

- Supabase RLS Documentation: https://supabase.com/docs/guides/auth/row-level-security
- PostgreSQL UUID Type: https://www.postgresql.org/docs/current/datatype-uuid.html
- Foreign Key Relationships: Ensures referential integrity between tables

