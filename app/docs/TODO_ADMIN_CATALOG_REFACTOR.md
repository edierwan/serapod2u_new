# TODO: AdminCatalogPage Shop Points Monitor Refactor

## Current State

**File:** `/app/src/components/engagement/catalog/AdminCatalogPage.tsx`

**Issue:** Lines 330-490 manually aggregate shop points data from two sources:

1. `consumer_qr_scans` table - QR scan points
2. `points_transactions` table - Manual adjustments

This duplicates logic that now exists in database views.

---

## Required Changes

### 1. Replace Shop User Aggregation Logic

**Lines to Change:** 330-490 (approximately)

**Current Implementation:**

```typescript
async function loadShopUsers() {
    // Get all shop organizations
    const { data: shops } = await supabase
        .from("organizations")
        .select("*")
        .eq("company_id", companyId)
        .eq("org_type_code", "SHOP");

    const shopOrgIds = shops.map((s) => s.id);

    // Query QR scans
    const { data: qrScans } = await supabase
        .from("consumer_qr_scans")
        .select("*")
        .in("shop_id", shopOrgIds)
        .eq("collected_points", true);

    // Query manual transactions
    const { data: transactions } = await supabase
        .from("points_transactions")
        .select("*")
        .eq("company_id", companyId);

    // Manual aggregation by shop
    const shopMap = new Map();

    qrScans.forEach((scan) => {
        const shop = shopMap.get(scan.shop_id) || {
            current_balance: 0,
            total_scans: 0,
            total_earned: 0,
        };
        shop.current_balance += scan.points_amount;
        shop.total_scans += 1;
        shop.total_earned += scan.points_amount;
        shopMap.set(scan.shop_id, shop);
    });

    transactions.forEach((txn) => {
        // Find shop by phone/email
        const shop = findShopByContact(
            shops,
            txn.consumer_phone,
            txn.consumer_email,
        );
        if (shop) {
            const shopData = shopMap.get(shop.id);
            if (shopData) {
                shopData.current_balance += txn.points_amount;
                if (txn.transaction_type === "redeem") {
                    shopData.total_redeemed += Math.abs(txn.points_amount);
                }
            }
        }
    });

    // Convert to array and sort
    const users = Array.from(shopMap.entries()).map(([shop_id, data]) => {
        const shop = shops.find((s) => s.id === shop_id);
        return {
            shop_id,
            shop_name: shop.org_name,
            shop_phone: shop.org_phone,
            shop_email: shop.org_email,
            ...data,
        };
    });

    setShopUsers(users);
}
```

**New Implementation (Using Views):**

```typescript
async function loadShopUsers() {
    // Query balance view with shop organization details
    const { data: shopBalances, error } = await supabase
        .from("v_shop_points_balance")
        .select(`
      *,
      organizations!inner(
        id,
        org_name,
        org_phone,
        org_email,
        org_status,
        created_at,
        company_id
      )
    `)
        .eq("organizations.company_id", companyId)
        .eq("organizations.org_type_code", "SHOP")
        .order("current_balance", { ascending: false });

    if (error) {
        console.error("Failed to load shop balances", error);
        return;
    }

    // Transform to ShopUser format
    const users: ShopUser[] = shopBalances.map((balance) => ({
        shop_id: balance.shop_id,
        shop_name: balance.organizations.org_name,
        shop_phone: balance.organizations.org_phone || "",
        shop_email: balance.organizations.org_email || "",
        shop_status: balance.organizations.org_status,
        shop_created_at: balance.organizations.created_at,
        current_balance: balance.current_balance,
        total_scans: balance.scan_count,
        total_earned: balance.total_earned_scans,
        total_redeemed: balance.total_redeemed,
        total_transactions: balance.transaction_count,
        first_transaction: balance.first_transaction_at,
        last_transaction: balance.last_transaction_at,
    }));

    setShopUsers(users);
}
```

**Benefits:**

- ✅ Removes 100+ lines of aggregation logic
- ✅ Pre-calculated balances (faster)
- ✅ No manual phone/email matching
- ✅ Consistent with ShopCatalogPage

---

### 2. Add Transaction Details Modal

**New Feature:** When admin clicks "View Details" on a shop, show transaction
history from ledger

