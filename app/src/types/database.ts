export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      scratch_card_plays: {
        Row: {
          id: string
          created_at: string
          campaign_id: string
          is_win: boolean
          is_claimed: boolean
          shop_id: string | null
          claim_details: Json | null
          consumer_email: string | null
          consumer_name: string | null
          consumer_phone: string | null
          qr_code_id: string | null
          reward_id: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          campaign_id: string
          is_win?: boolean
          is_claimed?: boolean
          shop_id?: string | null
          claim_details?: Json | null
          consumer_email?: string | null
          consumer_name?: string | null
          consumer_phone?: string | null
          qr_code_id?: string | null
          reward_id?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          campaign_id?: string
          is_win?: boolean
          is_claimed?: boolean
          shop_id?: string | null
          claim_details?: Json | null
          consumer_email?: string | null
          consumer_name?: string | null
          consumer_phone?: string | null
          qr_code_id?: string | null
          reward_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scratch_card_plays_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "scratch_card_rewards"
            referencedColumns: ["id"]
          }
        ]
      },
      scratch_card_rewards: {
        Row: {
          id: string
          created_at: string
          campaign_id: string
          name: string
          type: string
          value_points: number | null
          probability: number
          inventory_limit: number | null
          inventory_used: number
        }
        Insert: {
          id?: string
          created_at?: string
          campaign_id: string
          name: string
          type: string
          value_points?: number | null
          probability?: number
          inventory_limit?: number | null
          inventory_used?: number
        }
        Update: {
          id?: string
          created_at?: string
          campaign_id?: string
          name?: string
          type?: string
          value_points?: number | null
          probability?: number
          inventory_limit?: number | null
          inventory_used?: number
        }
        Relationships: []
      },
      audit_logs: {
        Row: {
          action: string
          changed_fields: string[] | null
          created_at: string | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changed_fields?: string[] | null
          created_at?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changed_fields?: string[] | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          brand_code: string
          brand_description: string | null
          brand_name: string
          brand_name_search: string | null
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          updated_at: string | null
        }
        Insert: {
          brand_code: string
          brand_description?: string | null
          brand_name: string
          brand_name_search?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          updated_at?: string | null
        }
        Update: {
          brand_code?: string
          brand_description?: string | null
          brand_name?: string
          brand_name_search?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brands_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consumer_activations: {
        Row: {
          activated_at: string | null
          activation_device_info: Json | null
          activation_location: string | null
          company_id: string
          consumer_email: string | null
          consumer_name: string | null
          consumer_phone: string
          created_at: string | null
          id: string
          is_verified: boolean | null
          lucky_draw_entry_id: string | null
          points_awarded: number | null
          qr_code_id: string
          verification_notes: string | null
        }
        Insert: {
          activated_at?: string | null
          activation_device_info?: Json | null
          activation_location?: string | null
          company_id: string
          consumer_email?: string | null
          consumer_name?: string | null
          consumer_phone: string
          created_at?: string | null
          id?: string
          is_verified?: boolean | null
          lucky_draw_entry_id?: string | null
          points_awarded?: number | null
          qr_code_id: string
          verification_notes?: string | null
        }
        Update: {
          activated_at?: string | null
          activation_device_info?: Json | null
          activation_location?: string | null
          company_id?: string
          consumer_email?: string | null
          consumer_name?: string | null
          consumer_phone?: string
          created_at?: string | null
          id?: string
          is_verified?: boolean | null
          lucky_draw_entry_id?: string | null
          points_awarded?: number | null
          qr_code_id?: string
          verification_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consumer_activations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumer_activations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "consumer_activations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumer_activations_lucky_draw_entry_id_fkey"
            columns: ["lucky_draw_entry_id"]
            isOneToOne: false
            referencedRelation: "lucky_draw_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumer_activations_qr_code_id_fkey"
            columns: ["qr_code_id"]
            isOneToOne: true
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      consumer_qr_scans: {
        Row: {
          collected_points: boolean | null
          consumer_id: string | null
          created_at: string | null
          entered_lucky_draw: boolean | null
          id: string
          ip_address: string | null
          journey_config_id: string | null
          location_lat: number | null
          location_lng: number | null
          points_amount: number | null
          points_collected_at: string | null
          qr_code_id: string
          redeemed_gift: boolean | null
          scanned_at: string | null
          shop_id: string | null
          updated_at: string | null
          user_agent: string | null
          viewed_welcome: boolean | null
        }
        Insert: {
          collected_points?: boolean | null
          consumer_id?: string | null
          created_at?: string | null
          entered_lucky_draw?: boolean | null
          id?: string
          ip_address?: string | null
          journey_config_id?: string | null
          location_lat?: number | null
          location_lng?: number | null
          points_amount?: number | null
          points_collected_at?: string | null
          qr_code_id: string
          redeemed_gift?: boolean | null
          scanned_at?: string | null
          shop_id?: string | null
          updated_at?: string | null
          user_agent?: string | null
          viewed_welcome?: boolean | null
        }
        Update: {
          collected_points?: boolean | null
          consumer_id?: string | null
          created_at?: string | null
          entered_lucky_draw?: boolean | null
          id?: string
          ip_address?: string | null
          journey_config_id?: string | null
          location_lat?: number | null
          location_lng?: number | null
          points_amount?: number | null
          points_collected_at?: string | null
          qr_code_id?: string
          redeemed_gift?: boolean | null
          scanned_at?: string | null
          shop_id?: string | null
          updated_at?: string | null
          user_agent?: string | null
          viewed_welcome?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "consumer_qr_scans_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumer_qr_scans_journey_config_id_fkey"
            columns: ["journey_config_id"]
            isOneToOne: false
            referencedRelation: "journey_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumer_qr_scans_qr_code_id_fkey"
            columns: ["qr_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumer_qr_scans_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumer_qr_scans_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "consumer_qr_scans_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      distributor_products: {
        Row: {
          agreement_end_date: string | null
          agreement_number: string | null
          agreement_start_date: string | null
          can_backorder: boolean | null
          created_at: string | null
          created_by: string | null
          distributor_cost: number | null
          distributor_id: string
          id: string
          is_active: boolean | null
          is_exclusive: boolean | null
          lead_time_days: number | null
          max_order_quantity: number | null
          min_order_quantity: number | null
          product_id: string
          territory_coverage: string[] | null
          updated_at: string | null
        }
        Insert: {
          agreement_end_date?: string | null
          agreement_number?: string | null
          agreement_start_date?: string | null
          can_backorder?: boolean | null
          created_at?: string | null
          created_by?: string | null
          distributor_cost?: number | null
          distributor_id: string
          id?: string
          is_active?: boolean | null
          is_exclusive?: boolean | null
          lead_time_days?: number | null
          max_order_quantity?: number | null
          min_order_quantity?: number | null
          product_id: string
          territory_coverage?: string[] | null
          updated_at?: string | null
        }
        Update: {
          agreement_end_date?: string | null
          agreement_number?: string | null
          agreement_start_date?: string | null
          can_backorder?: boolean | null
          created_at?: string | null
          created_by?: string | null
          distributor_cost?: number | null
          distributor_id?: string
          id?: string
          is_active?: boolean | null
          is_exclusive?: boolean | null
          lead_time_days?: number | null
          max_order_quantity?: number | null
          min_order_quantity?: number | null
          product_id?: string
          territory_coverage?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "distributor_products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_products_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_products_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "distributor_products_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "distributor_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_current_pricing"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "distributor_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "distributor_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock_alerts"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "distributor_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_available_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      districts: {
        Row: {
          created_at: string | null
          district_code: string
          district_name: string
          id: string
          is_active: boolean | null
          state_id: string
        }
        Insert: {
          created_at?: string | null
          district_code: string
          district_name: string
          id?: string
          is_active?: boolean | null
          state_id: string
        }
        Update: {
          created_at?: string | null
          district_code?: string
          district_name?: string
          id?: string
          is_active?: boolean | null
          state_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "districts_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "states"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_counters: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          next_seq: number
          scope_code: string
          updated_at: string | null
          yymm: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          id?: string
          next_seq?: number
          scope_code: string
          updated_at?: string | null
          yymm: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          next_seq?: number
          scope_code?: string
          updated_at?: string | null
          yymm?: string
        }
        Relationships: [
          {
            foreignKeyName: "doc_counters_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_counters_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "doc_counters_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      document_files: {
        Row: {
          company_id: string
          document_id: string
          file_name: string | null
          file_size: number | null
          file_url: string
          id: string
          mime_type: string | null
          uploaded_at: string | null
          uploaded_by: string
        }
        Insert: {
          company_id: string
          document_id: string
          file_name?: string | null
          file_size?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          uploaded_at?: string | null
          uploaded_by: string
        }
        Update: {
          company_id?: string
          document_id?: string
          file_name?: string | null
          file_size?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          uploaded_at?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_files_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      document_signatures: {
        Row: {
          created_at: string
          document_id: string
          document_type: string
          id: string
          metadata: Json | null
          signature_hash: string
          signature_image_url: string | null
          signed_at: string
          signer_role: string
          signer_user_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          document_type: string
          id?: string
          metadata?: Json | null
          signature_hash: string
          signature_image_url?: string | null
          signed_at?: string
          signer_role: string
          signer_user_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          document_type?: string
          id?: string
          metadata?: Json | null
          signature_hash?: string
          signature_image_url?: string | null
          signed_at?: string
          signer_role?: string
          signer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_signatures_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_signatures_signer_user_id_fkey"
            columns: ["signer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          company_id: string
          created_at: string | null
          created_by: string
          doc_no: string
          doc_type: Database["public"]["Enums"]["document_type"]
          id: string
          issued_by_org_id: string
          issued_to_org_id: string
          order_id: string
          payload: Json | null
          payment_percentage: number | null
          signed_pdf_url: string | null
          status: Database["public"]["Enums"]["document_status"]
          updated_at: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          company_id: string
          created_at?: string | null
          created_by: string
          doc_no: string
          doc_type: Database["public"]["Enums"]["document_type"]
          id?: string
          issued_by_org_id: string
          issued_to_org_id: string
          order_id: string
          payload?: Json | null
          payment_percentage?: number | null
          signed_pdf_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          updated_at?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          company_id?: string
          created_at?: string | null
          created_by?: string
          doc_no?: string
          doc_type?: Database["public"]["Enums"]["document_type"]
          id?: string
          issued_by_org_id?: string
          issued_to_org_id?: string
          order_id?: string
          payload?: Json | null
          payment_percentage?: number | null
          signed_pdf_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_issued_by_org_id_fkey"
            columns: ["issued_by_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_issued_by_org_id_fkey"
            columns: ["issued_by_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "documents_issued_by_org_id_fkey"
            columns: ["issued_by_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_issued_to_org_id_fkey"
            columns: ["issued_to_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_issued_to_org_id_fkey"
            columns: ["issued_to_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "documents_issued_to_org_id_fkey"
            columns: ["issued_to_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          metadata: Json | null
          org_id: string
          provider: string
          recipient_email: string
          sent_at: string
          sent_date_pst: string | null
          status: string
          subject: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          org_id: string
          provider: string
          recipient_email: string
          sent_at?: string
          sent_date_pst?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          org_id?: string
          provider?: string
          recipient_email?: string
          sent_at?: string
          sent_date_pst?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_send_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "email_send_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      journey_configurations: {
        Row: {
          activation_mode: string | null
          activation_status: string | null
          button_color: string | null
          created_at: string
          created_by: string | null
          custom_image_url: string | null
          end_at: string | null
          genuine_badge_style: string | null
          id: string
          is_active: boolean
          is_default: boolean
          lucky_draw_enabled: boolean | null
          name: string
          org_id: string
          points_enabled: boolean | null
          primary_color: string | null
          product_image_source: string | null
          redemption_enabled: boolean | null
          require_customer_otp_for_lucky_draw: boolean | null
          require_customer_otp_for_redemption: boolean | null
          require_staff_otp_for_points: boolean | null
          show_product_image: boolean | null
          start_at: string | null
          thank_you_message: string | null
          welcome_message: string | null
          welcome_title: string | null
        }
        Insert: {
          activation_mode?: string | null
          activation_status?: string | null
          button_color?: string | null
          created_at?: string
          created_by?: string | null
          custom_image_url?: string | null
          end_at?: string | null
          genuine_badge_style?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          lucky_draw_enabled?: boolean | null
          name: string
          org_id: string
          points_enabled?: boolean | null
          primary_color?: string | null
          product_image_source?: string | null
          redemption_enabled?: boolean | null
          require_customer_otp_for_lucky_draw?: boolean | null
          require_customer_otp_for_redemption?: boolean | null
          require_staff_otp_for_points?: boolean | null
          show_product_image?: boolean | null
          start_at?: string | null
          thank_you_message?: string | null
          welcome_message?: string | null
          welcome_title?: string | null
        }
        Update: {
          activation_mode?: string | null
          activation_status?: string | null
          button_color?: string | null
          created_at?: string
          created_by?: string | null
          custom_image_url?: string | null
          end_at?: string | null
          genuine_badge_style?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          lucky_draw_enabled?: boolean | null
          name?: string
          org_id?: string
          points_enabled?: boolean | null
          primary_color?: string | null
          product_image_source?: string | null
          redemption_enabled?: boolean | null
          require_customer_otp_for_lucky_draw?: boolean | null
          require_customer_otp_for_redemption?: boolean | null
          require_staff_otp_for_points?: boolean | null
          show_product_image?: boolean | null
          start_at?: string | null
          thank_you_message?: string | null
          welcome_message?: string | null
          welcome_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journey_configurations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journey_configurations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journey_configurations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "journey_configurations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      journey_order_links: {
        Row: {
          created_at: string
          id: string
          journey_config_id: string
          order_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          journey_config_id: string
          order_id: string
        }
        Update: {
          created_at?: string
          id?: string
          journey_config_id?: string
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journey_order_links_journey_config_id_fkey"
            columns: ["journey_config_id"]
            isOneToOne: false
            referencedRelation: "journey_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journey_order_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journey_order_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "journey_order_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "journey_order_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journey_order_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      lucky_draw_campaigns: {
        Row: {
          campaign_code: string
          campaign_description: string | null
          campaign_image_url: string | null
          campaign_name: string
          company_id: string
          created_at: string | null
          created_by: string | null
          draw_date: string | null
          drawn_at: string | null
          drawn_by: string | null
          end_date: string
          id: string
          max_entries_per_consumer: number | null
          prizes: Json | null
          prizes_json: Json | null
          requires_purchase: boolean | null
          start_date: string
          status: string | null
          terms_and_conditions: string | null
          updated_at: string | null
          winners: Json | null
        }
        Insert: {
          campaign_code: string
          campaign_description?: string | null
          campaign_image_url?: string | null
          campaign_name: string
          company_id: string
          created_at?: string | null
          created_by?: string | null
          draw_date?: string | null
          drawn_at?: string | null
          drawn_by?: string | null
          end_date: string
          id?: string
          max_entries_per_consumer?: number | null
          prizes?: Json | null
          prizes_json?: Json | null
          requires_purchase?: boolean | null
          start_date: string
          status?: string | null
          terms_and_conditions?: string | null
          updated_at?: string | null
          winners?: Json | null
        }
        Update: {
          campaign_code?: string
          campaign_description?: string | null
          campaign_image_url?: string | null
          campaign_name?: string
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          draw_date?: string | null
          drawn_at?: string | null
          drawn_by?: string | null
          end_date?: string
          id?: string
          max_entries_per_consumer?: number | null
          prizes?: Json | null
          prizes_json?: Json | null
          requires_purchase?: boolean | null
          start_date?: string
          status?: string | null
          terms_and_conditions?: string | null
          updated_at?: string | null
          winners?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "lucky_draw_campaigns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lucky_draw_campaigns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "lucky_draw_campaigns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lucky_draw_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lucky_draw_campaigns_drawn_by_fkey"
            columns: ["drawn_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lucky_draw_entries: {
        Row: {
          campaign_id: string
          company_id: string
          consumer_email: string | null
          consumer_name: string | null
          consumer_phone: string
          created_at: string | null
          entry_date: string | null
          entry_number: string
          entry_status: string | null
          id: string
          is_winner: boolean | null
          prize_claimed: boolean | null
          prize_claimed_at: string | null
          prize_won: Json | null
          qr_code_id: string | null
        }
        Insert: {
          campaign_id: string
          company_id: string
          consumer_email?: string | null
          consumer_name?: string | null
          consumer_phone: string
          created_at?: string | null
          entry_date?: string | null
          entry_number: string
          entry_status?: string | null
          id?: string
          is_winner?: boolean | null
          prize_claimed?: boolean | null
          prize_claimed_at?: string | null
          prize_won?: Json | null
          qr_code_id?: string | null
        }
        Update: {
          campaign_id?: string
          company_id?: string
          consumer_email?: string | null
          consumer_name?: string | null
          consumer_phone?: string
          created_at?: string | null
          entry_date?: string | null
          entry_number?: string
          entry_status?: string | null
          id?: string
          is_winner?: boolean | null
          prize_claimed?: boolean | null
          prize_claimed_at?: string | null
          prize_won?: Json | null
          qr_code_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lucky_draw_entries_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "lucky_draw_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lucky_draw_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lucky_draw_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "lucky_draw_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lucky_draw_entries_qr_code_id_fkey"
            columns: ["qr_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      lucky_draw_order_links: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          journey_config_id: string | null
          order_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          journey_config_id?: string | null
          order_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          journey_config_id?: string | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lucky_draw_order_links_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "lucky_draw_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lucky_draw_order_links_journey_config_id_fkey"
            columns: ["journey_config_id"]
            isOneToOne: false
            referencedRelation: "journey_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lucky_draw_order_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lucky_draw_order_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "lucky_draw_order_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "lucky_draw_order_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lucky_draw_order_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          channel: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          org_id: string
        }
        Insert: {
          body: string
          channel: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          org_id: string
        }
        Update: {
          body?: string
          channel?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "message_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          channel: string
          cost_amount: number | null
          cost_currency: string | null
          created_at: string | null
          delivered_at: string | null
          error_code: string | null
          error_message: string | null
          event_code: string | null
          failed_at: string | null
          id: string
          org_id: string
          outbox_id: string | null
          provider_message_id: string | null
          provider_name: string | null
          provider_response: Json | null
          queued_at: string | null
          recipient_type: string | null
          recipient_value: string | null
          retry_count: number | null
          sent_at: string | null
          status: string
          status_details: string | null
        }
        Insert: {
          channel: string
          cost_amount?: number | null
          cost_currency?: string | null
          created_at?: string | null
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          event_code?: string | null
          failed_at?: string | null
          id?: string
          org_id: string
          outbox_id?: string | null
          provider_message_id?: string | null
          provider_name?: string | null
          provider_response?: Json | null
          queued_at?: string | null
          recipient_type?: string | null
          recipient_value?: string | null
          retry_count?: number | null
          sent_at?: string | null
          status: string
          status_details?: string | null
        }
        Update: {
          channel?: string
          cost_amount?: number | null
          cost_currency?: string | null
          created_at?: string | null
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          event_code?: string | null
          failed_at?: string | null
          id?: string
          org_id?: string
          outbox_id?: string | null
          provider_message_id?: string | null
          provider_name?: string | null
          provider_response?: Json | null
          queued_at?: string | null
          recipient_type?: string | null
          recipient_value?: string | null
          retry_count?: number | null
          sent_at?: string | null
          status?: string
          status_details?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "notification_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_logs_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "notifications_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_provider_configs: {
        Row: {
          channel: string
          config_encrypted: string | null
          config_iv: string | null
          config_public: Json | null
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          is_sandbox: boolean | null
          last_test_at: string | null
          last_test_error: string | null
          last_test_status: string | null
          org_id: string
          provider_name: string
          updated_at: string | null
        }
        Insert: {
          channel: string
          config_encrypted?: string | null
          config_iv?: string | null
          config_public?: Json | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          is_sandbox?: boolean | null
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_status?: string | null
          org_id: string
          provider_name: string
          updated_at?: string | null
        }
        Update: {
          channel?: string
          config_encrypted?: string | null
          config_iv?: string | null
          config_public?: Json | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          is_sandbox?: boolean | null
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_status?: string | null
          org_id?: string
          provider_name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_provider_configs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_provider_configs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_provider_configs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "notification_provider_configs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          channels_enabled: string[] | null
          created_at: string | null
          enabled: boolean | null
          event_code: string
          id: string
          max_retries: number | null
          org_id: string
          priority: string | null
          recipient_custom: string[] | null
          recipient_roles: string[] | null
          recipient_users: string[] | null
          retry_enabled: boolean | null
          template_code: string | null
          updated_at: string | null
        }
        Insert: {
          channels_enabled?: string[] | null
          created_at?: string | null
          enabled?: boolean | null
          event_code: string
          id?: string
          max_retries?: number | null
          org_id: string
          priority?: string | null
          recipient_custom?: string[] | null
          recipient_roles?: string[] | null
          recipient_users?: string[] | null
          retry_enabled?: boolean | null
          template_code?: string | null
          updated_at?: string | null
        }
        Update: {
          channels_enabled?: string[] | null
          created_at?: string | null
          enabled?: boolean | null
          event_code?: string
          id?: string
          max_retries?: number | null
          org_id?: string
          priority?: string | null
          recipient_custom?: string[] | null
          recipient_roles?: string[] | null
          recipient_users?: string[] | null
          retry_enabled?: boolean | null
          template_code?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_event_code_fkey"
            columns: ["event_code"]
            isOneToOne: false
            referencedRelation: "notification_types"
            referencedColumns: ["event_code"]
          },
          {
            foreignKeyName: "notification_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "notification_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_types: {
        Row: {
          available_channels: string[] | null
          category: string
          created_at: string | null
          default_enabled: boolean | null
          default_template_code: string | null
          event_code: string
          event_description: string | null
          event_name: string
          id: string
          is_system: boolean | null
          updated_at: string | null
        }
        Insert: {
          available_channels?: string[] | null
          category: string
          created_at?: string | null
          default_enabled?: boolean | null
          default_template_code?: string | null
          event_code: string
          event_description?: string | null
          event_name: string
          id?: string
          is_system?: boolean | null
          updated_at?: string | null
        }
        Update: {
          available_channels?: string[] | null
          category?: string
          created_at?: string | null
          default_enabled?: boolean | null
          default_template_code?: string | null
          event_code?: string
          event_description?: string | null
          event_name?: string
          id?: string
          is_system?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      notifications_outbox: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          event_code: string | null
          id: string
          max_retries: number | null
          next_retry_at: string | null
          org_id: string
          payload_json: Json | null
          priority: string | null
          provider_message_id: string | null
          provider_name: string | null
          retry_count: number | null
          scheduled_for: string | null
          sent_at: string | null
          status: string
          template_code: string | null
          to_email: string | null
          to_phone: string | null
        }
        Insert: {
          channel: string
          created_at?: string
          error?: string | null
          event_code?: string | null
          id?: string
          max_retries?: number | null
          next_retry_at?: string | null
          org_id: string
          payload_json?: Json | null
          priority?: string | null
          provider_message_id?: string | null
          provider_name?: string | null
          retry_count?: number | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          template_code?: string | null
          to_email?: string | null
          to_phone?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          event_code?: string | null
          id?: string
          max_retries?: number | null
          next_retry_at?: string | null
          org_id?: string
          payload_json?: Json | null
          priority?: string | null
          provider_message_id?: string | null
          provider_name?: string | null
          retry_count?: number | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          template_code?: string | null
          to_email?: string | null
          to_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "notifications_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          line_total: number | null
          order_id: string
          product_id: string
          qty: number
          unit_price: number
          updated_at: string | null
          variant_id: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          id?: string
          line_total?: number | null
          order_id: string
          product_id: string
          qty: number
          unit_price: number
          updated_at?: string | null
          variant_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          line_total?: number | null
          order_id?: string
          product_id?: string
          qty?: number
          unit_price?: number
          updated_at?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_current_pricing"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock_alerts"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_available_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          buyer_org_id: string
          company_id: string
          created_at: string | null
          created_by: string
          has_lucky_draw: boolean | null
          has_points: boolean | null
          has_redeem: boolean | null
          has_rfid: boolean | null
          id: string
          notes: string | null
          order_no: string
          order_type: Database["public"]["Enums"]["order_type"]
          parent_order_id: string | null
          payment_terms: Json
          qr_buffer_percent: number | null
          seller_org_id: string
          status: Database["public"]["Enums"]["order_status"]
          units_per_case: number | null
          updated_at: string | null
          updated_by: string | null
          warehouse_org_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          buyer_org_id: string
          company_id: string
          created_at?: string | null
          created_by: string
          has_lucky_draw?: boolean | null
          has_points?: boolean | null
          has_redeem?: boolean | null
          has_rfid?: boolean | null
          id?: string
          notes?: string | null
          order_no: string
          order_type: Database["public"]["Enums"]["order_type"]
          parent_order_id?: string | null
          payment_terms?: Json
          qr_buffer_percent?: number | null
          seller_org_id: string
          status?: Database["public"]["Enums"]["order_status"]
          units_per_case?: number | null
          updated_at?: string | null
          updated_by?: string | null
          warehouse_org_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          buyer_org_id?: string
          company_id?: string
          created_at?: string | null
          created_by?: string
          has_lucky_draw?: boolean | null
          has_points?: boolean | null
          has_redeem?: boolean | null
          has_rfid?: boolean | null
          id?: string
          notes?: string | null
          order_no?: string
          order_type?: Database["public"]["Enums"]["order_type"]
          parent_order_id?: string | null
          payment_terms?: Json
          qr_buffer_percent?: number | null
          seller_org_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          units_per_case?: number | null
          updated_at?: string | null
          updated_by?: string | null
          warehouse_org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_buyer_org_id_fkey"
            columns: ["buyer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_buyer_org_id_fkey"
            columns: ["buyer_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "orders_buyer_org_id_fkey"
            columns: ["buyer_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
          {
            foreignKeyName: "orders_seller_org_id_fkey"
            columns: ["seller_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_seller_org_id_fkey"
            columns: ["seller_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "orders_seller_org_id_fkey"
            columns: ["seller_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_warehouse_org_id_fkey"
            columns: ["warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_warehouse_org_id_fkey"
            columns: ["warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "orders_warehouse_org_id_fkey"
            columns: ["warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      org_notification_settings: {
        Row: {
          org_id: string
          otp_channel: string
          otp_enabled: boolean
          updated_at: string
          whatsapp_enabled: boolean
        }
        Insert: {
          org_id: string
          otp_channel?: string
          otp_enabled?: boolean
          updated_at?: string
          whatsapp_enabled?: boolean
        }
        Update: {
          org_id?: string
          otp_channel?: string
          otp_enabled?: boolean
          updated_at?: string
          whatsapp_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "org_notification_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_notification_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "org_notification_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_types: {
        Row: {
          created_at: string | null
          hierarchy_level: number
          id: string
          is_active: boolean | null
          type_code: string
          type_description: string | null
          type_name: string
        }
        Insert: {
          created_at?: string | null
          hierarchy_level: number
          id?: string
          is_active?: boolean | null
          type_code: string
          type_description?: string | null
          type_name: string
        }
        Update: {
          created_at?: string | null
          hierarchy_level?: number
          id?: string
          is_active?: boolean | null
          type_code?: string
          type_description?: string | null
          type_name?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          address: string | null
          address_line2: string | null
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contact_title: string | null
          country_code: string | null
          created_at: string | null
          created_by: string | null
          default_warehouse_org_id: string | null
          district_id: string | null
          id: string
          is_active: boolean | null
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          org_code: string
          org_name: string
          org_name_search: string | null
          org_type_code: string
          parent_org_id: string | null
          postal_code: string | null
          registration_no: string | null
          scan_activation_point: string | null
          settings: Json | null
          state_id: string | null
          tax_id: string | null
          updated_at: string | null
          updated_by: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          address_line2?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_title?: string | null
          country_code?: string | null
          created_at?: string | null
          created_by?: string | null
          default_warehouse_org_id?: string | null
          district_id?: string | null
          id?: string
          is_active?: boolean | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          org_code: string
          org_name: string
          org_name_search?: string | null
          org_type_code: string
          parent_org_id?: string | null
          postal_code?: string | null
          registration_no?: string | null
          scan_activation_point?: string | null
          settings?: Json | null
          state_id?: string | null
          tax_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          address_line2?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_title?: string | null
          country_code?: string | null
          created_at?: string | null
          created_by?: string | null
          default_warehouse_org_id?: string | null
          district_id?: string | null
          id?: string
          is_active?: boolean | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          org_code?: string
          org_name?: string
          org_name_search?: string | null
          org_type_code?: string
          parent_org_id?: string | null
          postal_code?: string | null
          registration_no?: string | null
          scan_activation_point?: string | null
          settings?: Json | null
          state_id?: string | null
          tax_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_default_warehouse_org_id_fkey"
            columns: ["default_warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_default_warehouse_org_id_fkey"
            columns: ["default_warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "organizations_default_warehouse_org_id_fkey"
            columns: ["default_warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_org_type_code_fkey"
            columns: ["org_type_code"]
            isOneToOne: false
            referencedRelation: "organization_types"
            referencedColumns: ["type_code"]
          },
          {
            foreignKeyName: "organizations_parent_org_id_fkey"
            columns: ["parent_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_parent_org_id_fkey"
            columns: ["parent_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "organizations_parent_org_id_fkey"
            columns: ["parent_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_challenges: {
        Row: {
          attempts: number
          channel: string
          code_hash: string
          created_at: string
          email: string | null
          expires_at: string
          id: string
          max_attempts: number
          metadata: Json | null
          org_id: string
          phone: string | null
          salt: string
          status: string
          subject_ref: string | null
          subject_type: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          channel: string
          code_hash: string
          created_at?: string
          email?: string | null
          expires_at: string
          id?: string
          max_attempts?: number
          metadata?: Json | null
          org_id: string
          phone?: string | null
          salt: string
          status?: string
          subject_ref?: string | null
          subject_type: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          channel?: string
          code_hash?: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          max_attempts?: number
          metadata?: Json | null
          org_id?: string
          phone?: string | null
          salt?: string
          status?: string
          subject_ref?: string | null
          subject_type?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "otp_challenges_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "otp_challenges_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "otp_challenges_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      point_rewards: {
        Row: {
          created_at: string
          id: string
          is_featured: boolean | null
          points_required: number
          reward_description: string | null
          reward_image_url: string | null
          reward_name: string
          stock_quantity: number | null
          tier_level: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_featured?: boolean | null
          points_required: number
          reward_description?: string | null
          reward_image_url?: string | null
          reward_name: string
          stock_quantity?: number | null
          tier_level?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_featured?: boolean | null
          points_required?: number
          reward_description?: string | null
          reward_image_url?: string | null
          reward_name?: string
          stock_quantity?: number | null
          tier_level?: string
          updated_at?: string
        }
        Relationships: []
      }
      points_rules: {
        Row: {
          allow_manual_adjustment: boolean
          created_at: string
          created_by: string | null
          effective_from: string | null
          effective_to: string | null
          expires_after_days: number | null
          id: string
          is_active: boolean
          journey_config_id: string | null
          name: string
          org_id: string
          points_per_scan: number
        }
        Insert: {
          allow_manual_adjustment?: boolean
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          expires_after_days?: number | null
          id?: string
          is_active?: boolean
          journey_config_id?: string | null
          name?: string
          org_id: string
          points_per_scan?: number
        }
        Update: {
          allow_manual_adjustment?: boolean
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          expires_after_days?: number | null
          id?: string
          is_active?: boolean
          journey_config_id?: string | null
          name?: string
          org_id?: string
          points_per_scan?: number
        }
        Relationships: [
          {
            foreignKeyName: "points_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_rules_journey_config_id_fkey"
            columns: ["journey_config_id"]
            isOneToOne: false
            referencedRelation: "journey_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "points_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      points_transactions: {
        Row: {
          balance_after: number
          company_id: string
          consumer_email: string | null
          consumer_phone: string
          created_at: string | null
          description: string | null
          id: string
          points_amount: number
          qr_code_id: string | null
          redeem_item_id: string | null
          transaction_date: string | null
          transaction_type: string
        }
        Insert: {
          balance_after: number
          company_id: string
          consumer_email?: string | null
          consumer_phone: string
          created_at?: string | null
          description?: string | null
          id?: string
          points_amount: number
          qr_code_id?: string | null
          redeem_item_id?: string | null
          transaction_date?: string | null
          transaction_type: string
        }
        Update: {
          balance_after?: number
          company_id?: string
          consumer_email?: string | null
          consumer_phone?: string
          created_at?: string | null
          description?: string | null
          id?: string
          points_amount?: number
          qr_code_id?: string | null
          redeem_item_id?: string | null
          transaction_date?: string | null
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "points_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "points_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_transactions_qr_code_id_fkey"
            columns: ["qr_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_transactions_redeem_item_id_fkey"
            columns: ["redeem_item_id"]
            isOneToOne: false
            referencedRelation: "redeem_items"
            referencedColumns: ["id"]
          },
        ]
      }
      product_attributes: {
        Row: {
          attribute_group: string | null
          attribute_name: string
          attribute_type: string | null
          attribute_value: string
          created_at: string | null
          display_order: number | null
          id: string
          is_filterable: boolean | null
          is_searchable: boolean | null
          product_id: string | null
          unit_of_measure: string | null
          updated_at: string | null
          variant_id: string | null
        }
        Insert: {
          attribute_group?: string | null
          attribute_name: string
          attribute_type?: string | null
          attribute_value: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_filterable?: boolean | null
          is_searchable?: boolean | null
          product_id?: string | null
          unit_of_measure?: string | null
          updated_at?: string | null
          variant_id?: string | null
        }
        Update: {
          attribute_group?: string | null
          attribute_name?: string
          attribute_type?: string | null
          attribute_value?: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_filterable?: boolean | null
          is_searchable?: boolean | null
          product_id?: string | null
          unit_of_measure?: string | null
          updated_at?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_attributes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attributes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_attributes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attributes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_current_pricing"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_attributes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_attributes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock_alerts"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_attributes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attributes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_available_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_attributes_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "product_attributes_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attributes_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      product_categories: {
        Row: {
          category_code: string
          category_description: string | null
          category_name: string
          category_name_search: string | null
          created_at: string | null
          created_by: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          is_vape: boolean | null
          parent_category_id: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          category_code: string
          category_description?: string | null
          category_name: string
          category_name_search?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_vape?: boolean | null
          parent_category_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          category_code?: string
          category_description?: string | null
          category_name?: string
          category_name_search?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_vape?: boolean | null
          parent_category_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_parent_category_id_fkey"
            columns: ["parent_category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_groups: {
        Row: {
          category_id: string
          created_at: string | null
          group_code: string
          group_description: string | null
          group_name: string
          group_name_search: string | null
          id: string
          is_active: boolean | null
          updated_at: string | null
        }
        Insert: {
          category_id: string
          created_at?: string | null
          group_code: string
          group_description?: string | null
          group_name: string
          group_name_search?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Update: {
          category_id?: string
          created_at?: string | null
          group_code?: string
          group_description?: string | null
          group_name?: string
          group_name_search?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_groups_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt_text: string | null
          created_at: string | null
          file_size: number | null
          height: number | null
          id: string
          image_type: string | null
          image_url: string
          is_active: boolean | null
          is_primary: boolean | null
          mime_type: string | null
          product_id: string | null
          sort_order: number | null
          title: string | null
          uploaded_by: string | null
          variant_id: string | null
          width: number | null
        }
        Insert: {
          alt_text?: string | null
          created_at?: string | null
          file_size?: number | null
          height?: number | null
          id?: string
          image_type?: string | null
          image_url: string
          is_active?: boolean | null
          is_primary?: boolean | null
          mime_type?: string | null
          product_id?: string | null
          sort_order?: number | null
          title?: string | null
          uploaded_by?: string | null
          variant_id?: string | null
          width?: number | null
        }
        Update: {
          alt_text?: string | null
          created_at?: string | null
          file_size?: number | null
          height?: number | null
          id?: string
          image_type?: string | null
          image_url?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          mime_type?: string | null
          product_id?: string | null
          sort_order?: number | null
          title?: string | null
          uploaded_by?: string | null
          variant_id?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_current_pricing"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock_alerts"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_available_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_images_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "product_images_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      product_inventory: {
        Row: {
          average_cost: number | null
          cases_on_hand: number | null
          created_at: string | null
          id: string
          is_active: boolean | null
          last_counted_at: string | null
          last_counted_by: string | null
          max_stock_level: number | null
          organization_id: string
          quantity_allocated: number | null
          quantity_available: number | null
          quantity_on_hand: number | null
          reorder_point: number | null
          reorder_quantity: number | null
          total_value: number | null
          units_on_hand: number | null
          updated_at: string | null
          variant_id: string
          warehouse_location: string | null
        }
        Insert: {
          average_cost?: number | null
          cases_on_hand?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_counted_at?: string | null
          last_counted_by?: string | null
          max_stock_level?: number | null
          organization_id: string
          quantity_allocated?: number | null
          quantity_available?: number | null
          quantity_on_hand?: number | null
          reorder_point?: number | null
          reorder_quantity?: number | null
          total_value?: number | null
          units_on_hand?: number | null
          updated_at?: string | null
          variant_id: string
          warehouse_location?: string | null
        }
        Update: {
          average_cost?: number | null
          cases_on_hand?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_counted_at?: string | null
          last_counted_by?: string | null
          max_stock_level?: number | null
          organization_id?: string
          quantity_allocated?: number | null
          quantity_available?: number | null
          quantity_on_hand?: number | null
          reorder_point?: number | null
          reorder_quantity?: number | null
          total_value?: number | null
          units_on_hand?: number | null
          updated_at?: string | null
          variant_id?: string
          warehouse_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_inventory_last_counted_by_fkey"
            columns: ["last_counted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_inventory_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_inventory_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "product_inventory_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "product_inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      product_pricing: {
        Row: {
          case_price: number | null
          created_at: string | null
          created_by: string | null
          currency_code: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          is_active: boolean | null
          max_quantity: number | null
          min_quantity: number | null
          organization_id: string | null
          price_tier: string | null
          promotional_discount_percent: number | null
          unit_price: number
          updated_at: string | null
          variant_id: string
          volume_discount_percent: number | null
        }
        Insert: {
          case_price?: number | null
          created_at?: string | null
          created_by?: string | null
          currency_code?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          max_quantity?: number | null
          min_quantity?: number | null
          organization_id?: string | null
          price_tier?: string | null
          promotional_discount_percent?: number | null
          unit_price: number
          updated_at?: string | null
          variant_id: string
          volume_discount_percent?: number | null
        }
        Update: {
          case_price?: number | null
          created_at?: string | null
          created_by?: string | null
          currency_code?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          max_quantity?: number | null
          min_quantity?: number | null
          organization_id?: string | null
          price_tier?: string | null
          promotional_discount_percent?: number | null
          unit_price?: number
          updated_at?: string | null
          variant_id?: string
          volume_discount_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_pricing_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_pricing_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_pricing_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "product_pricing_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_pricing_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "product_pricing_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_pricing_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      product_skus: {
        Row: {
          created_at: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          internal_code: string | null
          is_active: boolean | null
          organization_id: string | null
          package_type: string | null
          quantity_per_package: number | null
          sku_code: string
          sku_type: string | null
          updated_at: string | null
          variant_id: string
        }
        Insert: {
          created_at?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          internal_code?: string | null
          is_active?: boolean | null
          organization_id?: string | null
          package_type?: string | null
          quantity_per_package?: number | null
          sku_code: string
          sku_type?: string | null
          updated_at?: string | null
          variant_id: string
        }
        Update: {
          created_at?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          internal_code?: string | null
          is_active?: boolean | null
          organization_id?: string | null
          package_type?: string | null
          quantity_per_package?: number | null
          sku_code?: string
          sku_type?: string | null
          updated_at?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_skus_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_skus_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "product_skus_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_skus_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "product_skus_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_skus_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      product_subgroups: {
        Row: {
          created_at: string | null
          group_id: string
          id: string
          is_active: boolean | null
          subgroup_code: string
          subgroup_description: string | null
          subgroup_name: string
          subgroup_name_search: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          group_id: string
          id?: string
          is_active?: boolean | null
          subgroup_code: string
          subgroup_description?: string | null
          subgroup_name: string
          subgroup_name_search?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          group_id?: string
          id?: string
          is_active?: boolean | null
          subgroup_code?: string
          subgroup_description?: string | null
          subgroup_name?: string
          subgroup_name_search?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_subgroups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          attributes: Json | null
          barcode: string | null
          base_cost: number | null
          created_at: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          is_default: boolean | null
          manufacturer_sku: string | null
          product_id: string
          sort_order: number | null
          suggested_retail_price: number | null
          updated_at: string | null
          variant_code: string
          variant_name: string
          variant_name_search: string | null
        }
        Insert: {
          attributes?: Json | null
          barcode?: string | null
          base_cost?: number | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_default?: boolean | null
          manufacturer_sku?: string | null
          product_id: string
          sort_order?: number | null
          suggested_retail_price?: number | null
          updated_at?: string | null
          variant_code: string
          variant_name: string
          variant_name_search?: string | null
        }
        Update: {
          attributes?: Json | null
          barcode?: string | null
          base_cost?: number | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_default?: boolean | null
          manufacturer_sku?: string | null
          product_id?: string
          sort_order?: number | null
          suggested_retail_price?: number | null
          updated_at?: string | null
          variant_code?: string
          variant_name?: string
          variant_name_search?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_current_pricing"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock_alerts"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_available_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      products: {
        Row: {
          age_restriction: number | null
          base_unit_type: string | null
          brand_id: string | null
          case_dimensions: Json | null
          category_id: string
          created_at: string | null
          created_by: string | null
          discontinued_at: string | null
          group_id: string | null
          health_warning: string | null
          id: string
          is_active: boolean | null
          is_discontinued: boolean | null
          is_serialized: boolean | null
          is_vape: boolean | null
          launch_date: string | null
          manufacturer_id: string | null
          product_code: string
          product_description: string | null
          product_name: string
          product_name_search: string | null
          regulatory_info: Json | null
          requires_tracking: boolean | null
          short_description: string | null
          subgroup_id: string | null
          units_per_case: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          age_restriction?: number | null
          base_unit_type?: string | null
          brand_id?: string | null
          case_dimensions?: Json | null
          category_id: string
          created_at?: string | null
          created_by?: string | null
          discontinued_at?: string | null
          group_id?: string | null
          health_warning?: string | null
          id?: string
          is_active?: boolean | null
          is_discontinued?: boolean | null
          is_serialized?: boolean | null
          is_vape?: boolean | null
          launch_date?: string | null
          manufacturer_id?: string | null
          product_code: string
          product_description?: string | null
          product_name: string
          product_name_search?: string | null
          regulatory_info?: Json | null
          requires_tracking?: boolean | null
          short_description?: string | null
          subgroup_id?: string | null
          units_per_case?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          age_restriction?: number | null
          base_unit_type?: string | null
          brand_id?: string | null
          case_dimensions?: Json | null
          category_id?: string
          created_at?: string | null
          created_by?: string | null
          discontinued_at?: string | null
          group_id?: string | null
          health_warning?: string | null
          id?: string
          is_active?: boolean | null
          is_discontinued?: boolean | null
          is_serialized?: boolean | null
          is_vape?: boolean | null
          launch_date?: string | null
          manufacturer_id?: string | null
          product_code?: string
          product_description?: string | null
          product_name?: string
          product_name_search?: string | null
          regulatory_info?: Json | null
          requires_tracking?: boolean | null
          short_description?: string | null
          subgroup_id?: string | null
          units_per_case?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "products_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "product_subgroups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_batches: {
        Row: {
          buffer_percent: number | null
          company_id: string
          created_at: string | null
          created_by: string | null
          excel_file_url: string | null
          excel_generated_at: string | null
          excel_generated_by: string | null
          id: string
          order_id: string
          production_completed_at: string | null
          production_completed_by: string | null
          status: string | null
          total_master_codes: number
          total_unique_codes: number
          updated_at: string | null
        }
        Insert: {
          buffer_percent?: number | null
          company_id: string
          created_at?: string | null
          created_by?: string | null
          excel_file_url?: string | null
          excel_generated_at?: string | null
          excel_generated_by?: string | null
          id?: string
          order_id: string
          production_completed_at?: string | null
          production_completed_by?: string | null
          status?: string | null
          total_master_codes?: number
          total_unique_codes?: number
          updated_at?: string | null
        }
        Update: {
          buffer_percent?: number | null
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          excel_file_url?: string | null
          excel_generated_at?: string | null
          excel_generated_by?: string | null
          id?: string
          order_id?: string
          production_completed_at?: string | null
          production_completed_by?: string | null
          status?: string | null
          total_master_codes?: number
          total_unique_codes?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qr_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "qr_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_batches_excel_generated_by_fkey"
            columns: ["excel_generated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_batches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_batches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "qr_batches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "qr_batches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_batches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      qr_codes: {
        Row: {
          activated_at: string | null
          activated_by_consumer: string | null
          batch_id: string
          case_number: number | null
          code: string
          company_id: string
          created_at: string | null
          current_location_org_id: string | null
          first_consumer_scan_at: string | null
          has_lucky_draw: boolean | null
          has_redeem: boolean | null
          id: string
          is_active: boolean | null
          is_buffer: boolean | null
          last_scanned_at: string | null
          last_scanned_by: string | null
          lucky_draw_campaign_id: string | null
          master_code_id: string | null
          notes: string | null
          order_id: string
          order_item_id: string | null
          points_value: number | null
          product_id: string
          qr_hash: string | null
          redeem_item_id: string | null
          replaces_sequence_no: number | null
          sequence_number: number
          status: string | null
          total_consumer_scans: number | null
          updated_at: string | null
          variant_id: string
          variant_key: string | null
        }
        Insert: {
          activated_at?: string | null
          activated_by_consumer?: string | null
          batch_id: string
          case_number?: number | null
          code: string
          company_id: string
          created_at?: string | null
          current_location_org_id?: string | null
          first_consumer_scan_at?: string | null
          has_lucky_draw?: boolean | null
          has_redeem?: boolean | null
          id?: string
          is_active?: boolean | null
          is_buffer?: boolean | null
          last_scanned_at?: string | null
          last_scanned_by?: string | null
          lucky_draw_campaign_id?: string | null
          master_code_id?: string | null
          notes?: string | null
          order_id: string
          order_item_id?: string | null
          points_value?: number | null
          product_id: string
          qr_hash?: string | null
          redeem_item_id?: string | null
          replaces_sequence_no?: number | null
          sequence_number: number
          status?: string | null
          total_consumer_scans?: number | null
          updated_at?: string | null
          variant_id: string
          variant_key?: string | null
        }
        Update: {
          activated_at?: string | null
          activated_by_consumer?: string | null
          batch_id?: string
          case_number?: number | null
          code?: string
          company_id?: string
          created_at?: string | null
          current_location_org_id?: string | null
          first_consumer_scan_at?: string | null
          has_lucky_draw?: boolean | null
          has_redeem?: boolean | null
          id?: string
          is_active?: boolean | null
          is_buffer?: boolean | null
          last_scanned_at?: string | null
          last_scanned_by?: string | null
          lucky_draw_campaign_id?: string | null
          master_code_id?: string | null
          notes?: string | null
          order_id?: string
          order_item_id?: string | null
          points_value?: number | null
          product_id?: string
          qr_hash?: string | null
          redeem_item_id?: string | null
          replaces_sequence_no?: number | null
          sequence_number?: number
          status?: string | null
          total_consumer_scans?: number | null
          updated_at?: string | null
          variant_id?: string
          variant_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qr_codes_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "qr_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "qr_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_current_location_org_id_fkey"
            columns: ["current_location_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_current_location_org_id_fkey"
            columns: ["current_location_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "qr_codes_current_location_org_id_fkey"
            columns: ["current_location_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_last_scanned_by_fkey"
            columns: ["last_scanned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_lucky_draw_campaign_fkey"
            columns: ["lucky_draw_campaign_id"]
            isOneToOne: false
            referencedRelation: "lucky_draw_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_master_code_id_fkey"
            columns: ["master_code_id"]
            isOneToOne: false
            referencedRelation: "qr_master_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "qr_codes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "qr_codes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
          {
            foreignKeyName: "qr_codes_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "qr_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_current_pricing"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "qr_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "qr_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock_alerts"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "qr_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_available_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "qr_codes_redeem_item_fkey"
            columns: ["redeem_item_id"]
            isOneToOne: false
            referencedRelation: "redeem_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "qr_codes_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      qr_master_codes: {
        Row: {
          actual_unit_count: number | null
          batch_id: string
          case_number: number
          company_id: string
          created_at: string | null
          expected_unit_count: number
          id: string
          manufacturer_org_id: string | null
          manufacturer_scanned_at: string | null
          manufacturer_scanned_by: string | null
          master_code: string
          notes: string | null
          shipment_order_id: string | null
          shipped_at: string | null
          shipped_by: string | null
          shipped_to_distributor_id: string | null
          status: string | null
          updated_at: string | null
          warehouse_org_id: string | null
          warehouse_received_at: string | null
          warehouse_received_by: string | null
        }
        Insert: {
          actual_unit_count?: number | null
          batch_id: string
          case_number: number
          company_id: string
          created_at?: string | null
          expected_unit_count: number
          id?: string
          manufacturer_org_id?: string | null
          manufacturer_scanned_at?: string | null
          manufacturer_scanned_by?: string | null
          master_code: string
          notes?: string | null
          shipment_order_id?: string | null
          shipped_at?: string | null
          shipped_by?: string | null
          shipped_to_distributor_id?: string | null
          status?: string | null
          updated_at?: string | null
          warehouse_org_id?: string | null
          warehouse_received_at?: string | null
          warehouse_received_by?: string | null
        }
        Update: {
          actual_unit_count?: number | null
          batch_id?: string
          case_number?: number
          company_id?: string
          created_at?: string | null
          expected_unit_count?: number
          id?: string
          manufacturer_org_id?: string | null
          manufacturer_scanned_at?: string | null
          manufacturer_scanned_by?: string | null
          master_code?: string
          notes?: string | null
          shipment_order_id?: string | null
          shipped_at?: string | null
          shipped_by?: string | null
          shipped_to_distributor_id?: string | null
          status?: string | null
          updated_at?: string | null
          warehouse_org_id?: string | null
          warehouse_received_at?: string | null
          warehouse_received_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qr_master_codes_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "qr_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_master_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_master_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "qr_master_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_master_codes_manufacturer_org_id_fkey"
            columns: ["manufacturer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_master_codes_manufacturer_org_id_fkey"
            columns: ["manufacturer_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "qr_master_codes_manufacturer_org_id_fkey"
            columns: ["manufacturer_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_master_codes_manufacturer_scanned_by_fkey"
            columns: ["manufacturer_scanned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_master_codes_shipment_order_id_fkey"
            columns: ["shipment_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_master_codes_shipment_order_id_fkey"
            columns: ["shipment_order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "qr_master_codes_shipment_order_id_fkey"
            columns: ["shipment_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "qr_master_codes_shipment_order_id_fkey"
            columns: ["shipment_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_master_codes_shipment_order_id_fkey"
            columns: ["shipment_order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
          {
            foreignKeyName: "qr_master_codes_shipped_by_fkey"
            columns: ["shipped_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_master_codes_shipped_to_distributor_id_fkey"
            columns: ["shipped_to_distributor_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_master_codes_shipped_to_distributor_id_fkey"
            columns: ["shipped_to_distributor_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "qr_master_codes_shipped_to_distributor_id_fkey"
            columns: ["shipped_to_distributor_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_master_codes_warehouse_org_id_fkey"
            columns: ["warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_master_codes_warehouse_org_id_fkey"
            columns: ["warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "qr_master_codes_warehouse_org_id_fkey"
            columns: ["warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_master_codes_warehouse_received_by_fkey"
            columns: ["warehouse_received_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_movements: {
        Row: {
          company_id: string
          created_at: string | null
          current_status: string | null
          device_info: Json | null
          from_org_id: string | null
          id: string
          movement_type: string
          notes: string | null
          qr_code_id: string | null
          qr_master_code_id: string | null
          related_order_id: string | null
          scan_location: string | null
          scanned_at: string | null
          scanned_by: string | null
          to_org_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          current_status?: string | null
          device_info?: Json | null
          from_org_id?: string | null
          id?: string
          movement_type: string
          notes?: string | null
          qr_code_id?: string | null
          qr_master_code_id?: string | null
          related_order_id?: string | null
          scan_location?: string | null
          scanned_at?: string | null
          scanned_by?: string | null
          to_org_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          current_status?: string | null
          device_info?: Json | null
          from_org_id?: string | null
          id?: string
          movement_type?: string
          notes?: string | null
          qr_code_id?: string | null
          qr_master_code_id?: string | null
          related_order_id?: string | null
          scan_location?: string | null
          scanned_at?: string | null
          scanned_by?: string | null
          to_org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qr_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "qr_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_movements_from_org_id_fkey"
            columns: ["from_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_movements_from_org_id_fkey"
            columns: ["from_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "qr_movements_from_org_id_fkey"
            columns: ["from_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_movements_qr_code_id_fkey"
            columns: ["qr_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_movements_qr_master_code_id_fkey"
            columns: ["qr_master_code_id"]
            isOneToOne: false
            referencedRelation: "qr_master_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_movements_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_movements_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "qr_movements_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "qr_movements_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_movements_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
          {
            foreignKeyName: "qr_movements_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_movements_to_org_id_fkey"
            columns: ["to_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_movements_to_org_id_fkey"
            columns: ["to_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "qr_movements_to_org_id_fkey"
            columns: ["to_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_prepared_codes: {
        Row: {
          batch_id: string
          code: string
          consumed_at: string | null
          created_at: string | null
          id: string
          job_id: string
          order_id: string
          sequence_number: number | null
          status: string
        }
        Insert: {
          batch_id: string
          code: string
          consumed_at?: string | null
          created_at?: string | null
          id?: string
          job_id: string
          order_id: string
          sequence_number?: number | null
          status?: string
        }
        Update: {
          batch_id?: string
          code?: string
          consumed_at?: string | null
          created_at?: string | null
          id?: string
          job_id?: string
          order_id?: string
          sequence_number?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_prepared_codes_batch"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "qr_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_prepared_codes_job"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "qr_reverse_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_prepared_codes_job"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "v_reverse_job_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_prepared_codes_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_prepared_codes_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "fk_prepared_codes_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "fk_prepared_codes_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_prepared_codes_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      qr_reverse_job_items: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          job_id: string
          processed_at: string | null
          replacement_code_id: string | null
          replacement_sequence_no: number | null
          spoiled_code_id: string | null
          spoiled_sequence_no: number
          status: string
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          job_id: string
          processed_at?: string | null
          replacement_code_id?: string | null
          replacement_sequence_no?: number | null
          spoiled_code_id?: string | null
          spoiled_sequence_no: number
          status?: string
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          job_id?: string
          processed_at?: string | null
          replacement_code_id?: string | null
          replacement_sequence_no?: number | null
          spoiled_code_id?: string | null
          spoiled_sequence_no?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "qr_reverse_job_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "qr_reverse_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_reverse_job_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "v_reverse_job_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_reverse_job_items_replacement_code_id_fkey"
            columns: ["replacement_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_reverse_job_items_spoiled_code_id_fkey"
            columns: ["spoiled_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_reverse_job_logs: {
        Row: {
          created_at: string | null
          id: string
          job_id: string
          level: string
          message: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          job_id: string
          level: string
          message: string
        }
        Update: {
          created_at?: string | null
          id?: string
          job_id?: string
          level?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_job_logs_job"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "qr_reverse_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_job_logs_job"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "v_reverse_job_status"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_reverse_jobs: {
        Row: {
          batch_id: string
          case_number: number | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          error_message: string | null
          exclude_codes: string[]
          expected_units_per_case: number | null
          final_unit_count: number | null
          id: string
          manufacturer_org_id: string
          master_code: string | null
          master_code_id: string | null
          order_id: string
          prepared_count: number | null
          product_variant_key: string | null
          progress: number | null
          remaining_to_prepare: number | null
          result_summary: Json | null
          started_at: string | null
          status: string
          total_available_in_batch: number | null
          total_replacements: number | null
          total_spoiled: number | null
          updated_at: string | null
          variant_key: string | null
        }
        Insert: {
          batch_id: string
          case_number?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          exclude_codes?: string[]
          expected_units_per_case?: number | null
          final_unit_count?: number | null
          id?: string
          manufacturer_org_id: string
          master_code?: string | null
          master_code_id?: string | null
          order_id: string
          prepared_count?: number | null
          product_variant_key?: string | null
          progress?: number | null
          remaining_to_prepare?: number | null
          result_summary?: Json | null
          started_at?: string | null
          status?: string
          total_available_in_batch?: number | null
          total_replacements?: number | null
          total_spoiled?: number | null
          updated_at?: string | null
          variant_key?: string | null
        }
        Update: {
          batch_id?: string
          case_number?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          exclude_codes?: string[]
          expected_units_per_case?: number | null
          final_unit_count?: number | null
          id?: string
          manufacturer_org_id?: string
          master_code?: string | null
          master_code_id?: string | null
          order_id?: string
          prepared_count?: number | null
          product_variant_key?: string | null
          progress?: number | null
          remaining_to_prepare?: number | null
          result_summary?: Json | null
          started_at?: string | null
          status?: string
          total_available_in_batch?: number | null
          total_replacements?: number | null
          total_spoiled?: number | null
          updated_at?: string | null
          variant_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_reverse_jobs_batch"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "qr_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_reverse_jobs_manufacturer"
            columns: ["manufacturer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_reverse_jobs_manufacturer"
            columns: ["manufacturer_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "fk_reverse_jobs_manufacturer"
            columns: ["manufacturer_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_reverse_jobs_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_reverse_jobs_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "fk_reverse_jobs_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "fk_reverse_jobs_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_reverse_jobs_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
          {
            foreignKeyName: "qr_reverse_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_reverse_jobs_master_code_id_fkey"
            columns: ["master_code_id"]
            isOneToOne: false
            referencedRelation: "qr_master_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_validation_reports: {
        Row: {
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          company_id: string
          created_at: string | null
          created_by: string
          destination_order_id: string | null
          discrepancy_details: Json | null
          distributor_org_id: string
          expected_quantities: Json
          id: string
          is_matched: boolean | null
          master_codes_scanned: string[] | null
          scanned_quantities: Json
          source_order_id: string | null
          unique_codes_scanned: string[] | null
          updated_at: string | null
          validation_status: string | null
          warehouse_org_id: string
        }
        Insert: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          created_at?: string | null
          created_by: string
          destination_order_id?: string | null
          discrepancy_details?: Json | null
          distributor_org_id: string
          expected_quantities: Json
          id?: string
          is_matched?: boolean | null
          master_codes_scanned?: string[] | null
          scanned_quantities: Json
          source_order_id?: string | null
          unique_codes_scanned?: string[] | null
          updated_at?: string | null
          validation_status?: string | null
          warehouse_org_id: string
        }
        Update: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string | null
          created_by?: string
          destination_order_id?: string | null
          discrepancy_details?: Json | null
          distributor_org_id?: string
          expected_quantities?: Json
          id?: string
          is_matched?: boolean | null
          master_codes_scanned?: string[] | null
          scanned_quantities?: Json
          source_order_id?: string | null
          unique_codes_scanned?: string[] | null
          updated_at?: string | null
          validation_status?: string | null
          warehouse_org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qr_validation_reports_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_validation_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_validation_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "qr_validation_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_validation_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_validation_reports_destination_order_id_fkey"
            columns: ["destination_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_validation_reports_destination_order_id_fkey"
            columns: ["destination_order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "qr_validation_reports_destination_order_id_fkey"
            columns: ["destination_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "qr_validation_reports_destination_order_id_fkey"
            columns: ["destination_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_validation_reports_destination_order_id_fkey"
            columns: ["destination_order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
          {
            foreignKeyName: "qr_validation_reports_distributor_org_id_fkey"
            columns: ["distributor_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_validation_reports_distributor_org_id_fkey"
            columns: ["distributor_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "qr_validation_reports_distributor_org_id_fkey"
            columns: ["distributor_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_validation_reports_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_validation_reports_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "qr_validation_reports_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "qr_validation_reports_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_validation_reports_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
          {
            foreignKeyName: "qr_validation_reports_warehouse_org_id_fkey"
            columns: ["warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_validation_reports_warehouse_org_id_fkey"
            columns: ["warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "qr_validation_reports_warehouse_org_id_fkey"
            columns: ["warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      redeem_gift_transactions: {
        Row: {
          consumer_name: string | null
          consumer_phone: string
          id: string
          notes: string | null
          order_id: string
          qr_code: string
          redeem_gift_id: string
          redeemed_at: string
          staff_id: string | null
          staff_name: string | null
        }
        Insert: {
          consumer_name?: string | null
          consumer_phone: string
          id?: string
          notes?: string | null
          order_id: string
          qr_code: string
          redeem_gift_id: string
          redeemed_at?: string
          staff_id?: string | null
          staff_name?: string | null
        }
        Update: {
          consumer_name?: string | null
          consumer_phone?: string
          id?: string
          notes?: string | null
          order_id?: string
          qr_code?: string
          redeem_gift_id?: string
          redeemed_at?: string
          staff_id?: string | null
          staff_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "redeem_gift_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redeem_gift_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "redeem_gift_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "redeem_gift_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redeem_gift_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
          {
            foreignKeyName: "redeem_gift_transactions_redeem_gift_id_fkey"
            columns: ["redeem_gift_id"]
            isOneToOne: false
            referencedRelation: "redeem_gifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redeem_gift_transactions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      redeem_gifts: {
        Row: {
          claimed_quantity: number
          created_at: string
          created_by: string | null
          end_date: string | null
          gift_description: string | null
          gift_image_url: string | null
          gift_name: string
          id: string
          is_active: boolean
          limit_per_consumer: number | null
          order_id: string
          start_date: string | null
          total_quantity: number
          updated_at: string
        }
        Insert: {
          claimed_quantity?: number
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          gift_description?: string | null
          gift_image_url?: string | null
          gift_name: string
          id?: string
          is_active?: boolean
          limit_per_consumer?: number | null
          order_id: string
          start_date?: string | null
          total_quantity?: number
          updated_at?: string
        }
        Update: {
          claimed_quantity?: number
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          gift_description?: string | null
          gift_image_url?: string | null
          gift_name?: string
          id?: string
          is_active?: boolean
          limit_per_consumer?: number | null
          order_id?: string
          start_date?: string | null
          total_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "redeem_gifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redeem_gifts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redeem_gifts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "redeem_gifts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "redeem_gifts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redeem_gifts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      redeem_items: {
        Row: {
          company_id: string
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          item_code: string
          item_description: string | null
          item_image_url: string | null
          item_name: string
          max_redemptions_per_consumer: number | null
          points_required: number
          stock_quantity: number | null
          terms_and_conditions: string | null
          updated_at: string | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          item_code: string
          item_description?: string | null
          item_image_url?: string | null
          item_name: string
          max_redemptions_per_consumer?: number | null
          points_required: number
          stock_quantity?: number | null
          terms_and_conditions?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          item_code?: string
          item_description?: string | null
          item_image_url?: string | null
          item_name?: string
          max_redemptions_per_consumer?: number | null
          points_required?: number
          stock_quantity?: number | null
          terms_and_conditions?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "redeem_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redeem_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "redeem_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redeem_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      redemption_gifts: {
        Row: {
          created_at: string
          gift_description: string | null
          gift_image_url: string | null
          gift_name: string
          id: string
          order_id: string
          quantity_available: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          gift_description?: string | null
          gift_image_url?: string | null
          gift_name: string
          id?: string
          order_id: string
          quantity_available?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          gift_description?: string | null
          gift_image_url?: string | null
          gift_name?: string
          id?: string
          order_id?: string
          quantity_available?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "redemption_gifts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_gifts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "redemption_gifts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "redemption_gifts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_gifts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      redemption_order_limits: {
        Row: {
          end_at: string | null
          enforce_limit: boolean
          exhausted_message: string | null
          max_redemptions: number | null
          order_id: string
          start_at: string | null
          updated_at: string
        }
        Insert: {
          end_at?: string | null
          enforce_limit?: boolean
          exhausted_message?: string | null
          max_redemptions?: number | null
          order_id: string
          start_at?: string | null
          updated_at?: string
        }
        Update: {
          end_at?: string | null
          enforce_limit?: boolean
          exhausted_message?: string | null
          max_redemptions?: number | null
          order_id?: string
          start_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "redemption_order_limits_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_order_limits_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "redemption_order_limits_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "redemption_order_limits_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_order_limits_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      redemption_orders: {
        Row: {
          created_at: string
          customer_phone: string | null
          id: string
          journey_config_id: string | null
          order_id: string
          org_id: string
          qr_code_id: string
          redeemed_at: string
          shop_org_id: string | null
          staff_user_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          customer_phone?: string | null
          id?: string
          journey_config_id?: string | null
          order_id: string
          org_id: string
          qr_code_id: string
          redeemed_at?: string
          shop_org_id?: string | null
          staff_user_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          customer_phone?: string | null
          id?: string
          journey_config_id?: string | null
          order_id?: string
          org_id?: string
          qr_code_id?: string
          redeemed_at?: string
          shop_org_id?: string | null
          staff_user_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "redemption_orders_journey_config_id_fkey"
            columns: ["journey_config_id"]
            isOneToOne: false
            referencedRelation: "journey_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "redemption_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "redemption_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
          {
            foreignKeyName: "redemption_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "redemption_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_orders_qr_code_id_fkey"
            columns: ["qr_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_orders_shop_org_id_fkey"
            columns: ["shop_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_orders_shop_org_id_fkey"
            columns: ["shop_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "redemption_orders_shop_org_id_fkey"
            columns: ["shop_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_orders_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      redemption_policies: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          journey_config_id: string | null
          name: string
          org_id: string
          per_qr_max: number
          require_customer_otp: boolean
          require_staff_login: boolean
          require_staff_otp: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          journey_config_id?: string | null
          name?: string
          org_id: string
          per_qr_max?: number
          require_customer_otp?: boolean
          require_staff_login?: boolean
          require_staff_otp?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          journey_config_id?: string | null
          name?: string
          org_id?: string
          per_qr_max?: number
          require_customer_otp?: boolean
          require_staff_login?: boolean
          require_staff_otp?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "redemption_policies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_policies_journey_config_id_fkey"
            columns: ["journey_config_id"]
            isOneToOne: false
            referencedRelation: "journey_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemption_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "redemption_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
          country_code: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          region_code: string
          region_name: string
        }
        Insert: {
          country_code?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          region_code: string
          region_name: string
        }
        Update: {
          country_code?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          region_code?: string
          region_name?: string
        }
        Relationships: []
      }
      roles: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          permissions: Json | null
          role_code: string
          role_description: string | null
          role_level: number
          role_name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          permissions?: Json | null
          role_code: string
          role_description?: string | null
          role_level: number
          role_name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          permissions?: Json | null
          role_code?: string
          role_description?: string | null
          role_level?: number
          role_name?: string
        }
        Relationships: []
      }
      shop_distributors: {
        Row: {
          account_number: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          credit_limit: number | null
          delivery_notes: string | null
          distributor_id: string
          id: string
          is_active: boolean | null
          is_preferred: boolean | null
          last_order_date: string | null
          payment_terms: string | null
          preferred_delivery_day: string | null
          shop_id: string
          total_orders: number | null
          total_value: number | null
          updated_at: string | null
        }
        Insert: {
          account_number?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          credit_limit?: number | null
          delivery_notes?: string | null
          distributor_id: string
          id?: string
          is_active?: boolean | null
          is_preferred?: boolean | null
          last_order_date?: string | null
          payment_terms?: string | null
          preferred_delivery_day?: string | null
          shop_id: string
          total_orders?: number | null
          total_value?: number | null
          updated_at?: string | null
        }
        Update: {
          account_number?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          credit_limit?: number | null
          delivery_notes?: string | null
          distributor_id?: string
          id?: string
          is_active?: boolean | null
          is_preferred?: boolean | null
          last_order_date?: string | null
          payment_terms?: string | null
          preferred_delivery_day?: string | null
          shop_id?: string
          total_orders?: number | null
          total_value?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_distributors_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_distributors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_distributors_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_distributors_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "shop_distributors_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_distributors_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_distributors_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "shop_distributors_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      states: {
        Row: {
          country_code: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          region_id: string | null
          state_code: string
          state_name: string
        }
        Insert: {
          country_code?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          region_id?: string | null
          state_code: string
          state_name: string
        }
        Update: {
          country_code?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          region_id?: string | null
          state_code?: string
          state_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "states_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustment_reasons: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          reason_code: string
          reason_description: string | null
          reason_name: string
          requires_approval: boolean | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          reason_code: string
          reason_description?: string | null
          reason_name: string
          requires_approval?: boolean | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          reason_code?: string
          reason_description?: string | null
          reason_name?: string
          requires_approval?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          from_organization_id: string | null
          id: string
          manufacturer_id: string | null
          movement_type: string
          notes: string | null
          quantity_after: number
          quantity_before: number
          quantity_change: number
          reason: string | null
          reference_id: string | null
          reference_no: string | null
          reference_type: string | null
          to_organization_id: string | null
          total_cost: number | null
          unit_cost: number | null
          variant_id: string
          warehouse_location: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          from_organization_id?: string | null
          id?: string
          manufacturer_id?: string | null
          movement_type: string
          notes?: string | null
          quantity_after: number
          quantity_before: number
          quantity_change: number
          reason?: string | null
          reference_id?: string | null
          reference_no?: string | null
          reference_type?: string | null
          to_organization_id?: string | null
          total_cost?: number | null
          unit_cost?: number | null
          variant_id: string
          warehouse_location?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          from_organization_id?: string | null
          id?: string
          manufacturer_id?: string | null
          movement_type?: string
          notes?: string | null
          quantity_after?: number
          quantity_before?: number
          quantity_change?: number
          reason?: string | null
          reference_id?: string | null
          reference_no?: string | null
          reference_type?: string | null
          to_organization_id?: string | null
          total_cost?: number | null
          unit_cost?: number | null
          variant_id?: string
          warehouse_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_from_organization_id_fkey"
            columns: ["from_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_from_organization_id_fkey"
            columns: ["from_organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_movements_from_organization_id_fkey"
            columns: ["from_organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_movements_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_organization_id_fkey"
            columns: ["to_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_organization_id_fkey"
            columns: ["to_organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_movements_to_organization_id_fkey"
            columns: ["to_organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          approved_by: string | null
          cancelled_at: string | null
          company_id: string
          created_at: string
          created_by: string
          from_organization_id: string
          id: string
          items: Json
          notes: string | null
          received_at: string | null
          received_by: string | null
          shipped_at: string | null
          status: string
          to_organization_id: string
          total_items: number | null
          total_value: number | null
          transfer_no: string
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          cancelled_at?: string | null
          company_id: string
          created_at?: string
          created_by: string
          from_organization_id: string
          id?: string
          items?: Json
          notes?: string | null
          received_at?: string | null
          received_by?: string | null
          shipped_at?: string | null
          status?: string
          to_organization_id: string
          total_items?: number | null
          total_value?: number | null
          transfer_no: string
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          cancelled_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          from_organization_id?: string
          id?: string
          items?: Json
          notes?: string | null
          received_at?: string | null
          received_by?: string | null
          shipped_at?: string | null
          status?: string
          to_organization_id?: string
          total_items?: number | null
          total_value?: number | null
          transfer_no?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_transfers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_from_organization_id_fkey"
            columns: ["from_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_from_organization_id_fkey"
            columns: ["from_organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_transfers_from_organization_id_fkey"
            columns: ["from_organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_organization_id_fkey"
            columns: ["to_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_organization_id_fkey"
            columns: ["to_organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_transfers_to_organization_id_fkey"
            columns: ["to_organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          email_verified_at: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          is_verified: boolean | null
          last_login_at: string | null
          last_login_ip: unknown
          organization_id: string | null
          phone: string | null
          phone_verified_at: string | null
          preferences: Json | null
          role_code: string
          signature_url: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          email_verified_at?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean | null
          is_verified?: boolean | null
          last_login_at?: string | null
          last_login_ip?: unknown
          organization_id?: string | null
          phone?: string | null
          phone_verified_at?: string | null
          preferences?: Json | null
          role_code: string
          signature_url?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          email_verified_at?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          is_verified?: boolean | null
          last_login_at?: string | null
          last_login_ip?: unknown
          organization_id?: string | null
          phone?: string | null
          phone_verified_at?: string | null
          preferences?: Json | null
          role_code?: string
          signature_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_users_organization"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_users_organization"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "fk_users_organization"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["role_code"]
          },
          {
            foreignKeyName: "users_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "v_user_roles"
            referencedColumns: ["role_code"]
          },
        ]
      }
      wms_movement_dedup: {
        Row: {
          created_at: string
          dedup_key: string
          movement_id: string | null
        }
        Insert: {
          created_at?: string
          dedup_key: string
          movement_id?: string | null
        }
        Update: {
          created_at?: string
          dedup_key?: string
          movement_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      mv_product_catalog: {
        Row: {
          brand_name: string | null
          category_name: string | null
          created_at: string | null
          group_name: string | null
          id: string | null
          image_count: number | null
          is_active: boolean | null
          is_discontinued: boolean | null
          is_vape: boolean | null
          manufacturer_name: string | null
          product_code: string | null
          product_name: string | null
          subgroup_name: string | null
          updated_at: string | null
          variant_count: number | null
        }
        Relationships: []
      }
      mv_shop_available_products: {
        Row: {
          brand_name: string | null
          category_name: string | null
          credit_limit: number | null
          default_variant_id: string | null
          default_variant_name: string | null
          distributor_carries_product: boolean | null
          distributor_cost: number | null
          distributor_id: string | null
          distributor_name: string | null
          distributor_stock: number | null
          in_stock: boolean | null
          is_available: boolean | null
          is_preferred: boolean | null
          is_vape: boolean | null
          lead_time_days: number | null
          max_order_quantity: number | null
          min_order_quantity: number | null
          payment_terms: string | null
          product_active: boolean | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          shop_distributor_active: boolean | null
          shop_district_id: string | null
          shop_id: string | null
          shop_name: string | null
          shop_state_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_district_id_fkey"
            columns: ["shop_district_id"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_state_id_fkey"
            columns: ["shop_state_id"]
            isOneToOne: false
            referencedRelation: "states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_distributors_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_distributors_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "shop_distributors_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_distributors_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_distributors_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "shop_distributors_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      v_current_pricing: {
        Row: {
          case_price: number | null
          currency_code: string | null
          effective_from: string | null
          effective_to: string | null
          effective_unit_price: number | null
          id: string | null
          max_quantity: number | null
          min_quantity: number | null
          org_name: string | null
          org_type_code: string | null
          organization_id: string | null
          price_tier: string | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          promotional_discount_percent: number | null
          unit_price: number | null
          variant_code: string | null
          variant_id: string | null
          variant_name: string | null
          volume_discount_percent: number | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_org_type_code_fkey"
            columns: ["org_type_code"]
            isOneToOne: false
            referencedRelation: "organization_types"
            referencedColumns: ["type_code"]
          },
          {
            foreignKeyName: "product_pricing_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_pricing_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "product_pricing_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_pricing_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "product_pricing_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_pricing_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      v_document_workflow: {
        Row: {
          invoice_no: string | null
          invoice_status: Database["public"]["Enums"]["document_status"] | null
          order_id: string | null
          order_no: string | null
          order_status: Database["public"]["Enums"]["order_status"] | null
          order_type: Database["public"]["Enums"]["order_type"] | null
          payment_no: string | null
          payment_status: Database["public"]["Enums"]["document_status"] | null
          po_no: string | null
          po_status: Database["public"]["Enums"]["document_status"] | null
          receipt_no: string | null
          receipt_status: Database["public"]["Enums"]["document_status"] | null
          warehouse_name: string | null
          warehouse_org_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_warehouse_org_id_fkey"
            columns: ["warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_warehouse_org_id_fkey"
            columns: ["warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "orders_warehouse_org_id_fkey"
            columns: ["warehouse_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      v_hq_inventory: {
        Row: {
          average_cost: number | null
          hq_org_id: string | null
          hq_org_name: string | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          quantity_allocated: number | null
          quantity_available: number | null
          quantity_on_hand: number | null
          total_value: number | null
          variant_code: string | null
          variant_id: string | null
          variant_name: string | null
        }
        Relationships: []
      }
      v_low_stock_alerts: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          id: string | null
          last_counted_at: string | null
          max_stock_level: number | null
          org_name: string | null
          org_type_code: string | null
          organization_id: string | null
          priority: string | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          quantity_allocated: number | null
          quantity_available: number | null
          quantity_on_hand: number | null
          reorder_point: number | null
          reorder_quantity: number | null
          stock_level_percent: number | null
          units_below_reorder: number | null
          updated_at: string | null
          variant_code: string | null
          variant_id: string | null
          variant_name: string | null
          warehouse_location: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_org_type_code_fkey"
            columns: ["org_type_code"]
            isOneToOne: false
            referencedRelation: "organization_types"
            referencedColumns: ["type_code"]
          },
          {
            foreignKeyName: "product_inventory_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_inventory_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "product_inventory_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "product_inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      v_order_engagement_summary: {
        Row: {
          activated_qr_codes: number | null
          claimed_redeem_quantity: number | null
          company_id: string | null
          has_lucky_draw: boolean | null
          has_redeem: boolean | null
          journey_config_id: string | null
          journey_is_active: boolean | null
          journey_name: string | null
          lucky_draw_campaigns_count: number | null
          order_id: string | null
          order_no: string | null
          order_type: Database["public"]["Enums"]["order_type"] | null
          redeem_gifts_count: number | null
          status: Database["public"]["Enums"]["order_status"] | null
          total_qr_codes: number | null
          total_redeem_quantity: number | null
        }
        Relationships: [
          {
            foreignKeyName: "journey_order_links_journey_config_id_fkey"
            columns: ["journey_config_id"]
            isOneToOne: false
            referencedRelation: "journey_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      v_order_summary: {
        Row: {
          approved_at: string | null
          approved_by_name: string | null
          buyer_name: string | null
          created_at: string | null
          created_by_name: string | null
          id: string | null
          item_count: number | null
          order_no: string | null
          order_type: Database["public"]["Enums"]["order_type"] | null
          parent_order_id: string | null
          parent_order_no: string | null
          seller_name: string | null
          status: Database["public"]["Enums"]["order_status"] | null
          total_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      v_org_hierarchy: {
        Row: {
          id: string | null
          level: number | null
          org_code: string | null
          org_name: string | null
          org_type_code: string | null
          parent_org_id: string | null
          path: string[] | null
          path_codes: string | null
          type_name: string | null
        }
        Relationships: []
      }
      v_org_hierarchy_validation: {
        Row: {
          created_at: string | null
          id: string | null
          is_active: boolean | null
          org_code: string | null
          org_name: string | null
          org_type_code: string | null
          org_type_name: string | null
          parent_org_id: string | null
          parent_org_name: string | null
          parent_org_type: string | null
          suggested_fix: string | null
          updated_at: string | null
          validation_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_org_type_code_fkey"
            columns: ["parent_org_type"]
            isOneToOne: false
            referencedRelation: "organization_types"
            referencedColumns: ["type_code"]
          },
          {
            foreignKeyName: "organizations_org_type_code_fkey"
            columns: ["org_type_code"]
            isOneToOne: false
            referencedRelation: "organization_types"
            referencedColumns: ["type_code"]
          },
          {
            foreignKeyName: "organizations_parent_org_id_fkey"
            columns: ["parent_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_parent_org_id_fkey"
            columns: ["parent_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "organizations_parent_org_id_fkey"
            columns: ["parent_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      v_org_hierarchy_with_stock: {
        Row: {
          id: string | null
          is_active: boolean | null
          level: number | null
          low_stock_items: number | null
          org_code: string | null
          org_name: string | null
          org_type_code: string | null
          parent_org_id: string | null
          path: string[] | null
          path_codes: string | null
          total_inventory_value: number | null
          total_units_available: number | null
          total_units_on_hand: number | null
          total_variants_in_stock: number | null
          type_name: string | null
        }
        Relationships: []
      }
      v_parent_order_remaining: {
        Row: {
          allocated_percent: number | null
          allocated_qty: number | null
          parent_order_id: string | null
          parent_order_no: string | null
          parent_qty: number | null
          product_name: string | null
          remaining_qty: number | null
          variant_id: string | null
          variant_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      v_product_catalog: {
        Row: {
          brand_name: string | null
          category_name: string | null
          created_at: string | null
          group_name: string | null
          id: string | null
          image_count: number | null
          is_active: boolean | null
          is_discontinued: boolean | null
          is_vape: boolean | null
          manufacturer_name: string | null
          product_code: string | null
          product_name: string | null
          subgroup_name: string | null
          variant_count: number | null
        }
        Relationships: []
      }
      v_reverse_job_status: {
        Row: {
          batch_id: string | null
          case_number: number | null
          completed_at: string | null
          created_at: string | null
          created_by_email: string | null
          error_message: string | null
          expected_units_per_case: number | null
          failed_items: number | null
          final_unit_count: number | null
          id: string | null
          master_code: string | null
          order_id: string | null
          order_no: string | null
          pending_items: number | null
          product_variant_key: string | null
          replaced_items: number | null
          status: string | null
          total_replacements: number | null
          total_spoiled: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_reverse_jobs_batch"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "qr_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_reverse_jobs_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_reverse_jobs_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_document_workflow"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "fk_reverse_jobs_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_engagement_summary"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "fk_reverse_jobs_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_reverse_jobs_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_parent_order_remaining"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      v_shop_available_products: {
        Row: {
          brand_name: string | null
          category_name: string | null
          credit_limit: number | null
          distributor_carries_product: boolean | null
          distributor_id: string | null
          distributor_name: string | null
          distributor_stock: number | null
          distributor_wholesale_cost: number | null
          is_vape: boolean | null
          lead_time_days: number | null
          payment_terms: string | null
          product_active: boolean | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          shop_distributor_active: boolean | null
          shop_id: string | null
          shop_name: string | null
          territory_coverage: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_distributors_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_distributors_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "shop_distributors_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_distributors_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_distributors_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "shop_distributors_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
        ]
      }
      v_stock_movements_display: {
        Row: {
          created_at: string | null
          created_by: string | null
          from_organization_id: string | null
          id: string | null
          movement_type: string | null
          quantity_after: number | null
          quantity_before: number | null
          quantity_change: number | null
          reason: string | null
          reference_id: string | null
          to_organization_id: string | null
          unit_cost: number | null
          variant_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          from_organization_id?: string | null
          id?: string | null
          movement_type?: string | null
          quantity_after?: number | null
          quantity_before?: number | null
          quantity_change?: number | null
          reason?: string | null
          reference_id?: string | null
          to_organization_id?: string | null
          unit_cost?: number | null
          variant_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          from_organization_id?: string | null
          id?: string | null
          movement_type?: string | null
          quantity_after?: number | null
          quantity_before?: number | null
          quantity_change?: number | null
          reason?: string | null
          reference_id?: string | null
          to_organization_id?: string | null
          unit_cost?: number | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_from_organization_id_fkey"
            columns: ["from_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_from_organization_id_fkey"
            columns: ["from_organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_movements_from_organization_id_fkey"
            columns: ["from_organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_organization_id_fkey"
            columns: ["to_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_organization_id_fkey"
            columns: ["to_organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_movements_to_organization_id_fkey"
            columns: ["to_organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      v_system_statistics: {
        Row: {
          active: number | null
          entity: string | null
          total: number | null
        }
        Relationships: []
      }
      v_user_roles: {
        Row: {
          role_code: string | null
          role_level: number | null
          role_name: string | null
        }
        Insert: {
          role_code?: string | null
          role_level?: number | null
          role_name?: string | null
        }
        Update: {
          role_code?: string | null
          role_level?: number | null
          role_name?: string | null
        }
        Relationships: []
      }
      v_wms_movements_recent: {
        Row: {
          created_at: string | null
          from_org_id: string | null
          movement_type: string | null
          order_id: string | null
          quantity_after: number | null
          quantity_before: number | null
          quantity_change: number | null
          reference_type: string | null
          to_org_id: string | null
          variant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_from_organization_id_fkey"
            columns: ["from_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_from_organization_id_fkey"
            columns: ["from_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_movements_from_organization_id_fkey"
            columns: ["from_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_organization_id_fkey"
            columns: ["to_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_organization_id_fkey"
            columns: ["to_org_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_movements_to_organization_id_fkey"
            columns: ["to_org_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      vw_manual_stock_balance: {
        Row: {
          manual_balance_qty: number | null
          variant_id: string | null
          warehouse_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      vw_stock_movements_ordered: {
        Row: {
          company_id: string | null
          created_at: string | null
          created_by: string | null
          from_organization_id: string | null
          id: string | null
          manufacturer_id: string | null
          movement_type: string | null
          notes: string | null
          quantity_after: number | null
          quantity_before: number | null
          quantity_change: number | null
          reason: string | null
          reference_id: string | null
          reference_no: string | null
          reference_type: string | null
          to_organization_id: string | null
          total_cost: number | null
          unit_cost: number | null
          variant_id: string | null
          warehouse_location: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          from_organization_id?: string | null
          id?: string | null
          manufacturer_id?: string | null
          movement_type?: string | null
          notes?: string | null
          quantity_after?: number | null
          quantity_before?: number | null
          quantity_change?: number | null
          reason?: string | null
          reference_id?: string | null
          reference_no?: string | null
          reference_type?: string | null
          to_organization_id?: string | null
          total_cost?: number | null
          unit_cost?: number | null
          variant_id?: string | null
          warehouse_location?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          from_organization_id?: string | null
          id?: string | null
          manufacturer_id?: string | null
          movement_type?: string | null
          notes?: string | null
          quantity_after?: number | null
          quantity_before?: number | null
          quantity_change?: number | null
          reason?: string | null
          reference_id?: string | null
          reference_no?: string | null
          reference_type?: string | null
          to_organization_id?: string | null
          total_cost?: number | null
          unit_cost?: number | null
          variant_id?: string | null
          warehouse_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_from_organization_id_fkey"
            columns: ["from_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_from_organization_id_fkey"
            columns: ["from_organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_movements_from_organization_id_fkey"
            columns: ["from_organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_movements_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_organization_id_fkey"
            columns: ["to_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_organization_id_fkey"
            columns: ["to_organization_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["hq_org_id"]
          },
          {
            foreignKeyName: "stock_movements_to_organization_id_fkey"
            columns: ["to_organization_id"]
            isOneToOne: false
            referencedRelation: "v_org_hierarchy_validation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "mv_shop_available_products"
            referencedColumns: ["default_variant_id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "v_hq_inventory"
            referencedColumns: ["variant_id"]
          },
        ]
      }
    }
    Functions: {
      _movement_warehouse_id: {
        Args: { p_from: string; p_movement_type: string; p_to: string }
        Returns: string
      }
      _org_depth_ok: { Args: { p_org_id: string }; Returns: boolean }
      add_document_signature: {
        Args: {
          p_document_id: string
          p_signer_role: string
          p_signer_user_id: string
        }
        Returns: {
          created_at: string
          document_id: string
          document_type: string
          id: string
          metadata: Json | null
          signature_hash: string
          signature_image_url: string | null
          signed_at: string
          signer_role: string
          signer_user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "document_signatures"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_inventory_ship_adjustment: {
        Args: {
          p_cases?: number
          p_organization_id: string
          p_shipped_at?: string
          p_units?: number
          p_variant_id: string
        }
        Returns: undefined
      }
      apply_inventory_ship_adjustment_deprecated_56910: {
        Args: {
          p_cases: number
          p_organization_id: string
          p_shipped_at: string
          p_units: number
          p_variant_id: string
        }
        Returns: undefined
      }
      approve_payment_request: {
        Args: { p_request_id: string }
        Returns: string
      }
      archive_old_audit_logs: {
        Args: { days_to_keep?: number }
        Returns: number
      }
      can_access_org: { Args: { p_org_id: string }; Returns: boolean }
      can_consumer_redeem_gift: {
        Args: { p_consumer_phone: string; p_redeem_gift_id: string }
        Returns: Json
      }
      check_order_shipped_to_distributor: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      cleanup_old_audit_logs: { Args: never; Returns: undefined }
      cleanup_old_notifications: {
        Args: { p_retention_days?: number }
        Returns: number
      }
      create_new_user: {
        Args: {
          p_email: string
          p_full_name?: string
          p_organization_id?: string
          p_password: string
          p_phone?: string
          p_role_code?: string
        }
        Returns: Json
      }
      current_user_org_id: { Args: never; Returns: string }
      current_user_role_level: { Args: never; Returns: number }
      delete_all_transactions_with_inventory: { Args: never; Returns: Json }
      delete_all_transactions_with_inventory_v3: { Args: never; Returns: Json }
      detect_order_type: {
        Args: { p_buyer_org_id: string; p_seller_org_id: string }
        Returns: Database["public"]["Enums"]["order_type"]
      }
      ensure_distributor_org: { Args: { p_org_id: string }; Returns: undefined }
      ensure_shop_org: { Args: { p_org_id: string }; Returns: undefined }
      extract_variant_key_from_code: {
        Args: { qr_code: string }
        Returns: string
      }
      fn_calculate_order_total: {
        Args: { p_order_id: string }
        Returns: number
      }
      fn_create_balance_payment_request: {
        Args: { p_order_id: string }
        Returns: string
      }
      fn_create_otp: {
        Args: {
          p_channel: string
          p_email: string
          p_org_id: string
          p_phone: string
          p_purpose: string
          p_subject_ref: string
          p_subject_type: string
          p_ttl_sec?: number
        }
        Returns: string
      }
      fn_get_balance_payment_request: {
        Args: { p_order_id: string }
        Returns: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          company_id: string
          created_at: string | null
          created_by: string
          doc_no: string
          doc_type: Database["public"]["Enums"]["document_type"]
          id: string
          issued_by_org_id: string
          issued_to_org_id: string
          order_id: string
          payload: Json | null
          payment_percentage: number | null
          signed_pdf_url: string | null
          status: Database["public"]["Enums"]["document_status"]
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_test_balance_request_flow: {
        Args: { p_auto_approve?: boolean; p_order_id: string }
        Returns: Json
      }
      fn_verify_otp: {
        Args: { p_challenge_id: string; p_code: string }
        Returns: boolean
      }
      format_doc_no_from_order: {
        Args: { p_order_no: string; p_prefix: string }
        Returns: string
      }
      generate_doc_number: {
        Args: { p_company_id: string; p_order_type: string; p_prefix: string }
        Returns: string
      }
      generate_master_qr_code_string: {
        Args: { p_case_number: number; p_order_no: string }
        Returns: string
      }
      generate_qr_code_string: {
        Args: {
          p_order_no: string
          p_product_code: string
          p_sequence: number
          p_variant_code: string
        }
        Returns: string
      }
      generate_signature_hash: {
        Args: {
          p_document_id: string
          p_signed_at: string
          p_signer_user_id: string
        }
        Returns: string
      }
      generate_transfer_number: { Args: never; Returns: string }
      get_company_id: { Args: { p_org_id: string }; Returns: string }
      get_consumer_scan_stats: {
        Args: { p_order_id: string }
        Returns: {
          anonymous_scans: number
          authenticated_scans: number
          lucky_draw_entries: number
          points_collected_count: number
          redemptions: number
          total_consumer_scans: number
          total_qr_codes: number
          unique_consumer_scans: number
        }[]
      }
      get_current_price: {
        Args: { p_buyer_org_id: string; p_variant_id: string }
        Returns: number
      }
      get_distributor_product_count: {
        Args: { p_distributor_id: string }
        Returns: number
      }
      get_distributor_shop_count: {
        Args: { p_distributor_id: string }
        Returns: number
      }
      get_document_signatures: {
        Args: { p_document_id: string }
        Returns: {
          id: string
          signature_hash: string
          signature_image_url: string
          signed_at: string
          signer_name: string
          signer_role: string
          signer_user_id: string
        }[]
      }
      get_email_count_today: {
        Args: { p_org_id: string; p_provider?: string }
        Returns: number
      }
      get_email_stats: {
        Args: { p_days?: number; p_org_id: string; p_provider?: string }
        Returns: {
          send_date: string
          total_emails: number
          total_failed: number
          total_sent: number
        }[]
      }
      get_hq_aggregated_product_count: {
        Args: { p_hq_id: string }
        Returns: number
      }
      get_manufacturer_product_count: {
        Args: { p_manufacturer_id: string }
        Returns: number
      }
      get_notification_stats: {
        Args: { p_days?: number; p_org_id: string }
        Returns: {
          by_channel: Json
          by_event: Json
          recent_failures: Json
          success_rate: number
          total_failed: number
          total_pending: number
          total_sent: number
        }[]
      }
      get_org_ancestors: {
        Args: { p_org_id: string }
        Returns: {
          level: number
          org_id: string
        }[]
      }
      get_org_children_count: { Args: { p_org_id: string }; Returns: number }
      get_org_descendants: {
        Args: { p_org_id: string }
        Returns: {
          level: number
          org_id: string
        }[]
      }
      get_org_descendants_count: {
        Args: { p_org_id: string }
        Returns: {
          dists_count: number
          mfgs_count: number
          shops_count: number
          total_count: number
          warehouses_count: number
        }[]
      }
      get_org_order_count: { Args: { p_org_id: string }; Returns: number }
      get_org_stats: {
        Args: { p_org_id: string }
        Returns: {
          children_count: number
          distributors_count: number
          orders_count: number
          org_id: string
          org_type_code: string
          products_count: number
          shops_count: number
          users_count: number
        }[]
      }
      get_org_stats_batch: {
        Args: { p_org_ids: string[] }
        Returns: {
          children_count: number
          distributors_count: number
          orders_count: number
          org_id: string
          org_type_code: string
          products_count: number
          shops_count: number
          users_count: number
        }[]
      }
      get_org_type: { Args: { p_org_id: string }; Returns: string }
      get_org_user_count: { Args: { p_org_id: string }; Returns: number }
      get_pending_notifications: {
        Args: { p_limit?: number }
        Returns: {
          channel: string
          event_code: string
          id: string
          org_id: string
          payload_json: Json
          priority: string
          provider_name: string
          retry_count: number
          template_code: string
          to_email: string
          to_phone: string
        }[]
      }
      get_pending_receives_for_warehouse: {
        Args: { p_warehouse_org_id: string }
        Returns: {
          actual_unit_count: number
          batch_id: string
          buyer_org_id: string
          buyer_org_name: string
          case_number: number
          company_id: string
          expected_unit_count: number
          manufacturer_org_id: string
          manufacturer_scanned_at: string
          master_code: string
          master_id: string
          order_id: string
          order_no: string
          seller_org_id: string
          status: string
          warehouse_org_id: string
        }[]
      }
      get_prepared_codes_count: {
        Args: { p_batch_id: string; p_order_id: string }
        Returns: number
      }
      get_public_branding: { Args: never; Returns: Json }
      get_remaining_quantity: {
        Args: { p_parent_order_id: string; p_variant_id: string }
        Returns: number
      }
      get_shop_available_products: {
        Args: { p_search?: string; p_shop_id: string }
        Returns: {
          available_quantity: number
          brand_name: string
          distributor_id: string
          distributor_name: string
          in_stock: boolean
          is_preferred_distributor: boolean
          product_code: string
          product_id: string
          product_name: string
          unit_price: number
          variant_id: string
          variant_name: string
        }[]
      }
      get_shop_distributor_count: {
        Args: { p_shop_id: string }
        Returns: number
      }
      get_storage_url: {
        Args: { bucket_name: string; file_path: string }
        Returns: string
      }
      get_user_by_email: {
        Args: { p_email: string }
        Returns: {
          email: string
          full_name: string
          id: string
          is_active: boolean
          organization_id: string
          role_code: string
        }[]
      }
      get_variants_by_master_code: {
        Args: { p_master_code: string }
        Returns: {
          variant_code: string
          variant_id: string
          variant_name: string
        }[]
      }
      hard_delete_organization: { Args: { p_org_id: string }; Returns: Json }
      has_role_level: { Args: { required_level: number }; Returns: boolean }
      invoice_acknowledge: {
        Args: { p_document_id: string; p_payment_proof_url?: string }
        Returns: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          company_id: string
          created_at: string | null
          created_by: string
          doc_no: string
          doc_type: Database["public"]["Enums"]["document_type"]
          id: string
          issued_by_org_id: string
          issued_to_org_id: string
          order_id: string
          payload: Json | null
          payment_percentage: number | null
          signed_pdf_url: string | null
          status: Database["public"]["Enums"]["document_status"]
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_hq_admin: { Args: never; Returns: boolean }
      is_payment_proof_required: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      is_platform_super_admin: { Args: never; Returns: boolean }
      is_power_user: { Args: never; Returns: boolean }
      is_product_available_for_shop: {
        Args: { p_product_id: string; p_shop_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      log_email_send: {
        Args: {
          p_error_message?: string
          p_metadata?: Json
          p_org_id: string
          p_provider: string
          p_recipient_email: string
          p_status?: string
          p_subject?: string
        }
        Returns: string
      }
      log_notification_attempt: {
        Args: {
          p_error_message?: string
          p_outbox_id: string
          p_provider_message_id?: string
          p_provider_response?: Json
          p_status: string
        }
        Returns: undefined
      }
      log_qr_receive_movement: {
        Args: {
          p_company_id: string
          p_created_by: string
          p_reason?: string
          p_reference_id: string
          p_reference_no: string
          p_unit_cost: number
          p_units: number
          p_variant_id: string
          p_warehouse_org_id: string
        }
        Returns: string
      }
      log_qr_shipment_movement: {
        Args: {
          p_company_id: string
          p_created_by: string
          p_reason?: string
          p_reference_id: string
          p_reference_no: string
          p_unit_cost: number
          p_units: number
          p_variant_id: string
          p_warehouse_org_id: string
        }
        Returns: string
      }
      orders_approve: {
        Args: { p_order_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          buyer_org_id: string
          company_id: string
          created_at: string | null
          created_by: string
          has_lucky_draw: boolean | null
          has_points: boolean | null
          has_redeem: boolean | null
          has_rfid: boolean | null
          id: string
          notes: string | null
          order_no: string
          order_type: Database["public"]["Enums"]["order_type"]
          parent_order_id: string | null
          payment_terms: Json
          qr_buffer_percent: number | null
          seller_org_id: string
          status: Database["public"]["Enums"]["order_status"]
          units_per_case: number | null
          updated_at: string | null
          updated_by: string | null
          warehouse_org_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      orders_submit: {
        Args: { p_order_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          buyer_org_id: string
          company_id: string
          created_at: string | null
          created_by: string
          has_lucky_draw: boolean | null
          has_points: boolean | null
          has_redeem: boolean | null
          has_rfid: boolean | null
          id: string
          notes: string | null
          order_no: string
          order_type: Database["public"]["Enums"]["order_type"]
          parent_order_id: string | null
          payment_terms: Json
          qr_buffer_percent: number | null
          seller_org_id: string
          status: Database["public"]["Enums"]["order_status"]
          units_per_case: number | null
          updated_at: string | null
          updated_by: string | null
          warehouse_org_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payment_acknowledge: {
        Args: { p_document_id: string }
        Returns: undefined
      }
      po_acknowledge: {
        Args: { p_document_id: string }
        Returns: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          company_id: string
          created_at: string | null
          created_by: string
          doc_no: string
          doc_type: Database["public"]["Enums"]["document_type"]
          id: string
          issued_by_org_id: string
          issued_to_org_id: string
          order_id: string
          payload: Json | null
          payment_percentage: number | null
          signed_pdf_url: string | null
          status: Database["public"]["Enums"]["document_status"]
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      propagate_warehouse_to_master_codes: {
        Args: { p_batch_id: string }
        Returns: {
          cases_updated: number
          warehouse_org_id: string
        }[]
      }
      queue_notification: {
        Args: {
          p_channel: string
          p_event_code: string
          p_org_id: string
          p_payload?: Json
          p_priority?: string
          p_recipient_email?: string
          p_recipient_phone?: string
          p_scheduled_for?: string
          p_template_code?: string
        }
        Returns: string
      }
      record_stock_movement: {
        Args: {
          p_company_id?: string
          p_created_by?: string
          p_manufacturer_id?: string
          p_movement_type: string
          p_notes?: string
          p_organization_id: string
          p_quantity_change: number
          p_reason?: string
          p_reference_id?: string
          p_reference_no?: string
          p_reference_type?: string
          p_unit_cost?: number
          p_variant_id: string
          p_warehouse_location?: string
        }
        Returns: string
      }
      refresh_all_materialized_views: { Args: never; Returns: undefined }
      refresh_product_catalog: { Args: never; Returns: undefined }
      refresh_shop_products: { Args: never; Returns: undefined }
      render_template: {
        Args: { p_org_id: string; p_payload: Json; p_template_code: string }
        Returns: string
      }
      search_products: {
        Args: { search_query: string }
        Returns: {
          brand_name: string
          category_name: string
          is_active: boolean
          product_code: string
          product_id: string
          product_name: string
          relevance: number
        }[]
      }
      set_skip_ship_trigger: { Args: { p_skip?: boolean }; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sync_user_profile: {
        Args: {
          p_email: string
          p_full_name?: string
          p_organization_id?: string
          p_phone?: string
          p_role_code?: string
          p_user_id: string
        }
        Returns: Json
      }
      update_last_login: { Args: { user_id: string }; Returns: undefined }
      update_master_status_skip_trigger: {
        Args: {
          p_master_ids: string[]
          p_shipped_at?: string
          p_user_id: string
        }
        Returns: {
          id: string
          master_code: string
          status: string
        }[]
      }
      validate_child_items: {
        Args: { p_order_id: string; p_parent_order_id: string }
        Returns: boolean
      }
      validate_child_quantities: {
        Args: { p_order_id: string; p_parent_order_id: string }
        Returns: boolean
      }
      wms_deduct_and_summarize: {
        Args: {
          p_from_org_id: string
          p_order_id: string
          p_shipped_at?: string
          p_to_org_id: string
          p_units: number
          p_variant_id: string
        }
        Returns: Json
      }
      wms_from_master: { Args: { p_master_code_id: string }; Returns: Json }
      wms_from_mixed: {
        Args: {
          p_from_org_id: string
          p_master_code_id: string
          p_order_id: string
          p_qr_code_ids: string[]
          p_shipped_at?: string
          p_to_org_id: string
        }
        Returns: Json
      }
      wms_from_unique_codes: {
        Args: {
          p_from_org_id: string
          p_order_id: string
          p_qr_code_ids: string[]
          p_shipped_at?: string
          p_to_org_id: string
        }
        Returns: Json
      }
      wms_record_movement_from_summary: {
        Args: { p_summary: Json }
        Returns: string
      }
      wms_record_movements_from_items: {
        Args: { p_items: Json }
        Returns: Json
      }
      wms_resolve_ship_to: {
        Args: {
          p_buyer_org_id: string
          p_buyer_org_type: string
          p_case_warehouse_org_id: string
          p_order_type: Database["public"]["Enums"]["order_type"]
          p_order_warehouse_org_id: string
          p_shipped_to_distributor_id: string
        }
        Returns: string
      }
      wms_reverse_manual_movement: {
        Args: {
          p_movement_id: string
          p_override_user?: string
          p_reversal_reason?: string
        }
        Returns: Json
      }
      wms_ship_manual: {
        Args: {
          p_company_id: string
          p_distributor_id: string
          p_notes?: string
          p_qty: number
          p_reference_no?: string
          p_user_id: string
          p_variant_id: string
          p_warehouse_id: string
        }
        Returns: {
          movement_id: string
          quantity_after: number
          quantity_before: number
        }[]
      }
      wms_ship_master_auto: {
        Args: { p_master_code_id: string }
        Returns: Json
      }
      wms_ship_mixed: {
        Args: {
          p_company_id: string
          p_distributor_id: string
          p_manual_qty?: number
          p_notes?: string
          p_qr_codes?: Json
          p_reference_no?: string
          p_user_id?: string
          p_variant_id: string
          p_warehouse_id: string
        }
        Returns: Json
      }
      wms_ship_unique_auto: {
        Args: {
          p_from_org_id: string
          p_order_id: string
          p_qr_code_ids: string[]
          p_shipped_at?: string
          p_to_org_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      document_status: "pending" | "acknowledged" | "completed"
      document_type:
        | "PO"
        | "INVOICE"
        | "PAYMENT"
        | "RECEIPT"
        | "PAYMENT_REQUEST"
      order_status: "draft" | "submitted" | "approved" | "closed"
      order_type: "H2M" | "D2H" | "S2D"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      document_status: ["pending", "acknowledged", "completed"],
      document_type: ["PO", "INVOICE", "PAYMENT", "RECEIPT", "PAYMENT_REQUEST"],
      order_status: ["draft", "submitted", "approved", "closed"],
      order_type: ["H2M", "D2H", "S2D"],
    },
  },
} as const
