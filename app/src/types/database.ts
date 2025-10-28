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
      redeem_items: {
        Row: {
          id: string
          company_id: string
          item_code: string
          item_name: string
          item_description: string | null
          item_image_url: string | null
          points_required: number
          stock_quantity: number | null
          max_redemptions_per_consumer: number | null
          is_active: boolean
          valid_from: string | null
          valid_until: string | null
          terms_and_conditions: string | null
          created_at: string
          updated_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          company_id: string
          item_code: string
          item_name: string
          item_description?: string | null
          item_image_url?: string | null
          points_required: number
          stock_quantity?: number | null
          max_redemptions_per_consumer?: number | null
          is_active?: boolean
          valid_from?: string | null
          valid_until?: string | null
          terms_and_conditions?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          company_id?: string
          item_code?: string
          item_name?: string
          item_description?: string | null
          item_image_url?: string | null
          points_required?: number
          stock_quantity?: number | null
          max_redemptions_per_consumer?: number | null
          is_active?: boolean
          valid_from?: string | null
          valid_until?: string | null
          terms_and_conditions?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
        }
      }
      points_transactions: {
        Row: {
          id: string
          company_id: string
          consumer_phone: string
          consumer_email: string | null
          transaction_type: 'earn' | 'redeem' | 'expire' | 'adjust'
          points_amount: number
          balance_after: number
          qr_code_id: string | null
          redeem_item_id: string | null
          description: string | null
          transaction_date: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          company_id: string
          consumer_phone: string
          consumer_email?: string | null
          transaction_type: 'earn' | 'redeem' | 'expire' | 'adjust'
          points_amount: number
          balance_after: number
          qr_code_id?: string | null
          redeem_item_id?: string | null
          description?: string | null
          transaction_date?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          company_id?: string
          consumer_phone?: string
          consumer_email?: string | null
          transaction_type?: 'earn' | 'redeem' | 'expire' | 'adjust'
          points_amount?: number
          balance_after?: number
          qr_code_id?: string | null
          redeem_item_id?: string | null
          description?: string | null
          transaction_date?: string | null
          created_at?: string | null
        }
      }
      point_rewards: {
        Row: {
          id: string
          reward_name: string
          reward_description: string | null
          points_required: number
          reward_image_url: string | null
          stock_quantity: number | null
          is_featured: boolean
          tier_level: 'bronze' | 'silver' | 'gold' | 'platinum'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          reward_name: string
          reward_description?: string | null
          points_required: number
          reward_image_url?: string | null
          stock_quantity?: number | null
          is_featured?: boolean
          tier_level?: 'bronze' | 'silver' | 'gold' | 'platinum'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          reward_name?: string
          reward_description?: string | null
          points_required?: number
          reward_image_url?: string | null
          stock_quantity?: number | null
          is_featured?: boolean
          tier_level?: 'bronze' | 'silver' | 'gold' | 'platinum'
          created_at?: string
          updated_at?: string
        }
      }
      consumer_activations: {
        Row: {
          id: string
          company_id: string
          qr_code_id: string
          consumer_phone: string
          consumer_email: string | null
          consumer_name: string | null
          activated_at: string | null
          activation_location: string | null
          activation_device_info: Record<string, unknown> | null
          points_awarded: number | null
          lucky_draw_entry_id: string | null
          is_verified: boolean
          verification_notes: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          company_id: string
          qr_code_id: string
          consumer_phone: string
          consumer_email?: string | null
          consumer_name?: string | null
          activated_at?: string | null
          activation_location?: string | null
          activation_device_info?: Record<string, unknown> | null
          points_awarded?: number | null
          lucky_draw_entry_id?: string | null
          is_verified?: boolean
          verification_notes?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          company_id?: string
          qr_code_id?: string
          consumer_phone?: string
          consumer_email?: string | null
          consumer_name?: string | null
          activated_at?: string | null
          activation_location?: string | null
          activation_device_info?: Record<string, unknown> | null
          points_awarded?: number | null
          lucky_draw_entry_id?: string | null
          is_verified?: boolean
          verification_notes?: string | null
          created_at?: string | null
        }
      }
      points_rules: {
        Row: {
          id: string
          org_id: string
          journey_config_id: string | null
          name: string
          is_active: boolean
          points_per_scan: number
          expires_after_days: number | null
          allow_manual_adjustment: boolean
          effective_from: string | null
          effective_to: string | null
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          org_id: string
          journey_config_id?: string | null
          name?: string
          is_active?: boolean
          points_per_scan?: number
          expires_after_days?: number | null
          allow_manual_adjustment?: boolean
          effective_from?: string | null
          effective_to?: string | null
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          journey_config_id?: string | null
          name?: string
          is_active?: boolean
          points_per_scan?: number
          expires_after_days?: number | null
          allow_manual_adjustment?: boolean
          effective_from?: string | null
          effective_to?: string | null
          created_at?: string
          created_by?: string | null
        }
      }
    }
  }
}