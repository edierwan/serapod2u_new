import type { ReturnMeta, ReturnSettings } from './types'

export const DEFAULT_RETURN_SETTINGS: ReturnSettings = {
    default_return_warehouse_id: null,
    sla_submitted_to_received_days: 3,
    sla_received_to_processing_days: 2,
    sla_processing_to_completed_days: 5,
    pdf_instruction_text: null,
    shop_self_service_enabled: true,
}

export const EMPTY_RETURN_META: ReturnMeta = {
    isManager: false,
    userOrgId: null,
    orgTypeCode: null,
    shops: [],
    warehouses: [],
    reasons: [],
    conditions: [],
    categories: [],
    settings: DEFAULT_RETURN_SETTINGS,
}

/** Convert an untrusted API payload into the stable ReturnMeta client contract. */
export function normalizeReturnMeta(value: unknown): ReturnMeta {
    const response = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const settings = response.settings && typeof response.settings === 'object'
        ? { ...DEFAULT_RETURN_SETTINGS, ...response.settings as Partial<ReturnSettings> }
        : DEFAULT_RETURN_SETTINGS

    return {
        ...EMPTY_RETURN_META,
        ...response,
        isManager: response.isManager === true,
        userOrgId: typeof response.userOrgId === 'string' ? response.userOrgId : null,
        orgTypeCode: typeof response.orgTypeCode === 'string' ? response.orgTypeCode : null,
        shops: Array.isArray(response.shops) ? response.shops : [],
        warehouses: Array.isArray(response.warehouses) ? response.warehouses : [],
        reasons: Array.isArray(response.reasons) ? response.reasons : [],
        conditions: Array.isArray(response.conditions) ? response.conditions : [],
        categories: Array.isArray(response.categories) ? response.categories : [],
        settings,
    } as ReturnMeta
}

export function getCategorySelectorState(
    meta: ReturnMeta,
    loading: boolean,
    autoResolved: boolean,
): { categories: ReturnMeta['categories']; disabled: boolean; placeholder: string; showManual: boolean; empty: boolean } {
    const categories = Array.isArray(meta.categories) ? meta.categories : []
    return {
        categories,
        disabled: loading || categories.length === 0,
        placeholder: loading ? 'Loading categories...' : 'Select category',
        showManual: !autoResolved,
        empty: !loading && categories.length === 0,
    }
}
