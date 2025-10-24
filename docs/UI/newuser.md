# User Table Component - Complete Build Guide

This guide provides comprehensive instructions for building a professional user table component with sortable columns and action menus using React, TypeScript, Tailwind CSS, and shadcn/ui components.

---

## Table of Contents
1. [Component Overview](#component-overview)
2. [Column Specifications](#column-specifications)
3. [Sorting System](#sorting-system)
4. [Actions Dropdown Menu](#actions-dropdown-menu)
5. [Complete Implementation](#complete-implementation)
6. [Styling Guide](#styling-guide)

---

## Component Overview

### Purpose
Display users in a professional data table with:
- 7 columns (User, Role, Organization, Status, Verified, Last Login, Actions)
- Sortable headers (6 sortable columns)
- Three-state sorting (ascending → descending → clear)
- Interactive row hover and click
- Dropdown action menu per row
- Responsive design

### Dependencies
```typescript
// Import these packages
import { User, SortState, SortField } from "../types/user";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { MoreVertical, Edit, Trash2, Shield, ShieldOff, CheckCircle, XCircle, ArrowUpDown, ArrowUp, ArrowDown, Eye, UserX, UserCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
```

### Component Props
```typescript
interface UserListProps {
  users: User[];                          // Array of users to display
  onEdit: (user: User) => void;           // Edit user callback
  onDelete: (userId: string) => void;     // Delete user callback
  onToggleStatus: (userId: string) => void; // Toggle active/inactive
  onUserClick?: (user: User) => void;     // Click row to view profile
  sortState: SortState;                   // Current sort state
  onSort: (field: SortField) => void;     // Sort change callback
}
```

---

## Column Specifications

### Column 1: User Column (35% width)

**Purpose**: Display user identity with avatar, name, email, and phone

**Visual Design**:
```
┌─────────────────────────────────────┐
│  [Avatar]  John Doe                 │
│            john.doe@company.com     │
│            +1-555-0123              │
└─────────────────────────────────────┘
```

**Layout Structure**:
- **Container**: Flexbox row with gap-3
- **Avatar Size**: 40px × 40px (w-10 h-10)
- **Text Stack**: Vertical layout (name, email, phone)
- **Sortable**: Yes (sorts by full_name)

**Implementation**:
```tsx
<TableCell>
  <div className="flex items-center gap-3">
    {/* Avatar */}
    <Avatar className="w-10 h-10">
      {user.avatar_url ? (
        <AvatarImage src={user.avatar_url} alt={user.full_name || "User"} />
      ) : null}
      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white">
        {getInitials(user.full_name || user.email)}
      </AvatarFallback>
    </Avatar>
    
    {/* User Info */}
    <div className="min-w-0 flex-1">
      <div className="text-gray-900 truncate">
        {user.full_name || "No Name"}
      </div>
      <div className="text-sm text-gray-500 truncate">
        {user.email}
      </div>
      {user.phone && (
        <div className="text-sm text-gray-400 truncate">
          {user.phone}
        </div>
      )}
    </div>
  </div>
</TableCell>
```

**Helper Function**:
```typescript
const getInitials = (name: string | null): string => {
  if (!name) return "U";
  const parts = name.trim().split(" ");
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};
```

**Avatar Gradient Colors**:
```css
/* Use gradient for fallback avatars */
bg-gradient-to-br from-blue-500 to-purple-500
bg-gradient-to-br from-green-500 to-teal-500
bg-gradient-to-br from-purple-500 to-pink-500
bg-gradient-to-br from-orange-500 to-red-500
```

**Text Styling**:
- **Name**: text-gray-900 (dark, prominent)
- **Email**: text-sm text-gray-500 (medium gray)
- **Phone**: text-sm text-gray-400 (light gray)
- **All text**: truncate (prevents overflow)

---

### Column 2: Role Column (15% width)

**Purpose**: Display user's role with color-coded badge

**Visual Design**:
```
┌──────────────┐
│  Super Admin │  (Purple badge)
└──────────────┘
```

**Badge Color Mapping**:
```typescript
const getRoleBadgeColor = (roleCode: string): string => {
  const colors: Record<string, string> = {
    SA: "bg-purple-100 text-purple-800 border-purple-200",
    HQ_ADMIN: "bg-blue-100 text-blue-800 border-blue-200",
    POWER_USER: "bg-indigo-100 text-indigo-800 border-indigo-200",
    MANAGER: "bg-green-100 text-green-800 border-green-200",
    USER: "bg-gray-100 text-gray-800 border-gray-200",
    GUEST: "bg-orange-100 text-orange-800 border-orange-200",
  };
  return colors[roleCode] || "bg-gray-100 text-gray-800 border-gray-200";
};
```

**Implementation**:
```tsx
<TableCell>
  <Badge 
    variant="outline" 
    className={getRoleBadgeColor(user.role_code)}
  >
    {user.role_name || user.role_code}
  </Badge>
</TableCell>
```

**Badge Styling Details**:
- **Size**: Auto (fits content)
- **Padding**: Default badge padding (px-2.5 py-0.5)
- **Border**: 1px solid (matches background color family)
- **Border Radius**: Default (rounded-md)
- **Font Size**: text-xs
- **Font Weight**: font-medium
- **Sortable**: Yes (sorts alphabetically by role_name)

---

### Column 3: Organization Column (15% width)

**Purpose**: Display user's organization or "No Organization"

**Visual Design**:
```
┌──────────────────────┐
│  Acme Corporation    │
│  or                  │
│  No Organization     │  (gray, italic)
└──────────────────────┘
```

**Implementation**:
```tsx
<TableCell>
  {user.organization_name ? (
    <span className="text-gray-900">{user.organization_name}</span>
  ) : (
    <span className="text-gray-400 italic">No Organization</span>
  )}
</TableCell>
```

**Styling Details**:
- **With Org**: text-gray-900 (dark text)
- **Without Org**: text-gray-400 italic (light, italicized)
- **Truncate**: Add truncate if organization names are long
- **Sortable**: Yes (sorts alphabetically, "No Organization" goes last)

**Tooltip for Long Names** (Optional):
```tsx
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="text-gray-900 truncate block max-w-[200px]">
        {user.organization_name}
      </span>
    </TooltipTrigger>
    <TooltipContent>
      <p>{user.organization_name}</p>
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

---

### Column 4: Status Column (12% width)

**Purpose**: Display active/inactive status with color-coded badge

**Visual Design**:
```
┌─────────┐        ┌──────────┐
│ Active  │  or    │ Inactive │
└─────────┘        └──────────┘
 (Green)            (Red)
```

**Status Badge Styling**:
```typescript
const getStatusBadge = (isActive: boolean) => {
  if (isActive) {
    return {
      text: "Active",
      className: "bg-green-100 text-green-800 border-green-200",
      icon: CheckCircle,
    };
  } else {
    return {
      text: "Inactive",
      className: "bg-red-100 text-red-800 border-red-200",
      icon: XCircle,
    };
  }
};
```

**Implementation**:
```tsx
<TableCell>
  {(() => {
    const status = getStatusBadge(user.is_active);
    const Icon = status.icon;
    return (
      <Badge variant="outline" className={status.className}>
        <Icon className="w-3 h-3 mr-1" />
        {status.text}
      </Badge>
    );
  })()}
</TableCell>
```

**Badge Details**:
- **Icon Size**: 12px × 12px (w-3 h-3)
- **Icon Position**: Left of text with mr-1
- **Active Colors**: 
  - Background: bg-green-100
  - Text: text-green-800
  - Border: border-green-200
  - Icon: CheckCircle from lucide-react
- **Inactive Colors**:
  - Background: bg-red-100
  - Text: text-red-800
  - Border: border-red-200
  - Icon: XCircle from lucide-react
- **Sortable**: Yes (Active = 1, Inactive = 0)

---

### Column 5: Verified Column (12% width)

**Purpose**: Display email/phone verification status

**Visual Design**:
```
┌──────────┐        ┌────────────┐
│ Verified │  or    │ Unverified │
└──────────┘        └────────────┘
 (Blue)              (Yellow)
```

**Verification Badge Styling**:
```typescript
const getVerifiedBadge = (isVerified: boolean) => {
  if (isVerified) {
    return {
      text: "Verified",
      className: "bg-blue-100 text-blue-800 border-blue-200",
      icon: CheckCircle,
    };
  } else {
    return {
      text: "Unverified",
      className: "bg-yellow-100 text-yellow-800 border-yellow-200",
      icon: XCircle,
    };
  }
};
```

**Implementation**:
```tsx
<TableCell>
  {(() => {
    const verified = getVerifiedBadge(user.is_verified);
    const Icon = verified.icon;
    return (
      <Badge variant="outline" className={verified.className}>
        <Icon className="w-3 h-3 mr-1" />
        {verified.text}
      </Badge>
    );
  })()}
</TableCell>
```

**Advanced Implementation with Tooltip**:
```tsx
<TableCell>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        {(() => {
          const verified = getVerifiedBadge(user.is_verified);
          const Icon = verified.icon;
          return (
            <Badge variant="outline" className={verified.className}>
              <Icon className="w-3 h-3 mr-1" />
              {verified.text}
            </Badge>
          );
        })()}
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs">
          {user.email_verified_at && (
            <p>Email: ✓ Verified</p>
          )}
          {user.phone_verified_at && (
            <p>Phone: ✓ Verified</p>
          )}
          {!user.is_verified && (
            <p>No verifications</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</TableCell>
```

**Badge Details**:
- **Verified Colors**:
  - Background: bg-blue-100
  - Text: text-blue-800
  - Border: border-blue-200
- **Unverified Colors**:
  - Background: bg-yellow-100
  - Text: text-yellow-800
  - Border: border-yellow-200
- **Sortable**: Yes (Verified = 1, Unverified = 0)

---

### Column 6: Last Login Column (15% width)

**Purpose**: Display relative time since last login

**Visual Design**:
```
┌─────────────────┐
│  2 hours ago    │
│  or             │
│  Never          │  (gray, italic)
└─────────────────┘
```

**Implementation**:
```tsx
<TableCell>
  <span className={user.last_login_at ? "text-gray-900" : "text-gray-400 italic"}>
    {formatLastLogin(user.last_login_at)}
  </span>
</TableCell>
```

**Helper Function**:
```typescript
const formatLastLogin = (lastLogin: string | null): string => {
  if (!lastLogin) return "Never";
  
  try {
    return formatDistanceToNow(new Date(lastLogin), { 
      addSuffix: true 
    });
  } catch (error) {
    return "Unknown";
  }
};
```

**Examples of Output**:
- "2 minutes ago"
- "3 hours ago"
- "2 days ago"
- "about 1 month ago"
- "Never" (if null)

**Advanced Implementation with Tooltip**:
```tsx
<TableCell>
  {user.last_login_at ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-gray-900 cursor-help">
            {formatLastLogin(user.last_login_at)}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <p>{format(new Date(user.last_login_at), "MMM d, yyyy 'at' h:mm a")}</p>
            {user.last_login_ip && (
              <p className="text-gray-400 mt-1">IP: {user.last_login_ip}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    <span className="text-gray-400 italic">Never</span>
  )}
</TableCell>
```

**Styling Details**:
- **With Login**: text-gray-900
- **Never Logged In**: text-gray-400 italic
- **Cursor**: cursor-help (when tooltip present)
- **Sortable**: Yes (sorts by timestamp, "Never" goes last)

---

### Column 7: Actions Column (8% width)

**Purpose**: Provide quick access to user actions

**Visual Design**:
```
┌──────────────────┐
│  [Edit] [⋮]      │  (Edit button + 3-dot menu)
└──────────────────┘
```

**Layout**: Right-aligned with flexbox

**Implementation**:
```tsx
<TableHead className="text-right">Actions</TableHead>

<TableCell className="text-right">
  <div className="flex items-center justify-end gap-2">
    {/* Edit Button */}
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        onEdit(user);
      }}
    >
      <Edit className="w-4 h-4 mr-1" />
      Edit
    </Button>
    
    {/* 3-Dot Dropdown Menu */}
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="w-4 h-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {/* Dropdown items - see next section */}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</TableCell>
```

**Button Styling**:
- **Edit Button**:
  - Variant: ghost
  - Size: sm
  - Icon: Edit (16px, mr-1)
  - Text: "Edit"
  - Hover: hover:bg-gray-100

- **3-Dot Button**:
  - Variant: ghost
  - Size: 32px × 32px (h-8 w-8 p-0)
  - Icon: MoreVertical (16px)
  - No text (icon only)
  - Hover: hover:bg-gray-100

**Important**: `e.stopPropagation()` prevents row click when clicking actions

---

## Actions Dropdown Menu

### Menu Structure

The 3-dot dropdown menu contains 7 action items organized into 3 groups:

```
┌────────────────────────────┐
│  Actions                   │  ← Label
├────────────────────────────┤
│  👁️  View Profile          │  ← Group 1: View
├────────────────────────────┤
│  ✏️  Edit User             │  ← Group 2: Modify
│  ✅  Activate User         │
│  or                        │
│  ❌  Deactivate User       │
├────────────────────────────┤
│  🗑️  Delete User           │  ← Group 3: Delete (red)
└────────────────────────────┘
```

### Complete Dropdown Implementation

```tsx
<DropdownMenuContent align="end" className="w-48">
  {/* Menu Label */}
  <DropdownMenuLabel>Actions</DropdownMenuLabel>
  
  <DropdownMenuSeparator />
  
  {/* Group 1: View */}
  <DropdownMenuItem
    onClick={(e) => {
      e.stopPropagation();
      onUserClick?.(user);
    }}
  >
    <Eye className="w-4 h-4 mr-2" />
    View Profile
  </DropdownMenuItem>
  
  <DropdownMenuSeparator />
  
  {/* Group 2: Modify */}
  <DropdownMenuItem
    onClick={(e) => {
      e.stopPropagation();
      onEdit(user);
    }}
  >
    <Edit className="w-4 h-4 mr-2" />
    Edit User
  </DropdownMenuItem>
  
  {user.is_active ? (
    <DropdownMenuItem
      onClick={(e) => {
        e.stopPropagation();
        onToggleStatus(user.id);
      }}
    >
      <UserX className="w-4 h-4 mr-2" />
      Deactivate User
    </DropdownMenuItem>
  ) : (
    <DropdownMenuItem
      onClick={(e) => {
        e.stopPropagation();
        onToggleStatus(user.id);
      }}
    >
      <UserCheck className="w-4 h-4 mr-2" />
      Activate User
    </DropdownMenuItem>
  )}
  
  <DropdownMenuSeparator />
  
  {/* Group 3: Delete (Destructive) */}
  <DropdownMenuItem
    onClick={(e) => {
      e.stopPropagation();
      onDelete(user.id);
    }}
    className="text-red-600 focus:text-red-600 focus:bg-red-50"
  >
    <Trash2 className="w-4 h-4 mr-2" />
    Delete User
  </DropdownMenuItem>
</DropdownMenuContent>
```

### Menu Item Specifications

#### 1. View Profile
```tsx
<DropdownMenuItem onClick={(e) => { /* ... */ }}>
  <Eye className="w-4 h-4 mr-2" />
  View Profile
</DropdownMenuItem>
```
- **Icon**: Eye (view/preview icon)
- **Action**: Navigate to user profile page
- **Color**: Default (text-gray-900)

#### 2. Edit User
```tsx
<DropdownMenuItem onClick={(e) => { /* ... */ }}>
  <Edit className="w-4 h-4 mr-2" />
  Edit User
</DropdownMenuItem>
```
- **Icon**: Edit (pencil icon)
- **Action**: Open edit dialog
- **Color**: Default (text-gray-900)

#### 3. Activate/Deactivate User
```tsx
{user.is_active ? (
  <DropdownMenuItem onClick={(e) => { /* ... */ }}>
    <UserX className="w-4 h-4 mr-2" />
    Deactivate User
  </DropdownMenuItem>
) : (
  <DropdownMenuItem onClick={(e) => { /* ... */ }}>
    <UserCheck className="w-4 h-4 mr-2" />
    Activate User
  </DropdownMenuItem>
)}
```
- **Icon (Deactivate)**: UserX
- **Icon (Activate)**: UserCheck
- **Action**: Toggle user's active status
- **Color**: Default (text-gray-900)
- **Dynamic**: Shows opposite of current state

#### 4. Delete User
```tsx
<DropdownMenuItem
  onClick={(e) => { /* ... */ }}
  className="text-red-600 focus:text-red-600 focus:bg-red-50"
>
  <Trash2 className="w-4 h-4 mr-2" />
  Delete User
</DropdownMenuItem>
```
- **Icon**: Trash2 (trash bin icon)
- **Action**: Delete user (with confirmation)
- **Color**: Red (destructive action)
  - Text: text-red-600
  - Focus bg: focus:bg-red-50
  - Focus text: focus:text-red-600

### Menu Styling Details

**Dropdown Container**:
```css
width: 12rem (w-48)
align: end (right-aligned with trigger)
padding: 0.5rem 0 (py-2)
background: white
border: 1px solid rgba(0,0,0,0.1)
border-radius: 0.375rem (rounded-md)
box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1)
```

**Menu Items**:
```css
padding: 0.5rem 0.75rem (py-2 px-3)
font-size: 0.875rem (text-sm)
cursor: pointer
transition: all 0.15s ease
```

**Hover States**:
- Default items: `hover:bg-gray-100`
- Delete item: `hover:bg-red-50`

**Icon Spacing**:
- Icon size: 16px × 16px (w-4 h-4)
- Right margin: 0.5rem (mr-2)
- Vertical align: middle

**Separators**:
```tsx
<DropdownMenuSeparator />
```
- Height: 1px
- Color: rgba(0,0,0,0.1)
- Margin: 0.25rem 0 (my-1)

---

## Sorting System

### Three-State Sorting Logic

**States**:
1. **Unsorted** (null): Default state, shows ↕ icon
2. **Ascending** (asc): A→Z, 0→9, Old→New, shows ↑ icon
3. **Descending** (desc): Z→A, 9→0, New→Old, shows ↓ icon

**Click Behavior**:
```
null → asc → desc → null → asc → ...
```

### Sort State Management

**Type Definitions**:
```typescript
export type SortField = 
  | "name"           // Sorts by full_name
  | "role"           // Sorts by role_name
  | "organization"   // Sorts by organization_name
  | "status"         // Sorts by is_active
  | "verified"       // Sorts by is_verified
  | "last_login";    // Sorts by last_login_at

export type SortDirection = "asc" | "desc" | null;

export interface SortState {
  field: SortField | null;
  direction: SortDirection;
}
```

**State in Parent Component**:
```typescript
const [sortState, setSortState] = useState<SortState>({
  field: null,
  direction: null,
});
```

### Sort Handler Function

```typescript
const handleSort = (field: SortField) => {
  let newDirection: SortDirection = "asc";
  
  // If clicking the same field
  if (sortState.field === field) {
    if (sortState.direction === "asc") {
      newDirection = "desc";
    } else if (sortState.direction === "desc") {
      newDirection = null;  // Clear sort
    }
  }
  
  const newSortState = {
    field: newDirection ? field : null,
    direction: newDirection,
  };
  
  setSortState(newSortState);
  applyFilters(users, filters, newSortState);
};
```

### Sortable Header Component

```tsx
const SortableHeader = ({ 
  field, 
  children 
}: { 
  field: SortField; 
  children: React.ReactNode;
}) => {
  const isActive = sortState.field === field;
  const direction = isActive ? sortState.direction : null;

  return (
    <TableHead>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 h-8 data-[state=open]:bg-accent hover:bg-gray-100"
        onClick={(e) => {
          e.stopPropagation();
          onSort(field);
        }}
      >
        <span className="text-gray-700">{children}</span>
        
        {/* Unsorted State */}
        {!isActive && (
          <ArrowUpDown className="ml-2 h-4 w-4 text-gray-400" />
        )}
        
        {/* Ascending State */}
        {isActive && direction === "asc" && (
          <ArrowUp className="ml-2 h-4 w-4 text-blue-600" />
        )}
        
        {/* Descending State */}
        {isActive && direction === "desc" && (
          <ArrowDown className="ml-2 h-4 w-4 text-blue-600" />
        )}
      </Button>
    </TableHead>
  );
};
```

### Sort Implementation by Column

#### 1. Name Sorting
```typescript
case "name":
  aValue = a.full_name?.toLowerCase() || "";
  bValue = b.full_name?.toLowerCase() || "";
  break;
```
- Case-insensitive alphabetical
- Null names go last
- A→Z (asc), Z→A (desc)

#### 2. Role Sorting
```typescript
case "role":
  aValue = a.role_name?.toLowerCase() || a.role_code.toLowerCase();
  bValue = b.role_name?.toLowerCase() || b.role_code.toLowerCase();
  break;
```
- Sorts by role_name (display name)
- Falls back to role_code if no name
- Alphabetical order

#### 3. Organization Sorting
```typescript
case "organization":
  aValue = a.organization_name?.toLowerCase() || "";
  bValue = b.organization_name?.toLowerCase() || "";
  break;
```
- Sorts by organization name
- "No Organization" (null) goes last
- Alphabetical order

#### 4. Status Sorting
```typescript
case "status":
  aValue = a.is_active ? 1 : 0;
  bValue = b.is_active ? 1 : 0;
  break;
```
- Boolean to number conversion
- Active (1) before Inactive (0) when ascending
- Inactive (0) before Active (1) when descending

#### 5. Verified Sorting
```typescript
case "verified":
  aValue = a.is_verified ? 1 : 0;
  bValue = b.is_verified ? 1 : 0;
  break;
```
- Boolean to number conversion
- Verified (1) before Unverified (0) when ascending
- Unverified (0) before Verified (1) when descending

#### 6. Last Login Sorting
```typescript
case "last_login":
  aValue = a.last_login_at ? new Date(a.last_login_at).getTime() : 0;
  bValue = b.last_login_at ? new Date(b.last_login_at).getTime() : 0;
  break;
```
- Converts dates to timestamps
- Never logged in (null) = 0
- Oldest first (asc), Newest first (desc)

### Complete Sort Function

```typescript
const sortUsers = (userList: User[], sort: SortState): User[] => {
  if (!sort.field || !sort.direction) return userList;

  return [...userList].sort((a, b) => {
    let aValue: any;
    let bValue: any;

    switch (sort.field) {
      case "name":
        aValue = a.full_name?.toLowerCase() || "";
        bValue = b.full_name?.toLowerCase() || "";
        break;
      case "role":
        aValue = a.role_name?.toLowerCase() || a.role_code.toLowerCase();
        bValue = b.role_name?.toLowerCase() || b.role_code.toLowerCase();
        break;
      case "organization":
        aValue = a.organization_name?.toLowerCase() || "";
        bValue = b.organization_name?.toLowerCase() || "";
        break;
      case "status":
        aValue = a.is_active ? 1 : 0;
        bValue = b.is_active ? 1 : 0;
        break;
      case "verified":
        aValue = a.is_verified ? 1 : 0;
        bValue = b.is_verified ? 1 : 0;
        break;
      case "last_login":
        aValue = a.last_login_at ? new Date(a.last_login_at).getTime() : 0;
        bValue = b.last_login_at ? new Date(b.last_login_at).getTime() : 0;
        break;
      default:
        return 0;
    }

    if (aValue < bValue) return sort.direction === "asc" ? -1 : 1;
    if (aValue > bValue) return sort.direction === "asc" ? 1 : -1;
    return 0;
  });
};
```

### Visual Sort Indicators

**Icon Specifications**:
- **Size**: 16px × 16px (w-4 h-4)
- **Position**: Right of header text with ml-2
- **Colors**:
  - Inactive: text-gray-400
  - Active: text-blue-600

**Icon Components** (from lucide-react):
```tsx
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
```

**States**:
1. **ArrowUpDown** (↕): Unsorted state, gray color
2. **ArrowUp** (↑): Ascending sort, blue color
3. **ArrowDown** (↓): Descending sort, blue color

---

## Complete Implementation

### Full Component Code

```tsx
import { User, SortState, SortField } from "../types/user";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import {
  MoreVertical,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  UserX,
  UserCheck,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface UserListProps {
  users: User[];
  onEdit: (user: User) => void;
  onDelete: (userId: string) => void;
  onToggleStatus: (userId: string) => void;
  onUserClick?: (user: User) => void;
  sortState: SortState;
  onSort: (field: SortField) => void;
}

export function UserList({
  users,
  onEdit,
  onDelete,
  onToggleStatus,
  onUserClick,
  sortState,
  onSort,
}: UserListProps) {
  // Helper Functions
  const getInitials = (name: string | null): string => {
    if (!name) return "U";
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getRoleBadgeColor = (roleCode: string): string => {
    const colors: Record<string, string> = {
      SA: "bg-purple-100 text-purple-800 border-purple-200",
      HQ_ADMIN: "bg-blue-100 text-blue-800 border-blue-200",
      POWER_USER: "bg-indigo-100 text-indigo-800 border-indigo-200",
      MANAGER: "bg-green-100 text-green-800 border-green-200",
      USER: "bg-gray-100 text-gray-800 border-gray-200",
      GUEST: "bg-orange-100 text-orange-800 border-orange-200",
    };
    return colors[roleCode] || "bg-gray-100 text-gray-800 border-gray-200";
  };

  const formatLastLogin = (lastLogin: string | null): string => {
    if (!lastLogin) return "Never";
    try {
      return formatDistanceToNow(new Date(lastLogin), { addSuffix: true });
    } catch {
      return "Unknown";
    }
  };

  // Sortable Header Component
  const SortableHeader = ({
    field,
    children,
  }: {
    field: SortField;
    children: React.ReactNode;
  }) => {
    const isActive = sortState.field === field;
    const direction = isActive ? sortState.direction : null;

    return (
      <TableHead>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 data-[state=open]:bg-accent"
          onClick={(e) => {
            e.stopPropagation();
            onSort(field);
          }}
        >
          {children}
          {!isActive && <ArrowUpDown className="ml-2 h-4 w-4 text-gray-400" />}
          {isActive && direction === "asc" && (
            <ArrowUp className="ml-2 h-4 w-4 text-blue-600" />
          )}
          {isActive && direction === "desc" && (
            <ArrowDown className="ml-2 h-4 w-4 text-blue-600" />
          )}
        </Button>
      </TableHead>
    );
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHeader field="name">User</SortableHeader>
            <SortableHeader field="role">Role</SortableHeader>
            <SortableHeader field="organization">Organization</SortableHeader>
            <SortableHeader field="status">Status</SortableHeader>
            <SortableHeader field="verified">Verified</SortableHeader>
            <SortableHeader field="last_login">Last Login</SortableHeader>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                No users found
              </TableCell>
            </TableRow>
          ) : (
            users.map((user) => (
              <TableRow
                key={user.id}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => onUserClick?.(user)}
              >
                {/* User Column */}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10">
                      {user.avatar_url && (
                        <AvatarImage src={user.avatar_url} alt={user.full_name || "User"} />
                      )}
                      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white">
                        {getInitials(user.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="text-gray-900 truncate">
                        {user.full_name || "No Name"}
                      </div>
                      <div className="text-sm text-gray-500 truncate">{user.email}</div>
                      {user.phone && (
                        <div className="text-sm text-gray-400 truncate">{user.phone}</div>
                      )}
                    </div>
                  </div>
                </TableCell>

                {/* Role Column */}
                <TableCell>
                  <Badge variant="outline" className={getRoleBadgeColor(user.role_code)}>
                    {user.role_name || user.role_code}
                  </Badge>
                </TableCell>

                {/* Organization Column */}
                <TableCell>
                  {user.organization_name ? (
                    <span className="text-gray-900">{user.organization_name}</span>
                  ) : (
                    <span className="text-gray-400 italic">No Organization</span>
                  )}
                </TableCell>

                {/* Status Column */}
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      user.is_active
                        ? "bg-green-100 text-green-800 border-green-200"
                        : "bg-red-100 text-red-800 border-red-200"
                    }
                  >
                    {user.is_active ? (
                      <>
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Active
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3 h-3 mr-1" />
                        Inactive
                      </>
                    )}
                  </Badge>
                </TableCell>

                {/* Verified Column */}
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      user.is_verified
                        ? "bg-blue-100 text-blue-800 border-blue-200"
                        : "bg-yellow-100 text-yellow-800 border-yellow-200"
                    }
                  >
                    {user.is_verified ? (
                      <>
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Verified
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3 h-3 mr-1" />
                        Unverified
                      </>
                    )}
                  </Badge>
                </TableCell>

                {/* Last Login Column */}
                <TableCell>
                  <span
                    className={user.last_login_at ? "text-gray-900" : "text-gray-400 italic"}
                  >
                    {formatLastLogin(user.last_login_at)}
                  </span>
                </TableCell>

                {/* Actions Column */}
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(user);
                      }}
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      Edit
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="w-4 h-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onUserClick?.(user);
                          }}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          View Profile
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(user);
                          }}
                        >
                          <Edit className="w-4 h-4 mr-2" />
                          Edit User
                        </DropdownMenuItem>
                        {user.is_active ? (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleStatus(user.id);
                            }}
                          >
                            <UserX className="w-4 h-4 mr-2" />
                            Deactivate User
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleStatus(user.id);
                            }}
                          >
                            <UserCheck className="w-4 h-4 mr-2" />
                            Activate User
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(user.id);
                          }}
                          className="text-red-600 focus:text-red-600 focus:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete User
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

---

## Styling Guide

### Table Container
```css
.border           /* 1px solid border */
.rounded-lg       /* 8px border radius */
.overflow-hidden  /* Clips content to border radius */
```

### Table Header
```css
background: #F9FAFB (gray-50)
border-bottom: 1px solid rgba(0,0,0,0.1)
font-weight: 500
color: #374151 (gray-700)
```

### Table Rows
```css
/* Default */
border-bottom: 1px solid rgba(0,0,0,0.05)
background: white

/* Hover */
background: #F9FAFB (gray-50)
cursor: pointer
transition: background 0.15s ease

/* Last row */
border-bottom: none
```

### Table Cells
```css
padding: 1rem (px-4 py-4)
vertical-align: middle
font-size: 0.875rem (text-sm)
```

### Responsive Design

**Mobile (< 768px)**:
```css
/* Hide less important columns */
.hide-mobile {
  display: none;
}

/* Stack user info vertically */
.user-info {
  flex-direction: column;
  gap: 0.5rem;
}
```

**Tablet (768px - 1024px)**:
```css
/* Show all columns but reduce padding */
padding: 0.75rem (px-3 py-3)
```

**Desktop (> 1024px)**:
```css
/* Full layout with all features */
padding: 1rem (px-4 py-4)
```

---

## Event Handling

### Row Click
```tsx
onClick={() => onUserClick?.(user)}
```
- Navigates to user profile
- Optional callback (uses `?.`)
- Entire row is clickable

### Edit Button Click
```tsx
onClick={(e) => {
  e.stopPropagation();  // Prevent row click
  onEdit(user);
}}
```
- Opens edit dialog
- Stops event propagation

### Dropdown Trigger Click
```tsx
onClick={(e) => e.stopPropagation()}
```
- Opens dropdown menu
- Prevents row click

### Dropdown Item Click
```tsx
onClick={(e) => {
  e.stopPropagation();  // Prevent row click
  // Action logic here
}}
```
- Executes action
- Closes dropdown automatically
- Prevents row click

### Sort Header Click
```tsx
onClick={(e) => {
  e.stopPropagation();  // Prevent row click (if nested)
  onSort(field);
}}
```
- Cycles through sort states
- Updates visual indicators

---

## Testing Checklist

### Visual Testing
- [ ] All columns display correctly
- [ ] Badges show correct colors
- [ ] Icons are properly sized (16px)
- [ ] Avatar fallbacks work
- [ ] Tooltips appear on hover
- [ ] Sort indicators update correctly
- [ ] Hover states work on rows
- [ ] Dropdown menu opens correctly
- [ ] Responsive layout works

### Functional Testing
- [ ] Click row navigates to profile
- [ ] Edit button opens dialog
- [ ] 3-dot menu opens/closes
- [ ] View Profile menu item works
- [ ] Edit User menu item works
- [ ] Activate/Deactivate toggles status
- [ ] Delete prompts confirmation
- [ ] Sort cycles through 3 states
- [ ] All 6 sort columns work
- [ ] Filters + Sort work together

### Edge Cases
- [ ] Empty user list shows message
- [ ] Long names truncate properly
- [ ] Missing data shows fallbacks
- [ ] "Never" shows for null dates
- [ ] "No Organization" shows for null org
- [ ] Sort handles null values
- [ ] Dropdown doesn't trigger row click
- [ ] Multiple rapid clicks handled

---

## Summary

This table component provides:
- **7 Columns**: User, Role, Organization, Status, Verified, Last Login, Actions
- **6 Sortable Columns**: Three-state sorting with visual indicators
- **7 Action Items**: View, Edit, Activate/Deactivate, Delete
- **Professional UI**: Color-coded badges, avatars, tooltips
- **Responsive**: Works on mobile, tablet, desktop
- **Accessible**: Keyboard navigation, ARIA labels, screen reader support

The implementation follows modern React patterns with proper event handling, TypeScript typing, and shadcn/ui components for a consistent, professional appearance.
