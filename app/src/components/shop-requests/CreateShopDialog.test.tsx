// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateShopDialog } from './CreateShopDialog'

describe('CreateShopDialog', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input)

            if (url.includes('/api/shops/locations')) {
                return {
                    ok: true,
                    json: async () => ({ success: true, states: [], districts: [] }),
                }
            }

            if (url.includes('/api/shops/contact-verification/request-code')) {
                return {
                    ok: true,
                    json: async () => ({
                        success: true,
                        resendCooldown: 60,
                        contactPhone: '+60123456789',
                        shopRequest: {
                            shopName: 'Kedai Baru',
                            branch: null,
                            state: null,
                            contactName: 'Ali',
                            contactPhone: '+60123456789',
                            contactEmail: null,
                            address: null,
                            hotFlavourBrands: null,
                            sellsSerapodFlavour: false,
                            sellsSbox: false,
                            sellsSboxSpecialEdition: false,
                            notes: null,
                        },
                    }),
                }
            }

            if (url.includes('/api/shops/contact-verification/verify-code')) {
                return {
                    ok: true,
                    json: async () => ({
                        success: true,
                        verificationToken: 'shop-token-1',
                    }),
                }
            }

            if (url.includes('/api/shops/contact-verification/create')) {
                return {
                    ok: true,
                    json: async () => ({
                        success: true,
                        organization: {
                            id: 'shop-1',
                            org_name: 'Kedai Baru',
                            branch: null,
                        },
                    }),
                }
            }

            throw new Error(`Unexpected fetch: ${url}`)
        }) as any)
    })

    afterEach(() => {
        cleanup()
        vi.unstubAllGlobals()
    })

    it('shows a Malaysia mobile validation error for landline-style contact numbers', async () => {
        const user = userEvent.setup()

        render(
            <CreateShopDialog
                open
                onOpenChange={() => {}}
                mode="prepare-registration"
                verificationOrgId="org-1"
            />,
        )

        const contactPhoneInput = await screen.findByPlaceholderText('e.g. 0123456789')
        await user.type(contactPhoneInput, '03-1234 5678')
        await user.tab()

        expect(screen.getByText('Please enter a valid Malaysia mobile number.')).toBeTruthy()
    })

    it('formats the shop name on space and blur', async () => {
        const user = userEvent.setup()

        render(
            <CreateShopDialog
                open
                onOpenChange={() => {}}
                mode="prepare-registration"
                verificationOrgId="org-1"
            />,
        )

        const shopNameInput = await screen.findByPlaceholderText('e.g. ABC Vape Shop') as HTMLInputElement

        await user.type(shopNameInput, 'test new shop ')
        expect(shopNameInput.value).toBe('Test New Shop ')

        await user.clear(shopNameInput)
        await user.type(shopNameInput, 'kedai maju jaya')
        await user.tab()
        expect(shopNameInput.value).toBe('Kedai Maju Jaya')
    })

    it('requests OTP, verifies the code, and returns the created organization', async () => {
        const user = userEvent.setup()
        const onCreated = vi.fn()

        render(
            <CreateShopDialog
                open
                onOpenChange={() => {}}
                mode="prepare-registration"
                verificationOrgId="org-1"
                onCreated={onCreated}
            />,
        )

        await user.type(await screen.findByPlaceholderText('e.g. ABC Vape Shop'), 'Kedai Baru')
        await user.type(screen.getByPlaceholderText('Person in charge'), 'Ali')
        await user.type(screen.getByPlaceholderText('e.g. 0123456789'), '0123456789')
        const addressInput = screen.getByPlaceholderText('Shop address') as HTMLTextAreaElement
        await user.type(addressInput, 'jalan dato onn, taman bukit indah')
        await user.tab()

        expect(addressInput.value).toBe('Jalan Dato Onn, Taman Bukit Indah')

        await user.click(screen.getByRole('button', { name: 'Continue' }))

        await waitFor(() => {
            const requestCodeCall = (fetch as any).mock.calls.find((call: any[]) => String(call[0]).includes('/api/shops/contact-verification/request-code'))
            const requestBody = JSON.parse(requestCodeCall[1].body)
            expect(requestBody.shopName).toBe('Kedai Baru')
            expect(requestBody.address).toBe('Jalan Dato Onn, Taman Bukit Indah')
        })

        await waitFor(() => {
            expect(screen.getByText(/Verify shop contact mobile number/i)).toBeTruthy()
        })

        await user.type(screen.getByPlaceholderText('1234'), '1234')
        await user.click(screen.getByRole('button', { name: 'Verify & Create Shop' }))

        await waitFor(() => {
            expect(onCreated).toHaveBeenCalledWith({
                id: 'shop-1',
                org_name: 'Kedai Baru',
                branch: null,
            })
        })

        const createCall = (fetch as any).mock.calls.find((call: any[]) => String(call[0]).includes('/api/shops/contact-verification/create'))
        expect(JSON.parse(createCall[1].body)).toEqual({ verificationToken: 'shop-token-1' })
    })
})