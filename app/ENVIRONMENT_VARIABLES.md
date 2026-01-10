# Environment Variables Configuration

This document explains how to configure environment variables for different environments (develop, staging, and production) on Vercel.

## Required Environment Variable

For all environments (develop, staging, and production), you need to set:

```
NEXT_PUBLIC_ACCOUNTING_ENABLED=true
```

This enables the accounting module throughout the application.

## How to Configure on Vercel

### Method 1: Via Vercel Dashboard (Recommended)

1. Go to your project on [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project (serapod2u_new)
3. Go to **Settings** → **Environment Variables**
4. Add the following environment variable:
   - **Key:** `NEXT_PUBLIC_ACCOUNTING_ENABLED`
   - **Value:** `true`
   - **Environments:** Select all:
     - ✅ Production (github `main` branch)
     - ✅ Preview (github `develop` branch)
     - ✅ Development (local)
5. Click **Save**
6. **Redeploy** your application for changes to take effect:
   - Go to **Deployments**
   - Click on the latest deployment
   - Click **⋯ (three dots)** → **Redeploy**

### Method 2: Via Vercel CLI

```bash
# For production (main branch)
vercel env add NEXT_PUBLIC_ACCOUNTING_ENABLED production

# For preview/develop (develop branch)
vercel env add NEXT_PUBLIC_ACCOUNTING_ENABLED preview

# For development (local)
vercel env add NEXT_PUBLIC_ACCOUNTING_ENABLED development
```

When prompted, enter: `true`

### Method 3: Bulk Import (All at Once)

Create a file named `env-vars.txt`:

```
NEXT_PUBLIC_ACCOUNTING_ENABLED=true
```

Then run:
```bash
vercel env pull .env.local
```

## Branch to Environment Mapping

| Branch | Vercel Environment | URL Pattern |
|--------|-------------------|-------------|
| `main` | Production | serapod2u.com |
| `develop` | Preview | dev.serapod2u.com or *-git-develop-*.vercel.app |
| `staging` | Preview | staging.serapod2u.com or *-git-staging-*.vercel.app |

## Verification

After deploying, verify the accounting module is enabled by:

1. Visit your deployment URL
2. Login as HQ Admin or Super Admin
3. Go to **Settings** → **Accounting** tab
4. You should see "Accounting Module Enabled" status with green checkmark
5. If you see "Module Not Enabled" warning, the environment variable was not set correctly

## Troubleshooting

If the accounting module is still disabled after setting the environment variable:

1. **Check the environment variable is set:**
   ```bash
   vercel env ls
   ```

2. **Ensure you redeployed after setting the variable:**
   - Environment variables only take effect after redeployment
   - Go to Vercel Dashboard → Deployments → Redeploy

3. **Check the build logs:**
   - Vercel Dashboard → Deployments → Click on deployment → View Build Logs
   - Look for any errors related to environment variables

4. **Verify in browser console:**
   ```javascript
   console.log(process.env.NEXT_PUBLIC_ACCOUNTING_ENABLED)
   ```
   Should output: `true`

## Local Development

For local development, the variable is already set in `.env.local`:

```dotenv
NEXT_PUBLIC_ACCOUNTING_ENABLED=true
```

This file is git-ignored and only used for local development. Vercel deployments do not use this file.

## Important Notes

- ⚠️ Variables starting with `NEXT_PUBLIC_` are exposed to the browser
- ⚠️ Changes to environment variables require redeployment to take effect
- ⚠️ Each branch (main, develop, staging) needs the variable set in Vercel
- ⚠️ `.env.local` is not used by Vercel - you must set variables in Vercel Dashboard
