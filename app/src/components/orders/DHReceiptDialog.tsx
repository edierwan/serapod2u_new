'use client'

import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Upload, Receipt, Loader2, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/use-toast'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ReceiptEntry {
  id: string
  date: string
  paymentMethod: 'Bank' | 'Cash'
  amount: string
  reference: string
  attachmentFile: File | null
  attachmentUrl: string | null
}

interface DHReceiptDialogProps {
  orderId: string
  orderNo: string
  orderTotal: number
  paidAmount: number
  buyerOrgId: string
  sellerOrgId: string
  companyId: string
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

export default function DHReceiptDialog({
  orderId,
  orderNo,
  orderTotal,
  paidAmount,
  buyerOrgId,
  sellerOrgId,
  companyId,
  open,
  onClose,
  onSuccess
}: DHReceiptDialogProps) {
  const [receipts, setReceipts] = useState<ReceiptEntry[]>([
    {
      id: crypto.randomUUID(),
      date: new Date().toISOString().split('T')[0],
      paymentMethod: 'Bank',
      amount: '',
      reference: '',
      attachmentFile: null,
      attachmentUrl: null
    }
  ])
  const [saving, setSaving] = useState(false)
  const [existingReceipts, setExistingReceipts] = useState<any[]>([])
  const [loadingReceipts, setLoadingReceipts] = useState(true)
  const supabase = createClient()

  // Load existing receipts for this order
  useEffect(() => {
    if (open && orderId) {
      loadExistingReceipts()
    }
  }, [open, orderId])

  async function loadExistingReceipts() {
    try {
      setLoadingReceipts(true)
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('order_id', orderId)
        .eq('doc_type', 'RECEIPT')
        .order('created_at', { ascending: true })

      if (error) throw error
      setExistingReceipts(data || [])
    } catch (error) {
      console.error('Error loading existing receipts:', error)
    } finally {
      setLoadingReceipts(false)
    }
  }

  // Calculate totals
  const totalPaidPreviously = existingReceipts.reduce((sum, r) => {
    const amount = r.payload?.amount || 0
    return sum + Number(amount)
  }, 0)

  const newReceiptTotal = receipts.reduce((sum, r) => {
    const amount = parseFloat(r.amount) || 0
    return sum + amount
  }, 0)

  const totalPaidWithNew = totalPaidPreviously + newReceiptTotal
  const remainingBalance = orderTotal - totalPaidWithNew

  const addReceipt = () => {
    setReceipts([
      ...receipts,
      {
        id: crypto.randomUUID(),
        date: new Date().toISOString().split('T')[0],
        paymentMethod: 'Bank',
        amount: '',
        reference: '',
        attachmentFile: null,
        attachmentUrl: null
      }
    ])
  }

  const removeReceipt = (id: string) => {
    if (receipts.length > 1) {
      setReceipts(receipts.filter(r => r.id !== id))
    }
  }

  const updateReceipt = (id: string, field: keyof ReceiptEntry, value: any) => {
    setReceipts(receipts.map(r => 
      r.id === id ? { ...r, [field]: value } : r
    ))
  }

  const handleFileChange = (id: string, file: File | null) => {
    updateReceipt(id, 'attachmentFile', file)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-MY', {
      style: 'currency',
      currency: 'MYR',
      minimumFractionDigits: 2
    }).format(amount)
  }

  const handleSave = async () => {
    // Validation
    const validReceipts = receipts.filter(r => {
      const amount = parseFloat(r.amount)
      return !isNaN(amount) && amount > 0 && r.date
    })

    if (validReceipts.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please enter at least one valid receipt with date and amount',
        variant: 'destructive'
      })
      return
    }

    // Check if total exceeds order total
    if (totalPaidWithNew > orderTotal) {
      toast({
        title: 'Warning',
        description: `Total receipts (${formatCurrency(totalPaidWithNew)}) exceed order total (${formatCurrency(orderTotal)}). Please verify amounts.`,
        variant: 'destructive'
      })
      return
    }

    try {
      setSaving(true)

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) {
        throw new Error('Authentication required')
      }

      // Process each receipt
      for (const receipt of validReceipts) {
        const amount = parseFloat(receipt.amount)
        
        // Calculate payment percentage based on amount
        const paymentPercentage = Math.round((amount / orderTotal) * 100)

        // Generate receipt document number
        const { data: docNo, error: docNoError } = await supabase.rpc('generate_doc_number', {
          p_company_id: companyId,
          p_prefix: 'RCT',
          p_order_type: 'DH'
        })

        if (docNoError) {
          console.error('Error generating doc number:', docNoError)
          // Use fallback doc number
        }

        const receiptDocNo = docNo || `RCT-DH-${Date.now()}`

        // Upload attachment if provided
        let attachmentUrl: string | null = null
        if (receipt.attachmentFile) {
          const fileName = `${orderId}/${receiptDocNo}-${receipt.attachmentFile.name}`
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('order-documents')
            .upload(fileName, receipt.attachmentFile)

          if (uploadError) {
            console.error('Error uploading attachment:', uploadError)
          } else {
            attachmentUrl = uploadData?.path || null
          }
        }

        // Create receipt document
        const { data: receiptDoc, error: receiptError } = await supabase
          .from('documents')
          .insert({
            order_id: orderId,
            doc_type: 'RECEIPT',
            doc_no: receiptDocNo,
            status: 'acknowledged', // Receipts are immediately acknowledged
            issued_by_org_id: sellerOrgId, // Seller (HQ) issues receipt for money received
            issued_to_org_id: buyerOrgId, // Buyer (Distributor) receives receipt
            company_id: companyId,
            created_by: user.id,
            acknowledged_at: new Date().toISOString(),
            acknowledged_by: user.id,
            payment_percentage: paymentPercentage,
            payload: {
              amount: amount,
              payment_method: receipt.paymentMethod,
              payment_date: receipt.date,
              reference: receipt.reference,
              attachment_url: attachmentUrl,
              is_partial: remainingBalance > 0,
              total_paid_to_date: totalPaidPreviously + amount,
              order_total: orderTotal,
              receipt_type: 'customer_receipt', // AR receipt from distributor
              gl_posting_required: true
            }
          })
          .select()
          .single()

        if (receiptError) {
          console.error('Error creating receipt:', receiptError)
          throw receiptError
        }

        // Log for finance/AR tracking - receipt already has all needed info in payload
        console.log('📝 AR Receipt created:', {
          receiptId: receiptDoc.id,
          docNo: receiptDocNo,
          amount,
          paymentMethod: receipt.paymentMethod,
          orderNo,
          glPostingRequired: true
        })
      }

      toast({
        title: 'Success',
        description: `${validReceipts.length} receipt(s) recorded successfully`,
      })

      // Reset form
      setReceipts([{
        id: crypto.randomUUID(),
        date: new Date().toISOString().split('T')[0],
        paymentMethod: 'Bank',
        amount: '',
        reference: '',
        attachmentFile: null,
        attachmentUrl: null
      }])

      // Reload existing receipts
      await loadExistingReceipts()

      // Call success callback
      if (onSuccess) {
        onSuccess()
      }

    } catch (error: any) {
      console.error('Error saving receipts:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to save receipts',
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-blue-600" />
            Receipt
          </DialogTitle>
          <DialogDescription>
            Record payments received from distributor for order {orderNo}
          </DialogDescription>
        </DialogHeader>

        {loadingReceipts ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary Section */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Order Total:</span>
                <span className="font-medium">{formatCurrency(orderTotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Previously Paid:</span>
                <span className="font-medium text-green-600">{formatCurrency(totalPaidPreviously)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">New Receipt(s):</span>
                <span className="font-medium text-blue-600">{formatCurrency(newReceiptTotal)}</span>
              </div>
              <div className="border-t pt-2 mt-2">
                <div className="flex justify-between font-medium">
                  <span className={remainingBalance <= 0 ? 'text-green-700' : 'text-amber-700'}>
                    Balance Remaining:
                  </span>
                  <span className={remainingBalance <= 0 ? 'text-green-700' : 'text-amber-700'}>
                    {formatCurrency(Math.max(0, remainingBalance))}
                  </span>
                </div>
              </div>
            </div>

            {/* Existing Receipts */}
            {existingReceipts.length > 0 && (
              <div className="border rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-3 text-sm">Previous Receipts</h4>
                <div className="space-y-2">
                  {existingReceipts.map((r, idx) => (
                    <div key={r.id} className="flex justify-between items-center text-sm bg-gray-50 p-2 rounded">
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500">#{idx + 1}</span>
                        <span className="font-medium">{r.doc_no}</span>
                        <span className="text-gray-500">
                          {new Date(r.created_at).toLocaleDateString('en-MY')}
                        </span>
                      </div>
                      <span className="font-medium text-green-600">
                        {formatCurrency(r.payload?.amount || r.total_amount || 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* New Receipt Entries */}
            <div className="space-y-4">
              <h4 className="font-medium text-gray-900 text-sm">New Receipt(s)</h4>
              
              {/* Header Row */}
              <div className="grid grid-cols-12 gap-3 text-xs font-medium text-gray-600 px-1">
                <div className="col-span-2">Date: *</div>
                <div className="col-span-2">Bank / Cash: *</div>
                <div className="col-span-2">Amount: *</div>
                <div className="col-span-2">Reference:</div>
                <div className="col-span-3">Attachment:</div>
                <div className="col-span-1"></div>
              </div>

              {/* Receipt Entry Rows */}
              {receipts.map((receipt, index) => (
                <div key={receipt.id} className="grid grid-cols-12 gap-3 items-center">
                  {/* Date */}
                  <div className="col-span-2">
                    <Input
                      type="date"
                      value={receipt.date}
                      onChange={(e) => updateReceipt(receipt.id, 'date', e.target.value)}
                      className="text-sm"
                    />
                  </div>

                  {/* Payment Method */}
                  <div className="col-span-2">
                    <Select
                      value={receipt.paymentMethod}
                      onValueChange={(value: 'Bank' | 'Cash') => 
                        updateReceipt(receipt.id, 'paymentMethod', value)
                      }
                    >
                      <SelectTrigger className="text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Bank">Bank</SelectItem>
                        <SelectItem value="Cash">Cash</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Amount */}
                  <div className="col-span-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={receipt.amount}
                      onChange={(e) => updateReceipt(receipt.id, 'amount', e.target.value)}
                      className="text-sm"
                    />
                  </div>

                  {/* Reference */}
                  <div className="col-span-2">
                    <Input
                      type="text"
                      placeholder="Ref #"
                      value={receipt.reference}
                      onChange={(e) => updateReceipt(receipt.id, 'reference', e.target.value)}
                      className="text-sm"
                    />
                  </div>

                  {/* Attachment */}
                  <div className="col-span-3">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 hover:text-gray-900 border rounded-md px-3 py-2 hover:bg-gray-50">
                      <Upload className="w-4 h-4" />
                      <span className="truncate">
                        {receipt.attachmentFile ? receipt.attachmentFile.name : 'No file chosen'}
                      </span>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => handleFileChange(receipt.id, e.target.files?.[0] || null)}
                      />
                    </label>
                  </div>

                  {/* Remove Button */}
                  <div className="col-span-1 flex justify-center">
                    <button
                      type="button"
                      onClick={() => removeReceipt(receipt.id)}
                      disabled={receipts.length === 1}
                      className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Add Receipt Link */}
              <button
                type="button"
                onClick={addReceipt}
                className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1"
              >
                <Plus className="w-4 h-4" />
                Add receipt
              </button>
            </div>

            {/* Warning if overpaying */}
            {remainingBalance < 0 && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-700">
                  <p className="font-medium">Amount exceeds order total</p>
                  <p>The total receipts exceed the order total by {formatCurrency(Math.abs(remainingBalance))}. Please verify the amounts.</p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={saving}
              >
                Back
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || newReceiptTotal === 0}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
