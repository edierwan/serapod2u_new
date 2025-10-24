# Supply Chain Management System - Complete Build Guide

## System Overview

This is a professional multi-tenant Supply Chain Management System for retail/vape product distribution with role-based access control. The system manages the complete supply chain from headquarters through manufacturers, distributors, warehouses, to retail shops.

### Tech Stack
- **Framework**: React + TypeScript
- **Styling**: Tailwind CSS v4.0
- **UI Components**: shadcn/ui
- **Icons**: lucide-react
- **Database**: PostgreSQL (Supabase)

---

## Database Schema Understanding

### Organization Hierarchy (5 Levels)
```
Level 1: HQ (Headquarters)
    ↓
Level 2: MANUFACTURER (Contract Manufacturers)
    ↓
Level 3: DISTRIBUTOR (Regional Distributors)
    ↓
Level 4: WAREHOUSE (Storage Facilities)
    ↓
Level 5: SHOP (Retail Outlets)
```

### Core Tables & Relationships

**1. User Management**
- `roles` - Role definitions (SA, HQ Admin, Manager, User, Guest) with hierarchy levels
- `users` - User profiles linked to organizations with role-based access
- `audit_logs` - Complete audit trail for all data changes

**2. Geographic Data**
- `regions` - Top-level regions (North, South, etc.)
- `states` - Malaysian states
- `districts` - Districts within states

**3. Organization Management**
- `organization_types` - HQ, MANUFACTURER, DISTRIBUTOR, WAREHOUSE, SHOP
- `organizations` - All organizations with parent-child relationships
- Supports hierarchical structure with `parent_org_id`

**4. Product Catalog**
- `product_categories` - Hierarchical categories (Vape/Non-Vape)
- `brands` - Product brands
- `product_groups` - Groups within categories
- `product_subgroups` - Subgroups within groups
- `products` - Master product records
- `product_variants` - Product variations (flavors, sizes, nicotine strengths)

**5. Product Details**
- `product_skus` - Organization-specific SKU codes
- `product_pricing` - Multi-tier pricing (Wholesale, Retail, VIP, etc.)
- `product_images` - Product and variant images
- `product_attributes` - Flexible key-value attributes
- `product_inventory` - Stock levels per organization

**6. Distribution Network**
- `distributor_products` - Which distributors carry which products
- `shop_distributors` - Shop-Distributor relationships with terms

**7. Key Features**
- Age restriction tracking (18+)
- Vape product flagging
- Regulatory compliance fields
- Territory coverage arrays
- Multi-currency support (default MYR)

---

## Application Architecture

### File Structure
```
/App.tsx                          # Main app with view routing
/components/
  ├── Sidebar.tsx                 # Navigation sidebar
  ├── DashboardView.tsx           # Overview dashboard
  ├── ProductsView.tsx            # Product catalog management
  ├── InventoryView.tsx           # Inventory tracking
  ├── OrganizationsView.tsx       # Organization management
  ├── DistributorsView.tsx        # Distributor relationships
  └── ui/                         # shadcn/ui components
```

### Design System

