'use client'

import { useEffect, useState } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { toTitleCaseAddress, toTitleCaseWords, validateMalaysianMobileNumber } from '@/lib/utils'
import type { ShopRequestFormInput } from '@/lib/shop-requests/core'
import { formatShopNameTitleCase, normalizeShopNameForSubmit } from '@/lib/shop-requests/shop-name-formatting'
import { formatPhoneDisplay } from '@/utils/phone'
import { Store, MapPin, AlertTriangle } from 'lucide-react'

interface CreateShopDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    defaultShopName?: string
    onCreated?: (org: { id: string; org_name: string; branch?: string | null }) => void
    /** Called when the user picks an existing shop from a duplicate match. Falls back to onCreated. */
    onSelectExisting?: (org: { id: string; org_name: string; branch?: string | null }) => void
    onPrepared?: (shopRequest: ShopRequestFormInput) => void
    linkUser?: boolean
    mode?: 'create' | 'prepare-registration'
    verificationOrgId?: string | null
}

interface DuplicateShop {
    org_id: string
    org_name: string
    branch: string | null
    state_name: string | null
    address?: string | null
    contact_phone?: string | null
    contact_email?: string | null
    match_reasons?: string[]
}

// blocked = same physical outlet (no create option); outlet = shared phone/email/address,
// needs explicit "different outlet / branch"; similar = name-only suggestion.
type DuplicateKind = 'blocked' | 'outlet' | 'similar'

interface CreateConfirmations {
    confirmCreate: boolean
    confirmDifferentOutlet: boolean
}

const NO_CONFIRMATIONS: CreateConfirmations = { confirmCreate: false, confirmDifferentOutlet: false }

type DialogStep = 'form' | 'verify'

