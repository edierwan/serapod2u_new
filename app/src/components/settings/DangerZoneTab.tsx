'use client'

import { useState } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { 
  AlertTriangle, 
  Trash2, 
  Database, 
  Download,
  AlertCircle,
  Shield,
  Loader2
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface DangerZoneTabProps {
  userProfile: {
    id: string
    email: string
    role_code: string
    roles: {
      role_level: number
      role_name: string
    }
    organization_id: string
  }
}

export default function DangerZoneTab({ userProfile }: DangerZoneTabProps) {
  const { supabase } = useSupabaseAuth()
  const { toast } = useToast()

  // Only Super Admin can access (role_level = 1)
  const isSuperAdmin = userProfile.roles.role_level === 1
  
  // State for Transaction Deletion
  const [transactionConfirmText, setTransactionConfirmText] = useState('')
  const [transactionChecked, setTransactionChecked] = useState(false)
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false)
  const [transactionLoading, setTransactionLoading] = useState(false)

  // State for Full Deletion
  const [fullConfirmText, setFullConfirmText] = useState('')
  const [fullChecked, setFullChecked] = useState(false)
  const [fullDialogOpen, setFullDialogOpen] = useState(false)
  const [fullSecondDialogOpen, setFullSecondDialogOpen] = useState(false)
  const [fullLoading, setFullLoading] = useState(false)

  // Backup/Export state
  const [exportLoading, setExportLoading] = useState(false)

  if (!isSuperAdmin) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-600" />
            <CardTitle className="text-red-900">Access Denied</CardTitle>
          </div>
          <CardDescription className="text-red-700">
            Only Super Administrators can access the Danger Zone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">
            Your current role: <strong>{userProfile.roles.role_name}</strong> (Level {userProfile.roles.role_level})
          </p>
          <p className="text-sm text-red-600 mt-2">
            Required: Super Admin (Level 1)
          </p>
        </CardContent>
      </Card>
    )
  }

  const handleExportBackup = async () => {
    try {
      setExportLoading(true)
      
      toast({
        title: 'Export Started',
        description: 'Preparing data export... This may take a few minutes.',
      })

      // Call API endpoint to export data
      const response = await fetch('/api/admin/export-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) throw new Error('Export failed')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `serapod2u-backup-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Export Complete',
        description: 'Backup file downloaded successfully.',
      })
    } catch (error) {
      console.error('Export error:', error)
      toast({
        title: 'Export Failed',
        description: 'Could not export data. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setExportLoading(false)
    }
  }

  const handleDeleteTransactions = async () => {
    if (transactionConfirmText !== 'DELETE TRANSACTIONS') {
      toast({
        title: 'Confirmation Failed',
        description: 'Please type "DELETE TRANSACTIONS" exactly.',
        variant: 'destructive',
      })
      return
    }

    if (!transactionChecked) {
      toast({
        title: 'Confirmation Required',
        description: 'Please check the confirmation checkbox.',
        variant: 'destructive',
      })
      return
    }

    try {
      setTransactionLoading(true)

      const response = await fetch('/api/admin/delete-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await response.json()

      if (!response.ok) throw new Error(result.error || 'Deletion failed')

      toast({
        title: 'Transactions Deleted',
        description: `Successfully deleted ${result.deleted_count} transaction records.`,
      })

      // Send email notification
      await fetch('/api/admin/send-deletion-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'transactions',
          user_email: userProfile.email,
          deleted_count: result.deleted_count
        })
      })

      setTransactionDialogOpen(false)
      setTransactionConfirmText('')
      setTransactionChecked(false)

    } catch (error: any) {
      console.error('Delete error:', error)
      toast({
        title: 'Deletion Failed',
        description: error.message || 'Could not delete transactions.',
        variant: 'destructive',
      })
    } finally {
      setTransactionLoading(false)
    }
  }

  const handleDeleteAll = async () => {
    if (fullConfirmText !== 'DELETE ALL DATA') {
      toast({
        title: 'Confirmation Failed',
        description: 'Please type "DELETE ALL DATA" exactly.',
        variant: 'destructive',
      })
      return
    }

    if (!fullChecked) {
      toast({
        title: 'Confirmation Required',
        description: 'Please check the confirmation checkbox.',
        variant: 'destructive',
      })
      return
    }

    try {
      setFullLoading(true)

      const response = await fetch('/api/admin/delete-all-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await response.json()

      if (!response.ok) throw new Error(result.error || 'Deletion failed')

      toast({
        title: 'All Data Deleted',
        description: `Successfully deleted ${result.deleted_count} total records.`,
      })

      // Send email notification
      await fetch('/api/admin/send-deletion-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'full',
          user_email: userProfile.email,
          deleted_count: result.deleted_count
        })
      })

      setFullSecondDialogOpen(false)
      setFullDialogOpen(false)
      setFullConfirmText('')
      setFullChecked(false)

      // Refresh page after 2 seconds
      setTimeout(() => {
        window.location.reload()
      }, 2000)

    } catch (error: any) {
      console.error('Delete error:', error)
      toast({
        title: 'Deletion Failed',
        description: error.message || 'Could not delete data.',
        variant: 'destructive',
      })
    } finally {
      setFullLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Warning Banner */}
      <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-lg font-bold text-red-900">Danger Zone</h3>
            <p className="text-sm text-red-700 mt-1">
              These actions are <strong>irreversible</strong> and will permanently delete data.
              Only Super Administrators can perform these operations.
            </p>
            <p className="text-sm text-red-700 mt-2">
              <strong>⚠️ Always export a backup before deleting data!</strong>
            </p>
          </div>
        </div>
      </div>

      {/* Export Backup Section */}
      <Card className="border-blue-200">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-blue-600" />
            <CardTitle>Export Data Backup</CardTitle>
          </div>
          <CardDescription>
            Download a complete backup of all system data before performing any deletions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-blue-900 mb-2">Backup includes:</h4>
              <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
                <li>All transaction records (orders, QR codes, invoices)</li>
                <li>All master data (products, organizations, users)</li>
                <li>System configuration and settings</li>
                <li>Timestamps and metadata</li>
              </ul>
              <p className="text-xs text-blue-600 mt-3 italic">
                * File links are not included in backup. Download files separately if needed.
              </p>
            </div>

            <Button 
              onClick={handleExportBackup} 
              disabled={exportLoading}
              className="w-full"
              variant="outline"
            >
              {exportLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Export Backup Now
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete Transactions Only */}
      <Card className="border-orange-200">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-orange-600" />
            <CardTitle className="text-orange-900">Delete Transaction Data Only</CardTitle>
          </div>
          <CardDescription>
            Remove all transaction records while keeping master data intact
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <h4 className="font-semibold text-orange-900 mb-2">Will DELETE:</h4>
              <ul className="text-sm text-orange-700 space-y-1 list-disc list-inside">
                <li>All orders (H2M, D2S, S2C) and order items</li>
                <li>All QR batches, QR codes, and master codes</li>
                <li>All invoices and payments</li>
                <li>All shipments and tracking records</li>
                <li>All document workflows</li>
                <li>Storage files: QR Excel files, document PDFs</li>
              </ul>
              <h4 className="font-semibold text-green-900 mt-4 mb-2">Will KEEP:</h4>
              <ul className="text-sm text-green-700 space-y-1 list-disc list-inside">
                <li>Products, variants, brands, categories</li>
                <li>Organizations (all types)</li>
                <li>Users (all users including Super Admin)</li>
                <li>Roles, permissions, system settings</li>
                <li>Location data (countries, states, districts)</li>
              </ul>
            </div>

            <Button 
              onClick={() => setTransactionDialogOpen(true)} 
              variant="destructive"
              className="w-full bg-orange-600 hover:bg-orange-700"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Transactions Only
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete All Data */}
      <Card className="border-red-300 bg-red-50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <CardTitle className="text-red-900">Delete ALL Data</CardTitle>
          </div>
          <CardDescription className="text-red-700">
            ⚠️ EXTREME DANGER: Remove ALL transactions AND master data (except Super Admin)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-red-100 border-2 border-red-300 rounded-lg p-4">
              <h4 className="font-semibold text-red-900 mb-2">Will DELETE:</h4>
              <ul className="text-sm text-red-800 space-y-1 list-disc list-inside">
                <li>All transaction data (orders, QR codes, invoices, etc.)</li>
                <li>All products, variants, brands, categories</li>
                <li>All organizations (except Super Admin&apos;s parent organization)</li>
                <li>All users (except Super Admin account)</li>
                <li>All distributors and shops</li>
                <li>ALL storage files (QR files, images, logos, avatars, documents)</li>
              </ul>
              <h4 className="font-semibold text-green-900 mt-4 mb-2">Will KEEP:</h4>
              <ul className="text-sm text-green-700 space-y-1 list-disc list-inside">
                <li><strong>Super Admin user only</strong> (you will remain logged in)</li>
                <li><strong>Super Admin&apos;s parent organization</strong> (your organization)</li>
                <li>System roles and permissions</li>
                <li>Location data (countries, states, districts)</li>
                <li>Organization types (reference data)</li>
              </ul>
              <div className="mt-4 p-3 bg-red-200 border border-red-400 rounded">
                <p className="text-sm font-bold text-red-900">
                  ⚠️ THIS WILL RESET THE SYSTEM (Keep Your Organization)
                </p>
                <p className="text-xs text-red-800 mt-1">
                  You will need to recreate all child organizations, users, and products from scratch.
                  Your parent organization (e.g., SERA Distribution) will be preserved.
                </p>
              </div>
            </div>

            <Button 
              onClick={() => setFullDialogOpen(true)} 
              variant="destructive"
              className="w-full"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete ALL Data (Complete Reset)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Transaction Deletion Dialog */}
      <AlertDialog open={transactionDialogOpen} onOpenChange={setTransactionDialogOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-orange-900">
              <AlertTriangle className="w-5 h-5" />
              Delete Transaction Data?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all transaction records. Master data will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 py-4">
            <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm">
              <p className="font-semibold text-orange-900">This action will:</p>
              <ul className="list-disc list-inside text-orange-700 mt-2 space-y-1">
                <li>Delete all orders and order items</li>
                <li>Delete all QR codes and batches</li>
                <li>Delete all invoices and payments</li>
                <li>Delete QR Excel files and document PDFs from storage</li>
              </ul>
            </div>

            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="transaction-confirm" 
                  checked={transactionChecked}
                  onCheckedChange={(checked) => setTransactionChecked(checked as boolean)}
                />
                <label
                  htmlFor="transaction-confirm"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  I understand this action cannot be undone
                </label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="transaction-text">
                  Type <span className="font-mono font-bold">DELETE TRANSACTIONS</span> to confirm:
                </Label>
                <Input
                  id="transaction-text"
                  value={transactionConfirmText}
                  onChange={(e) => setTransactionConfirmText(e.target.value)}
                  placeholder="DELETE TRANSACTIONS"
                  className="font-mono"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              onClick={handleDeleteTransactions}
              disabled={transactionLoading || transactionConfirmText !== 'DELETE TRANSACTIONS' || !transactionChecked}
              variant="destructive"
              className="bg-orange-600 hover:bg-orange-700"
            >
              {transactionLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Transactions
                </>
              )}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Full Deletion - First Dialog */}
      <AlertDialog open={fullDialogOpen} onOpenChange={setFullDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-900">
              <AlertCircle className="w-5 h-5" />
              Delete ALL Data - First Confirmation
            </AlertDialogTitle>
            <AlertDialogDescription>
              This is an EXTREME action that will delete almost everything in the system.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4">
            <div className="bg-red-100 border-2 border-red-300 rounded p-4">
              <p className="text-sm font-bold text-red-900">⚠️ WARNING</p>
              <p className="text-sm text-red-800 mt-2">
                This will delete ALL data including:
              </p>
              <ul className="list-disc list-inside text-sm text-red-800 mt-2 space-y-1">
                <li>All transactions</li>
                <li>All master data (products, brands, etc.)</li>
                <li>All child organizations (Manufacturers, Distributors, Shops, Warehouses)</li>
                <li>All users (except Super Admin)</li>
                <li>All storage files</li>
              </ul>
              <p className="text-sm font-bold text-green-900 mt-3">
                ✓ Your parent organization will be preserved.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <AlertDialogCancel>Cancel - Go Back</AlertDialogCancel>
            <Button
              onClick={() => {
                setFullDialogOpen(false)
                setFullSecondDialogOpen(true)
              }}
              variant="destructive"
            >
              I Understand - Continue
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Full Deletion - Second Dialog */}
      <AlertDialog open={fullSecondDialogOpen} onOpenChange={setFullSecondDialogOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-900">
              <AlertCircle className="w-5 h-5" />
              FINAL CONFIRMATION - Delete ALL Data
            </AlertDialogTitle>
            <AlertDialogDescription>
              Last chance to cancel. This action is IRREVERSIBLE.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 py-4">
            <div className="bg-red-100 border-2 border-red-400 rounded p-4">
              <p className="text-sm font-bold text-red-900">FINAL WARNING:</p>
              <p className="text-sm text-red-800 mt-2">
                You are about to delete EVERYTHING except your parent organization. 
                Only your Super Admin account and parent organization will remain.
                You will need to rebuild all child organizations and users from scratch.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="full-confirm" 
                  checked={fullChecked}
                  onCheckedChange={(checked) => setFullChecked(checked as boolean)}
                />
                <label
                  htmlFor="full-confirm"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  I have exported a backup and understand this action is irreversible
                </label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="full-text">
                  Type <span className="font-mono font-bold">DELETE ALL DATA</span> to confirm:
                </Label>
                <Input
                  id="full-text"
                  value={fullConfirmText}
                  onChange={(e) => setFullConfirmText(e.target.value)}
                  placeholder="DELETE ALL DATA"
                  className="font-mono"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <AlertDialogCancel onClick={() => {
              setFullSecondDialogOpen(false)
              setFullConfirmText('')
              setFullChecked(false)
            }}>
              Cancel - Don&apos;t Delete
            </AlertDialogCancel>
            <Button
              onClick={handleDeleteAll}
              disabled={fullLoading || fullConfirmText !== 'DELETE ALL DATA' || !fullChecked}
              variant="destructive"
            >
              {fullLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting Everything...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  DELETE ALL DATA
                </>
              )}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
