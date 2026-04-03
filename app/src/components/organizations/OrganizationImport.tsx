'use client'

import { useState, useCallback, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  ArrowRight,
  RotateCcw,
  Loader2,
} from 'lucide-react'

interface SystemField {
  key: string
  label: string
  required?: boolean
}

interface PreviewRow {
  rowNum: number
  data: Record<string, string>
}

interface ImportResult {
  rowNum: number
  orgName: string
  errors: string[]
  warnings: string[]
  isDuplicate: boolean
}

interface ImportSummary {
  total: number
  inserted: number
  updated: number
  skipped: number
  failed: number
  failedRows: { rowNum: number; error: string }[]
}

interface OrganizationImportProps {
  parentOrgs: { id: string; org_code: string; org_name: string; org_type_code: string }[]
}

type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'result'

export default function OrganizationImport({ parentOrgs }: OrganizationImportProps) {
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Preview data from server
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [systemFields, setSystemFields] = useState<SystemField[]>([])
  const [rowCount, setRowCount] = useState(0)
  const [preview, setPreview] = useState<PreviewRow[]>([])

  // Import config
  const [importMode, setImportMode] = useState('insert_only')
  const [parentOrgId, setParentOrgId] = useState('')
  const [orgTypeCode] = useState('SHOP')

  // Result
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [importResults, setImportResults] = useState<ImportResult[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const f = e.dataTransfer.files[0]
    if (f && isValidFile(f)) {
      setFile(f)
      setError('')
    } else {
      setError('Please upload a CSV or XLSX file')
    }
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f && isValidFile(f)) {
      setFile(f)
      setError('')
    } else {
      setError('Please upload a CSV or XLSX file')
    }
  }, [])

  function isValidFile(f: File): boolean {
    const name = f.name.toLowerCase()
    return name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls')
  }

  const handleUpload = async () => {
    if (!file) return
    setLoading(true)
    setError('')

    try {
      const form = new FormData()
      form.append('file', file)
      form.append('action', 'preview')
      form.append('orgTypeCode', orgTypeCode)

      const res = await fetch('/api/organizations/import', { method: 'POST', body: form })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Upload failed')

      setHeaders(data.headers)
      setMapping(data.mapping)
      setSystemFields(data.systemFields)
      setRowCount(data.rowCount)
      setPreview(data.preview)
      setStep('mapping')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleMappingChange = (csvCol: string, sysField: string) => {
    setMapping(prev => {
      const next = { ...prev }
      if (sysField === '__skip__') {
        delete next[csvCol]
      } else {
        next[csvCol] = sysField
      }
      return next
    })
  }

  const handleStartImport = async () => {
    if (!file) return
    setStep('importing')
    setLoading(true)
    setError('')

    try {
      const form = new FormData()
      form.append('file', file)
      form.append('action', 'import')
      form.append('mapping', JSON.stringify(mapping))
      form.append('importMode', importMode)
      form.append('orgTypeCode', orgTypeCode)
      if (parentOrgId) form.append('parentOrgId', parentOrgId)

      const res = await fetch('/api/organizations/import', { method: 'POST', body: form })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Import failed')

      setImportSummary(data.summary)
      setImportResults(data.results || [])
      setStep('result')
    } catch (err: any) {
      setError(err.message)
      setStep('preview')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setStep('upload')
    setFile(null)
    setHeaders([])
    setMapping({})
    setPreview([])
    setImportSummary(null)
    setImportResults([])
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const downloadTemplate = () => {
    const templateHeaders = [
      'Nama Kedai',
      'Branch',
      'Name',
      'telephone',
      'Alamat',
      'Negeri',
      'Adakah kedai ini menjual flavour Serapod?',
      'Adakah kedai ini menjual S.Box?',
      'Adakah kedai ini menjual S.Box Special Edition',
      'Brand flavour hot',
    ]
    const csvContent = templateHeaders.join(',') + '\n'
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'organization_import_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Count mapped required fields
  const mappedRequired = systemFields
    .filter(f => f.required)
    .filter(f => Object.values(mapping).includes(f.key))

  const distParents = parentOrgs.filter(o => o.org_type_code === 'DIST' || o.org_type_code === 'HQ')

  return (
    <div className="space-y-6">
      {/* Progress Steps */}
      <div className="flex items-center gap-2 text-sm">
        {(['upload', 'mapping', 'preview', 'result'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="w-3 h-3 text-gray-400" />}
            <span className={step === s ? 'font-semibold text-blue-600' : step === 'importing' && s === 'preview' ? 'font-semibold text-blue-600' : 'text-gray-500'}>
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          </div>
        ))}
      </div>

      {error && (
        <Alert className="border-red-200 bg-red-50">
          <XCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800 ml-2">{error}</AlertDescription>
        </Alert>
      )}

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload File
            </CardTitle>
            <CardDescription>Upload a CSV or Excel file containing organization data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              ref={dropZoneRef}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
              onDrop={handleFileDrop}
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileSpreadsheet className="w-10 h-10 mx-auto text-gray-400 mb-3" />
              {file ? (
                <div>
                  <p className="text-sm font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-600">
                    Drag & drop your CSV or Excel file here, or click to browse
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Supports .csv, .xlsx, .xls
                  </p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>

            <div className="flex gap-3">
              <Button onClick={handleUpload} disabled={!file || loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Parse File
              </Button>
              <Button variant="outline" onClick={downloadTemplate}>
                <Download className="w-4 h-4 mr-2" />
                Download Template
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Column Mapping */}
      {step === 'mapping' && (
        <Card>
          <CardHeader>
            <CardTitle>Column Mapping</CardTitle>
            <CardDescription>
              {rowCount} rows detected. Map file columns to system fields.
              {mappedRequired.length < systemFields.filter(f => f.required).length && (
                <span className="text-red-600 ml-2">
                  * Required fields must be mapped
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Column</TableHead>
                  <TableHead>Sample Value</TableHead>
                  <TableHead>Map To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {headers.map((h) => (
                  <TableRow key={h}>
                    <TableCell className="font-medium">{h}</TableCell>
                    <TableCell className="text-gray-500 text-sm max-w-[200px] truncate">
                      {preview[0]?.data[h] || '—'}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={mapping[h] || '__skip__'}
                        onValueChange={(v) => handleMappingChange(h, v)}
                      >
                        <SelectTrigger className="w-[220px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__skip__">— Skip —</SelectItem>
                          {systemFields.map((f) => (
                            <SelectItem key={f.key} value={f.key}>
                              {f.label} {f.required ? '*' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep('upload')}>
                Back
              </Button>
              <Button
                onClick={() => setStep('preview')}
                disabled={mappedRequired.length < systemFields.filter(f => f.required).length}
              >
                Next: Preview
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Preview & Config */}
      {step === 'preview' && (
        <>
          {/* Import Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Import Settings</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Duplicate Handling</label>
                <Select value={importMode} onValueChange={setImportMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="insert_only">Insert new only (skip duplicates)</SelectItem>
                    <SelectItem value="update_existing">Update existing if matched</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Parent Organization</label>
                <Select value={parentOrgId || '__none__'} onValueChange={(v) => setParentOrgId(v === '__none__' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {distParents.map(o => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.org_name} ({o.org_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Organization Type</label>
                <div className="px-3 py-2 border rounded-md bg-gray-50 text-sm">SHOP</div>
              </div>
            </CardContent>
          </Card>

          {/* Data Preview */}
          <Card>
            <CardHeader>
              <CardTitle>Data Preview</CardTitle>
              <CardDescription>
                Showing first {Math.min(preview.length, 20)} of {rowCount} rows
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      {Object.values(mapping).filter(Boolean).map((sysField) => {
                        const field = systemFields.find(f => f.key === sysField)
                        return <TableHead key={sysField}>{field?.label || sysField}</TableHead>
                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((row) => (
                      <TableRow key={row.rowNum}>
                        <TableCell className="text-gray-500">{row.rowNum}</TableCell>
                        {Object.entries(mapping)
                          .filter(([, v]) => v)
                          .map(([csvCol, sysField]) => (
                            <TableCell key={`${row.rowNum}-${sysField}`} className="text-sm">
                              {row.data[csvCol] || '—'}
                            </TableCell>
                          ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex gap-3 mt-4">
                <Button variant="outline" onClick={() => setStep('mapping')}>
                  Back
                </Button>
                <Button onClick={handleStartImport} disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Import {rowCount} Rows
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Step 3.5: Importing */}
      {step === 'importing' && (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="w-10 h-10 mx-auto text-blue-500 animate-spin mb-4" />
            <p className="text-lg font-medium">Importing organizations...</p>
            <p className="text-sm text-gray-500 mt-1">Processing {rowCount} rows</p>
            <Progress value={50} className="max-w-xs mx-auto mt-4" />
          </CardContent>
        </Card>
      )}

      {/* Step 4: Results */}
      {step === 'result' && importSummary && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{importSummary.total}</p>
                <p className="text-xs text-gray-500">Total Rows</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{importSummary.inserted}</p>
                <p className="text-xs text-gray-500">Inserted</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-blue-600">{importSummary.updated}</p>
                <p className="text-xs text-gray-500">Updated</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-yellow-600">{importSummary.skipped}</p>
                <p className="text-xs text-gray-500">Skipped</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-red-600">{importSummary.failed}</p>
                <p className="text-xs text-gray-500">Failed</p>
              </CardContent>
            </Card>
          </div>

          {/* Success message */}
          {importSummary.inserted > 0 && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800 ml-2">
                Successfully imported {importSummary.inserted} organization{importSummary.inserted > 1 ? 's' : ''}.
              </AlertDescription>
            </Alert>
          )}

          {/* Error rows */}
          {importResults.some(r => r.errors.length > 0 || r.warnings.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Row Details</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Row</TableHead>
                      <TableHead>Organization</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importResults
                      .filter(r => r.errors.length > 0 || r.warnings.length > 0 || r.isDuplicate)
                      .map((r) => (
                        <TableRow key={r.rowNum}>
                          <TableCell>{r.rowNum}</TableCell>
                          <TableCell>{r.orgName || '—'}</TableCell>
                          <TableCell>
                            {r.errors.length > 0 && <Badge variant="destructive">Error</Badge>}
                            {r.isDuplicate && r.errors.length === 0 && <Badge variant="secondary">Duplicate</Badge>}
                            {r.warnings.length > 0 && r.errors.length === 0 && !r.isDuplicate && (
                              <Badge className="bg-yellow-100 text-yellow-800">Warning</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.errors.map((e, i) => (
                              <span key={i} className="text-red-600 block">{e}</span>
                            ))}
                            {r.warnings.map((w, i) => (
                              <span key={i} className="text-yellow-600 block">{w}</span>
                            ))}
                            {r.isDuplicate && r.errors.length === 0 && (
                              <span className="text-gray-500">Matched existing organization</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Button onClick={handleReset} variant="outline">
            <RotateCcw className="w-4 h-4 mr-2" />
            Import Another File
          </Button>
        </>
      )}
    </div>
  )
}
