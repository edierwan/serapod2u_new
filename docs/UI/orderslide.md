# AI Navigation & UI Design Prompt - Order Interface System
## Date: October 3, 2025

This comprehensive prompt guides AI coding assistants in building the complete Order Interface navigation system, UI design, and automatic update functionality. Follow these detailed instructions to replicate the exact design and behavior.

## 1. PROJECT OVERVIEW & ARCHITECTURE

### Core System Structure
- **Main Entry Point**: `/App.tsx` - Contains OrderDashboard with role-based rendering
- **Navigation Hub**: `OrderDashboard.tsx` - Central navigation between Dashboard and Order Interface
- **Order Processing**: `OrderInterface.tsx` - Main product selection and order creation interface
- **Real-time Summary**: `OrderSummary.tsx` - Automatic calculations and order totals sidebar
- **Support Components**: ProductSelector, RewardOptions, WorkflowTracker, PDF generation

### Technology Stack
- **React** with TypeScript for component architecture
- **Tailwind CSS v4** for styling (DO NOT use font-size, font-weight, or line-height classes)
- **shadcn/ui** components for consistent UI elements
- **Lucide React** for icons
- **State Management**: React useState with prop drilling for real-time updates

## 2. NAVIGATION DESIGN ARCHITECTURE

### Dashboard-to-Order Navigation Flow
```typescript
// Implementation in OrderDashboard.tsx
const [currentView, setCurrentView] = useState<'dashboard' | 'order'>('dashboard');

// Navigation structure:
// Dashboard View -> Shows order management grid
// Order View -> Shows product selection interface
// Seamless transitions with state preservation
```

### Navigation UI Components
1. **Header Navigation Bar**
   - Logo/Title on left
   - Navigation buttons (Dashboard, New Order)
   - User role indicator on right
   - Clean, minimal design using Card component

2. **View State Management**
   - Single state variable controls entire view
   - Conditional rendering based on currentView
   - Maintains order data across view switches
   - No page reloads - pure SPA navigation

### Responsive Navigation Design
- Desktop: Horizontal navigation bar with full text labels
- Mobile: Compact navigation with icon + text combinations
- Consistent spacing using shadcn/ui Card and Button components

## 3. DASHBOARD UI DESIGN SYSTEM

### Dashboard Main View Structure
```jsx
// Main dashboard layout
<div className="min-h-screen bg-background">
  <Card className="border-0 rounded-none shadow-sm">
    {/* Navigation Header */}
  </Card>
  
  <div className="container mx-auto px-6 py-8">
    {/* Content Grid */}
  </div>
</div>
```

### Dashboard Content Layout
1. **Order Statistics Cards**
   - Grid layout: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6`
   - Each card shows key metrics (Total Orders, Pending, Approved, etc.)
   - Uses shadcn Card with proper spacing and typography

2. **Recent Orders Table**
   - Full-width card container
   - shadcn Table component for data display
   - Status badges using shadcn Badge component
   - Action buttons for each order row

3. **Quick Actions Section**
   - Prominent "Create New Order" button
   - Secondary action buttons for bulk operations
   - Card-based layout for visual separation

### Color Scheme & Visual Hierarchy
- **Primary Actions**: Uses `bg-primary text-primary-foreground`
- **Secondary Elements**: Uses `bg-secondary text-secondary-foreground`
- **Cards**: `bg-card text-card-foreground` with subtle borders
- **Status Indicators**: Custom color coding for order statuses

## 4. ORDER PAGE UI DESIGN SYSTEM

### Order Interface Layout Architecture
```jsx
// Main order interface layout
<div className="flex flex-col lg:flex-row gap-6 p-6">
  {/* Left Column - Product Selection */}
  <div className="flex-1 space-y-6">
    {/* Customer Info, Product Selection, Rewards */}
  </div>
  
  {/* Right Column - Order Summary Sidebar */}
  <div className="lg:w-96">
    <OrderSummary /> {/* Sticky sidebar */}
  </div>
</div>
```

### Product Selection UI Components

#### 1. Customer Information Section
```jsx
<Card className="p-6">
  <h3>Customer Information</h3>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <Input placeholder="Customer Name" />
    <Input placeholder="Phone Number" />
    <div className="md:col-span-2">
      <Textarea placeholder="Delivery Address" />
    </div>
  </div>
</Card>
```

#### 2. Product Selection Grid
```jsx
<Card className="p-6">
  <h3>Select Products</h3>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    {products.map(product => (
      <Card key={product.id} className="p-4 border-2 hover:border-primary">
        {/* Product selection controls */}
      </Card>
    ))}
  </div>