**Color Palette**
- Primary: Blue-600 (#2563eb)
- Success: Green-600
- Warning: Orange-600
- Error: Red-600
- Info: Purple-600
- Neutral: Gray-50 to Gray-900

**Component Patterns**
- Cards with subtle shadows
- Badges for status indicators
- Tables for data display
- Grid layouts for cards (1/2/3/4 columns)
- Consistent spacing: p-6, gap-6, mb-8
- Border radius: rounded-lg
- Hover states: hover:shadow-lg transitions

---

## Page-by-Page Build Guide

### 1. Dashboard View (`DashboardView.tsx`)

**Purpose**: High-level overview of system metrics and activity

**Layout Structure**:
```
[Header: Title + Description]
[4 Stat Cards Grid]
[2-Column Grid]:
  - Low Stock Alert Card
  - Recent Activity Card
[3-Column Grid]:
  - Distributors Overview
  - Warehouses Overview
  - Retail Shops Overview
```

**Key Components**:

1. **Stat Cards** (4 columns)
   - Total Products
   - Active Organizations
   - Total Inventory Value
   - Low Stock Items
   - Each with icon, value, change percentage, trend indicator

2. **Low Stock Alert Card**
   - Shows products below reorder point
   - Badge indicating severity (critical/low)
   - Current quantity vs reorder point
   - Sorted by urgency

3. **Recent Activity Feed**
   - Timeline-style activity log
   - Action type, entity, user, timestamp
   - Color-coded dots for visual hierarchy

4. **Distribution Overview Cards**
   - Count by organization type
   - Breakdown by region/state
   - Quick stats with icons

**Data Points**:
```typescript
stats = {
  totalProducts: number,
  activeOrgs: number,
  inventoryValue: string (currency),
  lowStockItems: number,
  change: string (percentage),
  trend: 'up' | 'down'
}

activity = {
  action: string,
  item: string (code),
  user: string,
  time: string
}

lowStock = {
  code: string,
  name: string,
  category: string,
  quantity: number,
  reorder: number,
  status: 'critical' | 'low'
}
```

---

### 2. Products View (`ProductsView.tsx`)

**Purpose**: Complete product catalog management

**Layout Structure**:
```
[Header: Title + Export/Add Buttons]
[4 Stat Cards: Products, Active, Categories, Brands]
[Filters Card: Search, Category, Brand, More Filters]
[Products Table]
[Pagination]
```

**Table Columns**:
1. Product Code (monospace)
2. Product Name (with "Vape" badge if applicable)
3. Brand
4. Category
5. Variants (count badge)
6. Stock (number)
7. Price (currency)
8. Status (badge: In Stock/Low Stock/Out of Stock)
9. Actions (View/Edit/Delete icons)

**Features**:
- Real-time search across name, code, SKU
- Multi-level filtering (category, brand, status)
- Sortable columns
- Bulk actions
- Export to CSV/Excel
- Add new product modal

**Status Logic**:
```typescript
getStatusBadge(status: string, stock: number) {
  if (stock === 0) return 'Out of Stock' (red)
  if (stock < 100) return 'Low Stock' (orange)
  return 'In Stock' (green)
}
```

**Sample Data Structure**:
```typescript
product = {
  code: 'VAPE-2024-001',
  name: 'Crystal Blue Mint',
  brand: 'VapePro',
  category: 'Disposable Vape',
  variants: 3,
  stock: 450,
  price: 'RM 25.00',
  status: 'active',
  isVape: true
}
```

---

### 3. Inventory View (`InventoryView.tsx`)

**Purpose**: Real-time inventory tracking across all locations

**Layout Structure**:
```
[Header: Title + Export/Adjustment Buttons]
[4 Stat Cards: Total Value, In Stock %, Low Stock, Out of Stock]
[Filters Card: Search, Location, Status]
[Inventory Table]
[Pagination]
```

**Table Columns**:
1. Variant Code (monospace)
2. Product Name
3. Location (warehouse/distribution center)
4. On Hand (quantity)
5. Allocated (reserved quantity)
6. Available (calculated: on_hand - allocated)
7. Reorder Point
8. Stock Level (progress bar + badge)
9. Avg Cost (currency)
10. Total Value (calculated: quantity × avg_cost)

**Stock Level Indicator**:
```typescript
getStockLevel(available: number, reorderPoint: number) {
  const percentage = (available / reorderPoint) * 100
  if (percentage <= 50) return 'critical' (red)
  if (percentage <= 100) return 'low' (orange)
  return 'healthy' (green)
}
```

**Features**:
- Progress bars showing stock vs reorder point
- Color-coded severity (red/orange/green)
- Location-based filtering
- Total inventory value calculation
- Low stock alerts
- Inventory adjustment workflow

**Sample Data Structure**:
```typescript
inventory = {
  variant: 'VAPE-001-BM20',
  product: 'Crystal Blue Mint 20mg',
  location: 'HQ Warehouse - KL',
  onHand: 450,
  allocated: 120,
  available: 330, // calculated
  reorderPoint: 200,
  avgCost: 18.50,
  totalValue: 8325.00 // calculated
}
```

---

### 4. Organizations View (`OrganizationsView.tsx`)

**Purpose**: Manage all supply chain organizations

**Layout Structure**:
```
[Header: Title + Add Organization Button]
[4 Stat Cards: Total, Distributors, Warehouses, Shops]
[Filters Card: Search, Type, State]
[Organizations Grid (2 columns)]
[Pagination]
```

**Organization Card Design**:
```
┌─────────────────────────────────────┐
│ [Icon]  Organization Name     [Badge]│
│         ORG-CODE  [Type Badge]       │
│                                       │
│ 📍 Address, State                    │
│ 📞 Phone Number                       │
│ ✉️  Email Address                     │
│                                       │
│ [View Details] [Edit]                │
└─────────────────────────────────────┘
```

**Organization Type Icons & Colors**:
- HQ: Building2 (purple)
- MANUFACTURER: Factory (blue)
- DISTRIBUTOR: TruckIcon (green)
- WAREHOUSE: Warehouse (orange)
- SHOP: Store (pink)

**Features**:
- Visual hierarchy by organization type
- Location-based grouping
- Quick contact information
- Parent-child relationship display
- Status indicators (Active/Inactive)

**Sample Data Structure**:
```typescript
organization = {
  code: 'DIST-KL-001',
  name: 'Metro Vape Distributors',
  type: 'DISTRIBUTOR',
  email: 'sales@metrovape.com',
  phone: '+60 3-2345 6789',
  address: 'Shah Alam, Selangor',
  state: 'Selangor',
  status: 'active',
  level: 3
}
```

---

### 5. Distributors View (`DistributorsView.tsx`)

**Purpose**: Manage distributor-product relationships and shop connections

**Layout Structure**:
```
[Header: Title]
[4 Stat Cards: Distributors, Products, Shops, Trade Value]
[Tabs: Distributor Products | Shop Relationships]
[Filters Card]
[Data Table]
[Pagination]
```

**Tab 1: Distributor Products Table**

Columns:
1. Distributor (name + code)
2. Product (name + code)
3. Cost (currency)
4. Territory (array of locations as badges)
5. Lead Time (days)
6. Min Order (quantity)
7. Stock (current)
8. Agreement (end date)
9. Status (Active + Exclusive badges)

**Tab 2: Shop Relationships Table**

Columns:
1. Shop (name + code)
2. Distributor (name + code)
3. Account Number
4. Credit Limit (currency)
5. Payment Terms (NET_30, COD, etc.)
6. Orders (count)
7. Total Value (currency)
8. Last Order (date)
9. Status (Active + Preferred badges)

**Features**:
- Territory coverage visualization (badges)
- Agreement expiration tracking
- Exclusive distribution marking
- Payment terms management
- Preferred supplier indicators
- Credit limit monitoring

**Sample Data Structures**:
```typescript
distributorProduct = {
  distributor: 'Metro Vape Distributors',
  distCode: 'DIST-KL-001',
  product: 'Crystal Blue Mint',
  productCode: 'VAPE-2024-001',
  cost: 18.50,
  territory: ['Kuala Lumpur', 'Selangor'],
  leadTime: 3,
  minOrder: 50,
  stock: 450,
  isExclusive: false,
  agreementEnd: '2025-12-31'
}

shopRelationship = {
  shop: 'Vape Central KLCC',
  shopCode: 'SHOP-KL-456',
  distributor: 'Metro Vape Distributors',
  distCode: 'DIST-KL-001',
  accountNo: 'ACC-2024-1234',
  creditLimit: 50000,
  paymentTerms: 'NET_30',
  totalOrders: 156,
  totalValue: 234567,
  lastOrder: '2025-10-12',
  isPreferred: true,
  status: 'active'
}
```

---

### 6. Sidebar Navigation (`Sidebar.tsx`)

**Purpose**: Main application navigation

**Structure**:
```
[Logo/Brand Header]
[Main Navigation Items]
  - Dashboard
  - Products
  - Inventory
  - Organizations
  - Distributors
[Divider]
[Secondary Navigation]
  - Users
  - Reports
  - Settings
[User Profile Section]
```

**Navigation Item Design**:
- Icon + Label
- Active state: Blue background (bg-blue-50) + blue text
- Hover state: Light gray background (bg-gray-50)
- Icons: 5x5 size, colored based on state

**Active State Logic**:
```typescript
isActive = currentView === item.id
className = isActive 
  ? "bg-blue-50 text-blue-700"
  : "text-gray-700 hover:bg-gray-50"
```

---

## Common Patterns & Best Practices

### 1. Data Tables

**Standard Structure**:
```tsx
<Card>
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Column Name</TableHead>
        <TableHead className="text-right">Numeric</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {data.map((item) => (
        <TableRow key={item.id}>
          <TableCell>{item.value}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
</Card>
```

### 2. Stat Cards

**Template**:
```tsx
<Card className="p-6">
  <div className="flex items-start justify-between mb-4">
    <div className="w-12 h-12 rounded-lg bg-{color}-50 flex items-center justify-center">
      <Icon className="w-6 h-6 text-{color}-600" />
    </div>
    <div className="flex items-center gap-1 text-sm text-green-600">
      <TrendingUp className="w-4 h-4" />
      <span>+12.5%</span>
    </div>
  </div>
  <p className="text-gray-600 text-sm mb-1">Label</p>
  <p className="text-gray-900">Value</p>
</Card>
```

### 3. Badges

**Status Badges**:
```tsx
// Success
<Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
  Active
</Badge>

// Warning
<Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
  Low Stock
</Badge>

// Error
<Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
  Critical
</Badge>

// Info
<Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
  Info
</Badge>
```

### 4. Search & Filters

**Standard Filter Bar**:
```tsx
<Card className="p-6 mb-6">
  <div className="flex flex-wrap gap-4">
    <div className="flex-1 min-w-[300px]">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <Input
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>
    </div>
    
    <Select>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Filter" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
      </SelectContent>
    </Select>
  </div>
</Card>
```

### 5. Action Buttons

**Icon Button Template**:
```tsx
<Button variant="ghost" size="sm" className="h-8 w-8 p-0">
  <Eye className="w-4 h-4" />
</Button>

// Destructive action
<Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-600 hover:text-red-700">
  <Trash2 className="w-4 h-4" />
</Button>
```

### 6. Pagination

**Standard Pagination**:
```tsx
<div className="mt-6 flex items-center justify-between">
  <p className="text-gray-600 text-sm">
    Showing 1 to 10 of 1,247 items
  </p>
  <div className="flex gap-2">
    <Button variant="outline" size="sm">Previous</Button>
    <Button variant="outline" size="sm" className="bg-blue-50 text-blue-600 border-blue-200">
      1
    </Button>
    <Button variant="outline" size="sm">2</Button>
    <Button variant="outline" size="sm">3</Button>
    <Button variant="outline" size="sm">Next</Button>
  </div>
</div>
```

---

## Additional Pages to Build

### 7. Users Management View

**Purpose**: Manage user accounts and permissions

**Features**:
- User list with role assignments
- Organization association
- Permission management
- Activity logs per user
- Invite new users
- Deactivate/reactivate accounts

**Table Columns**:
- Name + Email
- Role (with hierarchy level)
- Organization
- Status (Active/Inactive/Verified)
- Last Login
- Actions

### 8. Reports View

**Purpose**: Generate business intelligence reports

**Report Types**:
- Sales by distributor
- Inventory turnover
- Low stock analysis
- Product performance
- Organization performance
- Territory coverage analysis

**Features**:
- Date range selector
- Export to PDF/Excel
- Chart visualizations
- Comparison periods
- Scheduled reports

### 9. Settings View

**Purpose**: System configuration

**Sections**:
- Company Profile
- Regional Settings (currency, timezone, language)
- Notification Preferences
- Integration Settings
- Data Export/Import
- Audit Log Viewer
- Role & Permission Configuration

### 10. Product Detail View

**Purpose**: Deep dive into single product

**Sections**:
- Product Information
- Variants Grid
- Pricing Table (by tier)
- Inventory Levels (by location)
- Images Gallery
- Attributes & Specifications
- Distributor Relationships
- Sales History Chart
- Edit/Update Forms

### 11. Organization Detail View

**Purpose**: Complete organization profile

**Sections**:
- Organization Info
- Contact Details
- Geographic Coverage
- Product Catalog (if distributor)
- Inventory Summary (if warehouse)
- Shop Relationships (if distributor)
- Parent/Child Organizations
- Performance Metrics
- Document Management

### 12. Orders Management View

**Purpose**: Track orders through supply chain

**Features**:
- Order list with status tracking
- Create new order
- Order details with line items
- Status workflow (Draft → Confirmed → Shipped → Delivered)
- Invoice generation
- Payment tracking
- Delivery notes

---

## Implementation Guidelines

### State Management

**View-level State**:
```tsx
const [searchQuery, setSearchQuery] = useState('');
const [filterCategory, setFilterCategory] = useState('all');
const [currentPage, setCurrentPage] = useState(1);
```

### Currency Formatting

```tsx
const formatCurrency = (value: number) => {
  return `RM ${value.toLocaleString('en-MY', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  })}`;
};
```

