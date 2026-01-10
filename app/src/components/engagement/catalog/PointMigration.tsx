import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  XCircle,
  FileDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from "lucide-react"
import { useSupabaseAuth } from "@/lib/hooks/useSupabaseAuth"

interface MigrationResult {
  rowNumber: number
  joinedDate: string
  name: string
  phone: string
  email: string
  location: string
  points: number
  password?: string
  status: 'Success' | 'Error'
  message: string
  isNewUser?: boolean
  userRole?: string
}

interface ProgressState {
  current: number
  total: number
  progress: number
  success: number
  errors: number
  newUsers: number
  existingUsers: number
  message: string
}

type PasswordMode = 'default' | 'file'
type SortField = 'rowNumber' | 'joinedDate' | 'name' | 'phone' | 'email' | 'location' | 'points' | 'status'

const PAGE_SIZE_OPTIONS = [20, 50, 100, -1] as const // -1 represents "All"

// Connection timeout in ms (30 seconds without any activity)
const CONNECTION_TIMEOUT = 30000
// Maximum timeout for entire operation (15 minutes for large files)
const MAX_OPERATION_TIMEOUT = 900000

interface PointMigrationProps {
  onMigrationComplete?: () => void
}

export function PointMigration({ onMigrationComplete }: PointMigrationProps) {
  const [file, setFile] = useState<File | null>(null)
  const [defaultPassword, setDefaultPassword] = useState("")
  const [passwordMode, setPasswordMode] = useState<PasswordMode>('default')
  const [uploading, setUploading] = useState(false)
  const [uploadComplete, setUploadComplete] = useState(false)
  const [results, setResults] = useState<MigrationResult[]>([])
  const [error, setError] = useState<string | null>(null)

  // Progress tracking state
  const [progressState, setProgressState] = useState<ProgressState | null>(null)
  const [statusMessage, setStatusMessage] = useState<string>("")

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(20)
  const [filterStatus, setFilterStatus] = useState<'all' | 'Success' | 'Error' | 'Existing' | 'New'>('all')

  // Sorting state
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const { supabase, isReady } = useSupabaseAuth()

  // Save migration results to history
  const saveMigrationHistory = async (fileName: string, migrationResults: MigrationResult[], summary: any) => {
    if (!isReady || !supabase) return
    
    try {
      // Get current user for audit trail
      const { data: { user } } = await supabase.auth.getUser()
      
      // Cast to any since migration_history table types are not generated yet
      const { error } = await (supabase as any).from('migration_history').insert({
        file_name: fileName,
        total_records: summary.total || migrationResults.length,
        success_count: summary.success || 0,
        new_users_count: summary.newUsers || 0,
        existing_users_count: summary.existingUsers || 0,
        error_count: summary.error || 0,
        results: migrationResults,
        migration_date: new Date().toISOString(),
        created_by: user?.id || null
      })
      
      if (error) {
        console.error('Failed to save migration history:', error)
      }
    } catch (err) {
      console.error('Error saving migration history:', err)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
      setResults([])
      setUploadComplete(false)
      setError(null)
      setProgressState(null)
      setStatusMessage("")
    }
  }

  const handleUpload = async () => {
    if (!file) return
    if (passwordMode === 'default' && !defaultPassword) {
      alert("Please enter a default password for new users.")
      return
    }

    setUploading(true)
    setError(null)
    setResults([])
    setUploadComplete(false)
    setProgressState(null)
    setStatusMessage("Processing file...")

    const formData = new FormData()
    formData.append('file', file)
    formData.append('passwordMode', passwordMode)
    if (passwordMode === 'default') {
      formData.append('defaultPassword', defaultPassword)
    }

    // Activity tracking for timeout detection
    let lastActivityTime = Date.now()
    let connectionTimeoutId: NodeJS.Timeout | null = null
    let operationTimeoutId: NodeJS.Timeout | null = null
    let isCompleted = false

    const clearTimeouts = () => {
      if (connectionTimeoutId) {
        clearTimeout(connectionTimeoutId)
        connectionTimeoutId = null
      }
      if (operationTimeoutId) {
        clearTimeout(operationTimeoutId)
        operationTimeoutId = null
      }
    }

    const resetConnectionTimeout = () => {
      lastActivityTime = Date.now()
      if (connectionTimeoutId) {
        clearTimeout(connectionTimeoutId)
      }
      connectionTimeoutId = setTimeout(() => {
        if (!isCompleted) {
          console.error('Connection timeout - no activity for', CONNECTION_TIMEOUT, 'ms')
          setError('Connection lost. Please try again. If the issue persists, try processing smaller batches.')
          setUploading(false)
          clearTimeouts()
        }
      }, CONNECTION_TIMEOUT)
    }

    try {
      // Set maximum operation timeout
      operationTimeoutId = setTimeout(() => {
        if (!isCompleted) {
          console.error('Operation timeout after', MAX_OPERATION_TIMEOUT, 'ms')
          setError('Operation timed out. Please try processing smaller batches.')
          setUploading(false)
          clearTimeouts()
        }
      }, MAX_OPERATION_TIMEOUT)

      // Try streaming endpoint first, fallback to regular endpoint
      let useStreaming = true
      let response: Response

      try {
        response = await fetch('/api/admin/point-migration-stream', {
          method: 'POST',
          body: formData
        })

        if (!response.ok || !response.body) {
          useStreaming = false
        }
      } catch {
        useStreaming = false
      }

      if (useStreaming && response!.body) {
        // Use streaming for progress updates
        const reader = response!.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        // Start connection timeout monitoring
        resetConnectionTimeout()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))

                switch (data.type) {
                  case 'status':
                    setStatusMessage(data.message)
                    break
                  case 'init':
                    setStatusMessage(data.message)
                    setProgressState({
                      current: 0,
                      total: data.total,
                      progress: 0,
                      success: 0,
                      errors: 0,
                      newUsers: 0,
                      existingUsers: 0,
                      message: data.message
                    })
                    break
                  case 'progress':
                    setProgressState({
                      current: data.current,
                      total: data.total,
                      progress: data.progress,
                      success: data.success,
                      errors: data.errors,
                      newUsers: data.newUsers || 0,
                      existingUsers: data.existingUsers || 0,
                      message: data.message
                    })
                    setStatusMessage(data.message)
                    // Reset timeout on progress
                    resetConnectionTimeout()
                    break
                  case 'complete':
                    isCompleted = true
                    clearTimeouts()
                    setResults(data.results || [])
                    setUploadComplete(true)
                    setCurrentPage(1)
                    setFilterStatus('all')
                    setSortField(null)
                    setStatusMessage(`Completed! ${data.summary.success} success, ${data.summary.error} errors`)
                    // Save to migration history
                    saveMigrationHistory(file?.name || 'unknown.csv', data.results || [], data.summary)
                    // Notify parent that migration completed so it can refresh data
                    if (onMigrationComplete) {
                      onMigrationComplete()
                    }
                    break
                  case 'ping':
                    // Keep-alive ping from server, reset timeout
                    resetConnectionTimeout()
                    break
                  case 'error':
                    isCompleted = true
                    clearTimeouts()
                    throw new Error(data.message)
                }
              } catch (parseError) {
                // Only log parse errors that aren't from our explicit throw
                if (!(parseError instanceof Error && parseError.message)) {
                  console.error('Parse error:', parseError)
                } else {
                  throw parseError
                }
              }
            }
          }
        }

        // If we reach here without completion, something went wrong
        if (!isCompleted) {
          throw new Error('Connection ended unexpectedly. Please try again.')
        }
      } else {
        // Fallback to regular endpoint
        setStatusMessage("Processing... Please wait.")
        const res = await fetch('/api/admin/point-migration', {
          method: 'POST',
          body: formData
        })

        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || 'Upload failed')
        }

        isCompleted = true
        clearTimeouts()
        setResults(data.results || [])
        setUploadComplete(true)
        setCurrentPage(1)
        setFilterStatus('all')
        setSortField(null)
        // Notify parent that migration completed so it can refresh data
        if (onMigrationComplete) {
          onMigrationComplete()
        }
      }
    } catch (error: any) {
      console.error('Upload error:', error)
      setError(error.message || 'Upload failed')
      clearTimeouts()
    } finally {
      setUploading(false)
      clearTimeouts()
    }
  }

  const downloadTemplate = () => {
    // Updated template with Password column
    const headers = ['JoinedDate', 'Name', 'MobileNumber', 'EmailAddress', 'Location', 'Balance', 'Password']
    const exampleRow = '2025-01-11,AZMIR,0179244297,nurazmirpcb@gmail.com,Kelantan,20,hb080397'
    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + exampleRow
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", "point_migration_template.csv")
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const downloadErrorRecords = () => {
    const errorRecords = results.filter(r => r.status === 'Error')
    if (errorRecords.length === 0) return

    const headers = ['JoinedDate', 'Name', 'MobileNumber', 'EmailAddress', 'Location', 'Balance', 'Password', 'ErrorMessage']
    const rows = errorRecords.map(r =>
      [r.joinedDate, r.name, r.phone, r.email, r.location, r.points, r.password || '', r.message].join(',')
    )
    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.join("\n")
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `migration_errors_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const downloadAllResults = () => {
    if (results.length === 0) return

    const headers = ['JoinedDate', 'Name', 'MobileNumber', 'EmailAddress', 'Location', 'Balance', 'Password', 'Status', 'UserType', 'MatchedRole', 'Message']
    const rows = results.map(r => {
      const userType = r.status === 'Success' ? (r.isNewUser ? 'New Account' : 'Existing Account') : ''
      const safeMessage = r.message ? `"${r.message.replace(/"/g, '""')}"` : ''
      const safeName = r.name ? `"${r.name.replace(/"/g, '""')}"` : ''
      
      return [
        r.joinedDate, 
        safeName, 
        r.phone, 
        r.email, 
        r.location, 
        r.points, 
        r.password || '', 
        r.status, 
        userType,
        r.userRole || '',
        safeMessage
      ].join(',')
    })
    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.join("\n")
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `migration_results_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const downloadExistingRecords = () => {
    // Filter for existing users - check for isNewUser explicitly false (not undefined)
    const existingRecords = results.filter(r => r.status === 'Success' && r.isNewUser !== undefined && r.isNewUser === false)
    console.log('Existing records for download:', existingRecords.length, 'out of', results.length, 'total')
    
    if (existingRecords.length === 0) {
      alert('No existing user records found to download.')
      return
    }

    const headers = ['JoinedDate', 'Name', 'MobileNumber', 'EmailAddress', 'Location', 'Balance', 'Password', 'Status', 'UserType', 'MatchedRole', 'Message']
    const rows = existingRecords.map(r => {
      const userType = 'Existing Account'
      const safeMessage = r.message ? `"${r.message.replace(/"/g, '""')}"` : ''
      const safeName = r.name ? `"${r.name.replace(/"/g, '""')}"` : ''
      const safeEmail = r.email ? `"${r.email.replace(/"/g, '""')}"` : ''
      
      return [
        r.joinedDate || '', 
        safeName, 
        r.phone || '', 
        safeEmail, 
        r.location || '', 
        r.points || 0, 
        r.password || '', 
        r.status, 
        userType,
        r.userRole || 'GUEST',
        safeMessage
      ].join(',')
    })
    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.join("\n")
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `migration_existing_users_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Handle column sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // Set new field with ascending direction
      setSortField(field)
      setSortDirection('asc')
    }
    setCurrentPage(1) // Reset to first page when sorting
  }

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 ml-1 inline opacity-40" />
    }
    return sortDirection === 'asc'
      ? <ArrowUp className="w-3 h-3 ml-1 inline" />
      : <ArrowDown className="w-3 h-3 ml-1 inline" />
  }

  // Filter results
  let filteredResults = results.filter(r => {
    if (filterStatus === 'all') return true
    if (filterStatus === 'Existing') return r.status === 'Success' && r.isNewUser !== undefined && r.isNewUser === false
    if (filterStatus === 'New') return r.status === 'Success' && r.isNewUser === true
    return r.status === filterStatus
  })

  // Apply sorting
  if (sortField) {
    filteredResults = [...filteredResults].sort((a, b) => {
      let aVal: any = a[sortField]
      let bVal: any = b[sortField]

      // Handle different data types
      if (sortField === 'points' || sortField === 'rowNumber') {
        aVal = Number(aVal) || 0
        bVal = Number(bVal) || 0
      } else if (sortField === 'joinedDate') {
        aVal = new Date(aVal || 0).getTime()
        bVal = new Date(bVal || 0).getTime()
      } else {
        aVal = String(aVal || '').toLowerCase()
        bVal = String(bVal || '').toLowerCase()
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
  }

  // Handle "All" option for page size
  const effectivePageSize = pageSize === -1 ? filteredResults.length : pageSize
  const totalPages = pageSize === -1 ? 1 : Math.ceil(filteredResults.length / pageSize)
  const startIndex = (currentPage - 1) * effectivePageSize
  const paginatedResults = pageSize === -1 ? filteredResults : filteredResults.slice(startIndex, startIndex + pageSize)

  const successCount = results.filter(r => r.status === 'Success').length
  const errorCount = results.filter(r => r.status === 'Error').length
  const newUsersCount = results.filter(r => r.status === 'Success' && r.isNewUser === true).length
  const existingUsersCount = results.filter(r => r.status === 'Success' && r.isNewUser !== undefined && r.isNewUser === false).length

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Point Migration</CardTitle>
          <CardDescription>Upload an Excel file to migrate user points and update details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="migration-file">Migration File (Excel/CSV)</Label>
            <Input id="migration-file" type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} />
          </div>

          {/* Password Mode Selection */}
          <div className="space-y-3">
            <Label>Password Source for New Users</Label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="passwordMode"
                  value="default"
                  checked={passwordMode === 'default'}
                  onChange={() => setPasswordMode('default')}
                  className="w-4 h-4"
                />
                <span className="text-sm">Use default password (same for all new users)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="passwordMode"
                  value="file"
                  checked={passwordMode === 'file'}
                  onChange={() => setPasswordMode('file')}
                  className="w-4 h-4"
                />
                <span className="text-sm">Use password from file (Column G - Password)</span>
              </label>
            </div>
          </div>

          {/* Default Password Input - only show when default mode is selected */}
          {passwordMode === 'default' && (
            <div className="grid w-full max-w-sm items-center gap-1.5">
              <Label htmlFor="default-password">Default Password for New Users</Label>
              <Input
                id="default-password"
                type="text"
                placeholder="Enter default password"
                value={defaultPassword}
                onChange={(e) => setDefaultPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">This password will be used for any new accounts created during migration.</p>
            </div>
          )}

          {passwordMode === 'file' && (
            <Alert className="border-blue-200 bg-blue-50">
              <FileSpreadsheet className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-700">
                The password for each new user will be read from Column G (Password) of your uploaded file.
                Make sure each row has a valid password.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleUpload}
              disabled={!file || (passwordMode === 'default' && !defaultPassword) || uploading}
            >
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {uploading ? 'Processing...' : 'Upload & Process'}
            </Button>
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="mr-2 h-4 w-4" /> Download Template
            </Button>
          </div>

          {/* Progress Section - shown during upload */}
          {uploading && (
            <div className="space-y-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span className="text-sm font-medium text-blue-700">{statusMessage || 'Processing...'}</span>
              </div>

              {progressState && (
                <>
                  <Progress value={progressState.progress} className="h-2" />
                  <div className="flex justify-between text-xs text-blue-600">
                    <span>{progressState.current} of {progressState.total} records</span>
                    <span>{progressState.progress}%</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span className="text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      {progressState.success} success
                    </span>
                    <span className="text-slate-600 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                      {progressState.newUsers} new
                    </span>
                    <span className="text-amber-600 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      {progressState.existingUsers} existing
                    </span>
                    <span className="text-red-600 flex items-center gap-1">
                      <XCircle className="h-3 w-3" />
                      {progressState.errors} errors
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {error && (
            <Alert className="border-red-500/50 text-red-600 dark:border-red-500 [&>svg]:text-red-600 bg-red-50">
              <AlertCircle className="h-4 w-4" />
              <h5 className="mb-1 font-medium leading-none tracking-tight">Error</h5>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Results Section - shown after upload */}
      {uploadComplete && results.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Migration Results</CardTitle>
                <CardDescription>
                  Review the results below. Success records have been processed.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={`bg-green-50 text-green-700 border-green-200 cursor-pointer hover:bg-green-100 transition-colors ${filterStatus === 'Success' ? 'ring-2 ring-green-500 ring-offset-1' : ''}`}
                    onClick={() => {
                      setFilterStatus('Success')
                      setCurrentPage(1)
                    }}
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    {successCount} Success
                  </Badge>

                  <Badge
                    variant="outline"
                    className={`bg-slate-100 text-slate-700 border-slate-300 cursor-pointer hover:bg-slate-200 transition-colors ${filterStatus === 'New' ? 'ring-2 ring-slate-500 ring-offset-1' : ''}`}
                    onClick={() => {
                      setFilterStatus('New')
                      setCurrentPage(1)
                    }}
                  >
                    <span className="w-2 h-2 rounded-full bg-slate-500 mr-1.5"></span>
                    {newUsersCount} New
                  </Badge>

                  <Badge
                    variant="outline"
                    className={`bg-amber-50 text-amber-700 border-amber-300 cursor-pointer hover:bg-amber-100 transition-colors ${filterStatus === 'Existing' ? 'ring-2 ring-amber-500 ring-offset-1' : ''}`}
                    onClick={() => {
                      setFilterStatus('Existing')
                      setCurrentPage(1)
                    }}
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-500 mr-1.5"></span>
                    {existingUsersCount} Exist
                  </Badge>
                  
                  <Badge
                    variant="outline"
                    className={`bg-red-50 text-red-700 border-red-200 cursor-pointer hover:bg-red-100 transition-colors ${filterStatus === 'Error' ? 'ring-2 ring-red-500 ring-offset-1' : ''}`}
                    onClick={() => {
                      setFilterStatus('Error')
                      setCurrentPage(1)
                    }}
                  >
                    <XCircle className="w-3 h-3 mr-1" />
                    {errorCount} Errors
                  </Badge>
                </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Action buttons and filters */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Filter:</Label>
                <select
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value as 'all' | 'Success' | 'Error' | 'Existing' | 'New')
                    setCurrentPage(1)
                  }}
                >
                  <option value="all">All Records ({results.length})</option>
                  <option value="Success">All Success ({successCount})</option>
                  {newUsersCount > 0 && <option value="New">New Users ({newUsersCount})</option>}
                  {existingUsersCount > 0 && <option value="Existing">Existing Users ({existingUsersCount})</option>}
                  <option value="Error">Errors Only ({errorCount})</option>
                </select>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={downloadAllResults}>
                  <FileDown className="mr-2 h-4 w-4" />
                  Download All Results
                </Button>
                {filterStatus === 'Existing' && existingUsersCount > 0 && (
                   <Button variant="outline" size="sm" onClick={downloadExistingRecords} className="text-amber-700 hover:text-amber-800 border-amber-200 hover:bg-amber-50">
                    <FileDown className="mr-2 h-4 w-4" />
                    Download Existing Records
                  </Button>
                )}
                {errorCount > 0 && (
                  <Button variant="outline" size="sm" onClick={downloadErrorRecords} className="text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50">
                    <FileDown className="mr-2 h-4 w-4" />
                    Download Error Records
                  </Button>
                )}
              </div>
            </div>

            {/* Results Table */}
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead
                      className="w-12 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('rowNumber')}
                    >
                      #{getSortIcon('rowNumber')}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('joinedDate')}
                    >
                      Joined Date{getSortIcon('joinedDate')}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('name')}
                    >
                      Name{getSortIcon('name')}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('phone')}
                    >
                      Phone{getSortIcon('phone')}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('email')}
                    >
                      Email{getSortIcon('email')}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('location')}
                    >
                      Location{getSortIcon('location')}
                    </TableHead>
                    <TableHead
                      className="text-right cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('points')}
                    >
                      Points{getSortIcon('points')}
                    </TableHead>
                    <TableHead
                      className="w-24 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('status')}
                    >
                      Status{getSortIcon('status')}
                    </TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedResults.length > 0 ? (
                    paginatedResults.map((result, index) => (
                      <TableRow key={`${result.rowNumber}-${index}`} className={result.status === 'Error' ? 'bg-red-50/50' : ''}>
                        <TableCell className="text-gray-500">{startIndex + index + 1}</TableCell>
                        <TableCell className="text-sm">{result.joinedDate}</TableCell>
                        <TableCell className="font-medium">{result.name}</TableCell>
                        <TableCell className="text-sm">{result.phone}</TableCell>
                        <TableCell className="text-sm">{result.email}</TableCell>
                        <TableCell className="text-sm">{result.location}</TableCell>
                        <TableCell className="text-right font-medium">{result.points}</TableCell>
                        <TableCell>
                          {result.status === 'Success' ? (
                            <div className="flex flex-col items-start gap-1.5">
                              <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Success
                              </Badge>
                              {result.isNewUser === true && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200">
                                  New Account
                                </span>
                              )}
                              {result.isNewUser === false && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                                  Existing{result.userRole ? ` (${result.userRole})` : ''}
                                </span>
                              )}
                            </div>
                          ) : (
                            <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-red-200">
                              <XCircle className="w-3 h-3 mr-1" />
                              Error
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600 max-w-xs truncate" title={result.message}>
                          {result.message}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                        No records match the current filter
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            {filteredResults.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Rows per page:</span>
                  <select
                    className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value))
                      setCurrentPage(1)
                    }}
                  >
                    {PAGE_SIZE_OPTIONS.map(size => (
                      <option key={size} value={size}>{size === -1 ? 'All' : size}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-600">
                    Showing {startIndex + 1} to {Math.min(startIndex + effectivePageSize, filteredResults.length)} of {filteredResults.length} records
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                    >
                      First
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="px-3 py-1 text-sm font-medium">
                      Page {currentPage} of {totalPages || 1}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage >= totalPages}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage >= totalPages}
                    >
                      Last
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Info message for error records */}
            {errorCount > 0 && (
              <Alert className="border-yellow-200 bg-yellow-50">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-yellow-700">
                  <strong>{errorCount} record(s)</strong> had errors and were not processed.
                  Download the error records, fix the issues, and re-upload them.
                </AlertDescription>
              </Alert>
            )}

            {successCount > 0 && (
              <Alert className="border-green-200 bg-green-50">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-700">
                  <strong>{successCount} record(s)</strong> were successfully processed and points have been updated.
                  You can view the updated balances in the Monitor Points tab.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
