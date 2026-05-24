// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RoadtourSettingsView } from './RoadtourSettingsView'

const toastMock = vi.fn()

let mockSupabase: any
let lastUpdatePayload: any = null
let lastInsertPayload: any = null

vi.mock('@/lib/supabase/client', () => ({
    createClient: () => mockSupabase,
}))

vi.mock('@/components/ui/use-toast', () => ({
    toast: (payload: any) => toastMock(payload),
}))

const defaultSettingsRow = {
    id: 'settings-1',
    org_id: 'org-1',
    is_enabled: true,
    default_points: 20,
    reward_mode: 'survey_submit',
    survey_template_id: null,
    qr_expiry_hours: null,
    point_value_rm_snapshot: 0.10,
    claim_whatsapp_enabled: true,
    claim_whatsapp_recipient_mode: 'manual',
    claim_whatsapp_manual_numbers: ['0192277233', '0147519216'],
    claim_whatsapp_success_template: 'Success template body',
    claim_whatsapp_failure_template: 'Failure template body',
}

const userProfile = {
    id: 'user-1',
    organizations: {
        id: 'org-1',
    },
}

function createSupabaseMock({
    roadtourSettings = defaultSettingsRow,
    orgSettings = { point_value_rm: 0.10 },
}: {
    roadtourSettings?: any
    orgSettings?: Record<string, unknown>
} = {}) {
    lastUpdatePayload = null
    lastInsertPayload = null

    return {
        from(table: string) {
            if (table === 'organizations') {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    async single() {
                                        return { data: { settings: orgSettings }, error: null }
                                    },
                                }
                            },
                        }
                    },
                }
            }

            if (table === 'roadtour_settings') {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    async maybeSingle() {
                                        return { data: roadtourSettings, error: null }
                                    },
                                }
                            },
                        }
                    },
                    update(payload: any) {
                        lastUpdatePayload = payload
                        return {
                            async eq() {
                                return { error: null }
                            },
                        }
                    },
                    insert(payload: any) {
                        lastInsertPayload = payload
                        return {
                            select() {
                                return {
                                    async single() {
                                        return { data: { id: 'settings-new' }, error: null }
                                    },
                                }
                            },
                        }
                    },
                }
            }

            throw new Error(`Unexpected table: ${table}`)
        },
    }
}

function renderView() {
    return render(<RoadtourSettingsView userProfile={userProfile} />)
}

describe('RoadtourSettingsView', () => {
    beforeEach(() => {
        mockSupabase = createSupabaseMock()
        toastMock.mockReset()

        window.history.replaceState({}, '', '/customer-growth/roadtour/settings')

        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input)

            if (url.includes('/api/roadtour/settings-status')) {
                return {
                    ok: true,
                    json: async () => ({ whatsapp: { status: 'ready' } }),
                }
            }

            if (url.includes('/api/roadtour/test-claim-alert')) {
                return {
                    ok: true,
                    json: async () => ({ success: true, body: init?.body ? JSON.parse(String(init.body)) : null }),
                }
            }

            throw new Error(`Unexpected fetch: ${url}`)
        }) as any)
    })

    afterEach(() => {
        cleanup()
        vi.unstubAllGlobals()
    })

    it('renders System Status by default and switches back and forth between tabs', async () => {
        const user = userEvent.setup()

        renderView()

        await screen.findByText('Enable RoadTour Program')
        expect(screen.getByRole('tab', { name: 'System Status' }).getAttribute('data-state')).toBe('active')
        expect(screen.queryByText('Manual Recipient Numbers')).toBeNull()

        await user.click(screen.getByRole('tab', { name: 'Claim WhatsApp Alerts' }))

        await screen.findByText('Enable Claim Alerts')
        expect(screen.getByRole('tab', { name: 'Claim WhatsApp Alerts' }).getAttribute('data-state')).toBe('active')
        expect(screen.queryByText('Enable RoadTour Program')).toBeNull()

        await user.click(screen.getByRole('tab', { name: 'System Status' }))

        await screen.findByText('Enable RoadTour Program')
        expect(screen.getByText('Duplicate Protection now lives on the RoadTour Event.')).toBeTruthy()
    })

    it('preserves claim alert form state while switching tabs', async () => {
        const user = userEvent.setup()

        renderView()
        await user.click(await screen.findByRole('tab', { name: 'Claim WhatsApp Alerts' }))

        const claimToggle = await screen.findByRole('switch', { name: 'Enable Claim Alerts' })
        await user.click(claimToggle)

        const manualNumbers = screen.getByLabelText('Manual Recipient Numbers') as HTMLTextAreaElement
        const successTemplate = screen.getByLabelText('Success Template') as HTMLTextAreaElement
        const failureTemplate = screen.getByLabelText('Failure Template') as HTMLTextAreaElement

        await user.clear(manualNumbers)
        await user.type(manualNumbers, '0123000000\n0134000000')
        await user.clear(successTemplate)
        await user.type(successTemplate, 'Updated success template')
        await user.clear(failureTemplate)
        await user.type(failureTemplate, 'Updated failure template')

        await user.click(screen.getByRole('tab', { name: 'System Status' }))
        await screen.findByText('Enable RoadTour Program')

        await user.click(screen.getByRole('tab', { name: 'Claim WhatsApp Alerts' }))

        expect((await screen.findByRole('switch', { name: 'Enable Claim Alerts' })).getAttribute('aria-checked')).toBe('false')
        expect((screen.getByLabelText('Manual Recipient Numbers') as HTMLTextAreaElement).value).toBe('0123000000\n0134000000')
        expect((screen.getByLabelText('Success Template') as HTMLTextAreaElement).value).toBe('Updated success template')
        expect((screen.getByLabelText('Failure Template') as HTMLTextAreaElement).value).toBe('Updated failure template')
    })

    it('keeps test buttons available and saves the same settings payload shape', async () => {
        const user = userEvent.setup()

        renderView()
        await user.click(await screen.findByRole('tab', { name: 'Claim WhatsApp Alerts' }))

        await user.click(await screen.findByRole('button', { name: 'Test Success' }))

        await waitFor(() => {
            const testCall = (fetch as any).mock.calls.find((call: any[]) => String(call[0]).includes('/api/roadtour/test-claim-alert'))
            expect(testCall).toBeTruthy()
            expect(JSON.parse(String(testCall[1].body)).status).toBe('success')
        })

        const manualNumbers = screen.getByLabelText('Manual Recipient Numbers') as HTMLTextAreaElement
        await user.clear(manualNumbers)
        await user.type(manualNumbers, '0191111111\n0192222222')
        await user.click(screen.getByRole('button', { name: 'Save RoadTour Settings' }))

        await waitFor(() => {
            expect(lastUpdatePayload).toBeTruthy()
            expect(lastUpdatePayload.claim_whatsapp_manual_numbers).toEqual(['0191111111', '0192222222'])
            expect(lastUpdatePayload.claim_whatsapp_enabled).toBe(true)
        })
    })

    it('does not crash when the settings row is missing', async () => {
        mockSupabase = createSupabaseMock({ roadtourSettings: null, orgSettings: {} })

        renderView()

        await screen.findByText('Enable RoadTour Program')
        await screen.findByRole('tab', { name: 'System Status' })
        expect(screen.getByText('RoadTour Settings')).toBeTruthy()
        expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' }))
    })
})