### Date Formatting

```tsx
const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('en-MY', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};
```

### Status Colors

```tsx
const statusConfig = {
  active: { bg: 'green-50', text: 'green-700', border: 'green-200' },
  inactive: { bg: 'gray-50', text: 'gray-700', border: 'gray-200' },
  pending: { bg: 'yellow-50', text: 'yellow-700', border: 'yellow-200' },
  critical: { bg: 'red-50', text: 'red-700', border: 'red-200' }
};
```

### Responsive Design

```tsx
// Grid layouts
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"

// Flex wrapping
className="flex flex-wrap gap-4"

// Min widths
className="flex-1 min-w-[300px]"
```

---

## Security & Access Control

### Role Hierarchy
```
Level 1: Super Admin (SA) - Full system access
Level 10: HQ Admin - HQ operations
Level 20: Power User - Advanced features
Level 30: Manager - Department management
Level 40: User - Standard operations
Level 50: Guest - Read-only access
```

### Row-Level Security Patterns
```sql
-- Users can see own organization data
policy "users_read_own" ON users
  FOR SELECT USING (organization_id = current_user_org_id());

-- HQ Admin can see all
policy "admin_all" ON products
  USING (is_hq_admin());
```

### Function Helpers
```sql
is_super_admin() -- Check if user is SA
is_hq_admin() -- Check if HQ level access
current_user_org_id() -- Get user's org
current_user_role_level() -- Get role level
```