```typescript
const [selectedShopId, setSelectedShopId] = useState<string | null>(null);
const [shopTransactions, setShopTransactions] = useState<
    ShopPointsLedgerExtended[]
>([]);

async function loadShopTransactions(shopId: string) {
    const { data, error } = await supabase
        .from("shop_points_ledger")
        .select(`
      *,
      product_variants:variant_id(
        variant_name,
        products(product_name)
      ),
      redeem_items:redeem_item_id(
        item_name,
        item_code
      ),
      organizations:shop_id(
        org_name,
        org_phone
      ),
      qr_codes:order_id(
        order_no
      )
    `)
        .eq("shop_id", shopId)
        .order("occurred_at", { ascending: false })
        .limit(200);

    if (error) {
        console.error("Failed to load shop transactions", error);
        return;
    }

    setShopTransactions(data as ShopPointsLedgerExtended[]);
}

// In component JSX
<Dialog open={!!selectedShopId} onOpenChange={() => setSelectedShopId(null)}>
    <DialogContent className="max-w-4xl">
        <DialogHeader>
            <DialogTitle>
                Transaction History - {selectedShop?.shop_name}
            </DialogTitle>
        </DialogHeader>

        <div className="max-h-96 overflow-y-auto">
            <table className="w-full">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Description</th>
                        <th>Points</th>
                        <th>Balance Change</th>
                    </tr>
                </thead>
                <tbody>
                    {shopTransactions.map((txn) => (
                        <tr key={txn.id}>
                            <td>{formatDate(txn.occurred_at)}</td>
                            <td>
                                <Badge
                                    variant={txn.transaction_type === "scan"
                                        ? "default"
                                        : txn.transaction_type === "redeem"
                                        ? "destructive"
                                        : "secondary"}
                                >
                                    {txn.transaction_type}
                                </Badge>
                            </td>
                            <td>
                                {txn.transaction_type === "scan" &&
                                        txn.product_variants
                                    ? (
                                        `${txn.product_variants.products.product_name} - ${txn.product_variants.variant_name}`
                                    )
                                    : txn.transaction_type === "redeem" &&
                                            txn.redeem_items
                                    ? (
                                        `Redeemed: ${txn.redeem_items.item_name}`
                                    )
                                    : txn.adjustment_reason
                                    ? (
                                        txn.adjustment_reason
                                    )
                                    : (
                                        txn.description || "-"
                                    )}
                            </td>
                            <td
                                className={txn.points_change > 0
                                    ? "text-green-600"
                                    : "text-red-600"}
                            >
                                {txn.points_change > 0 ? "+" : ""}
                                {txn.points_change}
                            </td>
                            <td>{txn.order_no || "-"}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </DialogContent>
</Dialog>;
```

---

### 3. Update Shop User Table

**Current:** Adjust Points button only

**Add:**

- "View Details" button to show transaction history
- Last transaction timestamp
- Total redemptions column

```typescript
<tbody>
    {shopUsers.map((user) => (
        <tr key={user.shop_id}>
            <td>{user.shop_name}</td>
            <td>{user.shop_phone}</td>
            <td>{formatNumber(user.current_balance)}</td>
            <td>{formatNumber(user.total_scans)}</td>
            <td>{formatNumber(user.total_redeemed)}</td> {/* NEW */}
            <td>{formatDate(user.last_transaction)}</td> {/* NEW */}
            <td>
                <div className="flex gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            setSelectedShopId(user.shop_id);
                            loadShopTransactions(user.shop_id);
                        }}
                    >
                        View Details
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            setSelectedUser(user);
                            setShowAdjustPointsModal(true);
                        }}
                    >
                        <Edit className="h-4 w-4" /> Adjust Points
                    </Button>
                </div>
            </td>
        </tr>
    ))}
</tbody>;
```

---

### 4. Add Filters for Transaction History

**New State:**

```typescript
const [txnTypeFilter, setTxnTypeFilter] = useState<TransactionTypeFilter>(
    "all",
);
const [dateRangeFilter, setDateRangeFilter] = useState<
    { start?: string; end?: string }
>({});
const [orderNoFilter, setOrderNoFilter] = useState("");
```

**Filter UI:**

```tsx
<div className="flex gap-3 mb-4">
    <Select value={txnTypeFilter} onValueChange={setTxnTypeFilter}>
        <SelectTrigger className="w-40">
            <SelectValue placeholder="Transaction Type" />
        </SelectTrigger>
        <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="scan">Scans Only</SelectItem>
            <SelectItem value="redeem">Redemptions</SelectItem>
            <SelectItem value="adjust">Adjustments</SelectItem>
        </SelectContent>
    </Select>

    <Input
        placeholder="Filter by order no..."
        value={orderNoFilter}
        onChange={(e) => setOrderNoFilter(e.target.value)}
        className="w-60"
    />

    <Input
        type="date"
        value={dateRangeFilter.start || ""}
        onChange={(e) =>
            setDateRangeFilter((prev) => ({ ...prev, start: e.target.value }))}
        placeholder="Start date"
    />

    <Input
        type="date"
        value={dateRangeFilter.end || ""}
        onChange={(e) =>
            setDateRangeFilter((prev) => ({ ...prev, end: e.target.value }))}
        placeholder="End date"
    />
</div>;
```

