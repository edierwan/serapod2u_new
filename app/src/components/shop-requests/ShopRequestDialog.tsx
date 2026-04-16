'use client'

import { useEffect, useState } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface ShopRequestDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    defaultShopName?: string
    onSubmitted?: (requestId: string) => void
}

export function ShopRequestDialog({
    open,
    onOpenChange,
    defaultShopName = '',
    onSubmitted,
}: ShopRequestDialogProps) {
    const [shopName, setShopName] = useState(defaultShopName)
    const [branch, setBranch] = useState('')
    const [contactName, setContactName] = useState('')
    const [contactPhone, setContactPhone] = useState('')
    const [state, setState] = useState('')
    const [address, setAddress] = useState('')
    const [notes, setNotes] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    useEffect(() => {
        if (!open) return
        setShopName(defaultShopName)
        setError('')
        setSuccess('')
    }, [defaultShopName, open])

    const handleSubmit = async () => {
        if (!shopName.trim()) {
            setError('Shop name is required.')
            return
        }

        try {
            setSubmitting(true)
            setError('')

            const response = await fetch('/api/shop-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    shopName,
                    branch,
                    contactName,
                    contactPhone,
                    state,
                    address,
                    notes,
                }),
            })

            const result = await response.json()
            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Failed to submit shop request.')
            }

            setSuccess('Your request has been submitted for HQ review. You will be notified after approval.')
            onSubmitted?.(result.requestId)
        } catch (submissionError: any) {
            setError(submissionError.message || 'Failed to submit shop request.')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Request New Shop</DialogTitle>
                    <DialogDescription>
                        Submit the key details needed for HQ/Admin to create a proper shop masterdata record. This does not create a live shop immediately.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label htmlFor="shop-request-name">Shop Name</Label>
                        <Input id="shop-request-name" value={shopName} onChange={(event) => setShopName(event.target.value)} />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="shop-request-branch">Branch</Label>
                            <Input id="shop-request-branch" value={branch} onChange={(event) => setBranch(event.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="shop-request-state">State</Label>
                            <Input id="shop-request-state" value={state} onChange={(event) => setState(event.target.value)} />
                        </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="shop-request-contact-name">Contact Name</Label>
                            <Input id="shop-request-contact-name" value={contactName} onChange={(event) => setContactName(event.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="shop-request-contact-phone">Contact Phone</Label>
                            <Input id="shop-request-contact-phone" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="shop-request-address">Address</Label>
                        <Textarea id="shop-request-address" value={address} onChange={(event) => setAddress(event.target.value)} rows={3} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="shop-request-notes">Notes</Label>
                        <Textarea id="shop-request-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Optional context for HQ/Admin review" />
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    {success && <p className="text-sm text-emerald-700">{success}</p>}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Submitting...' : 'Submit Request'}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}