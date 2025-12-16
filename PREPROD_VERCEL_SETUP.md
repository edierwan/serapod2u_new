# Preprod Environment Setup Guide

## Vercel Configuration for Preprod

### Step 1: Create Preprod Branch in GitHub

```bash
git checkout -b preprod
git push -u origin preprod
```

### Step 2: Configure Vercel Environment Variables

Go to your Vercel project: **Settings → Environment Variables**

Add these variables and select **Preview** environment (or create a separate project for preprod):

| Variable | Value | Environment |
|----------|-------|-------------|
| `NEXT_PUBLIC_APP_ENV` | `preprod` | Preview |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://jqihlckqrhdxszgwuymu.supabase.co` | Preview |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpxaWhsY2txcmhkeHN6Z3d1eW11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4OTEwNzMsImV4cCI6MjA4MTQ2NzA3M30._WWM_zrfHWYMsY081zis_8La_h6SOYWRglMc-dWmhqI` | Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpxaWhsY2txcmhkeHN6Z3d1eW11Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTg5MTA3MywiZXhwIjoyMDgxNDY3MDczfQ.13jLl6IUSspmcdXfbcRaq9t4Nv5_xIWxQrUxXzPCDng` | Preview |
| `DATABASE_POOL_URL` | `postgresql://postgres.jqihlckqrhdxszgwuymu:Turun_2020-@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres` | Preview |
| `NEXT_PUBLIC_APP_URL` | `http://www.pre.serapod2u.com` | Preview |
| `CRON_SECRET` | `84bf2b36d4ea9930f4f7b67382c7e94302f6c229a74e97f5508dbf770181b753` | Preview |

### Step 3: Set Custom Domain for Preprod

In Vercel **Settings → Domains**, add:
- `pre.serapod2u.com` or `www.pre.serapod2u.com`

Point your DNS to Vercel for this subdomain.

### Step 4: Deploy to Preprod

Push to the preprod branch:

```bash
git checkout preprod
git merge develop  # or your feature branch
git push
```

Vercel will automatically deploy to preview environment.

---

## Alternative: Separate Vercel Project

If you want complete isolation:

1. Create new Vercel project: **serapod2u-preprod**
2. Connect to same GitHub repo
3. Set **Production Branch** to `preprod`
4. Add all environment variables as **Production** scope
5. Add custom domain `pre.serapod2u.com`

---

## Quick Reference

### Production (main branch)
- URL: `www.serapod2u.com`
- Supabase: `bamybvzufxijghzqdytu`

### Preprod (preprod branch)
- URL: `www.pre.serapod2u.com`
- Supabase: `jqihlckqrhdxszgwuymu`

### Development (develop branch)
- Local only
- Uses `.env.local`
