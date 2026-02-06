export interface HrPosition {
    id: string
    organization_id: string
    code: string
    name: string
    level: number | null
    category: string | null
    is_active: boolean
    created_at: string
    updated_at: string
    user_count?: number
}

export interface HrPositionPayload {
    code: string
    name: string
    level?: number | null
    category?: string | null
}

export interface HrPositionUpdatePayload {
    name?: string
    level?: number | null
    category?: string | null
    is_active?: boolean
}

export interface HrUserUpdatePayload {
    department_id?: string | null
    position_id?: string | null
    manager_user_id?: string | null
    employment_type?: string | null
    join_date?: string | null
    employment_status?: string | null
}

const parseJson = async <T>(response: Response): Promise<T> => {
    const data = await response.json()
    return data as T
}

export const fetchHrPositions = async (includeDisabled = false) => {
    const response = await fetch(`/api/hr/positions?include_disabled=${includeDisabled ? '1' : '0'}`)
    const data = await parseJson<{ success: boolean; data?: HrPosition[]; error?: string }>(response)
    if (!response.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to load positions' }
    }
    return { success: true, data: data.data || [] }
}

export const createHrPosition = async (payload: HrPositionPayload) => {
    const response = await fetch('/api/hr/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    const data = await parseJson<{ success: boolean; data?: HrPosition; error?: string }>(response)
    if (!response.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to create position' }
    }
    return { success: true, data: data.data as HrPosition }
}

export const updateHrPosition = async (id: string, payload: HrPositionUpdatePayload) => {
    const response = await fetch(`/api/hr/positions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    const data = await parseJson<{ success: boolean; data?: HrPosition; error?: string }>(response)
    if (!response.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to update position' }
    }
    return { success: true, data: data.data as HrPosition }
}

export const seedHrPositions = async (templateKey: string) => {
    const response = await fetch('/api/hr/positions/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: templateKey })
    })
    const data = await parseJson<{ success: boolean; data?: { inserted: number; updated: number }; error?: string }>(response)
    if (!response.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to seed positions' }
    }
    return { success: true, data: data.data }
}

export const deleteHrPosition = async (id: string) => {
    const response = await fetch(`/api/hr/positions/${id}`, {
        method: 'DELETE'
    })
    const data = await parseJson<{ success: boolean; error?: string }>(response)
    if (!response.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to delete position' }
    }
    return { success: true }
}

export const updateUserHr = async (userId: string, payload: HrUserUpdatePayload) => {
    const response = await fetch(`/api/users/${userId}/hr`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    const data = await parseJson<{ success: boolean; data?: { id: string }; error?: string }>(response)
    if (!response.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to update user' }
    }
    return { success: true, data: data.data }
}
