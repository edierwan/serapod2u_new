# Payment Terms Feature - Complete Implementation Guide

## Overview
This feature allows organizations (Manufacturers, Distributors, Shops) to define their preferred payment terms, which automatically determine the deposit/balance split in order document workflows.

## Issues Resolved

### Issue 1: State/District "None" Option ✅
**Problem:** Organizations from countries outside Malaysia (e.g., China manufacturers) couldn't skip state/district selection.

**Solution:** 
- Added "None (Not defined)" option to State and District dropdowns
- Works in both AddOrganizationView and EditOrganizationView
- When "None" state is selected, district is automatically cleared

### Issue 2: Configurable Payment Terms ✅
**Problem:** System was hardcoded to 50/50 payment split. Business needs flexibility for different payment terms (30/70, 10/90, etc.) based on the seller organization.

**Solution:**
- Created payment_terms master table with predefined options
- Added payment_term_id to organizations table
- Order creation automatically fetches seller's payment terms
- Document workflow dynamically displays correct percentages

---

## Database Schema

### New Table: `payment_terms`

```sql
CREATE TABLE public.payment_terms (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    term_code TEXT NOT NULL UNIQUE,
    term_name TEXT NOT NULL,
    deposit_percentage NUMERIC(5,2) NOT NULL CHECK (deposit_percentage >= 0 AND deposit_percentage <= 100),
    balance_percentage NUMERIC(5,2) NOT NULL CHECK (balance_percentage >= 0 AND balance_percentage <= 100),
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT payment_terms_percentages_sum CHECK (deposit_percentage + balance_percentage = 100)
);
```

**Default Payment Terms Seeded:**
| Code | Name | Deposit % | Balance % | Description |
|------|------|-----------|-----------|-------------|
| 50_50 | 50/50 Split | 50 | 50 | Standard (Default) |
| 30_70 | 30/70 Split | 30 | 70 | Lower deposit |
| 70_30 | 70/30 Split | 70 | 30 | Higher deposit |
| 10_90 | 10/90 Split | 10 | 90 | Minimal deposit |
| 100_0 | Full Prepayment | 100 | 0 | 100% upfront |
| 0_100 | Cash on Delivery | 0 | 100 | Full payment on delivery |

### Modified Table: `organizations`

```sql
ALTER TABLE public.organizations
ADD COLUMN payment_term_id UUID REFERENCES public.payment_terms(id);
```

**Purpose:** Links organization to their default payment terms.

---

## Component Changes

### 1. AddOrganizationView.tsx

**Changes:**
- Added `PaymentTerm` interface
- Added `paymentTerms` state
- Added `payment_term_id` to formData
- Fetches payment terms on mount and sets default term
- New UI section "Payment Terms" (visible for MANU, DIST, SHOP only)
- Dropdown shows term name with "(Default)" indicator
- Helper text explains how it affects orders

**UI Location:** Between "Address Information" and "Contact Information" cards

**Code Sample:**
```tsx
{(formData.org_type_code === 'MANU' || formData.org_type_code === 'DIST' || formData.org_type_code === 'SHOP') && (
  <Card>
    <CardHeader>
      <CardTitle>Payment Terms</CardTitle>
      <CardDescription>Default payment terms for orders with this organization as seller</CardDescription>
    </CardHeader>
    <CardContent>
      <Select value={formData.payment_term_id} onValueChange={...}>
        {paymentTerms.map(term => (
          <SelectItem value={term.id}>
            {term.term_name} {term.is_default && '(Default)'}
          </SelectItem>
        ))}
      </Select>
    </CardContent>
  </Card>
)}
```

### 2. EditOrganizationView.tsx

**Changes:** Same as AddOrganizationView
- Added `PaymentTerm` interface and state
- Added `loadPaymentTerms()` function
- Same UI section for editing payment terms
- Loads current organization's payment term on mount

### 3. CreateOrderView.tsx

**Changes:**
- Fetches seller organization's payment terms during order creation
- Builds `payment_terms` JSONB based on organization's settings
- Falls back to 50/50 if no payment term defined

