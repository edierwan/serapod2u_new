# Vercel Staging Branch Setup Guide

## Current Issue
Vercel is only deploying the `main` branch. The `staging` branch needs to be configured for deployment to `dev.serapod2u.com`.

## Solution: Configure Vercel Dashboard

### Step 1: Access Project Settings
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select the `serapod2u` project
3. Click on **Settings** tab

### Step 2: Configure Git Integration
1. In Settings, navigate to **Git** section
2. Look for **Production Branch** setting
   - This should be set to: `main`
3. Look for **Deploy Hooks** or **Branch Deployments** section

### Step 3: Enable Staging Branch Deployment
1. Find **Branch Deployments** section
2. Ensure these settings:
   - ✅ **Production Branch**: `main`
   - ✅ **Preview Deployments**: Enabled
   - ✅ **Automatic Deployments from Git**: Enabled

### Step 4: Configure Custom Domains
1. In Settings, go to **Domains** section
2. Verify domain configuration:
   - `serapod2u.com` → **main** branch (Production)
   - `dev.serapod2u.com` → **staging** branch (Preview/Staging)

### Step 5: Add Staging Domain
If `dev.serapod2u.com` is not configured:
1. Click **Add** or **Add Domain**
2. Enter: `dev.serapod2u.com`
3. Select **Git Branch**: `staging`
4. Click **Add**

### Step 6: Environment Variables (if needed)
For the staging branch specifically:
1. Go to **Settings** → **Environment Variables**
2. For staging-specific variables, select:
   - Environment: **Preview** (this applies to staging)
   - Or select specific branch: **staging**

## Expected Result
After configuration:
- **main** branch → `serapod2u.com` (Production, no environment badge)
- **staging** branch → `dev.serapod2u.com` (Preview, shows "Environment: Staging" badge)
- **develop** branch → Auto-generated preview URL (not used for production)

## Verification
1. Push a commit to `staging` branch
2. Check Vercel Deployments tab - you should see:
   - A deployment for `staging` branch
   - It should be linked to `dev.serapod2u.com`
3. Visit `dev.serapod2u.com` - should show "Environment: Staging" badge on login page
4. Visit `serapod2u.com` - should show no badge on login page

## Code Changes Made
- ✅ Updated `LoginForm.tsx` to detect and show environment badges
- ✅ Updated `vercel.json` to specify deployment configuration
- ✅ Synced changes to all branches (main, develop, staging)

## Current Status
- ✅ Code changes pushed to GitHub
- ⏳ **Manual action required**: Configure Vercel dashboard settings as described above
- ⏳ Verify staging deployments appear in Vercel

## Troubleshooting

### Staging branch not deploying
1. Check if Git integration is properly connected
2. Verify the staging branch exists on GitHub (it does - confirmed)
3. Check Vercel project settings for ignored branches
4. Try triggering a manual deployment from Vercel dashboard

### Domain not pointing to staging
1. Verify DNS settings are correct
2. Check domain configuration in Vercel
3. Ensure staging branch is selected for `dev.serapod2u.com`

### Environment badge not showing
1. Clear browser cache
2. Wait for Vercel deployment to complete
3. Check browser console for JavaScript errors
4. Verify `NEXT_PUBLIC_VERCEL_ENV` is set by Vercel (automatic)
