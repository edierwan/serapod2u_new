'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Save, RotateCcw } from "lucide-react"
import { CATEGORY_LABELS, RewardCategory } from "./catalog-utils"
import { useToast } from "@/components/ui/use-toast"

interface CategorySettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userProfile: any
  onUpdate: (newLabels: Record<RewardCategory, string>) => void
  currentLabels: Record<RewardCategory, string>
}

export function CategorySettingsDialog({ 
  open, 
  onOpenChange, 
  userProfile,
  onUpdate,
  currentLabels
}: CategorySettingsDialogProps) {
  const supabase = createClient()
  const { toast } = useToast()
  const [labels, setLabels] = useState<Record<RewardCategory, string>>(currentLabels)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLabels(currentLabels)
  }, [currentLabels, open])

  const handleReset = () => {
    setLabels(CATEGORY_LABELS)
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      
      // Get current settings
      const { data: orgData } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', userProfile.organizations.id)
        .single()

      const currentSettings = (orgData?.settings as any) || {}
      const newSettings = {
        ...currentSettings,
        category_labels: labels
      }

      const { error } = await supabase
        .from('organizations')
        .update({ settings: newSettings })
        .eq('id', userProfile.organizations.id)

      if (error) throw error

      onUpdate(labels)
      onOpenChange(false)
      toast({
        title: "Categories updated",
        description: "Reward category names have been updated successfully."
      })
    } catch (error: any) {
      console.error('Error saving categories:', error)
      toast({
        title: "Error",
        description: "Failed to save category names.",
        variant: "destructive"
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Rename Categories</DialogTitle>
          <DialogDescription>
            Customize how reward categories appear to you and your team.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          {(Object.keys(CATEGORY_LABELS) as RewardCategory[]).map((key) => (
            <div key={key} className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor={key} className="text-right capitalize text-muted-foreground">
                {key.replace('_', ' ')}
              </Label>
              <Input
                id={key}
                value={labels[key]}
                onChange={(e) => setLabels({ ...labels, [key]: e.target.value })}
                className="col-span-3"
              />
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleReset} type="button">
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset Defaults
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