**Apply Filters in Query:**

```typescript
async function loadShopTransactions(shopId: string) {
    let query = supabase
        .from("shop_points_ledger")
        .select("...")
        .eq("shop_id", shopId);

    if (txnTypeFilter !== "all") {
        query = query.eq("transaction_type", txnTypeFilter);
    }

    if (dateRangeFilter.start) {
        query = query.gte("occurred_at", dateRangeFilter.start);
    }

    if (dateRangeFilter.end) {
        query = query.lte("occurred_at", dateRangeFilter.end);
    }

    if (orderNoFilter) {
        // Note: This requires joining qr_codes table for order_no
        // For now, filter client-side after fetch
    }

    const { data } = await query.order("occurred_at", { ascending: false })
        .limit(200);

    let filtered = data || [];
    if (orderNoFilter) {
        filtered = filtered.filter((txn) =>
            txn.qr_codes?.order_no?.toLowerCase().includes(
                orderNoFilter.toLowerCase(),
            )
        );
    }

    setShopTransactions(filtered);
}
```

---

### 5. Update ShopUser Interface

**File:** `/app/src/components/engagement/catalog/AdminCatalogPage.tsx`

**Current:**

```typescript
interface ShopUser {
    shop_id: string;
    shop_name: string;
    shop_phone: string;
    shop_email: string;
    current_balance: number;
    total_scans: number;
    total_earned: number;
    total_redeemed?: number;
}
```

**Updated:**

```typescript
interface ShopUser {
    shop_id: string;
    shop_name: string;
    shop_phone: string;
    shop_email: string;
    shop_status: string;
    shop_created_at: string;
    current_balance: number;
    total_scans: number;
    total_earned: number;
    total_redeemed: number;
    total_transactions: number;
    first_transaction: string | null;
    last_transaction: string | null;
}
```

---

## Import Changes

Add to imports:

```typescript
import type {
    ShopPointsBalanceRow,
    ShopPointsLedgerExtended,
    TransactionTypeFilter,
} from "@/types/shop-points";
```

---

## Testing Checklist

After refactoring:

### Shop User List

- [ ] All shops display with correct balances
- [ ] Sorting by balance works
- [ ] Total scans count matches
- [ ] Total redeemed shows correctly
- [ ] Last transaction date displays

### Transaction Details Modal

- [ ] Opens when "View Details" clicked
- [ ] Shows transaction history for selected shop
- [ ] Transaction types display with correct badges
- [ ] Product names show for scan transactions
- [ ] Reward names show for redemption transactions
- [ ] Points shown with correct sign (+/-)

### Filters

- [ ] Transaction type filter works (scan/redeem/adjust)
- [ ] Date range filter limits results
- [ ] Order number filter finds matching transactions
- [ ] Clear filters resets to all transactions

### Performance

- [ ] Shop list loads in < 100ms
- [ ] Transaction history loads in < 200ms
- [ ] No lag when switching between shops

---

## Estimated Effort

**Time:** ~2-3 hours

**Breakdown:**

- Replace aggregation logic: 45 min
- Add transaction modal: 60 min
- Add filters: 30 min
- Testing: 30 min
- Polish & debugging: 15 min

---

## Dependencies

**Before starting:**

- ✅ Migration 035 applied
- ✅ Views created and verified
- ✅ shop-points.ts types file exists
- ✅ ShopCatalogPage refactor complete (for reference)

---

## Notes

- Keep existing "Adjust Points" functionality unchanged
- Ensure RLS policies allow admin to view all shop balances
- Consider adding export to CSV for transaction history
- May want to add pagination if shops have 1000+ transactions

---

**Priority:** Medium\
**Impact:** Improves admin UX, simplifies codebase\
**Risk:** Low (view queries are read-only)

**Related Docs:**

- `/app/docs/SHOP_POINTS_LEDGER_IMPLEMENTATION.md`
- `/SHOP_POINTS_VIEWS_QUICKSTART.md`
