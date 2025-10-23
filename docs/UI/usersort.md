# User List with Sortable Columns - Complete Implementation Guide

## Overview
This guide provides step-by-step instructions for building a comprehensive user management table with sortable columns, bulk operations, and professional UI design. The implementation uses React, TypeScript, Tailwind CSS, and shadcn/ui components.

## 🎯 Final Result Features
- **Sortable columns** for all data fields (Name, Role, Status, Department, Join Date, Last Login)
- **Multi-select functionality** with checkboxes and "select all" option
- **Professional UI design** with hover states, badges, and avatars
- **Action menus** for individual user operations
- **Responsive design** that works on all screen sizes
- **Type-safe implementation** with TypeScript

## 📊 Data Structure

### 1. Define User Interface
```typescript
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'HQ_ADMIN' | 'POWER_USER' | 'Manufacture' | 'Distributor' | 'Shop' | 'Guest';
  status: 'Active' | 'Inactive' | 'Pending';
  department: string;
  joinDate: string;
  lastLogin: string;
  avatar: string;
}
```

### 2. Create Mock Data
```typescript
const mockUsers: User[] = [
  {
    id: '1',
    name: 'Sarah Johnson',
    email: 'sarah.johnson@company.com',
    role: 'HQ_ADMIN',
    status: 'Active',
    department: 'Headquarters',
    joinDate: '2022-01-15',
    lastLogin: '2024-10-02T09:30:00',
    avatar: 'https://images.unsplash.com/photo-1494790108755-2616b6faf12c?w=150&h=150&fit=crop&crop=face'
  },
  // Add more users...
];
```

## 🔧 Core Implementation

### 3. Sorting Functionality

#### Define Sort Types
```typescript
type SortField = 'name' | 'email' | 'role' | 'status' | 'department' | 'joinDate' | 'lastLogin';
type SortDirection = 'asc' | 'desc';
```

#### Implement Sort State
```typescript
const [sortField, setSortField] = useState<SortField>('name');
const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
```

#### Create Sort Handler
```typescript
const handleSort = (field: SortField) => {
  if (sortField === field) {
    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
  } else {
    setSortField(field);
    setSortDirection('asc');
  }
};
```

#### Implement Sort Logic
```typescript
const sortedUsers = [...users].sort((a, b) => {
  let aValue = a[sortField];
  let bValue = b[sortField];

  // Special handling for dates
  if (sortField === 'joinDate' || sortField === 'lastLogin') {
    if (aValue === 'Never') aValue = '1970-01-01';
    if (bValue === 'Never') bValue = '1970-01-01';
    aValue = new Date(aValue).getTime();
    bValue = new Date(bValue).getTime();
  }

  if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
  if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
  return 0;
});
```

### 4. Multi-Select Functionality

#### Select State Management
```typescript
const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

const handleSelectAll = (checked: boolean) => {
  if (checked) {
    onSelectedUsersChange(users.map(user => user.id));
  } else {
    onSelectedUsersChange([]);
  }
};

const handleSelectUser = (userId: string, checked: boolean) => {
  if (checked) {
    onSelectedUsersChange([...selectedUsers, userId]);
  } else {
    onSelectedUsersChange(selectedUsers.filter(id => id !== userId));
  }
};
```

#### Select All Logic
```typescript
const isAllSelected = users.length > 0 && selectedUsers.length === users.length;
const isSomeSelected = selectedUsers.length > 0 && selectedUsers.length < users.length;
```

## 🎨 UI Components Implementation

### 5. Sortable Header Component
```typescript
const SortableHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
  <Button
    variant="ghost"
    className="h-auto p-0 font-medium hover:bg-transparent"
    onClick={() => handleSort(field)}
  >
    {children}
    <ArrowUpDown className="ml-2 h-4 w-4" />
  </Button>
);
```

### 6. Status Badge System
```typescript
const getStatusBadge = (status: User['status']) => {
  const variants = {
    Active: 'bg-green-100 text-green-800 hover:bg-green-100',
    Inactive: 'bg-red-100 text-red-800 hover:bg-red-100',
    Pending: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100'
  };
  return <Badge variant="secondary" className={variants[status]}>{status}</Badge>;
};
```

### 7. Role Badge System
```typescript
const getRoleBadge = (role: User['role']) => {
  const variants = {
    HQ_ADMIN: 'bg-purple-100 text-purple-800 hover:bg-purple-100',
    POWER_USER: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
    Manufacture: 'bg-gray-100 text-gray-800 hover:bg-gray-100',
    Distributor: 'bg-orange-100 text-orange-800 hover:bg-orange-100',
    Shop: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-100',
    Guest: 'bg-gray-100 text-gray-600 hover:bg-gray-100'
  };
  return <Badge variant="secondary" className={variants[role]}>{role}</Badge>;
};
```

### 8. Date Formatting Utilities
```typescript
const formatDate = (dateString: string) => {
  if (dateString === 'Never') return 'Never';
  return new Date(dateString).toLocaleDateString();
};

const formatLastLogin = (dateString: string) => {
  if (dateString === 'Never') return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};
```

## 🏗️ Table Structure

