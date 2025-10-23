# 🚨 Danger Zone Feature - COMPLETE ✅

## Overview
Complete implementation of the Danger Zone feature for system reset during testing/demo phase. This feature allows Super Admins to delete transaction data or perform a complete system reset while preserving the Super Admin account.

---

## 📁 Files Created/Modified

### 1. **UI Component** (Complete ✅)
- **File**: `app/src/components/settings/DangerZoneTab.tsx` (637 lines)
- **Status**: ✅ No errors
- **Features**:
  - ✅ Super Admin access control (role_level === 1)
  - ✅ Export backup button (downloads JSON backup)
  - ✅ Delete Transactions option (orange warning)
  - ✅ Delete All Data option (red warning, dual confirmation)
  - ✅ Text verification inputs ("DELETE TRANSACTIONS" / "DELETE ALL DATA")
  - ✅ Confirmation checkboxes
  - ✅ Loading states with spinner
  - ✅ Toast notifications for success/error

### 2. **Settings Integration** (Complete ✅)
- **File**: `app/src/components/settings/SettingsView.tsx`
- **Status**: ✅ No errors
- **Changes**:
  - ✅ Added DangerZoneTab import
  - ✅ Added AlertTriangle icon import
  - ✅ Conditional tab (only for role_level === 1)
  - ✅ Tab content rendering

### 3. **API Endpoints** (All Complete ✅)

#### 3a. Delete Transactions Only
- **File**: `app/src/app/api/admin/delete-transactions/route.ts` (177 lines)
- **Status**: ✅ No errors
- **Deletes**:
  1. Document workflows
  2. QR codes (individual)
  3. QR master codes
  4. QR batches
  5. Payments
  6. Invoices
  7. Shipments
  8. Order items
  9. Orders
  10. Storage files (QR Excel, documents)
- **Preserves**: All master data (users, organizations, products)

#### 3b. Delete All Data (Complete Reset)
- **File**: `app/src/app/api/admin/delete-all-data/route.ts` (343 lines)
- **Status**: ✅ No errors
- **Three-Phase Deletion**:
  - **Phase 1**: Transaction data (same as above)
  - **Phase 2**: Master data (products, variants, brands, categories, shop-distributor links, users except Super Admin, all organizations)
  - **Phase 3**: Storage files (all buckets, preserves Super Admin avatar only)
- **Safety Measures**:
  - ✅ `.neq('id', user.id)` - Excludes current user
  - ✅ `.neq('role_code', 'SADM')` - Extra Super Admin protection
  - ✅ Preserves Super Admin's avatar folder
  - ✅ Detailed logging with phase markers
- **Returns**: Total count, database records count, storage files count, preserved user email

#### 3c. Export Data (Backup)
- **File**: `app/src/app/api/admin/export-data/route.ts` (277 lines)
- **Status**: ✅ No errors
- **Exports**:
  - ✅ All transaction data (orders, QR codes, invoices, payments, shipments, document workflows)
  - ✅ All master data (organizations, users, products, variants, brands, categories, shop-distributors)
  - ✅ All system reference data (roles, org types, countries, states, districts)
  - ✅ Statistics summary with counts
  - ✅ Export metadata (timestamp, exported by, version)
- **Returns**: JSON file download with filename format: `serapod2u-backup-YYYY-MM-DD.json`

#### 3d. Send Deletion Notification
- **File**: `app/src/app/api/admin/send-deletion-notification/route.ts` (295 lines)
- **Status**: ✅ No errors
- **Features**:
  - ✅ Two email templates (transactions vs full reset)
  - ✅ HTML formatted emails with styling
  - ✅ Detailed deletion summary
  - ✅ Timestamp in Malaysia timezone
  - ✅ Lists what was deleted vs preserved
  - ✅ Ready for email service integration (SendGrid/AWS SES/Postmark/Resend)
- **Current State**: Logs email preview (email service integration needed)

---

## 🔐 Security Features

