import type { ReturnStatus } from './constants'

export interface ReturnCaseItem {
    id: string
    return_case_id: string
    product_id: string | null
    variant_id: string | null
    sku: string | null
    product_name: string | null
    variant_name: string | null
    quantity: number
    unit_cost: number
    reason: string | null
    condition: string | null
    photo_url: string | null
    notes: string | null
    created_at?: string
}

export interface ReturnStatusHistoryEntry {
    id: string
    return_case_id: string
    from_status: string | null
    to_status: string
    changed_by: string | null
    changed_by_name?: string | null
    changed_at: string
    notes: string | null
}

export interface OrgRef {
    id: string
    org_code: string | null
    org_name: string | null
    contact_name?: string | null
    contact_phone?: string | null
    contact_email?: string | null
    address?: string | null
    city?: string | null
    postal_code?: string | null
}

export interface ReturnCase {
    id: string
    return_no: string
    shop_org_id: string
    return_warehouse_id: string | null
    contact_person: string | null
    contact_phone: string | null
    contact_email: string | null
    status: ReturnStatus
    notes: string | null
    received_by: string | null
    received_date: string | null
    processing_notes: string | null
    action_taken: string | null
    return_courier: string | null
    tracking_no: string | null
    completed_date: string | null
    created_by: string | null
    created_by_name?: string | null
    created_at: string
    updated_at: string
    submitted_at: string | null
    received_at: string | null
    processing_started_at: string | null
    completed_at: string | null
    cancelled_at: string | null
    // joined
    shop?: OrgRef | null
    warehouse?: OrgRef | null
    items?: ReturnCaseItem[]
    status_history?: ReturnStatusHistoryEntry[]
    // computed convenience fields (list/reporting)
    total_qty?: number
    total_value?: number
    days_open?: number
    is_overdue?: boolean
}

export interface ReturnSettings {
    default_return_warehouse_id: string | null
    sla_submitted_to_received_days: number
    sla_received_to_processing_days: number
    sla_processing_to_completed_days: number
    pdf_instruction_text: string | null
    shop_self_service_enabled: boolean
}

export interface ReturnMasterItem {
    id: string
    code: string
    label: string
    sort_order: number
    is_active: boolean
}

export interface ReturnMeta {
    isManager: boolean
    userOrgId: string | null
    shops: OrgRef[]
    warehouses: OrgRef[]
    reasons: ReturnMasterItem[]
    conditions: ReturnMasterItem[]
    settings: ReturnSettings
}
