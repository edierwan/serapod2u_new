'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Warehouse } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/use-toast'
import { createClient } from '@/lib/supabase/client'
import {
  buildSetDefaultFulfillmentConfirmMessage,
  shouldShowDistributorFulfillmentCard,
} from '@/lib/organizations/distributor-fulfillment-default'

interface OrgRef {
  id: string
  org_name: string
  org_type_code: string
  parent_org_id?: string | null
  is_active?: boolean | null
  default_warehouse_org_id?: string | null
}

interface DistributorOrderFulfillmentCardProps {
  warehouse: OrgRef
  parentHq: OrgRef | null
  onDefaultChanged?: () => void
}

export default function DistributorOrderFulfillmentCard({
  warehouse,
  parentHq,
  onDefaultChanged,
}: DistributorOrderFulfillmentCardProps) {
  const supabase = createClient()
  const { toast } = useToast()
  const [isHqAdmin, setIsHqAdmin] = useState(false)
  const [checkingAdmin, setCheckingAdmin] = useState(true)
  const [defaultWarehouseId, setDefaultWarehouseId] = useState<string | null>(
    parentHq?.default_warehouse_org_id || null,
  )
  const [defaultWarehouseName, setDefaultWarehouseName] = useState<string | null>(null)
  const [loadingDefault, setLoadingDefault] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const visible = shouldShowDistributorFulfillmentCard(warehouse, parentHq)
  const isCurrentDefault = Boolean(defaultWarehouseId && defaultWarehouseId === warehouse.id)

  useEffect(() => {
    let cancelled = false
    void supabase.rpc('is_hq_admin').then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        setIsHqAdmin(false)
      } else {
        setIsHqAdmin(Boolean(data))
      }
      setCheckingAdmin(false)
    })
    return () => {
      cancelled = true
    }
  }, [supabase])

  const refreshDefault = async () => {
    if (!parentHq?.id) {
      setDefaultWarehouseId(null)
      setDefaultWarehouseName(null)
      setLoadingDefault(false)
      return
    }

    setLoadingDefault(true)
    try {
      const { data: hq, error: hqError } = await supabase
        .from('organizations')
        .select('id, org_name, default_warehouse_org_id')
        .eq('id', parentHq.id)
        .maybeSingle()
      if (hqError) throw hqError

      const nextDefaultId = hq?.default_warehouse_org_id || null
      setDefaultWarehouseId(nextDefaultId)

      if (!nextDefaultId) {
        setDefaultWarehouseName(null)
        return
      }

      if (nextDefaultId === warehouse.id) {
        setDefaultWarehouseName(warehouse.org_name)
        return
      }

      const { data: currentDefault, error: defaultError } = await supabase
        .from('organizations')
        .select('id, org_name')
        .eq('id', nextDefaultId)
        .maybeSingle()
      if (defaultError) throw defaultError
      setDefaultWarehouseName(currentDefault?.org_name || 'Unknown warehouse')
    } catch (error) {
      console.error('Failed to load default fulfillment warehouse:', error)
      setDefaultWarehouseName(null)
    } finally {
      setLoadingDefault(false)
    }
  }

  useEffect(() => {
    if (!visible) return
    void refreshDefault()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, parentHq?.id, warehouse.id])

  if (!visible || !parentHq) return null

  const handleConfirmSetDefault = async () => {
    if (!isHqAdmin) {
      toast({
        title: 'Permission denied',
        description: 'Only HQ Admin can change the default fulfillment warehouse.',
        variant: 'destructive',
      })
      setConfirmOpen(false)
      return
    }

    setSaving(true)
    try {
      const response = await fetch('/api/organizations/set-default-warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hq_org_id: parentHq.id,
          warehouse_org_id: warehouse.id,
        }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(result?.error || 'Failed to set default fulfillment warehouse')
      }

      await refreshDefault()
      onDefaultChanged?.()
      toast({
        title: 'Default fulfillment warehouse updated',
        description: `${warehouse.org_name} is now the default for new distributor orders under ${parentHq.org_name}.`,
      })
      setConfirmOpen(false)
    } catch (error: any) {
      toast({
        title: 'Unable to update default',
        description: error?.message || 'Failed to set default fulfillment warehouse',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card className="border-blue-200 bg-blue-50/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Warehouse className="h-4 w-4 text-blue-700" />
            Distributor Order Fulfillment
          </CardTitle>
          <CardDescription>
            Controls which warehouse is pre-selected for new distributor orders under {parentHq.org_name}.
            Existing orders are never changed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {checkingAdmin || loadingDefault ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading fulfillment default…
            </div>
          ) : isCurrentDefault ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3">
              <div className="mb-1 flex items-center gap-2">
                <Badge className="bg-emerald-600 hover:bg-emerald-600">
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  Current Default
                </Badge>
              </div>
              <p className="text-sm text-emerald-900">
                This warehouse is the default fulfillment warehouse for new distributor orders under{' '}
                <span className="font-medium">{parentHq.org_name}</span>.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-background px-3 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Current Default
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {defaultWarehouseName || 'No default fulfillment warehouse is configured'}
                </p>
              </div>
              {isHqAdmin ? (
                <Button type="button" onClick={() => setConfirmOpen(true)} disabled={saving}>
                  Set This Warehouse as Default
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Only HQ Admin can change the default fulfillment warehouse.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set default fulfillment warehouse?</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {buildSetDefaultFulfillmentConfirmMessage(warehouse.org_name, parentHq.org_name)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmSetDefault()
              }}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Set as Default'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
