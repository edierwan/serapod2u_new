'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, FileText, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import {
  KKM_CERTIFICATE_BUCKET,
  uploadKkmCertificate,
  validateKkmCertificate,
} from '@/lib/products/kkm-certificate'

interface CertificateRecord {
  id: string
  product_variant_id: string
  storage_path: string
  file_name: string
  mime_type: string
  file_size: number
  updated_at: string
}

interface KkmApprovalCertificateProps {
  variantId?: string
  canManage: boolean
  pendingFile?: File | null
  onPendingFileChange?: (file: File | null) => void
  kkmApproval?: string | null
}

export default function KkmApprovalCertificate({ variantId, canManage, pendingFile, onPendingFileChange, kkmApproval }: KkmApprovalCertificateProps) {
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [certificate, setCertificate] = useState<CertificateRecord | null>(null)
  const [loading, setLoading] = useState(Boolean(variantId))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isReady || !variantId) {
      setLoading(false)
      setCertificate(null)
      return
    }

    let active = true
    const load = async () => {
      setLoading(true)
      const { data, error } = await (supabase as any)
        .from('variant_kkm_certificates')
        .select('id, product_variant_id, storage_path, file_name, mime_type, file_size, updated_at')
        .eq('product_variant_id', variantId)
        .maybeSingle()
      if (!active) return
      if (error) {
        console.error('Unable to load KKM certificate metadata:', error)
        toast({ title: 'Certificate unavailable', description: error.message, variant: 'destructive' })
      } else {
        setCertificate(data || null)
      }
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [isReady, supabase, toast, variantId])

  const handleUpload = async (file: File) => {
    if (!canManage) return
    const validationError = validateKkmCertificate(file)
    if (validationError) {
      toast({ title: 'Invalid certificate', description: validationError, variant: 'destructive' })
      return
    }
    if (!variantId) {
      onPendingFileChange?.(file)
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    setBusy(true)
    try {
      const data = await uploadKkmCertificate(supabase, variantId, file, certificate?.storage_path)
      setCertificate(data)
      toast({ title: 'Certificate saved', description: file.name })
    } catch (error: any) {
      toast({ title: 'Certificate upload failed', description: error?.message || 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const getSignedUrl = async () => {
    if (!certificate) return null
    const { data, error } = await supabase.storage.from(KKM_CERTIFICATE_BUCKET).createSignedUrl(certificate.storage_path, 60)
    if (error) throw error
    return data.signedUrl
  }

  const handleView = async () => {
    try {
      const signedUrl = await getSignedUrl()
      if (!signedUrl) return
      const anchor = document.createElement('a')
      anchor.href = signedUrl
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
      anchor.click()
    } catch (error: any) {
      toast({ title: 'Unable to view certificate', description: error?.message, variant: 'destructive' })
    }
  }

  const handleDownload = async () => {
    if (!certificate) return
    try {
      const { data, error } = await supabase.storage.from(KKM_CERTIFICATE_BUCKET).download(certificate.storage_path)
      if (error) throw error
      const url = URL.createObjectURL(data)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = certificate.file_name
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error: any) {
      toast({ title: 'Unable to download certificate', description: error?.message, variant: 'destructive' })
    }
  }

  const handleRemove = async () => {
    if (!certificate || !canManage || !window.confirm(`Remove ${certificate.file_name}?`)) return
    setBusy(true)
    try {
      const removing = certificate
      const { error: metadataError } = await (supabase as any)
        .from('variant_kkm_certificates')
        .delete()
        .eq('id', removing.id)
      if (metadataError) throw metadataError

      setCertificate(null)
      const { error: storageError } = await supabase.storage.from(KKM_CERTIFICATE_BUCKET).remove([removing.storage_path])
      if (storageError) console.error('Failed to clean up removed KKM certificate:', storageError)
      toast({ title: 'Certificate removed' })
    } catch (error: any) {
      toast({ title: 'Unable to remove certificate', description: error?.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-gray-900">KKM Approval Certificate</div>
          {!loading && certificate && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Certificate attached</Badge>}
          {!loading && !certificate && pendingFile && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Certificate selected</Badge>}
          {!loading && !certificate && !pendingFile && kkmApproval?.trim() && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Certificate not attached</Badge>}
          {!loading && !certificate && !pendingFile && !kkmApproval?.trim() && <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-600">Not provided</Badge>}
        </div>
        <p className="text-xs text-gray-500">PDF, JPG, JPEG or PNG · maximum 10 MB</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading certificate…</div>
      ) : certificate ? (
        <div className="flex flex-col gap-3 rounded-md bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-5 w-5 shrink-0 text-blue-600" />
            <span className="truncate text-sm font-medium" title={certificate.file_name}>{certificate.file_name}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleView}><ExternalLink className="mr-1 h-4 w-4" /> View</Button>
            <Button type="button" variant="outline" size="sm" onClick={handleDownload}><Download className="mr-1 h-4 w-4" /> Download</Button>
            {canManage && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}><RefreshCw className="mr-1 h-4 w-4" /> Replace</Button>}
            {canManage && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={handleRemove} className="text-red-600 hover:text-red-700"><Trash2 className="mr-1 h-4 w-4" /> Remove</Button>}
          </div>
        </div>
      ) : variantId ? (
        canManage
          ? <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Upload Certificate</Button>
          : <p className="text-sm text-gray-500">No certificate uploaded.</p>
      ) : pendingFile ? (
        <div className="flex flex-col gap-3 rounded-md bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2"><FileText className="h-5 w-5 shrink-0 text-blue-600" /><span className="truncate text-sm font-medium">{pendingFile.name}</span></div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}><RefreshCw className="mr-1 h-4 w-4" /> Replace</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onPendingFileChange?.(null)} className="text-red-600 hover:text-red-700"><Trash2 className="mr-1 h-4 w-4" /> Remove</Button>
          </div>
        </div>
      ) : canManage ? (
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}><Upload className="mr-2 h-4 w-4" /> Upload Certificate</Button>
      ) : (
        <p className="text-sm text-gray-500">Save the variant before uploading its certificate.</p>
      )}

      {canManage && (
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) handleUpload(file) }}
        />
      )}
      <p className="text-xs text-gray-500">Certificate attachment is optional. You may save the KKM approval number without uploading a certificate.</p>
      {!loading && certificate && !kkmApproval?.trim() && <p className="text-xs text-gray-500">KKM approval number not provided.</p>}
    </div>
  )
}
