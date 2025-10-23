# User Management Page - Complete Design Guide

This comprehensive guide documents the design system, implementation approach, and technical details for building a professional user management interface with React, TypeScript, and Tailwind CSS.

---

## Table of Contents
1. [Design Philosophy](#design-philosophy)
2. [Color System](#color-system)
3. [Spacing & Layout](#spacing--layout)
4. [Component Architecture](#component-architecture)
5. [Feature Implementation](#feature-implementation)
6. [Step-by-Step Build Guide](#step-by-step-build-guide)

---

## Design Philosophy

### Core Principles
- **Clean & Modern**: Minimalist design with clear visual hierarchy
- **Data Density**: Present information efficiently without overwhelming users
- **Progressive Disclosure**: Show basic info first, details on demand
- **Responsive Design**: Mobile-first approach, adapts to all screen sizes
- **Accessibility**: Keyboard navigation, screen reader support, proper ARIA labels

### Visual Hierarchy
1. **Primary Actions**: Prominent buttons (Add User)
2. **Statistics**: Quick overview cards at top
3. **Filters**: Easy-to-reach search and filter controls
4. **Data Table**: Main content area with sortable columns
5. **Actions**: Per-row actions (edit, delete) in rightmost column

---

## Color System

### Status Colors
```typescript
// Active/Success States
- Green 100: #DCFCE7 (background)
- Green 600: #16A34A (icon)
- Green 800: #166534 (text)
- Green 900: #14532D (bold text)

// Inactive/Error States
- Red 100: #FEE2E2 (background)
- Red 600: #DC2626 (icon)
- Red 800: #991B1B (text)
- Red 900: #7F1D1D (bold text)

// Warning/Pending States
- Yellow 100: #FEF3C7 (background)
- Yellow 600: #CA8A04 (icon)
- Yellow 800: #854D0E (text)

// Info/Verified States
- Blue 100: #DBEAFE (background)
- Blue 600: #2563EB (icon)
- Blue 800: #1E40AF (text)
```

### Role Badge Colors
```typescript
const roleBadgeColors = {
  SA: "bg-purple-100 text-purple-800",        // Super Admin
  HQ_ADMIN: "bg-blue-100 text-blue-800",      // HQ Admin
  POWER_USER: "bg-indigo-100 text-indigo-800", // Power User
  MANAGER: "bg-green-100 text-green-800",     // Manager
  USER: "bg-gray-100 text-gray-800",          // User
  GUEST: "bg-orange-100 text-orange-800"      // Guest
};
```

### Background Colors
```css
- Page Background: #F9FAFB (gray-50)
- Card Background: #FFFFFF (white)
- Hover State: #F3F4F6 (gray-50)
- Border: rgba(0, 0, 0, 0.1)
```

---

## Spacing & Layout

### Container Spacing
```css
.container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 1.5rem; /* 24px */
}
```

### Component Spacing
```css
/* Vertical spacing between major sections */
.space-y-6 { gap: 1.5rem; } /* 24px between sections */

/* Horizontal spacing in grids */
.gap-4 { gap: 1rem; } /* 16px between grid items */
.gap-6 { gap: 1.5rem; } /* 24px for larger gaps */

/* Card padding */
.card-padding { padding: 1.5rem; } /* 24px */

/* Tight spacing for related items */
.space-y-2 { gap: 0.5rem; } /* 8px */
.space-y-4 { gap: 1rem; } /* 16px */
```

### Grid Layouts
```css
/* Statistics Cards Grid */
grid-cols-1 md:grid-cols-2 lg:grid-cols-4

/* Filter Controls Grid */
grid-cols-1 md:grid-cols-2 lg:grid-cols-4

/* Profile Overview Grid */
grid-cols-1 lg:grid-cols-2
```

---

## Component Architecture

### File Structure
```
/components
  ├── UserManagement.tsx     (Main container, state management)
  ├── UserStats.tsx          (Statistics cards)
  ├── UserFilters.tsx        (Search & filter controls)
  ├── UserList.tsx           (Table with sortable columns)
  ├── UserDialog.tsx         (Add/Edit dialog with tabs)
  └── UserProfile.tsx        (Detailed profile view)

/types
  └── user.ts                (TypeScript interfaces)

/data
  └── mockUsers.ts           (Sample data)
```

---

## Feature Implementation

### 1. Statistics Cards

**Design Specs:**
- **Layout**: 4-column grid (responsive: 1 col mobile, 2 cols tablet, 4 cols desktop)
- **Card Size**: Auto height, equal width
- **Padding**: 1.5rem (24px) all sides
- **Background**: White with subtle border

**Card Structure:**
```tsx
<Card className="p-6">
  <div className="flex items-center justify-between">
    <div>
      <p className="text-sm text-gray-600">{title}</p>
      <p className="text-gray-900 mt-1">{value}</p>
    </div>
    <div className={`${bgColor} p-3 rounded-lg`}>
      <Icon className={`w-5 h-5 ${color}`} />
    </div>
  </div>
</Card>
```

**Statistics to Show:**
1. Total Users (Blue theme)
2. Active Users (Green theme)
3. Inactive Users (Red theme)
4. Verified Users (Purple theme)

**Icon Sizes:**
- Icon: 20px × 20px (w-5 h-5)
- Icon container: 48px × 48px (p-3 rounded-lg)

---

### 2. Search & Filter Controls

**Design Specs:**
- **Layout**: 4-column grid in a single card
- **Card Padding**: 1rem (16px)
- **Gap between controls**: 1rem (16px)

**Filter Components:**

#### Search Input
```tsx
<div className="relative">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
  <Input
    placeholder="Search users..."
    className="pl-9"  // Make room for icon
  />
</div>
```

#### Select Dropdowns
```tsx
<Select>
  <SelectTrigger>
    <SelectValue placeholder="All Roles" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="all">All Roles</SelectItem>
    {/* Dynamic options */}
  </SelectContent>
</Select>
```

**Filter Options:**
1. **Search**: Text input with search icon (left-aligned)
2. **Role Filter**: Dropdown (All Roles, SA, HQ Admin, Manager, User, Guest)
3. **Status Filter**: Dropdown (All Status, Active, Inactive)
4. **Organization Filter**: Dropdown (All Organizations, + dynamic list)

---

### 3. Sortable Data Table

**Design Specs:**
- **Table Layout**: Fixed layout with specific column widths
- **Row Height**: Auto (comfortable padding)
- **Hover Effect**: `hover:bg-gray-50` on clickable rows
- **Border**: Subtle borders between rows

**Column Structure:**
```
| User (35%)     | Role (15%) | Organization (15%) | Status (12%) | Verified (12%) | Last Login (15%) | Actions (8%) |
```

**Sortable Headers Implementation:**

```tsx
const SortableHeader = ({ field, children }) => {
  const isActive = sortState.field === field;
  const direction = isActive ? sortState.direction : null;

  return (
    <TableHead>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onSort(field)}
      >
        {children}
        {!isActive && <ArrowUpDown className="ml-2 h-4 w-4 text-gray-400" />}
        {isActive && direction === "asc" && <ArrowUp className="ml-2 h-4 w-4 text-blue-600" />}
        {isActive && direction === "desc" && <ArrowDown className="ml-2 h-4 w-4 text-blue-600" />}
      </Button>
    </TableHead>
  );
};
```

**Sorting Logic:**
```typescript
// Three-state sorting: null → asc → desc → null
const handleSort = (field: SortField) => {
  let newDirection: SortDirection = "asc";
  
  if (sortState.field === field) {
    if (sortState.direction === "asc") {
      newDirection = "desc";
    } else if (sortState.direction === "desc") {
      newDirection = null;  // Clear sort
    }
  }
  
  setSortState({
    field: newDirection ? field : null,
    direction: newDirection,
  });
};
```

**Sort Implementations:**
- **Name**: Case-insensitive alphabetical
- **Role**: Alphabetical by role name
- **Organization**: Alphabetical by org name
- **Status**: Active (1) before Inactive (0)
- **Verified**: Verified (1) before Unverified (0)
- **Last Login**: Timestamp descending (most recent first)

**User Row Structure:**
```tsx
<TableRow
  className="cursor-pointer hover:bg-gray-50"
  onClick={() => onUserClick(user)}
>
  <TableCell>
    <div className="flex items-center gap-3">
      <Avatar className="w-10 h-10">
        {user.avatar_url && <AvatarImage src={user.avatar_url} />}
        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white">
          {getInitials(user.full_name)}
        </AvatarFallback>
      </Avatar>
      <div>
        <div className="text-gray-900">{user.full_name || "No Name"}</div>
        <div className="text-sm text-gray-500">{user.email}</div>
        {user.phone && <div className="text-sm text-gray-400">{user.phone}</div>}
      </div>
    </div>
  </TableCell>
  {/* Other cells */}
</TableRow>
```

---

### 4. Add/Edit User Dialog

**Design Specs:**
- **Dialog Width**: max-w-2xl (672px)
- **Max Height**: 90vh with scroll
- **Padding**: Standard dialog padding
- **Tab Layout**: 3 equal-width tabs

**Tab Structure:**

#### Tab Navigation
```tsx
<TabsList className="grid w-full grid-cols-3">
  <TabsTrigger value="basic">Basic Info</TabsTrigger>
  <TabsTrigger value="role">Role & Access</TabsTrigger>
  <TabsTrigger value="settings">Settings</TabsTrigger>
</TabsList>
```

#### Tab 1: Basic Info

**Avatar Upload Component:**
```tsx
<div className="flex items-center gap-4">
  {/* Avatar Preview (80x80) */}
  <Avatar className="w-20 h-20">
    {avatarPreview ? (
      <AvatarImage src={avatarPreview} />
    ) : (
      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white text-xl">
        {getInitials(formData.full_name)}
      </AvatarFallback>
    )}
  </Avatar>
  
  {/* Upload Controls */}
  <div className="flex flex-col gap-2">
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      onChange={handleFileChange}
      className="hidden"
    />
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => fileInputRef.current?.click()}
    >
      <Upload className="w-4 h-4 mr-2" />
      Upload Image
    </Button>
    {avatarPreview && (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleRemoveAvatar}
      >
        <X className="w-4 h-4 mr-2" />
        Remove
      </Button>
    )}
    <p className="text-xs text-gray-500">JPG, PNG or GIF (max 5MB)</p>
  </div>
</div>
```

**File Upload Validation:**
```typescript
const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  
  // Validate file type
  if (!file.type.startsWith("image/")) {
    setErrors({ avatar: "Please select an image file" });
    return;
  }
  
  // Validate file size (5MB max)
  if (file.size > 5 * 1024 * 1024) {
    setErrors({ avatar: "Image must be less than 5MB" });
    return;
  }
  
  // Create preview using FileReader
  const reader = new FileReader();
  reader.onloadend = () => {
    const result = reader.result as string;
    setAvatarPreview(result);
    handleChange("avatar_url", result);
  };
  reader.readAsDataURL(file);
};
```

**Form Fields (Basic Info):**
1. **Email** (required): Input type="email" with validation
2. **Full Name** (required): Text input
3. **Phone Number** (optional): Input type="tel"
4. **Avatar**: File upload with preview

**Field Layout:**
```tsx
<div className="space-y-2">
  <Label htmlFor="email">
    Email <span className="text-red-500">*</span>
  </Label>
  <Input
    id="email"
    type="email"
    placeholder="user@company.com"
    value={formData.email}
    onChange={(e) => handleChange("email", e.target.value)}
    className={errors.email ? "border-red-500" : ""}
  />
  {errors.email && (
    <p className="text-sm text-red-500">{errors.email}</p>
  )}
</div>
```

#### Tab 2: Role & Access

**Role Selection:**
```tsx
<Select
  value={formData.role_code}
  onValueChange={(value) => handleChange("role_code", value)}
>
  <SelectTrigger>
    <SelectValue placeholder="Select role" />
  </SelectTrigger>
  <SelectContent>
    {mockRoles.map((role) => (
      <SelectItem key={role.role_code} value={role.role_code}>
        <div className="flex flex-col">
          <span>{role.role_name}</span>
          <span className="text-xs text-gray-500">
            {role.role_description}
          </span>
        </div>
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

**Organization Selection:**
```tsx
<Select
  value={formData.organization_id || "none"}
  onValueChange={(value) => 
    handleChange("organization_id", value === "none" ? null : value)
  }
>
  <SelectTrigger>
    <SelectValue placeholder="Select organization" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="none">No Organization</SelectItem>
    {mockOrganizations.map((org) => (
      <SelectItem key={org.id} value={org.id}>
        <div className="flex flex-col">
          <span>{org.org_name}</span>
          <span className="text-xs text-gray-500">
            {org.org_code} - {org.org_type_name}
          </span>
        </div>
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

**Info Box:**
```tsx
<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
  <p className="text-sm text-blue-800">
    <strong>Role Levels:</strong> Super Admin (1) → HQ Admin (10) → 
    Power User (20) → Manager (30) → User (40) → Guest (50)
  </p>
</div>
```

#### Tab 3: Settings

**Toggle Controls:**
```tsx
<div className="flex items-center justify-between p-4 border rounded-lg">
  <div className="space-y-0.5">
    <Label htmlFor="is_active">Active Status</Label>
    <p className="text-sm text-gray-500">
      Inactive users cannot log in to the system
    </p>
  </div>
  <Switch
    id="is_active"
    checked={formData.is_active}
    onCheckedChange={(checked) => handleChange("is_active", checked)}
  />
</div>
```

**Settings Options:**
1. **Active Status**: Toggle (controls login access)
2. **Verified Status**: Toggle (email/phone verification)

**Audit Information (Edit mode only):**
```tsx
<div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
  <h4 className="text-sm text-gray-700">User Information</h4>
  <div className="grid grid-cols-2 gap-2 text-sm">
    <div>
      <span className="text-gray-500">Created:</span>
      <p className="text-gray-900">
        {format(new Date(user.created_at), "MMM d, yyyy")}
      </p>
    </div>
    <div>
      <span className="text-gray-500">Updated:</span>
      <p className="text-gray-900">
        {format(new Date(user.updated_at), "MMM d, yyyy")}
      </p>
    </div>
  </div>
</div>
```

**Form Validation:**
```typescript
const validateForm = (): boolean => {
  const newErrors: Record<string, string> = {};
  
  // Email validation
  if (!formData.email) {
    newErrors.email = "Email is required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
    newErrors.email = "Invalid email format";
  }
  
  // Name validation
  if (!formData.full_name) {
    newErrors.full_name = "Full name is required";
  }
  
  // Role validation
  if (!formData.role_code) {
    newErrors.role_code = "Role is required";
  }
  
  setErrors(newErrors);
  return Object.keys(newErrors).length === 0;
};
```

---

### 5. User Profile Page

**Design Specs:**
- **Layout**: Full-page view (replaces table)
- **Back Navigation**: Top-left back button
- **Header Card**: Large avatar + user info
- **Tabs**: Overview, Activity Log, Settings

**Profile Header:**
```tsx
<Card className="p-8">
  <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">
    {/* Large Avatar (96x96) */}
    <Avatar className="w-24 h-24">
      {user.avatar_url && <AvatarImage src={user.avatar_url} />}
      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white text-3xl">
        {getInitials(user.full_name)}
      </AvatarFallback>
    </Avatar>
    
    <div className="flex-1">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-gray-900">{user.full_name}</h1>
          <p className="text-gray-600 mt-1">{user.email}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            {/* Status badges */}
          </div>
        </div>
        <Button onClick={() => setIsEditDialogOpen(true)}>
          <Edit className="w-4 h-4 mr-2" />
          Edit Profile
        </Button>
      </div>
    </div>
  </div>
</Card>
```

**Overview Tab - Information Cards:**
```tsx
<Card className="p-6">
  <h3 className="text-gray-900 mb-4">Personal Information</h3>
  <div className="space-y-4">
    <div className="flex items-start gap-3">
      <Mail className="w-5 h-5 text-gray-400 mt-0.5" />
      <div>
        <p className="text-sm text-gray-500">Email Address</p>
        <p className="text-gray-900">{user.email}</p>
        {user.email_verified_at && (
          <p className="text-xs text-green-600 mt-1">
            Verified on {format(new Date(user.email_verified_at), "MMM d, yyyy")}
          </p>
        )}
      </div>
    </div>
    {/* More info items */}
  </div>
</Card>
```

**Activity Log Tab:**
```tsx
<Card className="p-6">
  <h3 className="text-gray-900 mb-4">Recent Activity</h3>
  <div className="space-y-4">
    {mockActivityLog.map((activity, index) => (
      <div key={activity.id}>
        <div className="flex items-start gap-4">
          <div className="bg-blue-100 p-2 rounded-lg">
            <Activity className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-gray-900">{activity.action}</p>
            <div className="flex flex-wrap gap-3 mt-1 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {format(new Date(activity.timestamp), "MMM d, yyyy 'at' h:mm a")}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {activity.ip}
              </span>
            </div>
          </div>
          <span className="text-xs text-gray-400">
            {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
          </span>
        </div>
        {index < mockActivityLog.length - 1 && <Separator className="mt-4" />}
      </div>
    ))}
  </div>
</Card>
```

---

## Step-by-Step Build Guide

### Step 1: Set Up Type Definitions

Create `/types/user.ts`:

```typescript
export interface User {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role_code: string;
  role_name?: string;
  organization_id: string | null;
  organization_name?: string;
  avatar_url: string | null;
  is_active: boolean;
  is_verified: boolean;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserFormData {
  email: string;
  full_name: string;
  phone: string;
  role_code: string;
  organization_id: string | null;
  avatar_url: string | null;
  is_active: boolean;
  is_verified: boolean;
}

export interface FilterState {
  search: string;
  role: string;
  status: string;
  organization: string;
}

export type SortField = "name" | "role" | "organization" | "status" | "verified" | "last_login";
export type SortDirection = "asc" | "desc" | null;

export interface SortState {
  field: SortField | null;
  direction: SortDirection;
}
```

### Step 2: Create Mock Data

Create `/data/mockUsers.ts` with:
- Array of Role objects (SA, HQ_ADMIN, MANAGER, USER, GUEST)
- Array of Organization objects (HQ, Distributors, Warehouses, Shops)
- Array of User objects (10+ sample users with varied data)

### Step 3: Build Statistics Component

Create `/components/UserStats.tsx`:

**Purpose**: Display 4 statistic cards
**Props**: `{ users: User[] }`
**Logic**:
```typescript
const totalUsers = users.length;
const activeUsers = users.filter(u => u.is_active).length;
const inactiveUsers = users.filter(u => !u.is_active).length;
const verifiedUsers = users.filter(u => u.is_verified).length;
```

**Layout**: Grid with 4 columns (responsive)
**Card Structure**: Icon on right, text on left

### Step 4: Build Filter Component

Create `/components/UserFilters.tsx`:

**Purpose**: Search and filter controls
**Props**: `{ filters: FilterState; onFilterChange: (filters: FilterState) => void }`

**Components**:
1. Search input with icon
2. Role select dropdown
3. Status select dropdown
4. Organization select dropdown

**Layout**: 4-column grid in single card

### Step 5: Build Table Component

Create `/components/UserList.tsx`:

**Purpose**: Display users in sortable table
**Props**:
```typescript
{
  users: User[];
  onEdit: (user: User) => void;
  onDelete: (userId: string) => void;
  onToggleStatus: (userId: string) => void;
  onUserClick?: (user: User) => void;
  sortState: SortState;
  onSort: (field: SortField) => void;
}
```

**Features**:
- Sortable column headers
- Avatar with fallback initials
- Color-coded badges
- Row hover effect
- Click to view profile
- Dropdown actions menu

**Columns**:
1. User (avatar + name + email + phone)
2. Role (badge)
3. Organization (name)
4. Status (active/inactive badge)
5. Verified (yes/no badge)
6. Last Login (relative time)
7. Actions (edit button + dropdown menu)

### Step 6: Build Dialog Component

Create `/components/UserDialog.tsx`:

**Purpose**: Add/edit user form
**Props**:
```typescript
{
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (userData: UserFormData) => void;
}
```

**State**:
```typescript
const [formData, setFormData] = useState<UserFormData>({...});
const [errors, setErrors] = useState<Record<string, string>>({});
const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
```

**Tabs**:
1. Basic Info (avatar upload, email, name, phone)
2. Role & Access (role select, organization select)
3. Settings (active toggle, verified toggle, audit info)

**Features**:
- Form validation
- Avatar upload with preview
- File size/type validation
- Error messages
- Submit button in footer

### Step 7: Build Profile Component

Create `/components/UserProfile.tsx`:

**Purpose**: Detailed user profile view
**Props**:
```typescript
{
  user: User;
  onBack: () => void;
  onUpdate: (userData: UserFormData) => void;
}
```

**Layout**:
1. Back button
2. Profile header card (large avatar + info + edit button)
3. Tabbed content (Overview, Activity Log, Settings)

**Overview Tab**:
- Personal Information card
- Account Information card
- Account Status cards (3-column grid)

**Activity Log Tab**:
- Timeline of user actions
- Timestamps and IP addresses
- Icon indicators

**Settings Tab**:
- Account settings toggles
- Danger zone (destructive actions)

### Step 8: Build Main Container

Create `/components/UserManagement.tsx`:

**Purpose**: Main container with state management
**State**:
```typescript
const [users, setUsers] = useState<User[]>(mockUsers);
const [filteredUsers, setFilteredUsers] = useState<User[]>(mockUsers);
const [selectedUser, setSelectedUser] = useState<User | null>(null);
const [isDialogOpen, setIsDialogOpen] = useState(false);
const [filters, setFilters] = useState<FilterState>({...});
const [sortState, setSortState] = useState<SortState>({...});
```

**Functions**:
```typescript
// CRUD operations
handleAddUser()
handleEditUser(user)
handleDeleteUser(userId)
handleSaveUser(userData)
handleToggleStatus(userId)

// Filtering and sorting
handleFilterChange(newFilters)
handleSort(field)
applyFilters(userList, filterState, sortState)
sortUsers(userList, sortState)
```

**Layout**:
1. Header with title and Add User button
2. UserStats component
3. UserFilters component
4. UserList component
5. UserDialog component

### Step 9: Set Up Navigation

Create `/App.tsx`:

**State**:
```typescript
const [selectedUser, setSelectedUser] = useState<User | null>(null);
const [view, setView] = useState<"list" | "profile">("list");
```

**Conditional Rendering**:
```tsx
{view === "list" ? (
  <UserManagement onUserClick={handleUserClick} />
) : selectedUser ? (
  <UserProfile
    user={selectedUser}
    onBack={handleBackToList}
    onUpdate={handleProfileUpdate}
  />
) : null}
```

---

## Design Patterns Used

### 1. Compound Components
Dialog uses compound pattern with DialogContent, DialogHeader, DialogFooter

### 2. Controlled Components
All form inputs are controlled with React state

### 3. Lifting State Up
User list and filters share state through parent component

### 4. Composition
Small, focused components composed into larger features

### 5. Props Drilling Prevention
Callback props for communication between components

### 6. Single Responsibility
Each component has one clear purpose

---

## Accessibility Guidelines

### Keyboard Navigation
- All interactive elements are focusable
- Tab order follows visual order
- Enter/Space activate buttons
- Escape closes dialogs

### Screen Readers
- Proper ARIA labels on icons
- Form labels associated with inputs
- Error messages announced
- Status changes announced

### Color Contrast
- All text meets WCAG AA standards (4.5:1)
- Icons have sufficient contrast
- Focus indicators are visible

### Focus Management
- Focus trapped in dialogs
- Focus returns to trigger on close
- Visible focus indicators on all interactive elements

---

## Performance Considerations

### Memoization
```typescript
const sortedAndFilteredUsers = useMemo(
  () => sortUsers(applyFilters(users, filters), sortState),
  [users, filters, sortState]
);
```

### Virtual Scrolling
For large datasets (1000+ users), implement virtual scrolling:
```typescript
import { useVirtualizer } from '@tanstack/react-virtual';
```

### Debounced Search
```typescript
const debouncedSearch = useDebouncedValue(searchQuery, 300);
```

---

## Responsive Breakpoints

```css
/* Mobile First Approach */
sm: 640px   /* Small devices */
md: 768px   /* Tablets */
lg: 1024px  /* Laptops */
xl: 1280px  /* Desktops */
2xl: 1536px /* Large screens */
```

**Responsive Patterns**:
- Stack to grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4`
- Hide on mobile: `hidden md:block`
- Adjust sizes: `text-sm md:text-base`
- Flex direction: `flex-col md:flex-row`

---

## Testing Checklist

### Functionality
- [ ] Add user creates new entry
- [ ] Edit user updates existing entry
- [ ] Delete user removes entry with confirmation
- [ ] Toggle status changes active state
- [ ] Search filters by name, email, phone
- [ ] Role filter works correctly
- [ ] Status filter works correctly
- [ ] Organization filter works correctly
- [ ] Sorting works for all columns
- [ ] Three-state sorting (asc → desc → clear)
- [ ] Avatar upload validates file type
- [ ] Avatar upload validates file size
- [ ] Form validation shows errors
- [ ] Click user row opens profile
- [ ] Profile back button returns to list

### UI/UX
- [ ] All badges show correct colors
- [ ] Icons are properly sized
- [ ] Spacing is consistent
- [ ] Hover states work
- [ ] Loading states (if applicable)
- [ ] Empty states display
- [ ] Error states display
- [ ] Success feedback

### Responsive
- [ ] Layout works on mobile (320px+)
- [ ] Layout works on tablet (768px+)
- [ ] Layout works on desktop (1024px+)
- [ ] Touch targets are 44x44px minimum
- [ ] No horizontal scroll
- [ ] Text is readable at all sizes

### Accessibility
- [ ] Keyboard navigation works
- [ ] Screen reader announces changes
- [ ] Color contrast meets standards
- [ ] Focus indicators visible
- [ ] Form labels present
- [ ] Error messages associated

---

## Common Issues & Solutions

### Issue: Dropdown menu not opening
**Solution**: Ensure `e.stopPropagation()` on trigger button
```typescript
<DropdownMenuTrigger asChild>
  <Button onClick={(e) => e.stopPropagation()}>
    <MoreVertical />
  </Button>
</DropdownMenuTrigger>
```

### Issue: Row click interferes with actions
**Solution**: Stop propagation on action buttons
```typescript
<Button onClick={(e) => {
  e.stopPropagation();
  onEdit(user);
}}>
  Edit
</Button>
```

### Issue: Avatar upload not previewing
**Solution**: Use FileReader API
```typescript
const reader = new FileReader();
reader.onloadend = () => {
  setPreview(reader.result as string);
};
reader.readAsDataURL(file);
```

### Issue: Sort indicator not updating
**Solution**: Ensure sortState is in dependency array
```typescript
useEffect(() => {
  applyFilters(users, filters, sortState);
}, [users, filters, sortState]);
```

---

## Extension Ideas

### Advanced Features
1. **Bulk Actions**: Select multiple users for batch operations
2. **Export**: Download user list as CSV/Excel
3. **Import**: Upload CSV to add multiple users
4. **Permissions**: Granular permission management
5. **Audit Trail**: Complete history of all changes
6. **Email Templates**: Send welcome/reset emails
7. **Advanced Filters**: Date ranges, custom queries
8. **Saved Views**: Save filter combinations
9. **Column Customization**: Show/hide columns
10. **Pagination**: For large datasets

### Integration Points
1. **API Integration**: Replace mock data with real API
2. **Authentication**: Integrate with auth provider
3. **File Storage**: Upload avatars to cloud storage
4. **Email Service**: Send notifications
5. **Analytics**: Track user engagement
6. **Logging**: Centralized error logging

---

## Summary

This user management interface demonstrates modern React patterns with:
- **Clean Architecture**: Separation of concerns
- **Type Safety**: Full TypeScript coverage
- **Accessibility**: WCAG AA compliant
- **Responsive**: Mobile-first design
- **Performance**: Optimized rendering
- **UX**: Intuitive interactions
- **Maintainability**: Well-organized code

Follow this guide to build a professional, production-ready user management system that can scale with your application's needs.