**Code Sample:**
```tsx
// Fetch seller organization's payment terms
const { data: sellerOrgData } = await supabase
  .from('organizations')
  .select('payment_term_id, payment_terms(deposit_percentage, balance_percentage)')
  .eq('id', sellerOrg.id)
  .single()

// Build payment_terms jsonb
let paymentTermsData = {
  deposit_pct: 0.5,
  balance_pct: 0.5,
  balance_trigger: 'on_first_receive'
}

if (sellerOrgData?.payment_terms) {
  const depositPct = sellerOrgData.payment_terms.deposit_percentage / 100
  const balancePct = sellerOrgData.payment_terms.balance_percentage / 100
  paymentTermsData = {
    deposit_pct: depositPct,
    balance_pct: balancePct,
    balance_trigger: 'on_first_receive'
  }
}

const orderData = {
  // ...other fields...
  payment_terms: paymentTermsData,
}
```

### 4. OrderDocumentsDialogEnhanced.tsx

**Changes:**
- Replaced hardcoded `is50_50Split` logic with dynamic `useSplitPayment`
- Added `depositPercentage` calculation from `order.payment_terms.deposit_pct`
- Passes `depositPercentage` to DocumentWorkflowProgress component

**Code Sample:**
```tsx
// Check if this order uses split payment (deposit + balance)
const useSplitPayment = useMemo(() => {
  const depositPct = orderData?.payment_terms?.deposit_pct ?? 0.5
  return depositPct > 0 && depositPct < 1
}, [orderData])

// Get deposit percentage for display
const depositPercentage = useMemo(() => {
  const depositPct = orderData?.payment_terms?.deposit_pct ?? 0.5
  return Math.round(depositPct * 100)
}, [orderData])
```

### 5. DocumentWorkflowProgress.tsx

**Changes:**
- Added `depositPercentage` prop (default: 50)
- Calculates `balancePercentage = 100 - depositPercentage`
- Dynamic labels in split payment steps
- Dynamic workflow description text

**Before:**
```
Deposit Invoice (50%)
Deposit Payment (50%)
Balance Request (50%)
Balance Payment (50%)
```

**After:**
```
Deposit Invoice (30%)  // Dynamic based on payment terms
Deposit Payment (30%)
Balance Request (70%)
Balance Payment (70%)
```

---

## Data Flow

```
┌─────────────────────┐
│ payment_terms       │
│ (Master Data)       │
│ - 50/50 (default)   │
│ - 30/70             │
│ - 10/90             │
│ - 100/0             │
│ - 0/100             │
└──────────┬──────────┘
           │
           │ FK: payment_term_id
           ▼
┌─────────────────────┐
│ organizations       │
│ (MANU/DIST/SHOP)    │
│ - payment_term_id   │
└──────────┬──────────┘
           │
           │ Fetch on order creation
           ▼
┌─────────────────────┐
│ orders              │
│ - payment_terms:    │
│   {                 │
│     deposit_pct,    │
│     balance_pct,    │
│     balance_trigger │
│   }                 │
└──────────┬──────────┘
           │
           │ Read on document view
           ▼
┌─────────────────────┐
│ Document Workflow   │
│ - Dynamic labels    │
│ - Dynamic %         │
└─────────────────────┘
```

---

## Migration Instructions

### Step 1: Apply Database Migration

**File:** `supabase/migrations/032_payment_terms_master_data.sql`

**Via Supabase Dashboard (SQL Editor):**
1. Go to Supabase Dashboard → SQL Editor
2. Copy and paste the contents of `032_payment_terms_master_data.sql`
3. Click "Run"

**Via Supabase CLI:**
```bash
cd /Users/macbook/serapod2u_new
supabase db push
```

**What it does:**
- Creates `payment_terms` table
- Seeds 6 default payment terms
- Adds `payment_term_id` column to `organizations`
- Sets default 50/50 term for existing manufacturers/distributors/shops
- Creates indexes and triggers

### Step 2: Verify Migration

```sql
-- Check payment terms exist
SELECT * FROM payment_terms ORDER BY sort_order;

-- Check organizations have payment terms
SELECT 
  org_name, 
  org_type_code,
  pt.term_name
FROM organizations o
LEFT JOIN payment_terms pt ON o.payment_term_id = pt.id
WHERE o.org_type_code IN ('MANU', 'DIST', 'SHOP')
LIMIT 10;
```

