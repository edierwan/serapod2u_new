export interface Organization {
  id: string
  org_name: string
  org_code: string
  org_type_code: string
  parent_org_id: string | null
  contact_name: string | null
  contact_title: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  address_line2: string | null
  city: string | null
  state_id: string | null
  district_id: string | null
  postal_code: string | null
  country_code: string | null
  website: string | null
  logo_url: string | null
  latitude: number | null
  longitude: number | null
  default_warehouse_org_id: string | null
  settings?: Record<string, any> | null
  company_id?: string | null
  state?: string | null
  warranty_bonus?: number | null
}

export type OrganizationFormData = Partial<Organization>