---

## API Integration Points

### Products API
```typescript
GET /api/products - List products with filters
POST /api/products - Create new product
GET /api/products/:id - Get product details
PUT /api/products/:id - Update product
DELETE /api/products/:id - Delete product

// Variants
GET /api/products/:id/variants
POST /api/products/:id/variants
```

### Inventory API
```typescript
GET /api/inventory - Get inventory levels
POST /api/inventory/adjustment - Create adjustment
GET /api/inventory/low-stock - Get low stock items
GET /api/inventory/by-location - Get by location
```

### Organizations API
```typescript
GET /api/organizations - List with hierarchy
POST /api/organizations - Create organization
GET /api/organizations/:id - Get details
PUT /api/organizations/:id - Update
GET /api/organizations/tree - Get hierarchy tree
```

### Distributors API
```typescript
GET /api/distributor-products - List relationships
POST /api/distributor-products - Add product to distributor
GET /api/shop-distributors - List shop relationships
POST /api/shop-distributors - Create relationship
```

---

## Testing Scenarios

### Dashboard
- [ ] Load dashboard with all metrics
- [ ] Verify low stock calculations
- [ ] Check recent activity feed
- [ ] Test distribution breakdowns

### Products
- [ ] Search products by name/code
- [ ] Filter by category and brand
- [ ] Sort by different columns
- [ ] Add new product
- [ ] Edit existing product
- [ ] View product details

