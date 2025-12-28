// ============================================
// CORE TYPES
// ============================================

export type OrderStatus = 
  | 'draft' 
  | 'submitted' 
  | 'approved' 
  | 'closed'
  | 'cancelled';

export type OrderType = 
  | 'H2M' 
  | 'D2H' 
  | 'S2D';

export type DocumentType = 
  | 'PO' 
  | 'INVOICE' 
  | 'PAYMENT' 
  | 'RECEIPT'
  | 'PAYMENT_REQUEST';

export type DocumentStatus = 
  | 'pending' 
  | 'acknowledged' 
  | 'completed';

// ============================================
// DATA INTERFACES
// ============================================

export interface Order {
  id: string;
  order_no: string;
  order_type: OrderType;
  company_id: string;
  buyer_org_id: string;
  seller_org_id: string;
  parent_order_id?: string;
  status: OrderStatus;
  units_per_case: number;
  qr_buffer_percent: number;
  has_rfid: boolean;
  has_points: boolean;
  has_lucky_draw: boolean;
  has_redeem: boolean;
  notes?: string;
  created_by: string;
  updated_by?: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
  
  // Joined data
  buyer_org?: Organization;
  seller_org?: Organization;
  created_by_user?: User;
  approved_by_user?: User;
  order_items?: OrderItem[];
  documents?: Document[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  variant_id?: string | null;
  qty: number;
  unit_price: number;
  line_total?: number;
  company_id?: string;
  created_at?: string;
  updated_at?: string;
  
  // Joined data
  product?: Product;
  variant?: ProductVariant;
  product_name?: string;
  variant_name?: string | null;
}

export interface Document {
  id: string;
  order_id: string;
  doc_type: DocumentType;
  doc_no: string;
  status: DocumentStatus;
  issued_by_org_id: string;
  issued_to_org_id: string;
  company_id: string;
  payload?: Record<string, any>;
  created_by: string;
  acknowledged_by?: string;
  acknowledged_at?: string;
  created_at: string;
  updated_at: string;
  
  // Joined data
  issued_by_org?: Organization;
  issued_to_org?: Organization;
}

export interface Organization {
  id: string;
  org_name: string;
  org_code: string;
  org_type_code: string;
  email?: string;
  phone?: string;
  address?: string;
  is_active: boolean;
}

export interface User {
  id: string;
  email: string;
  full_name?: string;
  role_code: string;
  roles?: {
    role_name?: string;
    role_level: number;
  };
}

export interface Product {
  id: string;
  product_code: string;
  product_name: string;
  brand_id?: string;
  category_id?: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  variant_name: string;
  sku?: string;
}

// ============================================
// UI TYPES
// ============================================

export interface OrderFilters {
  status?: OrderStatus[];
  order_type?: OrderType[];
  buyer_org_id?: string;
  seller_org_id?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
}

export interface OrderSummary {
  total_orders: number;
  draft_orders: number;
  submitted_orders: number;
  approved_orders: number;
  closed_orders: number;
  total_amount: number;
}
