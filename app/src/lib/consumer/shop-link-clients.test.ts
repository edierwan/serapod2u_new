import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = resolve(process.cwd(), 'src')
const read = (file: string) => readFileSync(resolve(src, file), 'utf8')

/** Extracts the JSON bodies posted to /api/user/update-profile in a client. */
function updateProfileCalls(source: string): string[] {
    const calls: string[] = []
    let index = source.indexOf("'/api/user/update-profile'")
    while (index >= 0) {
        calls.push(source.slice(index, index + 700))
        index = source.indexOf("'/api/user/update-profile'", index + 1)
    }
    return calls
}

describe('consumer clients: shop affiliation goes through /api/consumer/link-shop', () => {
    it('Premium Loyalty links the shop via the dedicated endpoint and strips organization_id from profile saves', () => {
        const source = read('components/journey/templates/PremiumLoyaltyTemplate.tsx')
        expect(source).toContain("fetch('/api/consumer/link-shop'")
        expect(source).toContain('const { organization_id: _linkedOrganizationId, ...profileFields } = updateData')
        const calls = updateProfileCalls(source)
        expect(calls.length).toBe(1)
        expect(calls[0]).toContain('...profileFields')
        expect(calls[0]).not.toContain('...updateData')
        expect(calls[0]).not.toContain('confirmShopSwitch')
    })

    it.each([
        'modules/roadtour/components/RoadtourScanPage.tsx',
        'app/store/account/StoreAccountClient.tsx',
    ])('%s never sends organization or authority fields to update-profile', (file) => {
        for (const call of updateProfileCalls(read(file))) {
            expect(call).not.toMatch(/organization_id|role_code|account_scope|confirmShopSwitch/)
        }
    })

    it('storefront /store/account sends only changed fields, so an untouched shop name never blocks profile edits', () => {
        const source = read('app/store/account/StoreAccountClient.tsx')
        const [call] = updateProfileCalls(source)
        expect(call).toContain('body: JSON.stringify(changes)')
        expect(source).toContain("if (shopName.trim() !== (profile.shop_name || '')) changes.shop_name")
    })
})