</Card>
```

### Interactive Controls Design

#### Quantity & Unit Selection
- **Quantity Input**: shadcn Input with number type, min=0
- **Unit Per Case**: Radio group with 100/200 options using shadcn RadioGroup
- **Visual feedback**: Border changes on selection, hover effects

#### QR Buffer Configuration
```jsx
<div className="space-y-2">
  <Label>QR Buffer Percentage</Label>
  <div className="flex items-center space-x-2">
    <Slider 
      value={[qrBuffer]} 
      onValueChange={(value) => setQrBuffer(value[0])}
      max={50}
      min={0}
      step={1}
    />
    <span>{qrBuffer}%</span>
  </div>
</div>
```

#### RFID Toggle
- shadcn Switch component
- Clear labeling with explanation text
- Automatic calculation updates when toggled

## 5. AUTOMATIC UPDATE SYSTEM ARCHITECTURE

### Real-Time Calculation Engine

#### State Management Structure
```typescript
interface OrderData {
  customerInfo: CustomerInfo;
  selectedProducts: ProductSelection[];
  rewardOptions: RewardOptions;
  qrBuffer: number;
  rfidEnabled: boolean;
}

interface ProductSelection {
  productId: string;
  quantity: number;
  unitPerCase: 100 | 200;
  price: number;
}
```

#### Automatic Update Flow
1. **User Input Trigger**: Any change in quantity, unit per case, QR buffer, or RFID
2. **State Update**: Immediate state change using setState
3. **Calculation Cascade**: Automatic recalculation of all dependent values
4. **UI Update**: React re-renders affected components instantly

### Calculation Logic Implementation

#### Case Calculation
```typescript
const calculateCases = (quantity: number, unitPerCase: number) => {
  return Math.ceil(quantity / unitPerCase);
};
```

#### QR Code Calculations
```typescript
const calculateQRCodes = (cases: number, qrBuffer: number) => {
  const masterQR = cases;
  const bufferAmount = Math.ceil(cases * (qrBuffer / 100));
  const uniqueQR = cases + bufferAmount;
  
  return { masterQR, uniqueQR, bufferAmount };
};
```

#### RFID Integration
```typescript
const calculateRFID = (masterQR: number, rfidEnabled: boolean) => {
  return rfidEnabled ? masterQR : 0;
};
```

### OrderSummary Component Auto-Update

#### Props Interface
```typescript
interface OrderSummaryProps {
  orderData: OrderData;
  onUpdateOrder: (updates: Partial<OrderData>) => void;
}
```

#### Real-Time Display Updates
- **Immediate Updates**: No delays or loading states
- **Formatted Values**: Currency formatting, number formatting
- **Visual Feedback**: Highlight changes with subtle animations
- **Sticky Positioning**: Sidebar remains visible during scrolling

## 6. COMPONENT INTEGRATION PATTERNS

### Parent-Child Communication
```typescript
// OrderInterface.tsx - Parent Component
const [orderData, setOrderData] = useState<OrderData>(initialState);

const handleProductUpdate = (productId: string, updates: ProductUpdate) => {
  setOrderData(prev => ({
    ...prev,
    selectedProducts: prev.selectedProducts.map(p => 
      p.productId === productId ? { ...p, ...updates } : p
    )
  }));
};

// Pass to child components:
<ProductSelector onUpdateProduct={handleProductUpdate} />
<OrderSummary orderData={orderData} />
```

### Prop Drilling Strategy
- Single source of truth in OrderInterface component
- Update handlers passed down to interactive components
- OrderSummary receives complete orderData object
- Efficient re-rendering through React's optimization

## 7. RESPONSIVE DESIGN IMPLEMENTATION

### Breakpoint Strategy
- **Mobile First**: Start with mobile layout, enhance for larger screens
- **Key Breakpoints**: `sm:`, `md:`, `lg:`, `xl:`
- **Grid Systems**: CSS Grid for cards, Flexbox for components

### Layout Adaptations
```jsx
// Responsive grid examples
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
<div className="flex flex-col lg:flex-row gap-6">
<div className="lg:w-96"> {/* Fixed sidebar width on desktop */}
```

### Mobile Navigation
- Collapsible sidebar navigation
- Touch-friendly button sizes
- Optimized form layouts for mobile input

## 8. STYLING GUIDELINES & BEST PRACTICES

### Tailwind v4 CSS Custom Properties
- Use CSS custom properties defined in `globals.css`
- **DO NOT USE**: `text-xl`, `font-bold`, `leading-tight` classes
- **DO USE**: Component-based styling with shadcn/ui

### Component Styling Pattern
```jsx
// Correct approach
<Card className="border-0 rounded-lg shadow-sm">
  <CardContent className="p-6">
    <h3>Title</h3> {/* Uses globals.css h3 styling */}
    <p>Content</p> {/* Uses globals.css p styling */}
  </CardContent>
