/**
 * Minimal in-memory Supabase admin client for shop-creation tests.
 * Supports only the query-builder calls used by the shop creation paths.
 */
type Row = Record<string, any>

function likeToRegExp(pattern: string) {
    let source = ''
    for (let index = 0; index < pattern.length; index += 1) {
        const char = pattern[index]
        if (char === '\\' && index + 1 < pattern.length) {
            index += 1
            source += pattern[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        } else if (char === '%') {
            source += '.*'
        } else if (char === '_') {
            source += '.'
        } else {
            source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        }
    }
    return new RegExp(`^${source}$`, 'is')
}

export function createFakeAdminClient(tables: Record<string, Row[]>) {
    const inserts: Record<string, Row[]> = {}
    const updates: Array<{ table: string; values: Row; filters: Array<(row: Row) => boolean> }> = []
    let idCounter = 0

    function builder(table: string) {
        const filters: Array<(row: Row) => boolean> = []
        let mode: 'select' | 'insert' | 'update' = 'select'
        let payload: Row | null = null
        let limitCount: number | null = null

        const rows = () => (tables[table] ||= [])
        const matched = () => {
            const result = rows().filter((row) => filters.every((filter) => filter(row)))
            return limitCount === null ? result : result.slice(0, limitCount)
        }
        const execute = () => {
            if (mode === 'insert') {
                const row = { id: `new-${table}-${++idCounter}`, ...payload }
                rows().push(row)
                ;(inserts[table] ||= []).push(row)
                return { data: [row], error: null }
            }
            if (mode === 'update') {
                const target = matched()
                updates.push({ table, values: payload || {}, filters: [...filters] })
                target.forEach((row) => Object.assign(row, payload))
                return { data: target, error: null }
            }
            return { data: matched(), error: null }
        }

        const api: any = {
            select: () => api,
            insert: (values: Row) => { mode = 'insert'; payload = values; return api },
            update: (values: Row) => { mode = 'update'; payload = values; return api },
            eq: (column: string, value: any) => { filters.push((row) => row[column] === value); return api },
            is: (column: string, value: any) => { filters.push((row) => (row[column] ?? null) === value); return api },
            in: (column: string, values: any[]) => { filters.push((row) => values.includes(row[column])); return api },
            ilike: (column: string, pattern: string) => {
                const regex = likeToRegExp(pattern)
                filters.push((row) => typeof row[column] === 'string' && regex.test(row[column]))
                return api
            },
            gt: (column: string, value: any) => { filters.push((row) => row[column] > value); return api },
            order: () => api,
            limit: (count: number) => { limitCount = count; return api },
            single: async () => {
                const { data } = execute()
                return data[0] ? { data: data[0], error: null } : { data: null, error: { message: 'not found' } }
            },
            maybeSingle: async () => ({ data: execute().data[0] ?? null, error: null }),
            then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject),
        }
        return api
    }

    return {
        client: { from: (table: string) => builder(table) } as any,
        inserts,
        updates,
    }
}

export const VAPORWORLD_EXISTING = {
    id: 'org-vaporworld',
    org_name: 'Vaporworld Kepala Batas',
    org_type_code: 'SHOP',
    is_active: true,
    branch: null,
    address: '752 Jalan Perak 13200 Kepala Batas Pulau Pinang',
    contact_phone: '+60103659818',
    contact_email: 'tankeewei07@gmail.com',
    states: { state_name: 'Pulau Pinang' },
}

export const DIST_ROW = {
    id: 'dist-1',
    org_code: 'DH04',
    org_type_code: 'DIST',
    is_active: true,
}

export function street24Outlet(id: string, suffix: string, address: string) {
    return {
        id,
        org_name: `24 Street Vaperz ${suffix}`,
        org_type_code: 'SHOP',
        is_active: true,
        branch: null,
        address,
        contact_phone: '+60123456789',
        contact_email: 'hq@24streetvaperz.com',
        states: { state_name: 'Selangor' },
    }
}
