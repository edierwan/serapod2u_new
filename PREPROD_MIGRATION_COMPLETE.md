# Preprod Database Migration Complete

## Migration Summary

**Date:** December 16, 2025

### Source Database
- **Host:** aws-1-ap-southeast-1.pooler.supabase.com
- **Project ID:** bamybvzufxijghzqdytu

### Target Database (Preprod)
- **Host:** aws-1-ap-southeast-1.pooler.supabase.com
- **Project ID:** jqihlckqrhdxszgwuymu

---

## What Was Migrated

### Schema (No Data)
| Component | Count |
|-----------|-------|
| Public Tables | 81 |
| Public Functions | 522 |
| Public Views | 23 |
| Public Triggers | 78 |
| Storage Buckets | 8 |

### Seed Data (Required for App)
- **Roles** - All role definitions (11 roles)
- **Organization Types** - HQ, MFG, DIST, WH, SHOP (5 types)
- **Regions** - Malaysian regions (6 regions)
- **States** - Malaysian states (17 states)
- **Districts** - Malaysian districts (147 districts)
- **Payment Terms** - Default payment terms (6 records)

### Admin User
- **Email:** admin@dev.com
- **Password:** (Same as production - original password)
- **Role:** HQ (HQ Admin)
- **Organization:** Serapod Technology Sdn Bhd (SERA-HQ)

---

## Storage Buckets Created

| Bucket Name | Public |
|-------------|--------|
| documents | Yes |
| avatars | Yes |
| master-data | No |
| product-images | Yes |
| qr-codes | Yes |
| order-documents | No |
| organization-logos | Yes |
| stock-adjustments | Yes |

---

## Configuration for Preprod Environment

### Environment Variables to Set in Preprod

```env
# Supabase Connection
NEXT_PUBLIC_SUPABASE_URL=https://jqihlckqrhdxszgwuymu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<get from Supabase dashboard>
SUPABASE_SERVICE_ROLE_KEY=<get from Supabase dashboard>
```

### Getting the Keys

1. Go to https://supabase.com/dashboard/project/jqihlckqrhdxszgwuymu
2. Navigate to Settings → API
3. Copy the `anon public` key for `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Copy the `service_role secret` key for `SUPABASE_SERVICE_ROLE_KEY`

---

## Verification Checklist

- [x] All public tables created (81 tables)
- [x] All functions migrated (522 functions)
- [x] All views created (23 views)
- [x] All triggers configured (78 triggers)
- [x] Storage buckets created with policies
- [x] Admin user created in auth.users
- [x] Admin user created in public.users
- [x] Admin identity created in auth.identities
- [x] HQ organization created
- [x] Role codes populated
- [x] Organization types populated
- [x] Geographic data (regions, states, districts) populated

---

## Database Connection Test

```bash
# Test connection to preprod
export PGPASSWORD='Turun_2020-'
psql -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.jqihlckqrhdxszgwuymu -d postgres

# Test login query
SELECT u.email, u.full_name, o.org_name, r.role_name
FROM public.users u
JOIN public.organizations o ON u.organization_id = o.id
JOIN public.roles r ON u.role_code = r.role_code
WHERE u.email = 'admin@dev.com';
```

---

## Files Generated During Migration

- `preprod_public_schema.sql` - Public schema export
- `preprod_core_schema.sql` - Core schema export
- `preprod_seed_data.sql` - Seed data for roles, org types, regions, etc.
- `preprod_migration_log.txt` - Migration log

---

## Notes

1. **No Data Migration:** Only schema and essential seed data was migrated. No business data (orders, products, QR codes, etc.) was transferred.

2. **Admin User Password:** The password hash was copied directly from production, so the same password works: login with `admin@dev.com` using the existing password.

3. **RLS Policies:** All Row Level Security policies have been migrated, ensuring proper access control.

4. **Extensions:** Required extensions (btree_gin, btree_gist, citext, pg_trgm, pgcrypto, uuid-ossp) are enabled.

---

## Troubleshooting

### If Login Fails
1. Check auth.users has the admin record
2. Check auth.identities has the identity record
3. Verify public.users has the matching record
4. Ensure organization exists

### If Features Don't Work
1. Check if required functions exist in public schema
2. Verify triggers are enabled
3. Check RLS policies are in place
4. Ensure storage buckets and policies exist
