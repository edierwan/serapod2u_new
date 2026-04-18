'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { toTitleCaseWords, validatePhoneNumber } from '@/lib/utils'
import { Store, MapPin, AlertTriangle } from 'lucide-react'

interface CreateShopDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    defaultShopName?: string
    onCreated?: (org: { id: string; org_name: string; branch?: string | null }) => void
}

interface DuplicateShop {
    org_id: string
    org_name: string
    branch: string | null
    state_name: string | null
}

export function CreateShopDialog({
    open,
    onOpenChange,
    defaultShopName = '',
    onCreated,
}: CreateShopDialogProps) {
    const supabase = useMemo(() => createClient(), [])

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
    }, [defaultShopName, open])

    // Load states and districts
    useEffect(() => {
        if (!open) return

        const loadLocations = async () => {
            try {
                setLoadingLocations(true)
                const [{ data: statesData, error: statesErr }, { data: districtsData, error: districtsErr }] = await Promise.all([
                    supabase.from('states').select('id, state_name').eq('is_active', true).order('state_name'),
                    supabase.from('districts').select('id, district_name, state_id').eq('is_active', true).order('district_name'),
                ])
                if (statesErr) throw statesErr
                if (districtsErr) throw districtsErr
                setStates(statesData || [])
                setDistricts(districtsData || [])
            } catch (err: any) {
                console.error('Failed to load locations:', err)
                setError('Failed to load state/branch options.')
            } finally {
                setLoadingLocations(false)
            }
        }

        void loadLocations()
    }, [open, supabase])

    const filteredDistricts = districts.filter((d) => d.state_id === selectedStateId)
    const selectedState = states.find((s) => s.id === selectedStateId) || null
    const selectedDistrict = filteredDistricts.find((d) => d.id === selectedDistrictId) || null

    // Validate phone on blur
    const handlePhoneBlur = () => {
        if (!contactPhone.trim()) {
            setPhoneError('')
            return
        }
        const result = validatePhoneNumber(contactPhone.trim())
        setPhoneError(result.isValid ? '' : (result.error || 'Invalid Malaysia phone format'))
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

    const handleSubmit = async (confirmCreate = false) => {
        setError('')

        // Validate required fields
        const trimmedName = shopName.trim()
        if (!trimmedName) {
            setError('Shop name is required.')
            return
        }

        if (contactPhone.trim()) {
            const phoneResult = validatePhoneNumber(contactPhone.trim())
            if (!phoneResult.isValid) {
                setPhoneError(phoneResult.error || 'Invalid Malaysia phone format')
                return
            }
        }

        if (contactEmail.trim()) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            if (!emailRegex.test(contactEmail.trim())) {
                setEmailError('Invalid email format')
                return
            }
        }

        try {
            setSubmitting(true)

            const response = await fetch('/api/shops/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    shopName: trimmedName,
                    branch: selectedDistrict?.district_name || null,
                    state: selectedState?.state_name || null,
                    contactName: contactName.trim() || null,
                    contactPhone: contactPhone.trim() || null,
                    contactEmail: contactEmail.trim() || null,
                    address: address.trim() || null,
                    hotFlavourBrands: hotFlavourBrands.trim() || null,
                    sellsSerapodFlavour,
                    sellsSbox,
                    sellsSboxSpecialEdition,
                    notes: notes.trim() || null,
                    confirmCreate,
                }),
            })

            const result = await response.json()

            // Handle duplicate warning (409)
            if (response.status === 409 && result.duplicateWarning) {
                setDuplicates(result.duplicates || [])
                setShowDuplicates(true)
                setSubmitting(false)
                return
            }

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Failed to create shop.')
            }

            // Success — shop created and user linked
            onCreated?.(result.organization)
            onOpenChange(false)
        } catch (err: any) {
            setError(err.message || 'Failed to create shop.')
        } finally {
            setSubmitting(false)
        }
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
                        Create a new shop directly. This will be linked to your profile immediately.
                    </DialogDescription>
                </DialogHeader>

                {/* Duplicate warning overlay */}
                {showDuplicates && duplicates.length > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                            <div>
                                <p className="text-sm font-medium text-amber-800">Similar shops already exist</p>
                                <p className="text-xs text-amber-700 mt-1">Please verify none of these is your shop before creating a new one.</p>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            {duplicates.map((dup) => (
                                <div key={dup.org_id} className="flex items-center gap-2 p-2 bg-white rounded-md border text-sm">
                                    <Store className="w-4 h-4 text-orange-500 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <span className="font-medium">{dup.org_name}</span>
                                        {dup.branch && <span className="text-muted-foreground"> ({dup.branch})</span>}
                                        {dup.state_name && (
                                            <span className="text-xs text-muted-foreground ml-2 inline-flex items-center gap-0.5">
                                                <MapPin className="w-3 h-3" />{dup.state_name}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                            <Button
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                onClick={() => {
                                    setShowDuplicates(false)
                                    setDuplicates([])
                                }}
                            >
                                Go back
                            </Button>
                            <Button
                                size="sm"
                                className="flex-1"
                                onClick={() => handleSubmit(true)}
                                disabled={submitting}
                            >
                                {submitting ? 'Creating...' : 'None of these — Create new'}
                            </Button>
                        </div>
                    </div>
                )}

                {!showDuplicates && (
                    <div className="space-y-4 py-2">
                        {/* Shop Name */}
                        <div className="space-y-2">
                            <Label htmlFor="create-shop-name">Shop Name *</Label>
                            <Input
                                id="create-shop-name"
                                value={shopName}
                                onChange={(e) => setShopName(e.target.value)}
                                onBlur={() => { if (shopName.trim()) setShopName(toTitleCaseWords(shopName.trim())) }}
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
                                <Label>Contact Name</Label>
                                <Input
                                    value={contactName}
                                    onChange={(e) => setContactName(e.target.value)}
                                    onBlur={() => { if (contactName.trim()) setContactName(toTitleCaseWords(contactName.trim())) }}
                                    placeholder="Person in charge"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Contact Phone</Label>
                                <Input
                                    value={contactPhone}
                                    onChange={(e) => setContactPhone(e.target.value)}
                                    onBlur={handlePhoneBlur}
                                    placeholder="e.g. 0123456789"
                                />
                                {phoneError && <p className="text-xs text-red-600">{phoneError}</p>}
                            </div>
                        </div>

                        {/* Contact Email */}
                        <div className="space-y-2">
                            <Label>Contact Email</Label>
                            <Input
                                value={contactEmail}
                                onChange={(e) => setContactEmail(e.target.value)}
                                onBlur={handleEmailBlur}
                                placeholder="shop@example.com"
                                type="email"
                            />
                            {emailError && <p className="text-xs text-red-600">{emailError}</p>}
                        </div>

                        {/* Address */}
                        <div className="space-y-2">
                            <Label>Address</Label>
                            <Textarea
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
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

                {!showDuplicates && (
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                        <Button onClick={() => handleSubmit(false)} disabled={submitting || !!phoneError || !!emailError}>
                            {submitting ? 'Creating...' : 'Create Shop'}
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    )
}