export function CreateShopDialog({
    open,
    onOpenChange,
    defaultShopName = '',
    onCreated,
    onSelectExisting,
    onPrepared,
    linkUser = false,
    mode = 'create',
    verificationOrgId = null,
}: CreateShopDialogProps) {
    const invalidContactPhoneMessage = 'Please enter a valid Malaysia mobile number.'

    // Form fields
    const [shopName, setShopName] = useState('')
    const [branch, setBranch] = useState('')
    const [contactName, setContactName] = useState('')
    const [contactPhone, setContactPhone] = useState('')
    const [contactEmail, setContactEmail] = useState('')
    const [address, setAddress] = useState('')
    const [hotFlavourBrands, setHotFlavourBrands] = useState('')
    const [sellsSerapodFlavour, setSellsSerapodFlavour] = useState(false)
    const [sellsSbox, setSellsSbox] = useState(false)
    const [sellsSboxSpecialEdition, setSellsSboxSpecialEdition] = useState(false)
    const [notes, setNotes] = useState('')

    // Location dropdowns
    const [states, setStates] = useState<{ id: string; state_name: string }[]>([])
    const [districts, setDistricts] = useState<{ id: string; district_name: string; state_id: string }[]>([])
    const [selectedStateId, setSelectedStateId] = useState('')
    const [selectedDistrictId, setSelectedDistrictId] = useState('')
    const [loadingLocations, setLoadingLocations] = useState(false)

    // Duplicate check
    const [duplicates, setDuplicates] = useState<DuplicateShop[]>([])
    const [showDuplicates, setShowDuplicates] = useState(false)
    const [duplicateKind, setDuplicateKind] = useState<DuplicateKind | null>(null)
    const [confirmations, setConfirmations] = useState<CreateConfirmations>(NO_CONFIRMATIONS)

    // OTP verification step
    const [step, setStep] = useState<DialogStep>('form')
    const [preparedShopRequest, setPreparedShopRequest] = useState<ShopRequestFormInput | null>(null)
    const [verificationPhone, setVerificationPhone] = useState('')
    const [verificationEmail, setVerificationEmail] = useState('')
    const [verificationCode, setVerificationCode] = useState('')
    const [verificationError, setVerificationError] = useState('')
    const [verificationToken, setVerificationToken] = useState('')
    const [resendCooldown, setResendCooldown] = useState(0)
    const [verifying, setVerifying] = useState(false)

    // Status
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')
    const [phoneError, setPhoneError] = useState('')
    const [emailError, setEmailError] = useState('')

    // Reset form when dialog opens
    useEffect(() => {
        if (!open) return
        setShopName(defaultShopName ? toTitleCaseWords(defaultShopName) : '')
        setSelectedStateId('')
        setSelectedDistrictId('')
        setBranch('')
        setContactName('')
        setContactPhone('')
        setContactEmail('')
        setAddress('')
        setHotFlavourBrands('')
        setSellsSerapodFlavour(false)
        setSellsSbox(false)
        setSellsSboxSpecialEdition(false)
        setNotes('')
        setError('')
        setPhoneError('')
        setEmailError('')
        setDuplicates([])
        setShowDuplicates(false)
        setDuplicateKind(null)
        setConfirmations(NO_CONFIRMATIONS)
        setStep('form')
        setPreparedShopRequest(null)
        setVerificationPhone('')
        setVerificationEmail('')
        setVerificationCode('')
        setVerificationError('')
        setVerificationToken('')
        setResendCooldown(0)
    }, [defaultShopName, open])

    useEffect(() => {
        if (resendCooldown <= 0) return

        const timer = window.setTimeout(() => {
            setResendCooldown((current) => (current > 0 ? current - 1 : 0))
        }, 1000)

        return () => window.clearTimeout(timer)
    }, [resendCooldown])

    // Load states and districts
    useEffect(() => {
        if (!open) return

        const loadLocations = async () => {
            try {
                setLoadingLocations(true)
                const response = await fetch('/api/shops/locations')
                const result = await response.json()
                if (!response.ok || !result.success) {
                    throw new Error(result.error || 'Failed to load state/branch options.')
                }

                setStates(result.states || [])
                setDistricts(result.districts || [])
            } catch (err: any) {
                console.error('Failed to load locations:', err)
                setError('Failed to load state/branch options.')
            } finally {
                setLoadingLocations(false)
            }
        }

        void loadLocations()
    }, [open])

    const filteredDistricts = districts.filter((d) => d.state_id === selectedStateId)
    const selectedState = states.find((s) => s.id === selectedStateId) || null
    const selectedDistrict = filteredDistricts.find((d) => d.id === selectedDistrictId) || null

    const clearDuplicateState = () => {
        setDuplicates([])
        setShowDuplicates(false)
        setDuplicateKind(null)
    }

    /** Shows the matching duplicate panel for any 409 from the shared shop identity guard. */
    const applyDuplicateResponse = (status: number, result: any) => {
        if (status !== 409) return false

        let kind: DuplicateKind | null = null
        let rows: DuplicateShop[] = result.duplicates || []
        if (result.duplicateBlocked) {
            kind = 'blocked'
        } else if (result.requiresDifferentOutletConfirmation) {
            kind = 'outlet'
            rows = [...rows, ...(result.nameSuggestions || [])]
        } else if (result.duplicateWarning) {
            kind = 'similar'
        }
        if (!kind) return false

        setDuplicates(rows)
        setDuplicateKind(kind)
        setShowDuplicates(true)
        return true
    }

    const handleSelectExisting = (dup: DuplicateShop) => {
        const org = { id: dup.org_id, org_name: dup.org_name, branch: dup.branch }
        if (onSelectExisting) {
            onSelectExisting(org)
        } else {
            onCreated?.(org)
        }
        onOpenChange(false)
    }

    const resubmitWithConfirmation = (next: CreateConfirmations) => {
        setConfirmations(next)
        clearDuplicateState()
        if (mode === 'prepare-registration') {
            void requestShopContactVerification(false, next)
            return
        }
        void handleCreateShop(next)
    }

    const normalizeContactPhone = (value: string, options: { requireValue?: boolean; updateInput?: boolean } = {}) => {
        const trimmedValue = value.trim()

        if (!trimmedValue) {
            setPhoneError(options.requireValue ? 'Contact phone is required.' : '')
            return null
        }

        const result = validateMalaysianMobileNumber(trimmedValue)
        if (!result.isValid || !result.formatted) {
            setPhoneError(invalidContactPhoneMessage)
            return null
        }

        if (options.updateInput) {
            setContactPhone(result.formatted)
        }

        setPhoneError('')
        return result.formatted
    }

    // Validate phone on blur
    const handlePhoneBlur = () => {
        if (!contactPhone.trim()) {
            setPhoneError('')
            return
        }
        normalizeContactPhone(contactPhone, { updateInput: true })
    }

    // Validate email on blur
    const handleEmailBlur = () => {
        if (!contactEmail.trim()) {
            setEmailError('')
            return
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        setEmailError(emailRegex.test(contactEmail.trim()) ? '' : 'Invalid email format')
    }

    const handleShopNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const nextValue = event.target.value
        const cursorPosition = event.target.selectionStart ?? nextValue.length
        const isTypingAtEnd = cursorPosition === nextValue.length
        const shouldFormatCompletedWords = isTypingAtEnd && /\s$/.test(nextValue)

        setShopName(shouldFormatCompletedWords ? formatShopNameTitleCase(nextValue) : nextValue)
    }

    const handleShopNameBlur = () => {
        if (shopName.trim()) {
            setShopName(normalizeShopNameForSubmit(shopName))
        }
    }

    const validateFormFields = () => {
        setError('')
        setVerificationError('')

        const normalizedShopName = normalizeShopNameForSubmit(shopName)
        if (!normalizedShopName) {
            setError('Shop name is required.')
            return null
        }

        if (shopName !== normalizedShopName) {
            setShopName(normalizedShopName)
        }

        if (!contactName.trim()) {
            setError('Please enter the contact name.')
            return null
        }

        const normalizedContactPhone = normalizeContactPhone(contactPhone, {
            requireValue: true,
            updateInput: true,
        })
        if (!normalizedContactPhone) {
            return null
        }

        if (mode === 'prepare-registration') {
            if (!contactEmail.trim()) {
                setEmailError('Contact email is required.')
                setError('Contact email is required to send the verification code.')
                return null
            }
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            if (!emailRegex.test(contactEmail.trim())) {
                setEmailError('Invalid email format')
                return null
            }
        } else if (contactEmail.trim()) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            if (!emailRegex.test(contactEmail.trim())) {
                setEmailError('Invalid email format')
                return null
            }
        }

        if (mode === 'prepare-registration' && !verificationOrgId) {
            setError('Registration is not available because the organization is missing.')
            return null
        }

        const normalizedAddress = toTitleCaseAddress(address)
        if (address !== normalizedAddress) {
            setAddress(normalizedAddress)
        }

        return {
            normalizedContactPhone,
            normalizedShopName,
            normalizedAddress,
        }
    }

    const buildRequestPayload = (
        normalizedContactPhone: string,
        normalizedShopName: string,
        normalizedAddress: string,
        confirm: CreateConfirmations = NO_CONFIRMATIONS,
    ) => ({
        shopName: normalizedShopName,
        branch: selectedDistrict?.district_name || branch.trim() || null,
        state: selectedState?.state_name || null,
        contactName: contactName.trim() || null,
        contactPhone: normalizedContactPhone,
        contactEmail: contactEmail.trim() || null,
        address: normalizedAddress || null,
        hotFlavourBrands: hotFlavourBrands.trim() || null,
        sellsSerapodFlavour,
        sellsSbox,
        sellsSboxSpecialEdition,
        notes: notes.trim() || null,
        confirmCreate: confirm.confirmCreate || confirm.confirmDifferentOutlet,
        confirmDifferentOutlet: confirm.confirmDifferentOutlet,
        ...(mode === 'create' ? { linkUser } : { orgId: verificationOrgId || '' }),
    })

    const handleCreateShop = async (confirm: CreateConfirmations = NO_CONFIRMATIONS) => {
        const validated = validateFormFields()
        if (!validated) {
            return
        }

        try {
            setSubmitting(true)
            clearDuplicateState()

            const response = await fetch('/api/shops/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildRequestPayload(
                    validated.normalizedContactPhone,
                    validated.normalizedShopName,
                    validated.normalizedAddress,
                    confirm,
                )),
            })

            const result = await response.json()

            if (applyDuplicateResponse(response.status, result)) {
                return
            }

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Failed to create shop.')
            }

            onCreated?.(result.organization)
            onOpenChange(false)
        } catch (err: any) {
            setError(err.message || 'Failed to create shop.')
        } finally {
            setSubmitting(false)
        }
    }

    const requestShopContactVerification = async (isResend = false, confirm: CreateConfirmations = NO_CONFIRMATIONS) => {
        const validated = validateFormFields()
        if (!validated) {
            return
        }

        try {
            setSubmitting(true)
            setError('')
            setVerificationError('')
            if (isResend) {
                setVerificationToken('')
            }

            const response = await fetch(
                isResend
                    ? '/api/shops/contact-verification/resend-code'
                    : '/api/shops/contact-verification/request-code',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildRequestPayload(
                        validated.normalizedContactPhone,
                        validated.normalizedShopName,
                        validated.normalizedAddress,
                        confirm,
                    )),
                },
            )

            const result = await response.json()

            if (applyDuplicateResponse(response.status, result)) {
                setStep('form')
                setError(result.error || '')
                return
            }

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Unable to send verification code.')
            }

            clearDuplicateState()
            setPreparedShopRequest(result.shopRequest || null)
            setVerificationPhone(String(result.contactPhone || validated.normalizedContactPhone || ''))
            setVerificationEmail(String(result.contactEmail || contactEmail.trim().toLowerCase() || ''))
            setVerificationCode('')
            setVerificationError('')
            setVerificationToken('')
            setResendCooldown(Number(result.resendCooldown || 60))
            setStep('verify')
        } catch (err: any) {
            const message = err.message || 'Unable to send verification code.'
            if (isResend || step === 'verify') {
                setVerificationError(message)
            } else {
                setError(message)
            }
        } finally {
            setSubmitting(false)
        }
    }

    const finalizeVerifiedShopCreation = async (token: string) => {
        const response = await fetch('/api/shops/contact-verification/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ verificationToken: token }),
        })

        const result = await response.json()

        if (applyDuplicateResponse(response.status, result)) {
            setStep('form')
            setVerificationToken('')
            setVerificationError(result.error || '')
            return false
        }

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to create shop.')
        }

        if (mode === 'prepare-registration') {
            if (onCreated) {
                onCreated(result.organization)
            } else {
                onPrepared?.(result.shopRequest)
            }
        } else {
            onCreated?.(result.organization)
        }

        onOpenChange(false)
        return true
    }

    const handleVerifyAndCreate = async () => {
        if (!preparedShopRequest && !verificationToken) {
            setVerificationError('Shop details are missing. Please go back and try again.')
            return
        }

        if (!verificationToken && !/^\d{4}$/.test(verificationCode)) {
            setVerificationError('Please enter the 4-digit verification code.')
            return
        }

        try {
            setVerifying(true)
            setVerificationError('')

            let token = verificationToken
            if (!token) {
                const response = await fetch('/api/shops/contact-verification/verify-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone: verificationPhone || contactPhone.trim(),
                        code: verificationCode,
                    }),
                })

                const result = await response.json()
                if (!response.ok || !result.success) {
                    throw new Error(result.error || 'Unable to verify the code.')
                }

                token = String(result.verificationToken || '')
                setVerificationToken(token)
            }

            await finalizeVerifiedShopCreation(token)
        } catch (err: any) {
            setVerificationError(err.message || 'Unable to verify the code.')
        } finally {
            setVerifying(false)
        }
    }

    const handleBackToForm = () => {
        setConfirmations(NO_CONFIRMATIONS)
        setStep('form')
        setVerificationCode('')
        setVerificationError('')
        setVerificationToken('')
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Store className="w-5 h-5" />
                        Create New Shop
                    </DialogTitle>
                    <DialogDescription>
                        {mode === 'prepare-registration'
                            ? step === 'verify'
                                ? 'Enter the 4-digit email code sent to the shop contact email before we create and link this shop to your registration.'
                                : 'Enter the shop details first. We will verify the contact email by 4-digit email OTP before creating the shop.'
                            : linkUser
                            ? 'Create a new shop directly. This will be linked to your profile immediately.'
                            : 'Create a new shop, then review it below before saving your profile changes.'}
                    </DialogDescription>
                </DialogHeader>

                {/* Duplicate / existing-shop panel (driven by the shared server-side identity guard) */}
                {showDuplicates && duplicates.length > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                            <div>
                                <p className="text-sm font-medium text-amber-800">
                                    {duplicateKind === 'blocked'
                                        ? 'Existing shop found'
                                        : duplicateKind === 'outlet'
                                            ? 'We found other outlets using the same phone/email'
                                            : 'Similar shops already exist'}
                                </p>
                                <p className="text-xs text-amber-700 mt-1">
                                    {duplicateKind === 'blocked'
                                        ? 'This appears to be the same outlet. Please select the existing shop instead of creating another one.'
                                        : duplicateKind === 'outlet'
                                            ? 'If your shop is listed, select it. Only continue if this is a different outlet / branch at a different address.'
                                            : 'Please verify none of these is your shop before creating a new one.'}
                                </p>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            {duplicates.map((dup) => (
                                <div key={dup.org_id} className="flex items-start gap-2 p-2 bg-white rounded-md border text-sm">
                                    <Store className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0 space-y-0.5">
                                        <div>
                                            <span className="font-medium">{dup.org_name}</span>
                                            {dup.branch && <span className="text-muted-foreground"> ({dup.branch})</span>}
                                            {dup.state_name && (
                                                <span className="text-xs text-muted-foreground ml-2 inline-flex items-center gap-0.5">
                                                    <MapPin className="w-3 h-3" />{dup.state_name}
                                                </span>
                                            )}
                                        </div>
                                        {duplicateKind !== 'similar' && dup.address && (
                                            <p className="text-xs text-muted-foreground break-words">{dup.address}</p>
                                        )}
                                        {duplicateKind !== 'similar' && (dup.contact_phone || dup.contact_email) && (
                                            <p className="text-xs text-muted-foreground break-all">
                                                {[dup.contact_phone, dup.contact_email].filter(Boolean).join(' · ')}
                                            </p>
                                        )}
                                    </div>
                                    {duplicateKind !== 'similar' && (
                                        <Button
                                            size="sm"
                                            variant={duplicateKind === 'blocked' ? 'default' : 'outline'}
                                            className="shrink-0"
                                            onClick={() => handleSelectExisting(dup)}
                                        >
                                            Use this shop
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                            <Button
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                onClick={() => {
                                    clearDuplicateState()
                                }}
                            >
                                Go back
                            </Button>
                            {duplicateKind === 'outlet' && (
                                <Button
                                    size="sm"
                                    className="flex-1"
                                    onClick={() => resubmitWithConfirmation({ confirmCreate: true, confirmDifferentOutlet: true })}
                                    disabled={submitting}
                                >
                                    {submitting
                                        ? mode === 'prepare-registration'
                                            ? 'Sending code...'
                                            : 'Creating...'
                                        : 'This is a different outlet / branch'}
                                </Button>
                            )}
                            {duplicateKind === 'similar' && (
                                <Button
                                    size="sm"
                                    className="flex-1"
                                    onClick={() => resubmitWithConfirmation({ ...confirmations, confirmCreate: true })}
                                    disabled={submitting}
                                >
                                    {submitting
                                        ? mode === 'prepare-registration'
                                            ? 'Sending code...'
                                            : 'Creating...'
                                        : mode === 'prepare-registration'
                                            ? 'None of these — Send code'
                                            : 'None of these — Continue'}
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {!showDuplicates && step === 'form' && (
                    <div className="space-y-4 py-2">
                        {/* Shop Name */}
                        <div className="space-y-2">
                            <Label htmlFor="create-shop-name">Shop Name *</Label>
                            <Input
                                id="create-shop-name"
                                value={shopName}
                                onChange={handleShopNameChange}
                                onBlur={handleShopNameBlur}
                                placeholder="e.g. ABC Vape Shop"
                            />
                        </div>

                        {/* State + Branch */}
                        <div className="grid gap-4 grid-cols-2">
                            <div className="space-y-2">
                                <Label>State</Label>
                                <Select
                                    value={selectedStateId || 'none'}
                                    onValueChange={(value) => {
                                        const nextId = value === 'none' ? '' : value
                                        setSelectedStateId(nextId)
                                        setSelectedDistrictId('')
                                        setBranch('')
                                    }}
                                    disabled={loadingLocations}
                                >
                                    <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None</SelectItem>
                                        {states.map((s) => <SelectItem key={s.id} value={s.id}>{s.state_name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Branch</Label>
                                <Select
                                    value={selectedDistrictId || 'none'}
                                    onValueChange={(value) => {
                                        const nextId = value === 'none' ? '' : value
                                        setSelectedDistrictId(nextId)
                                        const d = filteredDistricts.find((item) => item.id === nextId)
                                        setBranch(d?.district_name || '')
                                    }}
                                    disabled={!selectedStateId || loadingLocations}
                                >
                                    <SelectTrigger><SelectValue placeholder={selectedStateId ? 'Select branch' : 'Select state first'} /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None</SelectItem>
                                        {filteredDistricts.map((d) => <SelectItem key={d.id} value={d.id}>{d.district_name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Contact Name + Phone */}
                        <div className="grid gap-4 grid-cols-2">
                            <div className="space-y-2">
                                <Label>Contact Name *</Label>
                                <Input
                                    value={contactName}
                                    onChange={(e) => setContactName(e.target.value)}
                                    onBlur={() => { if (contactName.trim()) setContactName(toTitleCaseWords(contactName.trim())) }}
                                    placeholder="Person in charge"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Contact Phone *</Label>
                                <Input
                                    value={contactPhone}
                                    onChange={(e) => {
                                        setContactPhone(e.target.value)
                                        if (phoneError) setPhoneError('')
                                    }}
                                    onBlur={handlePhoneBlur}
                                    placeholder="e.g. 0123456789"
                                    inputMode="tel"
                                    autoComplete="tel"
                                />
                                {phoneError && <p className="text-xs text-red-600">{phoneError}</p>}
                            </div>
                        </div>

                        {/* Contact Email */}
                        <div className="space-y-2">
                            <Label>Contact Email{mode === 'prepare-registration' ? ' *' : ''}</Label>
                            <Input
                                value={contactEmail}
                                onChange={(e) => {
                                    setContactEmail(e.target.value)
                                    if (emailError) setEmailError('')
                                }}
                                onBlur={handleEmailBlur}
                                placeholder="shop@example.com"
                                type="email"
                                autoComplete="email"
                            />
                            {emailError && <p className="text-xs text-red-600">{emailError}</p>}
                            {mode === 'prepare-registration' && (
                                <p className="text-xs text-muted-foreground">
                                    Required. The verification code will be sent to this email.
                                </p>
                            )}
                        </div>

                        {/* Address */}
                        <div className="space-y-2">
                            <Label>Address</Label>
                            <Textarea
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                onBlur={() => setAddress(toTitleCaseAddress(address))}
                                rows={2}
                                placeholder="Shop address"
                            />
                        </div>

                        {/* Hot Flavour Brands */}
                        <div className="space-y-2">
                            <Label>Hot Flavour Brands</Label>
                            <Input
                                value={hotFlavourBrands}
                                onChange={(e) => setHotFlavourBrands(e.target.value)}
                                onBlur={() => { if (hotFlavourBrands.trim()) setHotFlavourBrands(toTitleCaseWords(hotFlavourBrands.trim())) }}
                                placeholder="e.g. Brand A, Brand B"
                            />
                        </div>

                        {/* Sells checkboxes */}
                        <div className="space-y-3">
                            <Label className="text-sm font-medium">Product Availability</Label>
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm">
                                    <Checkbox checked={sellsSerapodFlavour} onCheckedChange={(v) => setSellsSerapodFlavour(v === true)} />
                                    Sells Serapod Flavour
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <Checkbox checked={sellsSbox} onCheckedChange={(v) => setSellsSbox(v === true)} />
                                    Sells S.Box
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <Checkbox checked={sellsSboxSpecialEdition} onCheckedChange={(v) => setSellsSboxSpecialEdition(v === true)} />
                                    Sells S.Box Special Edition
                                </label>
                            </div>
                        </div>

                        {/* Notes */}
                        <div className="space-y-2">
                            <Label>Notes</Label>
                            <Textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={2}
                                placeholder="Optional"
                            />
                        </div>

                        {error && <p className="text-sm text-red-600">{error}</p>}
                    </div>
                )}

                {!showDuplicates && step === 'verify' && (
                    <div className="space-y-4 py-2">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
                            <p className="text-sm font-medium text-slate-900">Verify shop contact email</p>
                            <p className="text-xs text-slate-600">
                                Enter the 4-digit code sent to {verificationEmail || 'the shop contact email'}.
                                We will only create the shop after this verification succeeds.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="shop-contact-verification-code">4-digit verification code</Label>
                            <Input
                                id="shop-contact-verification-code"
                                value={verificationCode}
                                onChange={(e) => {
                                    setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 4))
                                    if (verificationError) setVerificationError('')
                                }}
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                placeholder="1234"
                                maxLength={4}
                            />
                        </div>

                        {preparedShopRequest && (
                            <div className="rounded-xl border border-slate-200 p-3 space-y-1.5 text-sm">
                                <p className="font-medium text-slate-900">
                                    {preparedShopRequest.shopName}
                                    {preparedShopRequest.branch ? ` (${preparedShopRequest.branch})` : ''}
                                </p>
                                {preparedShopRequest.state && (
                                    <p className="text-slate-600">State: {preparedShopRequest.state}</p>
                                )}
                                <p className="text-slate-600">Contact: {preparedShopRequest.contactName}</p>
                                <p className="text-slate-600">
                                    Mobile: {formatPhoneDisplay(preparedShopRequest.contactPhone || verificationPhone || '') || preparedShopRequest.contactPhone || verificationPhone}
                                </p>
                                <p className="text-slate-600">
                                    Email: {preparedShopRequest.contactEmail || verificationEmail}
                                </p>
                            </div>
                        )}

                        {verificationError && <p className="text-sm text-red-600">{verificationError}</p>}
                    </div>
                )}

                {!showDuplicates && step === 'form' && (
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                        <Button
                            onClick={() => {
                                setConfirmations(NO_CONFIRMATIONS)
                                if (mode === 'prepare-registration') {
                                    void requestShopContactVerification(false)
                                    return
                                }
                                void handleCreateShop()
                            }}
                            disabled={submitting || !!phoneError || !!emailError}
                        >
                            {submitting
                                ? mode === 'prepare-registration'
                                    ? 'Sending code...'
                                    : 'Creating...'
                                : mode === 'prepare-registration'
                                    ? 'Continue'
                                    : 'Create Shop'}
                        </Button>
                    </DialogFooter>
                )}

                {!showDuplicates && step === 'verify' && (
                    <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
                        <Button variant="outline" onClick={handleBackToForm} disabled={submitting || verifying}>Back</Button>
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                            <Button
                                variant="outline"
                                onClick={() => void requestShopContactVerification(true, { ...confirmations, confirmCreate: true })}
                                disabled={submitting || verifying || resendCooldown > 0}
                            >
                                {submitting
                                    ? 'Sending...'
                                    : resendCooldown > 0
                                        ? `Resend in ${resendCooldown}s`
                                        : 'Resend code'}
                            </Button>
                            <Button
                                onClick={() => void handleVerifyAndCreate()}
                                disabled={
                                    submitting ||
                                    verifying ||
                                    (!verificationToken && !/^\d{4}$/.test(verificationCode))
                                }
                            >
                                {verifying
                                    ? verificationToken
                                        ? 'Creating...'
                                        : 'Verifying...'
                                    : verificationToken
                                        ? 'Create Shop'
                                        : 'Verify & Create Shop'}
                            </Button>
                        </div>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    )
}
