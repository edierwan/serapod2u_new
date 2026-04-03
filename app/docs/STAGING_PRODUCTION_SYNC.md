# Staging ↔ Production Sync Strategy

## Environment Overview

| | **Staging** | **Production** |
|---|---|---|
| App URL | `stg.serapod2u.com` | `serapod2u.com` |
| App Host | VPS via Coolify | Vercel |
| Git branch | `staging` | `main` |
| Supabase | Self-hosted on VPS (`serapod-stg-*` containers) | Supabase Cloud (ap-southeast-1) |
| Supabase URL | `https://sb-stg-serapod.getouch.co` | Supabase-managed |
| DB port | 6543 (VPS localhost) | 5432 (pooler) |
| Caddy proxy | `serapod-web-stg:3000` (Docker alias) | N/A (Vercel handles) |

## Code Sync

Both branches track `edierwan/serapod2u_new`.

```bash
# Deploy to staging
git push origin main:staging

# Or cherry-pick specific commits
git checkout staging && git cherry-pick <sha> && git push origin staging
```

Coolify auto-deploys on push to the configured branch. Vercel auto-deploys on push to `main`.

## Database Migration Workflow

### Writing Migrations

Place SQL files in `supabase/migrations/` with naming format:
```
YYYYMMDD_description.sql
```

Migrations must be **idempotent** — use `CREATE OR REPLACE`, `IF NOT EXISTS`, `ON CONFLICT DO NOTHING` etc.

### Applying to Staging

Connect to the self-hosted Supabase PostgreSQL:

```bash
ssh deploy@100.84.14.93
psql -h localhost -p 6543 -U supabase_admin -d postgres -f migration.sql
```

Or from local via SSH tunnel:
```bash
ssh -L 6543:localhost:6543 deploy@100.84.14.93
psql -h localhost -p 6543 -U supabase_admin -d postgres -f migration.sql
```

### Applying to Production

```bash
export PGPASSWORD='<password>'
psql -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 \
  -U postgres.hsvmvmurvpqcdmxckhnz -d postgres \
  -f supabase/migrations/<migration>.sql
```

Or use the Supabase Dashboard SQL Editor for production.

### Migration Checklist

When creating a migration:

1. Write the `.sql` file in `supabase/migrations/`
2. Test on staging first: `psql -h localhost -p 6543 ...`
3. Verify staging behavior in the app
4. Apply to production: `psql -h pooler ... -f migration.sql`
5. Commit the migration file and push

## Known Differences

### Storage (RLS Policies)

| Policy | Staging | Production |
|---|---|---|
| Signature SELECT | `users_select_own_signatures` (path-scoped) | `authenticated_users_read_documents` (bucket-wide) |

Production has broader read policies that cover signatures. Staging has path-scoped policies. Both work correctly.

### Storage API Behavior

**Staging (self-hosted)**: Kong gateway requires `apikey` header for ALL requests, including public bucket URLs. Use `createSignedUrl()` instead of `getPublicUrl()` for any `<img>` tag display.

**Production (Supabase Cloud)**: `getPublicUrl()` works normally for public buckets.

The code uses `createSignedUrl()` which works on both environments.

### Docker Networking (Staging only)

Coolify rotates container names on every deploy (e.g., `m85fvkzz5lgmq36kdvzc2jvh-<timestamp>`). A cron job (`/home/deploy/apps/getouch.co/infra/scripts/fix-serapod-alias.sh`) runs every minute to assign the stable alias `serapod-web-stg` to the current container. Caddyfile references this alias.

If staging shows 502 after a deploy, the cron will fix it within 60 seconds. To fix immediately:
```bash
ssh deploy@100.84.14.93 "/home/deploy/apps/getouch.co/infra/scripts/fix-serapod-alias.sh"
```

## Quick Reference

```bash
# Check staging container
ssh deploy@100.84.14.93 "docker ps --filter name=m85fvkzz5lgmq36kdvzc2jvh --format '{{.Names}} {{.Status}}'"

# Check staging alias is active
ssh deploy@100.84.14.93 "docker inspect \$(docker ps --filter name=m85fvkzz5lgmq36kdvzc2jvh -q) --format '{{json .NetworkSettings.Networks}}' | grep serapod-web-stg"

# Restart Caddy (admin off, so must docker restart)
ssh deploy@100.84.14.93 "docker restart caddy"

# Staging DB shell
ssh deploy@100.84.14.93 "docker exec -it \$(docker ps --filter name=serapod-stg-db -q) psql -U supabase_admin -d postgres"

# Production DB shell
psql -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.hsvmvmurvpqcdmxckhnz -d postgres
```