---

## Testing Checklist

### State/District None Option
- [ ] ✅ Create new organization → Select "None" for State → District shows "None (Not defined)"
- [ ] ✅ Edit existing organization → Can select "None" for State/District
- [ ] ✅ Select State, then change to "None" → District clears automatically

### Payment Terms - Organization Management
- [ ] ✅ Create new Manufacturer → Payment Terms section appears
- [ ] ✅ Payment Terms dropdown shows all 6 options with "(Default)" indicator
- [ ] ✅ Default 50/50 term is pre-selected
- [ ] ✅ Select 30/70 term → Description shows "30% deposit, 70% balance payment"
- [ ] ✅ Save organization → payment_term_id stored in database
- [ ] ✅ Edit organization → Current payment term is selected
- [ ] ✅ Change payment term → Saves successfully

### Payment Terms - Order Creation
- [ ] ✅ Create order with seller that has 30/70 term → Order saves with correct payment_terms jsonb
- [ ] ✅ Verify order.payment_terms contains: `{deposit_pct: 0.3, balance_pct: 0.7, balance_trigger: "on_first_receive"}`

### Payment Terms - Document Workflow
- [ ] ✅ View order with 30/70 terms → Document workflow shows:
  - Deposit Invoice (30%)
  - Deposit Payment (30%)
  - Balance Request (70%)
  - Balance Payment (70%)
- [ ] ✅ Workflow description text: "Orders use a 30/70 payment split..."
- [ ] ✅ Test with 50/50 term → Shows "50%" labels
- [ ] ✅ Test with 100/0 term → Shows traditional 4-step workflow (no split)

---

## Use Cases

### Use Case 1: New Manufacturer from China
**Scenario:** Adding manufacturer from China that ships to Malaysia

**Steps:**
1. Create Organization → Type: Manufacturer
2. State: Select "None (Not defined)"
3. District: Shows "None (Not defined)" (disabled)
4. Payment Terms: Select "30/70 Split" (requires lower deposit)
5. Save

**Result:** Organization created without state/district, has 30/70 payment terms

### Use Case 2: Local Distributor with High Credit
**Scenario:** Trusted local distributor gets favorable terms

**Steps:**
1. Create Organization → Type: Distributor
2. State: Select "Selangor"
3. District: Select "Petaling Jaya"
4. Payment Terms: Select "10/90 Split" (low deposit, high trust)
5. Save

**Result:** Orders with this distributor will use 10/90 payment split

### Use Case 3: New Shop with Standard Terms
**Scenario:** New retail shop gets standard terms

**Steps:**
1. Create Organization → Type: Shop
2. Address: Fill in Malaysian address
3. Payment Terms: Keep default "50/50 Split"
4. Save

**Result:** Standard 50/50 payment terms applied

### Use Case 4: Create Order
**Scenario:** HQ creates order with manufacturer that has 30/70 terms

**Flow:**
1. Create Order (H2M)
2. Select Seller: Manufacturer ABC (has 30/70 terms)
3. Add Products
4. Submit Order

**Behind the Scenes:**
- System fetches Manufacturer ABC's payment term
- Sets order.payment_terms to `{deposit_pct: 0.3, balance_pct: 0.7, ...}`

**Result:**
- PO created
- When acknowledged → Deposit Invoice generated for 30% of order total
- After deposit paid → Goods shipped
- After receive → Balance Request generated for 70% of order total

---

## Document Workflow Impact

### Traditional 4-Step (100% prepayment or 100% COD)
```
PO → Invoice → Payment → Receipt
```

### Split Payment (Any percentage between 0 and 100)
```
PO → Deposit Invoice (X%) → Deposit Payment (X%) 
   → Warehouse Receive → Balance Request (Y%) 
   → Balance Payment (Y%) → Receipt
```

**Where:**
- X = deposit_percentage (e.g., 30, 50, 70)
- Y = 100 - X (e.g., 70, 50, 30)

### Financial Impact Example

**Order Total: RM 10,000**

**50/50 Terms:**
- Deposit Invoice: RM 5,000
- Balance Request: RM 5,000

