'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  User, Mail, Phone, MapPin, Store, Camera, Loader2, Save, ArrowLeft,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────

interface StoreProfile {
  id: string
  email: string
  fullName: string
  phone: string
  address: string
  location: string
  avatarUrl: string | null
  shop_name: string | null
}

// ── Component ─────────────────────────────────────────────────────

export default function StoreAccountClient() {
  const router = useRouter()
  const [profile, setProfile] = useState<StoreProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [location, setLocation] = useState('')
  const [shopName, setShopName] = useState('')

  // ── Load profile ────────────────────────────────────────────────

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
          router.push('/login')
          return
        }

        // Fetch store-scoped fields only (no portal fields)
        // Note: some columns may not be in generated types yet, cast through any
        const { data, error } = await supabase
          .from('users')
          .select('id, email, full_name, phone, address, location, avatar_url, shop_name' as any)
          .eq('id', user.id)
          .single()

        if (error || !data) {
          setMessage({ type: 'error', text: 'Failed to load profile.' })
          setIsLoading(false)
          return
        }

        const d = data as any
        const p: StoreProfile = {
          id: d.id,
          email: d.email,
          fullName: d.full_name || '',
          phone: d.phone || '',
          address: d.address || '',
          location: d.location || '',
          avatarUrl: d.avatar_url,
          shop_name: d.shop_name || '',
        }

        setProfile(p)
        setFullName(p.fullName)
        setPhone(p.phone)
        setAddress(p.address)
        setLocation(p.location)
        setShopName(p.shop_name || '')
      } catch {
        setMessage({ type: 'error', text: 'Unexpected error loading profile.' })
      } finally {
        setIsLoading(false)
      }
    }

    loadProfile()
  }, [router])

  // ── Save profile ────────────────────────────────────────────────

  const handleSave = async () => {
    if (!profile) return
    setIsSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/user/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim(),
          address: address.trim(),
          shop_name: shopName.trim() || null,
        }),
      })

      const data = await res.json()

      if (data.success) {
        setMessage({ type: 'success', text: 'Profile updated successfully!' })
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update profile.' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' })
    } finally {
      setIsSaving(false)
    }
  }

  // ── Loading state ───────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center">
        <p className="text-gray-500">Unable to load profile. Please try logging in again.</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/login')}>
          Go to Login
        </Button>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <h1 className="text-2xl font-bold text-gray-900 mb-8">My Account</h1>

      {/* Messages */}
      {message && (
        <div
          className={`mb-6 p-3 rounded-xl text-sm ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Avatar */}
      <div className="flex items-center gap-4 mb-8">
        <div className="relative h-20 w-20 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
          {profile.avatarUrl ? (
            <Image
              src={profile.avatarUrl}
              alt={profile.fullName || 'Avatar'}
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600">
              <User className="h-8 w-8 text-white" />
            </div>
          )}
        </div>
        <div>
          <p className="font-semibold text-gray-900">{profile.fullName || 'User'}</p>
          <p className="text-sm text-gray-500">{profile.email}</p>
        </div>
      </div>

      {/* Store-scoped fields only */}
      <div className="space-y-5">
        {/* Full Name */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <User className="h-4 w-4" /> Full Name
          </Label>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your full name"
            className="h-11 rounded-xl"
          />
        </div>

        {/* Email (read-only) */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <Mail className="h-4 w-4" /> Email
          </Label>
          <Input
            value={profile.email}
            disabled
            className="h-11 rounded-xl bg-gray-50 text-gray-500"
          />
          <p className="text-xs text-gray-400">Email cannot be changed.</p>
        </div>

        {/* Phone */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <Phone className="h-4 w-4" /> Phone
          </Label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 60123456789"
            className="h-11 rounded-xl"
          />
        </div>

        {/* Address */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <MapPin className="h-4 w-4" /> Address
          </Label>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Your delivery address"
            className="h-11 rounded-xl"
          />
        </div>

        {/* Location */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <MapPin className="h-4 w-4" /> Location / City
          </Label>
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Kuala Lumpur"
            className="h-11 rounded-xl"
          />
        </div>

        {/* Shop Name (for shoppers) */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <Store className="h-4 w-4" /> Shop Name
            <span className="text-xs text-gray-400 font-normal">(optional)</span>
          </Label>
          <Input
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="Your shop name"
            className="h-11 rounded-xl"
            maxLength={50}
          />
        </div>

        {/* NOTE: Portal-only fields (department, reports_to, org chart, etc.)
            are intentionally NOT shown here. They belong to /dashboard profile. */}
      </div>

      {/* Save */}
      <div className="mt-8">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full h-11 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