### Inventory
- [ ] Filter by location
- [ ] Sort by stock level
- [ ] View low stock items
- [ ] Create stock adjustment
- [ ] Verify calculations (available = on_hand - allocated)

### Organizations
- [ ] View organization hierarchy
- [ ] Filter by type and state
- [ ] Create new organization
- [ ] Edit organization details
- [ ] View parent-child relationships

### Distributors
- [ ] View distributor-product relationships
- [ ] Add product to distributor
- [ ] Manage territory coverage
- [ ] View shop relationships
- [ ] Update payment terms

---

## Sample Mock Data

### Products
```typescript
const mockProducts = [
  {
    id: '1',
    code: 'VAPE-2024-001',
    name: 'Crystal Blue Mint',
    brand: 'VapePro',
    category: 'Disposable Vape',
    variants: 3,
    stock: 450,
    price: 25.00,
    isVape: true,
    isActive: true
  }
];
```

### Organizations
```typescript
const mockOrganizations = [
  {
    id: '1',
    code: 'HQ-001',
    name: 'VapeMax Headquarters',
    type: 'HQ',
    email: 'hq@vapemax.com',
    phone: '+60 3-1234 5678',
    address: 'Kuala Lumpur',
    state: 'Wilayah Persekutuan',
    level: 1,
    isActive: true
  }
];
```

