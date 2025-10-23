'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Building2, Plus, Edit, Trash2, Star, StarOff, Loader2, X } from 'lucide-react'

interface ShopDistributor {
  id: string
  shop_id: string
  distributor_id: string
  account_number: string | null
  credit_limit: number | null
  payment_terms: string
  preferred_delivery_day: string | null
  delivery_notes: string | null
  is_active: boolean
  is_preferred: boolean
  total_orders: number
  total_value: number
  last_order_date: string | null
  distributor: {
    id: string
    org_name: string
    org_code: string
    contact_name: string
    contact_phone: string
  }
}

interface Distributor {
  id: string
  org_name: string
  org_code: string
}

interface ShopDistributorsManagerProps {
  shopId: string
  shopName: string
}

export default function ShopDistributorsManager({ shopId, shopName }: ShopDistributorsManagerProps) {
  const [shopDistributors, setShopDistributors] = useState<ShopDistributor[]>([])
  const [availableDistributors, setAvailableDistributors] = useState<Distributor[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [formData, setFormData] = useState({
    distributor_id: '',
    account_number: '',
    credit_limit: '',
    payment_terms: 'NET_30',
    preferred_delivery_day: '',
    delivery_notes: '',
    is_preferred: false
  })

  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadShopDistributors()
      loadAvailableDistributors()
    }
  }, [isReady, shopId])

  const loadShopDistributors = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('shop_distributors')
        .select(`
          *,
          distributor:organizations!distributor_id(
            id,
            org_name,
            org_code,
            contact_name,
            contact_phone
          )
        `)
        .eq('shop_id', shopId)
        .eq('is_active', true)
        .order('is_preferred', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error
      
      const transformed = (data || []).map((sd: any) => ({
        ...sd,
        distributor: Array.isArray(sd.distributor) ? sd.distributor[0] : sd.distributor
      }))
      
      setShopDistributors(transformed)
    } catch (error) {
      console.error('Error loading shop distributors:', error)
      toast({
        title: 'Error',
        description: 'Failed to load distributors',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const loadAvailableDistributors = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_name, org_code')
        .eq('org_type_code', 'DIST')
        .eq('is_active', true)
        .order('org_name')

      if (error) throw error
      setAvailableDistributors(data || [])
    } catch (error) {
      console.error('Error loading distributors:', error)
    }
  }

  const handleSetPreferred = async (shopDistributorId: string) => {
    try {
      // First, unset all preferred flags for this shop
      await (supabase as any)
        .from('shop_distributors')
        .update({ is_preferred: false })
        .eq('shop_id', shopId)

      // Then set the selected one as preferred
      const { error } = await (supabase as any)
        .from('shop_distributors')
        .update({ is_preferred: true })
        .eq('id', shopDistributorId)

      if (error) throw error

      toast({
        title: 'Success',
        description: 'Default distributor updated'
      })

      loadShopDistributors()
    } catch (error) {
      console.error('Error setting preferred distributor:', error)
      toast({
        title: 'Error',
        description: 'Failed to set default distributor',
        variant: 'destructive'
      })
    }
  }

  const handleAddDistributor = async () => {
    try {
      setIsSaving(true)

      // Check if already linked
      const { data: existing } = await supabase
        .from('shop_distributors')
        .select('id')
        .eq('shop_id', shopId)
        .eq('distributor_id', formData.distributor_id)
        .single()

      if (existing) {
        toast({
          title: 'Already Linked',
          description: 'This distributor is already linked to this shop',
          variant: 'destructive'
        })
        return
      }

      // If this is the first distributor or marked as preferred, unset others
      if (formData.is_preferred || shopDistributors.length === 0) {
        await (supabase as any)
          .from('shop_distributors')
          .update({ is_preferred: false })
          .eq('shop_id', shopId)
      }

      const { error } = await (supabase as any)
        .from('shop_distributors')
        .insert([{
          shop_id: shopId,
          distributor_id: formData.distributor_id,
          account_number: formData.account_number || null,
          credit_limit: formData.credit_limit ? parseFloat(formData.credit_limit) : null,
          payment_terms: formData.payment_terms,
          preferred_delivery_day: formData.preferred_delivery_day || null,
          delivery_notes: formData.delivery_notes || null,
          is_preferred: shopDistributors.length === 0 ? true : formData.is_preferred,
          is_active: true
        }])

      if (error) throw error

      toast({
        title: 'Success',
        description: 'Distributor linked successfully'
      })

      setDialogOpen(false)
      setFormData({
        distributor_id: '',
        account_number: '',
        credit_limit: '',
        payment_terms: 'NET_30',
        preferred_delivery_day: '',
        delivery_notes: '',
        is_preferred: false
      })
      loadShopDistributors()
    } catch (error) {
      console.error('Error adding distributor:', error)
      toast({
        title: 'Error',
        description: 'Failed to link distributor',
        variant: 'destructive'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleRemoveDistributor = async (shopDistributorId: string) => {
    if (!confirm('Are you sure you want to remove this distributor link?')) return

    try {
      const { error } = await (supabase as any)
        .from('shop_distributors')
        .update({ is_active: false })
        .eq('id', shopDistributorId)

      if (error) throw error

      toast({
        title: 'Success',
        description: 'Distributor removed successfully'
      })

      loadShopDistributors()
    } catch (error) {
      console.error('Error removing distributor:', error)
      toast({
        title: 'Error',
        description: 'Failed to remove distributor',
        variant: 'destructive'
      })
    }
  }

  const formatCurrency = (amount: number | null) => {
    if (!amount) return 'RM 0.00'
    return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Linked Distributors</CardTitle>
              <CardDescription>
                Manage distributor relationships for {shopName}
              </CardDescription>
            </div>
            <Button onClick={() => setDialogOpen(true)} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Link Distributor
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {shopDistributors.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Distributor</TableHead>
                    <TableHead>Account #</TableHead>
                    <TableHead>Payment Terms</TableHead>
                    <TableHead className="text-right">Credit Limit</TableHead>
                    <TableHead className="text-center">Orders</TableHead>
                    <TableHead className="text-center">Default</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shopDistributors.map((sd) => (
                    <TableRow key={sd.id} className={sd.is_preferred ? 'bg-blue-50' : ''}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                            <Building2 className="w-5 h-5 text-green-600" />
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{sd.distributor.org_name}</div>
                            <div className="text-sm text-gray-500">{sd.distributor.org_code}</div>
                            <div className="text-xs text-gray-400">{sd.distributor.contact_phone}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{sd.account_number || '-'}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{sd.payment_terms}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-sm font-medium">{formatCurrency(sd.credit_limit)}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="text-sm">
                          <div className="font-medium">{sd.total_orders}</div>
                          <div className="text-xs text-gray-500">{formatCurrency(sd.total_value)}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {sd.is_preferred ? (
                          <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                            <Star className="w-3 h-3 mr-1 fill-current" />
                            Default
                          </Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSetPreferred(sd.id)}
                            className="text-gray-400 hover:text-amber-600"
                          >
                            <StarOff className="w-4 h-4" />
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveDistributor(sd.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Distributors Linked</h3>
              <p className="text-gray-600 mb-4">
                Link distributors to enable ordering for this shop
              </p>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Link First Distributor
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Link Distributor to Shop</h2>
                <p className="text-sm text-gray-600">Add a new distributor relationship for ordering</p>
              </div>
              <button
                onClick={() => setDialogOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="distributor_id">Distributor *</Label>
                <Select
                  value={formData.distributor_id}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, distributor_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a distributor" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableDistributors
                      .filter(d => !shopDistributors.find(sd => sd.distributor_id === d.id))
                      .map(dist => (
                        <SelectItem key={dist.id} value={dist.id}>
                          {dist.org_name} ({dist.org_code})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="account_number">Account Number</Label>
                  <Input
                    id="account_number"
                    placeholder="e.g., ACC-12345"
                    value={formData.account_number}
                    onChange={(e) => setFormData(prev => ({ ...prev, account_number: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="credit_limit">Credit Limit (RM)</Label>
                  <Input
                    id="credit_limit"
                    type="number"
                    placeholder="0.00"
                    value={formData.credit_limit}
                    onChange={(e) => setFormData(prev => ({ ...prev, credit_limit: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="payment_terms">Payment Terms *</Label>
                  <Select
                    value={formData.payment_terms}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, payment_terms: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="COD">Cash on Delivery</SelectItem>
                      <SelectItem value="NET_7">Net 7 Days</SelectItem>
                      <SelectItem value="NET_15">Net 15 Days</SelectItem>
                      <SelectItem value="NET_30">Net 30 Days</SelectItem>
                      <SelectItem value="NET_60">Net 60 Days</SelectItem>
                      <SelectItem value="NET_90">Net 90 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="preferred_delivery_day">Preferred Delivery Day</Label>
                  <Input
                    id="preferred_delivery_day"
                    placeholder="e.g., Monday"
                    value={formData.preferred_delivery_day}
                    onChange={(e) => setFormData(prev => ({ ...prev, preferred_delivery_day: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="delivery_notes">Delivery Notes</Label>
                <Input
                  id="delivery_notes"
                  placeholder="Special instructions for deliveries"
                  value={formData.delivery_notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, delivery_notes: e.target.value }))}
                />
              </div>

              <div className="flex items-center gap-2 p-4 border border-gray-200 rounded-lg">
                <input
                  type="checkbox"
                  id="is_preferred"
                  checked={formData.is_preferred}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_preferred: e.target.checked }))}
                  className="w-4 h-4"
                />
                <div className="flex-1">
                  <Label htmlFor="is_preferred" className="cursor-pointer">
                    Set as Default Distributor
                  </Label>
                  <p className="text-xs text-gray-500">
                    This distributor will be pre-selected when creating orders
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end p-6 border-t border-gray-200 sticky bottom-0 bg-white">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                onClick={handleAddDistributor}
                disabled={isSaving || !formData.distributor_id}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Linking...
                  </>
                ) : (
                  'Link Distributor'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