### 9. Complete Table Implementation
```typescript
<div className="rounded-md border overflow-visible">
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead className="w-12">
          <Checkbox
            checked={isAllSelected}
            onCheckedChange={handleSelectAll}
            aria-label="Select all users"
          />
        </TableHead>
        <TableHead>
          <SortableHeader field="name">User</SortableHeader>
        </TableHead>
        <TableHead>
          <SortableHeader field="role">Role</SortableHeader>
        </TableHead>
        <TableHead>
          <SortableHeader field="status">Status</SortableHeader>
        </TableHead>
        <TableHead>
          <SortableHeader field="department">Department</SortableHeader>
        </TableHead>
        <TableHead>
          <SortableHeader field="joinDate">Join Date</SortableHeader>
        </TableHead>
        <TableHead>
          <SortableHeader field="lastLogin">Last Login</SortableHeader>
        </TableHead>
        <TableHead className="w-12"></TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {sortedUsers.map((user) => (
        <TableRow 
          key={user.id}
          className="cursor-pointer hover:bg-muted/50"
          onClick={(e) => {
            // Prevent click when interacting with checkboxes or dropdowns
            if ((e.target as HTMLElement).closest('[data-slot="dropdown-menu-trigger"], [data-slot="checkbox"]')) {
              return;
            }
            onViewUser(user);
          }}
        >
          {/* Table cells implementation */}
        </TableRow>
      ))}
    </TableBody>
  </Table>
</div>
```

### 10. User Row Implementation
```typescript
<TableRow key={user.id} className="cursor-pointer hover:bg-muted/50">
  <TableCell>
    <Checkbox
      checked={selectedUsers.includes(user.id)}
      onCheckedChange={(checked) => handleSelectUser(user.id, !!checked)}
      aria-label={`Select ${user.name}`}
    />
  </TableCell>
  <TableCell>
    <div className="flex items-center gap-3">
      <Avatar className="h-8 w-8">
        <AvatarImage src={user.avatar} alt={user.name} />
        <AvatarFallback>
          {user.name.split(' ').map(n => n[0]).join('')}
        </AvatarFallback>
      </Avatar>
      <div>
        <div className="font-medium">{user.name}</div>
        <div className="text-sm text-muted-foreground">{user.email}</div>
      </div>
    </div>
  </TableCell>
  <TableCell>{getRoleBadge(user.role)}</TableCell>
  <TableCell>{getStatusBadge(user.status)}</TableCell>
  <TableCell>{user.department}</TableCell>
  <TableCell>{formatDate(user.joinDate)}</TableCell>
  <TableCell className="text-muted-foreground">
    {formatLastLogin(user.lastLogin)}
  </TableCell>
  <TableCell className="relative">
    <ActionMenu
      user={user}
      onViewUser={onViewUser}
      onEditUser={onEditUser}
      onToggleUserStatus={onToggleUserStatus}
      onDeleteUser={setDeleteUserId}
    />
  </TableCell>
</TableRow>
```

## 📱 Required Imports

### 11. Essential Imports
```typescript
import { useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Badge } from './ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
```

## 🎯 Component Props Interface

### 12. Props Definition
```typescript
interface UserTableProps {
  users: User[];
  selectedUsers: string[];
  onSelectedUsersChange: (selected: string[]) => void;
  onEditUser: (user: User) => void;
  onViewUser: (user: User) => void;
  onDeleteUser: (userId: string) => void;
  onToggleUserStatus?: (userId: string, newStatus: User['status']) => void;
}
```

## 🚀 Advanced Features

### 13. Action Menu Component
Create a separate ActionMenu component for user actions:
- View user details
- Edit user information
- Toggle user status
- Delete user (with confirmation)

### 14. Responsive Design
- Use `overflow-visible` on parent containers
- Implement horizontal scroll on mobile
- Hide less important columns on smaller screens
- Use appropriate spacing and sizing

### 15. Accessibility Features
- Add proper ARIA labels
- Ensure keyboard navigation
- Use semantic HTML elements
- Provide screen reader friendly content

## 💡 Best Practices

### 16. Performance Optimization
- Use `React.memo` for row components if needed
- Implement virtual scrolling for large datasets
- Debounce search and filter operations
- Use `useMemo` for expensive calculations

### 17. Error Handling
- Handle empty states gracefully
- Provide loading states
- Implement proper error boundaries
- Show user-friendly error messages

### 18. Code Organization
- Separate utility functions into their own files
- Use custom hooks for complex state logic
- Keep components focused and single-purpose
- Implement proper TypeScript types

## 🔧 Styling Guidelines

### 19. Tailwind Classes
- Use consistent spacing: `gap-3`, `p-4`, `mb-2`
- Apply hover states: `hover:bg-muted/50`
- Use semantic colors: `text-muted-foreground`
- Implement proper borders: `border`, `rounded-md`

### 20. Component Styling
- Maintain consistent button sizes and variants
- Use proper badge colors for different states
- Apply appropriate table cell padding
- Ensure proper icon sizing and positioning

## 🎨 Visual Design Principles

### 21. Color System
- **Active Status**: Green variants (`bg-green-100 text-green-800`)
- **Inactive Status**: Red variants (`bg-red-100 text-red-800`)
- **Pending Status**: Yellow variants (`bg-yellow-100 text-yellow-800`)
- **Different Roles**: Use distinct color schemes for each role

### 22. Layout Principles
- Maintain consistent spacing throughout
- Use proper alignment for different data types
- Ensure adequate click targets (minimum 44px)
- Provide clear visual hierarchy

This guide provides a complete foundation for building professional user management tables with sortable columns and comprehensive functionality. Follow these patterns and principles to create consistent, accessible, and performant user interfaces.