1. **Super Admin Only**
   - All endpoints check `role_level === 1`
   - UI shows "Access Denied" for non-Super Admins
   - Settings tab only visible to Super Admin

2. **Dual Confirmation for Full Reset**
   - Text verification required
   - Confirmation checkbox required
   - Two-step dialog process

3. **Super Admin Preservation**
   - Current user ID excluded from deletions
   - Extra check: `.neq('role_code', 'SADM')`
   - Super Admin's avatar folder preserved

4. **Audit Trail**
   - Detailed console logging
   - Phase markers for debugging
   - Returns deletion counts and details

---

## 📊 Deletion Summary

### Delete Transactions Only (Orange)
**What's Deleted:**
- ✅ All orders & order items
- ✅ All QR codes (batches, master codes, individual)
- ✅ All invoices & payments
- ✅ All shipments
- ✅ All document workflows
- ✅ Related storage files

**What's Preserved:**
- ✅ All users
- ✅ All organizations
- ✅ All products & variants
- ✅ All brands & categories
- ✅ All master data

### Delete All Data (Red)
**What's Deleted:**
- ✅ Everything from "Delete Transactions"
- ✅ All products & variants
- ✅ All brands & categories
- ✅ All organizations
- ✅ All shop-distributor relationships
- ✅ All users (except Super Admin)
- ✅ All storage files (except Super Admin avatar)

**What's Preserved:**
- ✅ Super Admin account
- ✅ Super Admin avatar
- ✅ System reference data (roles, org types, countries, states, districts)

---

## 🧪 Testing Checklist

### Pre-Testing Setup
- [ ] Ensure you're logged in as Super Admin
- [ ] Create test data (orders, products, organizations, users)
- [ ] Verify role_level = 1 in database

### Test 1: Access Control
- [ ] Login as non-Super Admin → Should see "Access Denied"
- [ ] Login as Super Admin → Should see all controls

### Test 2: Export Backup
- [ ] Click "Export Backup" button
- [ ] Should download JSON file
- [ ] Verify filename format: `serapod2u-backup-YYYY-MM-DD.json`
- [ ] Open JSON file and verify data structure
- [ ] Check statistics section for record counts

### Test 3: Delete Transactions
- [ ] Note current transaction counts in database
- [ ] Open "Delete Transactions" dialog
- [ ] Type "DELETE TRANSACTIONS" (exact text)
- [ ] Check confirmation checkbox
- [ ] Click confirm
- [ ] Wait for completion toast
- [ ] Verify:
  - [ ] All orders deleted
  - [ ] All QR codes deleted
  - [ ] All invoices/payments deleted
  - [ ] Users still exist
  - [ ] Products still exist
  - [ ] Organizations still exist
- [ ] Check browser console for detailed logs

### Test 4: Delete All Data
- [ ] Re-create test data (transactions + master data)
- [ ] Export backup first
- [ ] Open "Delete All Data" dialog
- [ ] First confirmation:
  - [ ] Type "DELETE ALL DATA"
  - [ ] Check confirmation checkbox
  - [ ] Click confirm
- [ ] Second confirmation (dual-check):
  - [ ] Click final confirm
- [ ] Wait for completion toast
- [ ] Verify:
  - [ ] All transactions deleted
  - [ ] All organizations deleted
  - [ ] All products deleted
  - [ ] All users deleted (except you)
  - [ ] Your Super Admin account still exists
  - [ ] Your avatar still exists
  - [ ] Can still login
- [ ] Check browser console for phase logs

### Test 5: Email Notifications (Optional)
- [ ] If email service configured: Check inbox for notification emails
- [ ] If not configured: Check console logs for email preview

---

## 🚀 Deployment Steps

### Phase 1: Local Testing (Current)
1. ✅ All code complete
2. ⏳ **YOU ARE HERE** - Ready for testing
3. ⏳ Run tests above
4. ⏳ Verify functionality
5. ⏳ Check for any issues