</Card>
```

### Interactive States
- **Hover**: `hover:border-primary`, `hover:bg-accent`
- **Focus**: Automatic focus rings from globals.css
- **Active**: `active:scale-[0.98]` for buttons
- **Disabled**: `disabled:opacity-50 disabled:cursor-not-allowed`

## 9. PERFORMANCE OPTIMIZATION

### Efficient Re-rendering
- Memoize expensive calculations
- Use React.memo for components that don't need frequent updates
- Optimize state updates to prevent unnecessary renders

### State Update Batching
```typescript
// Batch multiple state updates
const handleMultipleUpdates = (updates: MultipleUpdates) => {
  setOrderData(prev => ({
    ...prev,
    ...updates // React batches these automatically
  }));
};
```

## 10. ACCESSIBILITY IMPLEMENTATION

### Keyboard Navigation
- All interactive elements are keyboard accessible
- Proper tab order through form sections
- ARIA labels for complex controls

### Screen Reader Support
```jsx
<Label htmlFor="quantity">Quantity</Label>
<Input 
  id="quantity"
  aria-describedby="quantity-help"
  type="number"
/>
<div id="quantity-help" className="sr-only">
  Enter the desired quantity for this product
</div>
```

## 11. ERROR HANDLING & VALIDATION

### Input Validation
- Real-time validation feedback
- Visual error states using shadcn Alert components
- Form validation before order submission

### Error States
```jsx
{error && (
  <Alert variant="destructive">
    <AlertDescription>{error.message}</AlertDescription>
  </Alert>
)}
```

## 12. IMPLEMENTATION CHECKLIST

### Navigation System
- [ ] Dashboard view with order management grid
- [ ] Order interface view with product selection
- [ ] Seamless navigation between views
- [ ] State preservation across navigation
- [ ] Responsive navigation header

### Product Selection Interface
- [ ] Customer information form
- [ ] Product grid with interactive controls
- [ ] Quantity input with validation
- [ ] Unit per case radio selection (100/200)
- [ ] QR Buffer slider with percentage display
- [ ] RFID toggle switch
- [ ] Reward options section

### Automatic Updates
- [ ] Real-time case calculation
- [ ] QR Master and Unique calculations
- [ ] QR Buffer percentage application
- [ ] RFID quantity calculation
- [ ] Financial totals computation
- [ ] Order summary automatic refresh

### UI Components
- [ ] shadcn/ui components throughout
- [ ] Consistent card-based layout
- [ ] Proper spacing and typography
- [ ] Responsive design implementation
- [ ] Hover and focus states
- [ ] Loading states where needed

### Integration Points
- [ ] Parent-child component communication
- [ ] Efficient prop drilling
- [ ] State management consistency
- [ ] Error handling implementation
- [ ] Performance optimization

## 13. TESTING SCENARIOS

### User Interaction Flows
1. **Dashboard Navigation**: Click between dashboard and order views
2. **Product Selection**: Select products, change quantities and units
3. **QR Buffer Adjustment**: Move slider and verify calculations
4. **RFID Toggle**: Enable/disable and verify summary updates
5. **Responsive Testing**: Test on mobile, tablet, and desktop viewports

### Calculation Verification
- Verify case calculations for different unit per case values
- Test QR buffer percentage calculations
- Confirm RFID quantity matches QR Master when enabled
- Validate financial totals accuracy

## 14. DEPLOYMENT NOTES

### File Structure Requirements
```
/App.tsx - Main entry point
/components/
  ├── OrderDashboard.tsx - Navigation hub
  ├── OrderInterface.tsx - Main order interface
  ├── OrderSummary.tsx - Real-time summary sidebar
  ├── ProductSelector.tsx - Product selection grid
  └── RewardOptions.tsx - Reward configuration
```

### Dependencies
- React with TypeScript
- Tailwind CSS v4
- shadcn/ui components
- Lucide React icons
- No external state management library required

### Environment Setup
- Ensure Tailwind v4 configuration is properly set up
- Import all required shadcn/ui components
- Verify custom CSS properties are loaded from globals.css

This prompt provides complete guidance for replicating the Order Interface navigation system, UI design, and automatic update functionality. Follow each section carefully to ensure consistent implementation across all components and features.