"use client"

import Image from "next/image"
import { FormEvent, useEffect, useMemo, useState } from "react"
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
  UploadCloud,
  Wand2
} from "lucide-react"

type RedeemItemRow = Database["public"]["Tables"]["redeem_items"]["Row"]

type RewardFormState = {
  itemName: string
  itemCode: string
  description: string
  points: string
  stock: string
  maxPerConsumer: string
  terms: string
  validFrom: string
  validUntil: string
  imageUrl: string
  isActive: boolean
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
    stock: "",
    maxPerConsumer: "",
    terms: "",
    validFrom: "",
    validUntil: "",
    imageUrl: "",
    isActive: true
  })
  const [category, setCategory] = useState<RewardCategory>("other")
  const [requiresVerification, setRequiresVerification] = useState(false)
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false)
  const [loading, setLoading] = useState(mode === "edit")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (mode !== "edit" || !rewardId) return

    setLoading(true)

    const loadReward = async () => {
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
        setLoading(false)
        return
      }

      setForm({
        itemName: data.item_name,
        itemCode: data.item_code,
        description: data.item_description ?? "",
        points: data.points_required.toString(),
        stock: data.stock_quantity != null ? data.stock_quantity.toString() : "",
        maxPerConsumer: data.max_redemptions_per_consumer != null ? data.max_redemptions_per_consumer.toString() : "",
        terms: data.terms_and_conditions ?? "",
        validFrom: data.valid_from ? formatDateForInput(data.valid_from) : "",
        validUntil: data.valid_until ? formatDateForInput(data.valid_until) : "",
        imageUrl: data.item_image_url ?? "",
        isActive: data.is_active
      })
      setCategory(deriveCategory(data))
      setRequiresVerification(Boolean(data.max_redemptions_per_consumer && data.max_redemptions_per_consumer <= 1))
      setCodeManuallyEdited(true)
      setLoading(false)
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

  const parsedPoints = Number(form.points)
  const parsedStock = form.stock.trim() === "" ? null : Number(form.stock)
  const parsedMaxPerConsumer = form.maxPerConsumer.trim() === "" ? null : Number(form.maxPerConsumer)

  const previewReward = useMemo(() => {
    const draft: RedeemItemRow = {
      id: rewardId ?? "preview",
      company_id: userProfile.organizations.id,
      item_code: form.itemCode || "PREVIEW-REWARD",
      item_name: form.itemName || "Reward name",
      item_description: form.description || null,
      item_image_url: form.imageUrl || null,
      points_required: Number.isFinite(parsedPoints) ? parsedPoints : 0,
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
  }, [form, parsedMaxPerConsumer, parsedPoints, parsedStock, requiresVerification, rewardId, userProfile.id, userProfile.organizations.id])

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

    const normalizedCode = form.itemCode.trim().toUpperCase()
    const payload = {
      item_name: form.itemName.trim(),
      item_code: normalizedCode,
      item_description: form.description.trim() ? form.description.trim() : null,
      item_image_url: form.imageUrl.trim() ? form.imageUrl.trim() : null,
      points_required: parsedPoints,
      stock_quantity: parsedStock,
      max_redemptions_per_consumer: requiresVerification
        ? parsedMaxPerConsumer ?? 1
        : parsedMaxPerConsumer,
      is_active: form.isActive,
      valid_from: form.validFrom ? new Date(form.validFrom).toISOString() : null,
      valid_until: form.validUntil ? new Date(form.validUntil).toISOString() : null,
      terms_and_conditions: form.terms.trim() ? form.terms.trim() : null
    }

    setSaving(true)

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
                        {(Object.keys(CATEGORY_LABELS) as RewardCategory[]).map((key) => (
                          <SelectItem key={key} value={key} className="capitalize">
                            {CATEGORY_LABELS[key]}
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

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="imageUrl">Image URL</Label>
                    <Input
                      id="imageUrl"
                      placeholder="https://…"
                      value={form.imageUrl}
                      onChange={(event) => updateForm("imageUrl", event.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-3 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-4 text-sm">
                    <UploadCloud className="h-5 w-5 text-muted-foreground" />
                    <span className="text-muted-foreground">Upload via Supabase Storage and paste the public URL here.</span>
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
                <div className="relative h-40 w-full bg-muted">
                  {previewReward.item_image_url ? (
                    <Image src={previewReward.item_image_url} alt={previewReward.item_name} fill className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted-foreground/20">
                      <Gift className="h-10 w-10 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                    <Badge className="bg-white/90 text-xs text-foreground shadow">
                      {CATEGORY_LABELS[previewReward.category]}
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
                      <span className="text-2xl font-semibold">{formatNumber(previewReward.points_required)}</span>
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
