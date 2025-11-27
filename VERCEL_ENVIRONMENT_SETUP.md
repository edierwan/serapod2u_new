# Vercel Environment Variables Setup Guide

## 🎯 Overview
This guide shows you how to configure environment variables in Vercel so the login page displays the correct badge for each environment.

## 📋 Expected Results

| Environment | Domain | Badge Display |
|------------|--------|---------------|
| **Local Dev** | `localhost:3000` | `ENVIRONMENT: DEVELOPMENT` |
| **Staging** | `dev.serapod2u.com` | `ENVIRONMENT: STAGING` |
| **Production** | `serapod2u.com` | `ENVIRONMENT: PRODUCTION` |

---

## ⚙️ Vercel Dashboard Configuration

### Step 1: Access Environment Variables
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your **serapod2u** project
3. Click **Settings** tab
4. Navigate to **Environment Variables** section

### Step 2: Add NEXT_PUBLIC_VERCEL_ENV Variable

You need to add this variable **THREE TIMES** - once for each environment:

#### For Production (serapod2u.com)
```
Key:   NEXT_PUBLIC_VERCEL_ENV
Value: production
Environment: Production (✓)
```

#### For Staging (dev.serapod2u.com)
```
Key:   NEXT_PUBLIC_VERCEL_ENV
Value: preview
Environment: Preview (✓)
```

#### For Development (optional - Next.js handles this automatically)
```
Key:   NEXT_PUBLIC_VERCEL_ENV
Value: development
Environment: Development (✓)
```

### Step 3: Redeploy Your Application

After adding the environment variables:
1. Go to **Deployments** tab
2. For **Production**: Click on latest deployment → **Redeploy**
3. For **Staging**: Trigger a new deployment by pushing to `staging` branch

---

## 🔧 Detailed Instructions with Screenshots

### Adding Environment Variable in Vercel

1. **Click "Add New" button** in Environment Variables section

2. **Fill in the form:**
   - **Name**: `NEXT_PUBLIC_VERCEL_ENV`
   - **Value**: `production` (or `preview` for staging)
   - **Select Environments**: Check the appropriate box
     - ✓ Production (for main branch)
     - ✓ Preview (for staging branch)
     - ✓ Development (for local dev)

3. **Save** the variable

4. **Repeat** for each environment with correct value:
   - Production → `production`
   - Preview → `preview`

### Environment Selection Explained

- **Production**: Used when deploying from `main` branch to `serapod2u.com`
- **Preview**: Used when deploying from `staging` branch to `dev.serapod2u.com`
- **Development**: Used for local development (Next.js auto-sets this)

---

## 🧪 Verification Steps

### 1. Check Local Development
```bash
cd /Users/macbook/serapod2u_new/app
npm run dev
```
Visit `http://localhost:3000/login`
- ✅ Should show: **"ENVIRONMENT: DEVELOPMENT"** badge

### 2. Check Staging (after Vercel configuration)
Visit `https://dev.serapod2u.com/login`
- ✅ Should show: **"ENVIRONMENT: STAGING"** badge

### 3. Check Production
Visit `https://serapod2u.com/login`
- ✅ Should show: **"ENVIRONMENT: PRODUCTION"** badge

---

## 🛠️ Troubleshooting

### Badge not showing on localhost
**Solution:**
- Make sure dev server is running
- Check browser console for errors
- Verify the file `/utils/environment.ts` exists

### Badge showing wrong text on Vercel
**Solution:**
1. Verify environment variable is set correctly in Vercel dashboard
2. Check that you selected the correct environment (Production/Preview)
3. Redeploy the application after adding variables

### Badge not showing on staging (dev.serapod2u.com)
**Solution:**
1. Ensure `NEXT_PUBLIC_VERCEL_ENV=preview` is set for **Preview** environment
2. Push a new commit to `staging` branch to trigger deployment
3. Wait for deployment to complete (check Vercel dashboard)

### Badge showing on production (when it shouldn't)
**Note:** Based on requirements, production SHOULD show a badge.
If you want to hide it on production, modify `/utils/environment.ts`:

```typescript
if (vercelEnv === 'production') {
  return { badge: '', show: false }  // Hide on production
}
```

---

## 📁 Code Changes Made

### 1. Created `/utils/environment.ts`
This utility function detects the environment and returns the appropriate badge text.

### 2. Updated `LoginForm.tsx`
Replaced manual environment detection with the shared utility function.

### 3. Updated `.env` files
Added comments to clarify which environment each file is for.

---

## 🚀 Deployment Checklist

- [ ] Code changes committed and pushed to GitHub
- [ ] `NEXT_PUBLIC_VERCEL_ENV=production` added to Vercel (Production environment)
- [ ] `NEXT_PUBLIC_VERCEL_ENV=preview` added to Vercel (Preview environment)
- [ ] Production deployment redeployed
- [ ] Staging branch pushed to trigger new deployment
- [ ] Verified badge shows correctly on localhost
- [ ] Verified badge shows correctly on dev.serapod2u.com
- [ ] Verified badge shows correctly on serapod2u.com

---

## 💡 Why This Approach?

### ✅ Advantages:
1. **Same codebase** deployed everywhere
2. **Environment variables** control the badge text
3. **No code changes** needed when deploying
4. **Follows Vercel best practices**
5. **Easy to maintain** and understand

### ❌ What NOT to use:
- `process.env.NODE_ENV` - Only indicates build mode (development/production), not deployment environment
- Hostname detection only - Won't work for custom domains or changes
- Hardcoded values - Requires code changes for different environments

---

## 📞 Support

If you encounter issues:
1. Check Vercel deployment logs
2. Verify environment variables are set correctly
3. Ensure domain configuration is correct
4. Clear browser cache and retry

## 🎉 Expected Final Result

After completing this setup:
- **Localhost**: Shows "ENVIRONMENT: DEVELOPMENT" 🟡
- **Staging (dev.serapod2u.com)**: Shows "ENVIRONMENT: STAGING" 🟡
- **Production (serapod2u.com)**: Shows "ENVIRONMENT: PRODUCTION" 🟡

All badges use the same amber/orange background color (`bg-amber-500`).
