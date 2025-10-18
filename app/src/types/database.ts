export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          role_code: string
          organization_id: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          role_code?: string
          organization_id?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          role_code?: string
          organization_id?: string
          is_active?: boolean
          updated_at?: string
        }
      }
      organizations: {
        Row: {
          id: string
          org_type_code: string
          parent_org_id: string | null
          org_code: string
          org_name: string
          org_name_search: string
          registration_no: string | null
          tax_id: string | null
          website: string | null
          address: string | null
          address_line2: string | null
          city: string | null
          state_id: string | null
          district_id: string | null
          postal_code: string | null
          country_code: string
          latitude: number | null
          longitude: number | null
          settings: any
          is_active: boolean
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          contact_name: string | null
          contact_title: string | null
          contact_phone: string | null
          contact_email: string | null
        }
      }
      roles: {
        Row: {
          role_code: string
          role_name: string
          role_level: number
          description: string | null
          is_active: boolean
          created_at: string
        }
      }
      products: {
        Row: {
          id: string
          product_code: string
          product_name: string
          product_name_search: string
          brand_id: string | null
          category_id: string | null
          product_description: string | null
          is_vape: boolean
          age_restriction: number | null
          is_active: boolean
          created_at: string
          updated_at: string
          created_by: string | null
        }
      }
    }
  }
}