**30/70 Terms:**
- Deposit Invoice: RM 3,000
- Balance Request: RM 7,000

**70/30 Terms:**
- Deposit Invoice: RM 7,000
- Balance Request: RM 3,000

---

## API / Database Queries

### Fetch Organization with Payment Terms
```sql
SELECT 
  o.*,
  pt.term_code,
  pt.term_name,
  pt.deposit_percentage,
  pt.balance_percentage
FROM organizations o
LEFT JOIN payment_terms pt ON o.payment_term_id = pt.id
WHERE o.id = '<org_id>';
```

### Get Orders by Payment Terms
```sql
SELECT 
  o.order_no,
  o.payment_terms->>'deposit_pct' as deposit_pct,
  o.payment_terms->>'balance_pct' as balance_pct,
  seller.org_name as seller_name
FROM orders o
JOIN organizations seller ON o.seller_org_id = seller.id
WHERE o.company_id = '<company_id>'
ORDER BY o.created_at DESC;
```

### Update Organization Payment Terms
```typescript
await supabase
  .from('organizations')
  .update({ payment_term_id: '<new_term_id>' })
  .eq('id', '<org_id>')
```

---

## Future Enhancements

### 1. Custom Payment Terms
Allow organizations to create custom payment terms beyond the 6 defaults:
- UI: "Add Custom Term" button
- Fields: Deposit %, Balance %, Description
- Validation: Ensure sum = 100%

### 2. Multiple Payment Milestones
Support 3+ payment milestones:
- Example: 20% deposit → 30% on shipment → 50% on delivery
- Requires schema changes to `payment_terms`

### 3. Payment Term History
Track changes to organization payment terms:
- Audit table: `organization_payment_term_history`
- Fields: org_id, old_term_id, new_term_id, changed_by, changed_at

### 4. Payment Term by Product Category
Different terms for different product types:
- Electronics: 50/50
- Perishables: 100% prepayment
- Bulk orders: 30/70

### 5. Automatic Payment Term Selection
Based on business rules:
- New customer: 100% prepayment
- After 5 successful orders: 50/50
- Premium customer: 30/70

---

## Rollback Plan

If issues occur, rollback steps:

### Step 1: Remove Payment Terms from Orders (Data Loss)
```sql
-- Revert all orders to default 50/50 terms
UPDATE orders
SET payment_terms = jsonb_build_object(
  'deposit_pct', 0.5,
  'balance_pct', 0.5,
  'balance_trigger', 'on_first_receive'
);
```

### Step 2: Remove Column from Organizations
```sql
ALTER TABLE organizations
DROP COLUMN IF EXISTS payment_term_id;
```

### Step 3: Drop Payment Terms Table
```sql
DROP TABLE IF EXISTS payment_terms CASCADE;
```

### Step 4: Revert Code Changes
```bash
git revert <commit_hash>
git push origin main
```

---

## Files Modified

### Database
- `supabase/migrations/032_payment_terms_master_data.sql` (NEW)

### Components - Organization Management
- `app/src/components/organizations/AddOrganizationView.tsx`
- `app/src/components/organizations/EditOrganizationView.tsx`

### Components - Order Management
- `app/src/components/orders/CreateOrderView.tsx`

### Components - Document Workflow
- `app/src/components/dashboard/views/orders/OrderDocumentsDialogEnhanced.tsx`
- `app/src/components/documents/DocumentWorkflowProgress.tsx`

### Documentation
- `app/docs/PAYMENT_TERMS_FEATURE.md` (THIS FILE)

---

## Summary

✅ **Issue 1 Resolved:** State/District "None" option for international organizations
✅ **Issue 2 Resolved:** Configurable payment terms for flexible B2B payment models

**Benefits:**
1. **Flexibility:** Support different business relationships with varied payment terms
2. **Automation:** Payment terms automatically apply to orders based on seller
3. **Transparency:** Clear visual indication of payment splits in document workflow
4. **Scalability:** Easy to add new payment terms or modify existing ones
5. **Global Support:** International organizations can skip regional address requirements

**No Breaking Changes:** 
- Existing orders continue to work (default 50/50)
- Existing organizations default to 50/50 if no term set
- Document workflow remains backward compatible
