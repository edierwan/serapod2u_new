# Distributor Order (D2H) Feature Implementation

## Overview

Implemented a new **Distributor Order** feature that allows distributors to
create D2H (Distributor to HQ) orders directly from the system. This feature is
accessible through the QR Tracking menu and also integrated into the Orders page
for seamless workflow.

## Changes Made

### 1. Navigation Menu Update

**File**: `/app/src/components/layout/Sidebar.tsx`

- Added "Distributor Order" menu item under QR Tracking section
- Accessible to DIST and HQ organization types (role level ≤ 40)
- Uses ShoppingCart icon

### 2. Dashboard Routing

**File**: `/app/src/components/dashboard/DashboardContent.tsx`

- Added import for `DistributorOrderView` component
- Added route case for `'distributor-order'` view

### 3. New Distributor Order Page

**File**: `/app/src/components/orders/DistributorOrderView.tsx` (NEW)

#### Features:

- **Customer Information Block**: Pre-filled with distributor's organization
  details
  - Customer Name
  - Phone Number
  - Delivery Address

- **Product Selection Block**:
  - Shows only products with **available inventory** (on_hand_qty > 0)
  - Uses **distributor_price** from product_variants table
  - Displays available stock for each product
  - Search and filter capabilities
  - Validates quantity against available stock

- **Order Summary Block** (Right sidebar):
  - Customer information display
  - Order type badge (D2H)
  - Organization details (Buyer/Seller)
  - Product list with quantities
  - Subtotal, Tax, and Total calculations

#### Technical Implementation:

- Queries inventory table to get available quantities per variant
- Filters products to show only those with stock > 0
- Uses distributor_price for pricing calculations
- Generates order numbers with format: `D2H-MMDD-XX`
- Creates order with 'draft' status first (RLS requirement), then updates to
  'submitted'
- Stores customer info in notes field (format:
  `Customer: {name}, Phone: {phone}, Address: {address}`)

### 4. Orders Page Enhancement

**File**: `/app/src/components/orders/OrdersView.tsx`

#### Changes:

- Added `showOrderTypeDialog` state for dialog visibility
- Modified `handleCreateOrder` function to detect DIST organization type
- Added `handleOrderTypeSelection` function to route to appropriate view
- Added Order Type Selection Dialog:
  - Shows when distributors click "Create Order"
  - Two options:
    1. **Distributor to HQ (D2H)**: Routes to new DistributorOrderView
    2. **Regular Order**: Routes to standard CreateOrderView
  - Clean UI with icons and descriptions

### 5. Order Type Filter

The existing D2H filter in the Orders page already supports filtering D2H
orders:

- Order Type dropdown includes: "D2H (Distributor → HQ)"
- Properly displays D2H orders in the list

## User Flow

### From QR Tracking Menu:

1. User (Distributor) navigates to **QR Tracking → Distributor Order**
2. Opens DistributorOrderView directly
3. Customer information is pre-filled
4. User selects products with available stock
5. Reviews order summary
6. Clicks "Create Order"
7. Order is created with D2H type and redirects to Orders list

### From Orders Page:

1. User (Distributor) navigates to **Order Management → Orders**
2. Clicks "+ Create Order" button
3. **Order Type Selection Dialog** appears
4. User chooses:
   - "Distributor to HQ (D2H)" → Opens DistributorOrderView
   - "Regular Order" → Opens standard CreateOrderView
5. Completes order creation flow

### From Orders Page Filter:

1. User can filter orders by type selecting "D2H (Distributor → HQ)"
2. Views all D2H orders in the system

## Key Features

### Inventory-Based Product Selection

- Only shows products with available stock
- Displays available quantity for each variant
- Validates order quantity against stock levels
- Prevents over-ordering

### Distributor Pricing

- Uses `distributor_price` field from product_variants table
- Automatically applies correct pricing tier for B2B distributors
- Shows price in product selection dropdown

### Order Management

- Creates orders with proper D2H order type
- Generates unique order numbers with D2H prefix
- Integrates seamlessly with existing order approval workflow
- Orders appear in main Orders list with D2H badge

## Database Schema

No database migrations required. The implementation uses existing schema:

- `orders` table with `order_type` enum including 'D2H'
- `product_variants` table with `distributor_price` column
- `inventory` table with `on_hand_qty` column
- Customer info stored in `notes` field (existing pattern)

## Access Control

- **View Access**: DIST and HQ organizations (role level ≤ 40)
- **Create Orders**: Any distributor organization can create D2H orders
- **Approve Orders**: HQ users can approve D2H orders (existing approval logic)

## Testing Checklist

- [ ] Verify "Distributor Order" appears in QR Tracking menu for DIST users
- [ ] Verify order type dialog appears for DIST users in Orders page
- [ ] Verify only products with inventory > 0 are shown
- [ ] Verify distributor_price is used for calculations
- [ ] Verify order creation with D2H type
- [ ] Verify order appears in Orders list with D2H filter
- [ ] Verify order number generation (D2H-MMDD-XX format)
- [ ] Verify inventory validation prevents over-ordering
- [ ] Verify customer information is stored correctly

## Future Enhancements

1. Add inventory reservation during order creation
2. Add bulk product import via CSV
3. Add order templates for frequently ordered products
4. Add price comparison with other pricing tiers
5. Add order history and reorder functionality