### Inventory
```typescript
const mockInventory = [
  {
    id: '1',
    variantCode: 'VAPE-001-BM20',
    productName: 'Crystal Blue Mint 20mg',
    location: 'HQ Warehouse - KL',
    onHand: 450,
    allocated: 120,
    available: 330,
    reorderPoint: 200,
    avgCost: 18.50,
    totalValue: 8325.00
  }
];
```

---

## Performance Optimization

### Database Indexes
- Product search: `idx_products_name_search` on `product_name_search`
- Inventory queries: `idx_inventory_org` and `idx_inventory_variant`
- Organization hierarchy: `idx_orgs_parent` on `parent_org_id`

### Query Optimization
- Use views for complex joins (v_product_catalog, v_hq_inventory)
- Implement pagination (LIMIT/OFFSET)
- Cache frequently accessed data
- Use generated columns for search fields

### Frontend Optimization
- Lazy load images
- Virtual scrolling for large tables
- Debounce search inputs
- Cache API responses
- Implement infinite scroll for long lists

---

## Deployment Checklist

- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] Row-level security policies enabled
- [ ] Storage buckets created (product-images, documents, etc.)
- [ ] Initial roles and permissions seeded
- [ ] HQ organization created
- [ ] Super Admin user created
- [ ] Geographic data imported (regions, states, districts)
- [ ] Category hierarchy seeded
- [ ] Brand data loaded
- [ ] Test products created
- [ ] Audit logging enabled

---

## Future Enhancements

### Phase 2 Features
- Real-time notifications
- Advanced analytics dashboard
- Mobile app integration
- Barcode scanning
- Batch operations
- Advanced reporting with charts
- Data export automation
- Integration with accounting systems

### Phase 3 Features
- Multi-language support
- Advanced forecasting
- AI-powered inventory optimization
- Customer relationship management
- Loyalty program integration
- E-commerce frontend
- Delivery tracking
- Return management system

---

## Prompt Template for AI

When asking AI to build additional pages, use this structure:

```
Build a [Page Name] for the Supply Chain Management System.

Context:
- This is part of a multi-tenant supply chain system
- Database schema includes: [relevant tables]
- Existing pages: Dashboard, Products, Inventory, Organizations, Distributors
- Tech stack: React + TypeScript + Tailwind + shadcn/ui

Requirements:
1. Create [PageName]View.tsx component
2. Include these sections: [list sections]
3. Display these data fields: [list fields]
4. Add these features: [list features]
5. Follow existing design patterns from other views

Design Guidelines:
- Use Card components for containers
- Include search and filters at top
- Use Table for data display
- Add stat cards for key metrics
- Include pagination at bottom
- Match color scheme: blue-600 primary, gray-900 text
- Use appropriate icons from lucide-react
- Follow responsive grid patterns

Data Structure:
[Provide sample data structure]

Features:
- CRUD operations
- Search and filtering
- Sorting
- Export functionality
- Status indicators with badges
```

---

## Quick Reference

### Common Imports
```tsx
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Search, Plus, Download, Edit, Trash2, Eye } from 'lucide-react';
```

### Color Classes
```
Primary: bg-blue-50, text-blue-700, border-blue-200
Success: bg-green-50, text-green-700, border-green-200
Warning: bg-orange-50, text-orange-700, border-orange-200
Error: bg-red-50, text-red-700, border-red-200
Info: bg-purple-50, text-purple-700, border-purple-200
```

### Spacing Scale
```
p-4: 1rem (16px)
p-6: 1.5rem (24px)
p-8: 2rem (32px)
gap-4: 1rem
gap-6: 1.5rem
mb-6: 1.5rem
mb-8: 2rem
```

---

This guide provides a complete blueprint for building and extending the Supply Chain Management System. Use it as a reference for creating new pages, understanding the data structure, and maintaining consistency across the application.
