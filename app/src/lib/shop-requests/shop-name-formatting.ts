const SPECIAL_TOKEN_MAP: Record<string, string> = {
    's.box': 'S.Box',
    's.boxx': 'S.Boxx',
    '7-eleven': '7-Eleven',
    'abc': 'ABC',
    'kk': 'KK',
    'u': 'U',
    'mr': 'MR',
    'diy': 'DIY',
    'mydin': 'Mydin',
}

function formatPlainWord(token: string) {
    if (!token) return token
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
}

function formatShopNameToken(token: string) {
    const special = SPECIAL_TOKEN_MAP[token.toLowerCase()]
    if (special) return special

    if (/^[A-Z]{1,2}$/.test(token)) return token
    if (/^[A-Z]{3,4}$/.test(token) && SPECIAL_TOKEN_MAP[token.toLowerCase()]) return token
    if (/^[A-Za-z]+$/.test(token)) return formatPlainWord(token)
    if (/^\d+$/.test(token)) return token

    return token
}

export function formatShopNameTitleCase(input: string): string {
    return String(input || '')
        .split(/(\s+)/)
        .map((part) => (/^\s+$/.test(part) ? part : formatShopNameToken(part)))
        .join('')
}

export function normalizeShopNameForSubmit(input: string): string {
    const normalized = String(input || '').trim().replace(/\s+/g, ' ')
    return formatShopNameTitleCase(normalized)
}