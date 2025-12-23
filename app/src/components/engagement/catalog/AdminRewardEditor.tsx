"use client"

import NextImage from "next/image"
import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import type { Database } from "@/types/database"
import type { UserProfileWithRelations } from "@/lib/server/get-user-profile"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import {
  CATEGORY_LABELS,
  RewardCategory,
  deriveCategory,
  enrichReward,
  formatDateLabel,
  formatNumber,
  getStatusBadgeClass
} from "./catalog-utils"
import { useToast } from "@/components/ui/use-toast"
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  Gift,
  Loader2,
  ShieldCheck,
  Sparkles,
  Star,
  UploadCloud,
  Wand2,
  X
} from "lucide-react"

type RedeemItemRow = Database["public"]["Tables"]["redeem_items"]["Row"]

// Image compression utility for reward images
// Similar to avatar compression but optimized for reward display
const compressImage = (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = document.createElement('img')
      img.src = event.target?.result as string
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height
        
        // Aggressive compression for mobile optimization (< 5KB target)
        const MAX_WIDTH = 800 // Increased from 150 to 800 for better quality
        const MAX_HEIGHT = 800 // Increased from 150 to 800 for better quality
        
        // Calculate new dimensions while maintaining aspect ratio
        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width)
            width = MAX_WIDTH
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height)
            height = MAX_HEIGHT
          }
        }
        
        canvas.width = width
        canvas.height = height
        
        const ctx = canvas.getContext('2d')
        // Fill white background for JPEGs (transparency becomes black otherwise)
        if (ctx) {
            ctx.fillStyle = '#FFFFFF'
            ctx.fillRect(0, 0, width, height)
            ctx.drawImage(img, 0, 0, width, height)
        }
        
        // Convert to JPEG with aggressive compression (quality 0.5 = 50%)
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
                type: 'image/jpeg',
                lastModified: Date.now(),
              })
              console.log(`🖼️ Reward image compressed: ${(file.size / 1024).toFixed(2)}KB → ${(compressedFile.size / 1024).toFixed(2)}KB`)
              resolve(compressedFile)
            } else {
              reject(new Error('Canvas to Blob conversion failed'))
            }
          },
          'image/jpeg',
          0.8 // Better quality (80%)
        )
      }
      img.onerror = () => reject(new Error('Image loading failed'))
    }
    reader.onerror = () => reject(new Error('File reading failed'))
  })
}

type RewardFormState = {
  itemName: string
  itemCode: string
  description: string
  points: string
  pointOffer: string
  stock: string
  maxPerConsumer: string
  terms: string
  validFrom: string
  validUntil: string
  imageUrl: string
  additionalImages: string[]
  isActive: boolean
}

interface ImageItem {
  id: string
  url: string
  file?: File
  isDefault: boolean
}

interface AdminRewardEditorProps {
  userProfile: UserProfileWithRelations
  rewardId?: string
  mode?: "create" | "edit"
}