### Phase 2: Code Review
1. ⏳ Review all changes
2. ⏳ Ensure Super Admin safety
3. ⏳ Verify deletion order (foreign keys)

### Phase 3: Git Commit (After Your Approval)
```bash
# When you're ready to commit:
git add app/src/components/settings/DangerZoneTab.tsx
git add app/src/components/settings/SettingsView.tsx
git add app/src/app/api/admin/delete-transactions/route.ts
git add app/src/app/api/admin/delete-all-data/route.ts
git add app/src/app/api/admin/export-data/route.ts
git add app/src/app/api/admin/send-deletion-notification/route.ts

git commit -m "Add Danger Zone feature for system reset

- Add DangerZoneTab component (Super Admin only)
- Implement delete transactions endpoint (preserves master data)
- Implement delete all data endpoint (complete reset, preserves Super Admin)
- Add data export/backup functionality (JSON download)
- Add email notification system (ready for email service integration)
- Dual confirmation for full reset with text verification
- Comprehensive logging and audit trail"

git push origin main
```

---

## 📧 Email Service Integration (Optional)

The notification endpoint is ready for email service integration. To enable:

### Option 1: SendGrid
```typescript
// Add to .env.local:
SENDGRID_API_KEY=your_api_key
SENDGRID_FROM_EMAIL=noreply@serapod2u.com

// Uncomment the SendGrid code in send-deletion-notification/route.ts
```

### Option 2: AWS SES
```typescript
// Install AWS SDK
npm install @aws-sdk/client-ses

// Add to .env.local:
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_SES_FROM_EMAIL=noreply@serapod2u.com
```

### Option 3: Resend
```typescript
// Install Resend
npm install resend

// Add to .env.local:
RESEND_API_KEY=your_api_key
RESEND_FROM_EMAIL=noreply@serapod2u.com
```

---

## 🛡️ Safety Checklist

✅ **Code Safety**
- [x] Super Admin role check in all endpoints
- [x] Current user excluded from deletions
- [x] Extra SADM role check
- [x] Avatar folder preservation
- [x] Detailed error handling

✅ **UI Safety**
- [x] Access control (role_level check)
- [x] Text verification required
- [x] Confirmation checkboxes
- [x] Dual dialogs for full reset
- [x] Color-coded warnings (orange/red)

✅ **Database Safety**
- [x] Proper foreign key deletion order
- [x] Transaction data before master data
- [x] .delete({ count: 'exact' }) for all deletes
- [x] Error handling with try-catch

✅ **Storage Safety**
- [x] List files before deleting
- [x] Batch deletion (100 files at a time)
- [x] Preserve Super Admin avatar
- [x] Error handling for storage operations

---

## 📝 Notes

1. **Testing Environment**: This feature is designed for testing/demo environments. Use with extreme caution in production.

2. **Backup First**: Always export backup before deletion, especially for full reset.

3. **Email Integration**: Email notifications are prepared but require email service setup (SendGrid/AWS SES/Resend).

4. **Super Admin Preservation**: Your Super Admin account is ALWAYS preserved during full reset. You will not be locked out.

5. **System Reference Data**: Countries, states, districts, roles, and organization types are NOT deleted even in full reset (they're system data).

6. **Git Push**: DO NOT push to GitHub until testing is complete and approved.

---

## 🎯 Current Status

**✅ COMPLETE - READY FOR TESTING**

All code is written, compiled without errors, and ready for local testing. Please test thoroughly before pushing to GitHub.

**Next Steps:**
1. Test each deletion option
2. Verify Super Admin preservation
3. Check email notifications (console logs)
4. Approve for Git commit

---

## 📞 Support

If you encounter any issues during testing:
1. Check browser console logs (detailed phase logs)
2. Check server console logs (API endpoint logs)
3. Verify Super Admin role (role_level = 1)
4. Export backup before testing deletions

---

**Generated**: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}
**Status**: ✅ All files created, no errors
**Ready for**: Local testing