function generateCode(name: string, category: RewardCategory): string {
  const sanitizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
  const prefix = category.replace(/_/g, "-").toUpperCase()
  if (!sanitizedName) {
    return `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  }
  return `${prefix}-${sanitizedName}`.toUpperCase()
}

function formatDateForInput(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (input: number) => input.toString().padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function AdminRewardEditor({ userProfile, rewardId, mode = "create" }: AdminRewardEditorProps) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()

  const [form, setForm] = useState<RewardFormState>({
    itemName: "",
    itemCode: generateCode("New Reward", "other"),
    description: "",
    points: "500",
    pointOffer: "",
    stock: "",
    maxPerConsumer: "",
    terms: "",
    validFrom: "",
    validUntil: "",
    imageUrl: "",
    additionalImages: [],
    isActive: true
  })
  const [category, setCategory] = useState<RewardCategory>("other")
  const [requiresVerification, setRequiresVerification] = useState(false)
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false)
  const [loading, setLoading] = useState(mode === "edit")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [images, setImages] = useState<ImageItem[]>([])
  const [uploadingImage, setUploadingImage] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [pointValueRM, setPointValueRM] = useState<number>(0)
  const [categoryLabels, setCategoryLabels] = useState<Record<RewardCategory, string>>(CATEGORY_LABELS)

  useEffect(() => {
    const fetchSettings = async () => {
      const { data: orgData } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', userProfile.organizations.id)
        .single()

      if (orgData?.settings && typeof orgData.settings === 'object') {
        const settings = orgData.settings as any
        if (settings.point_value_rm) {
          setPointValueRM(settings.point_value_rm)
        }
        if (settings.category_labels) {
          setCategoryLabels({ ...CATEGORY_LABELS, ...settings.category_labels })
        }
      }
    }
    fetchSettings()
  }, [supabase, userProfile.organizations.id])

  useEffect(() => {
    if (mode !== "edit" || !rewardId) return

    const loadReward = async () => {
      try {
        setLoading(true)
        
        const { data, error } = await supabase
          .from("redeem_items")
          .select("*")
          .eq("id", rewardId)
          .single()

        if (error || !data) {
          console.error("Failed to load reward", error)
          toast({
            title: "Unable to load reward",
            description: error?.message ?? "Please return to the catalog and try again.",
            variant: "destructive"
          })
          return
        }

        setForm({
          itemName: data.item_name,
          itemCode: data.item_code,
          description: data.item_description ?? "",
          points: data.points_required.toString(),
          pointOffer: (data as any).point_offer ? (data as any).point_offer.toString() : "",
          stock: data.stock_quantity != null ? data.stock_quantity.toString() : "",
          maxPerConsumer: data.max_redemptions_per_consumer != null ? data.max_redemptions_per_consumer.toString() : "",
          terms: data.terms_and_conditions ?? "",
          validFrom: data.valid_from ? formatDateForInput(data.valid_from) : "",
          validUntil: data.valid_until ? formatDateForInput(data.valid_until) : "",
          imageUrl: data.item_image_url ?? "",
          additionalImages: (data as any).additional_images ?? [],
          isActive: data.is_active ?? true
        })
        setCategory(deriveCategory(data))
        setRequiresVerification(Boolean(data.max_redemptions_per_consumer && data.max_redemptions_per_consumer <= 1))
        setCodeManuallyEdited(true)
        
        // Initialize images state
        const loadedImages: ImageItem[] = []
        const additionalImages = (data as any).additional_images as string[] || []
        
        // If we have additional_images, use them. Otherwise fallback to item_image_url
        if (additionalImages.length > 0) {
            additionalImages.forEach((url, index) => {
                loadedImages.push({
                    id: `loaded-${index}`,
                    url,
                    isDefault: url === data.item_image_url
                })
            })
            // Ensure one is default if none matched (e.g. url changed)
            if (!loadedImages.some(img => img.isDefault) && loadedImages.length > 0) {
                loadedImages[0].isDefault = true
            }
        } else if (data.item_image_url) {
            loadedImages.push({
                id: 'loaded-default',
                url: data.item_image_url,
                isDefault: true
            })
        }
        setImages(loadedImages)

      } catch (error: any) {
        console.error("Error loading reward:", error)
        toast({
          title: "Error",
          description: "Failed to load reward details",
          variant: "destructive"
        })
      } finally {
        setLoading(false)
      }
    }

    loadReward()
  }, [mode, rewardId, supabase, toast])

  useEffect(() => {
    if (mode === "edit" || codeManuallyEdited) return
    if (!form.itemName.trim()) return
    const generated = generateCode(form.itemName, category)
    if (generated !== form.itemCode) {
      setForm((prev) => ({ ...prev, itemCode: generated }))
    }
  }, [category, codeManuallyEdited, form.itemCode, form.itemName, mode])

  const updateForm = <K extends keyof RewardFormState>(field: K, value: RewardFormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    if (images.length + files.length > 5) {
        toast({
            title: "Too many images",
            description: "You can only upload a maximum of 5 images.",
            variant: "destructive"
        })
        return
    }

    const newImages: ImageItem[] = []

    for (let i = 0; i < files.length; i++) {
        const file = files[i]
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
            toast({
                title: "Invalid file type",
                description: "Please select an image file (JPG, PNG, GIF, or WebP).",
                variant: "destructive"
            })
            continue
        }

        // Validate file size (5MB max before compression)
        if (file.size > 5 * 1024 * 1024) {
            toast({
                title: "File too large",
                description: "Image must be less than 5MB.",
                variant: "destructive"
            })
            continue
        }

        try {
            // Compress the image
            const compressedFile = await compressImage(file)
            
            // Create preview
            const previewUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader()
                reader.onloadend = () => resolve(reader.result as string)
                reader.readAsDataURL(compressedFile)
            })

            newImages.push({
                id: `new-${Date.now()}-${i}`,
                url: previewUrl,
                file: compressedFile,
                isDefault: images.length === 0 && i === 0 // First image is default if no images exist
            })

        } catch (error) {
            console.error('Image compression failed:', error)
            toast({
                title: "Compression failed",
                description: "Could not process image. Please try a different file.",
                variant: "destructive"
            })
        }
    }

    setImages(prev => [...prev, ...newImages])
    
    // Reset input
    if (imageInputRef.current) {
        imageInputRef.current.value = ''
    }
  }

  const handleRemoveImage = (id: string) => {
    setImages(prev => {
        const newImages = prev.filter(img => img.id !== id)
        // If we removed the default image, make the first one default
        if (prev.find(img => img.id === id)?.isDefault && newImages.length > 0) {
            newImages[0].isDefault = true
        }
        return newImages
    })
  }

  const handleSetDefault = (id: string) => {
    setImages(prev => prev.map(img => ({
        ...img,
        isDefault: img.id === id
    })))
  }

  const uploadImageToStorage = async (file: File): Promise<string | null> => {
    try {
      const fileName = `reward-${userProfile.organizations.id}-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`

      // Upload to avatars bucket
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, {
          contentType: file.type,
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw uploadError

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(uploadData.path)

      // Add cache-busting parameter
      return `${publicUrl}?v=${Date.now()}`
    } catch (error: any) {
      console.error('Failed to upload image', error)
      return null
    }
  }

  const parsedPoints = Number(form.points)
  const parsedPointOffer = form.pointOffer.trim() === "" ? null : Number(form.pointOffer)
  const parsedStock = form.stock.trim() === "" ? null : Number(form.stock)
  const parsedMaxPerConsumer = form.maxPerConsumer.trim() === "" ? null : Number(form.maxPerConsumer)

  const previewReward = useMemo(() => {
    const defaultImage = images.find(img => img.isDefault) || images[0]
    const draft: RedeemItemRow & { point_offer?: number | null } = {
      id: rewardId ?? "preview",
      company_id: userProfile.organizations.id,
      item_code: form.itemCode || "PREVIEW-REWARD",
      item_name: form.itemName || "Reward name",
      item_description: form.description || null,
      item_image_url: defaultImage?.url || null,
      points_required: Number.isFinite(parsedPoints) ? parsedPoints : 0,
      point_offer: parsedPointOffer,
      stock_quantity: parsedStock ?? null,
      max_redemptions_per_consumer: requiresVerification
        ? parsedMaxPerConsumer ?? 1
        : parsedMaxPerConsumer,
      is_active: form.isActive,
      valid_from: form.validFrom ? new Date(form.validFrom).toISOString() : null,
      valid_until: form.validUntil ? new Date(form.validUntil).toISOString() : null,
      terms_and_conditions: form.terms || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: userProfile.id
    }
    return enrichReward(draft)
  }, [form, parsedMaxPerConsumer, parsedPoints, parsedPointOffer, parsedStock, requiresVerification, rewardId, userProfile.id, userProfile.organizations.id, images])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!form.itemName.trim()) {
      toast({ title: "Reward name required", description: "Please provide a descriptive reward name.", variant: "destructive" })
      return
    }

    if (!form.itemCode.trim()) {
      toast({ title: "Reward code required", description: "Each reward needs a unique code for tracking.", variant: "destructive" })
      return
    }

    if (!Number.isFinite(parsedPoints) || parsedPoints <= 0) {
      toast({ title: "Invalid points", description: "Points required must be a positive number.", variant: "destructive" })
      return
    }

    if (parsedStock != null && (!Number.isFinite(parsedStock) || parsedStock < 0)) {
      toast({ title: "Invalid stock", description: "Stock quantity must be zero or greater.", variant: "destructive" })
      return
    }

    if (
      parsedMaxPerConsumer != null &&
      (!Number.isFinite(parsedMaxPerConsumer) || parsedMaxPerConsumer <= 0)
    ) {
      toast({
        title: "Invalid limit",
        description: "Max per consumer must be a positive number.",
        variant: "destructive"
      })
      return
    }

    setSaving(true)
    setUploadingImage(true)

    // Upload images
    const finalImages: string[] = []
    let defaultImageUrl: string | null = null

    try {
        for (const img of images) {
            let url = img.url
            if (img.file) {
                const uploadedUrl = await uploadImageToStorage(img.file)
                if (uploadedUrl) {
                    url = uploadedUrl
                } else {
                    throw new Error("Failed to upload image")
                }
            }
            finalImages.push(url)
            if (img.isDefault) {
                defaultImageUrl = url
            }
        }
        
        // If no default set but we have images, use the first one
        if (!defaultImageUrl && finalImages.length > 0) {
            defaultImageUrl = finalImages[0]
        }

    } catch (error) {
        setSaving(false)
        setUploadingImage(false)
        toast({
            title: "Upload failed",
            description: "Failed to upload one or more images.",
            variant: "destructive"
        })
        return
    }
    
    setUploadingImage(false)

    const normalizedCode = form.itemCode.trim().toUpperCase()
    const payload = {
      item_name: form.itemName.trim(),
      item_code: normalizedCode,
      item_description: form.description.trim() ? form.description.trim() : null,
      item_image_url: defaultImageUrl,
      additional_images: finalImages, // Store all images here
      points_required: parsedPoints,
      point_offer: parsedPointOffer,
      stock_quantity: parsedStock,
      max_redemptions_per_consumer: requiresVerification
        ? parsedMaxPerConsumer ?? 1
        : parsedMaxPerConsumer,
      is_active: form.isActive,
      valid_from: form.validFrom ? new Date(form.validFrom).toISOString() : null,
      valid_until: form.validUntil ? new Date(form.validUntil).toISOString() : null,
      terms_and_conditions: form.terms.trim() ? form.terms.trim() : null
    }

    try {
      if (mode === "edit" && rewardId) {
        const { error } = await supabase
          .from("redeem_items")
          .update(payload)
          .eq("id", rewardId)

        if (error) throw error

        toast({ title: "Reward updated", description: "Changes saved successfully." })
      } else {
        const { error } = await supabase.from("redeem_items").insert({
          ...payload,
          company_id: userProfile.organizations.id,
          created_by: userProfile.id
        })

        if (error) throw error

        toast({ title: "Reward created", description: "Your new reward is now live for shops." })
      }

      router.push("/engagement/catalog/admin")
    } catch (error: any) {
      console.error("Failed to save reward", error)
      toast({
        title: "Save failed",
        description: error?.message ?? "Something went wrong while saving the reward.",
        variant: "destructive"
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (mode !== "edit" || !rewardId) return
    const confirmed = window.confirm("This will permanently remove the reward. Continue?")
    if (!confirmed) return

    setDeleting(true)
    try {
      const { error } = await supabase.from("redeem_items").delete().eq("id", rewardId)
      if (error) throw error
      toast({ title: "Reward deleted", description: "Reward removed from the catalog." })
      router.push("/engagement/catalog/admin")
    } catch (error: any) {
      console.error("Failed to delete reward", error)
      toast({
        title: "Delete failed",
        description: error?.message ?? "Unable to delete reward. Please try again.",
        variant: "destructive"
      })
    } finally {
      setDeleting(false)
    }
  }

  const handleVerificationToggle = (checked: boolean) => {
    setRequiresVerification(checked)
    if (checked && !form.maxPerConsumer.trim()) {
      updateForm("maxPerConsumer", "1")
    }
    if (!checked && form.maxPerConsumer.trim() === "1") {
      updateForm("maxPerConsumer", "")
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Point Catalog • Admin</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            {mode === "edit" ? "Update reward" : "Create reward"}
          </h2>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="gap-2" onClick={() => router.push("/engagement/catalog/admin")}
            >
            <ArrowLeft className="h-4 w-4" /> Back to catalog
          </Button>
          {mode === "edit" && (
            <Button
              type="button"
              variant="outline"
              className="gap-2 text-destructive"
              onClick={handleDelete}
              disabled={deleting || saving}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              Delete reward
            </Button>
          )}
          <Button type="submit" className="gap-2" disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {mode === "edit" ? "Save changes" : "Create reward"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Gift className="h-4 w-4" /> Reward details
            </CardTitle>
            <CardDescription>
              Craft a compelling reward and control when it appears to shop users.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {loading ? (
              <div className="flex items-center gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading reward details…
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label htmlFor="itemName">Reward name</Label>
                    <Input
                      id="itemName"
                      placeholder="Premium Merch Bundle"
                      value={form.itemName}
                      onChange={(event) => updateForm("itemName", event.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Category</Label>
                    <Select value={category} onValueChange={(value: RewardCategory) => setCategory(value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(categoryLabels) as RewardCategory[]).map((key) => (
                          <SelectItem key={key} value={key} className="capitalize">
                            {categoryLabels[key]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="itemCode">Reward code</Label>
                    <div className="flex gap-2">
                      <Input
                        id="itemCode"
                        placeholder="DEVICE-PRO-BUNDLE"
                        value={form.itemCode}
                        onChange={(event) => {
                          setCodeManuallyEdited(true)
                          updateForm("itemCode", event.target.value.toUpperCase())
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2"
                        onClick={() => {
                          const generated = generateCode(form.itemName || "Reward", category)
                          updateForm("itemCode", generated)
                          setCodeManuallyEdited(true)
                        }}
                      >
                        <Wand2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="points">Points required</Label>
                    <Input
                      id="points"
                      type="number"
                      min={1}
                      value={form.points}
                      onChange={(event) => updateForm("points", event.target.value)}
                    />
                    {pointValueRM > 0 && form.points && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Estimated Cost: RM {(parseInt(form.points) * pointValueRM).toFixed(2)}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="pointOffer">Point Offer (Optional)</Label>
                    <Input
                      id="pointOffer"
                      type="number"
                      min={1}
                      placeholder="Discounted points"
                      value={form.pointOffer}
                      onChange={(event) => updateForm("pointOffer", event.target.value)}
                    />
                    {pointValueRM > 0 && form.pointOffer && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Estimated Cost: RM {(parseInt(form.pointOffer) * pointValueRM).toFixed(2)}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="stock">Stock quantity</Label>
                    <Input
                      id="stock"
                      type="number"
                      min={0}
                      placeholder="Unlimited"
                      value={form.stock}
                      onChange={(event) => updateForm("stock", event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="validFrom">Valid from</Label>
                    <Input
                      id="validFrom"
                      type="datetime-local"
                      value={form.validFrom}
                      onChange={(event) => updateForm("validFrom", event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="validUntil">Valid until</Label>
                    <Input
                      id="validUntil"
                      type="datetime-local"
                      value={form.validUntil}
                      onChange={(event) => updateForm("validUntil", event.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <Label>Reward Images (Max 5)</Label>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {images.map((img, index) => (
                            <div key={img.id} className="relative group aspect-square rounded-lg border border-muted-foreground/20 bg-muted overflow-hidden">
                                <NextImage 
                                    src={img.url} 
                                    alt={`Reward image ${index + 1}`} 
                                    fill 
                                    className="object-contain"
                                    unoptimized={img.url.startsWith('data:')}
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => handleSetDefault(img.id)}
                                        title="Set as default"
                                    >
                                        <Star className={`h-4 w-4 ${img.isDefault ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => handleRemoveImage(img.id)}
                                        title="Remove image"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                                {img.isDefault && (
                                    <div className="absolute top-2 right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
                                        Default
                                    </div>
                                )}
                            </div>
                        ))}
                        {images.length < 5 && (
                            <div 
                                className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/50 transition-colors flex flex-col items-center justify-center cursor-pointer"
                                onClick={() => imageInputRef.current?.click()}
                            >
                                <UploadCloud className="h-8 w-8 text-muted-foreground/50 mb-2" />
                                <span className="text-xs text-muted-foreground font-medium">Add Image</span>
                            </div>
                        )}
                    </div>

                    <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                        multiple
                        onChange={handleImageFileChange}
                        className="hidden"
                    />
                    <p className="text-xs text-muted-foreground">
                        Recommended: 1:1 ratio, max 5MB per image. First image or marked default will be shown in lists.
                    </p>
                  </div>
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    rows={4}
                    placeholder="Describe the reward, how to redeem, and any highlights."
                    value={form.description}
                    onChange={(event) => updateForm("description", event.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="terms">Terms & conditions</Label>
                  <Textarea
                    id="terms"
                    rows={3}
                    placeholder="Optional fine print for shops or consumers."
                    value={form.terms}
                    onChange={(event) => updateForm("terms", event.target.value)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-start justify-between rounded-lg border border-muted-foreground/30 bg-muted/20 p-4">
                    <div>
                      <h4 className="text-sm font-medium text-foreground">Reward is active</h4>
                      <p className="text-xs text-muted-foreground">Deactivate to hide from shop users while keeping data intact.</p>
                    </div>
                    <Switch checked={form.isActive} onCheckedChange={(checked) => updateForm("isActive", checked)} />
                  </div>

                  <div className="flex items-start justify-between rounded-lg border border-muted-foreground/30 bg-muted/20 p-4">
                    <div>
                      <h4 className="text-sm font-medium text-foreground">Requires verification</h4>
                      <p className="text-xs text-muted-foreground">Limit redemptions to staff approval (auto sets limit to one per consumer).</p>
                      <div className="mt-2">
                        <Label htmlFor="maxPerConsumer" className="text-xs text-muted-foreground">Max per consumer</Label>
                        <Input
                          id="maxPerConsumer"
                          type="number"
                          min={1}
                          disabled={!requiresVerification}
                          value={form.maxPerConsumer}
                          onChange={(event) => updateForm("maxPerConsumer", event.target.value)}
                          className="mt-1 h-8"
                        />
                      </div>
                    </div>
                    <Switch checked={requiresVerification} onCheckedChange={handleVerificationToggle} />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-4 w-4" /> Live preview
              </CardTitle>
              <CardDescription>How shops will see this reward.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-hidden rounded-xl border border-muted-foreground/20">
                <div className="relative h-40 sm:h-48 w-full bg-muted">
                  {previewReward.item_image_url ? (
                    <NextImage 
                      src={previewReward.item_image_url} 
                      alt={previewReward.item_name} 
                      fill 
                      className="object-contain" 
                      style={{ objectPosition: 'center' }}
                      unoptimized={previewReward.item_image_url.startsWith('data:')}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted-foreground/20">
                      <Gift className="h-10 w-10 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                    <Badge className="bg-white/90 text-xs text-foreground shadow">
                      {categoryLabels[previewReward.category]}
                    </Badge>
                    <Badge className={getStatusBadgeClass(previewReward.status)}>{previewReward.status}</Badge>
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{previewReward.item_name || "Reward name"}</h3>
                    <p className="text-xs uppercase text-muted-foreground">{previewReward.item_code}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {previewReward.item_description ?? "Add a description to explain the reward benefits."}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-blue-600">
                      <Sparkles className="h-4 w-4" />
                      {(previewReward as any).point_offer ? (
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-bold text-green-600">{formatNumber((previewReward as any).point_offer)}</span>
                          <span className="text-lg text-muted-foreground line-through decoration-2">{formatNumber(previewReward.points_required)}</span>
                        </div>
                      ) : (
                        <span className="text-2xl font-semibold">{formatNumber(previewReward.points_required)}</span>
                      )}
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">points</span>
                    </div>
                    <div className="text-xs text-muted-foreground text-right">
                      <div>Start: {previewReward.valid_from ? formatDateLabel(previewReward.valid_from) : "Immediate"}</div>
                      <div>End: {previewReward.valid_until ? formatDateLabel(previewReward.valid_until) : "No end"}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Stock: {previewReward.stock_quantity != null ? `${previewReward.stock_quantity} units` : "Unlimited"}</span>
                    <span>
                      {requiresVerification ? (
                        <span className="flex items-center gap-1 text-amber-600">
                          <ShieldCheck className="h-3.5 w-3.5" /> Staff verification
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-emerald-600">
                          <Check className="h-3.5 w-3.5" /> Auto approval
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <CalendarClock className="h-4 w-4" /> Redemption guardrails
                </div>
                <ul className="mt-2 space-y-1">
                  <li>• Reward is {previewReward.is_active ? "active" : "inactive"} for shops.</li>
                  <li>• {requiresVerification ? "Manual verification required" : "Redeemable instantly by qualifying shops"}.</li>
                  <li>• {previewReward.max_redemptions_per_consumer ? `Limited to ${previewReward.max_redemptions_per_consumer} per consumer.` : "No per-consumer limit set."}</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card className="border-dashed border-primary/40 bg-primary/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg text-primary">
                <ShieldCheck className="h-4 w-4" /> Publishing checklist
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-primary">
              <p>✅ Use clear reward names that shops can recognise.</p>
              <p>✅ Upload rich imagery for stronger engagement.</p>
              <p>✅ Set start and end dates to align with campaigns.</p>
              <p>✅ Turn on verification for high-value items.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  )
}
