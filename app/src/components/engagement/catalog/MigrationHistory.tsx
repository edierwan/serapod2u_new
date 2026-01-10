"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  History,
  Download,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileDown,
  Calendar
} from "lucide-react"
import { useSupabaseAuth } from "@/lib/hooks/useSupabaseAuth"
import { useToast } from "@/components/ui/use-toast"

interface MigrationRecord {
  id: string
  migration_date: string
  file_name: string
  total_records: number
  success_count: number
  new_users_count: number
  existing_users_count: number
  error_count: number
  results: any[]
  created_by: string
  created_at: string
  notes: string | null
  // Joined user info
  user_email?: string
  user_name?: string
}

interface MigrationHistoryProps {
  onRefresh?: () => void
}

export function MigrationHistory({ onRefresh }: MigrationHistoryProps) {
  const [history, setHistory] = useState<MigrationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<'all' | 'errors' | 'existing'>('all')
  const [deleting, setDeleting] = useState<string | null>(null)

  const { supabase, isReady } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadHistory()
    }
  }, [isReady])

  const loadHistory = async () => {
    try {
      setLoading(true)
      // Cast to any since migration_history table types are not generated yet
      const { data, error } = await (supabase as any)
        .from('migration_history')
        .select(`
          *,
          users!migration_history_created_by_fkey (
            email,
            full_name
          )
        `)
        .order('migration_date', { ascending: false })

      if (error) throw error
      
      // Map the user info to flat structure
      const historyWithUserInfo = (data || []).map((record: any) => ({
        ...record,
        user_email: record.users?.email,
        user_name: record.users?.full_name
      }))
      
      setHistory(historyWithUserInfo as MigrationRecord[])
    } catch (error: any) {
      console.error('Error loading migration history:', error)
      toast({
        title: "Error",
        description: "Failed to load migration history",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this migration record? This action cannot be undone.')) {
      return
    }

    try {
      setDeleting(id)
      // Cast to any since migration_history table types are not generated yet
      const { error } = await (supabase as any)
        .from('migration_history')
        .delete()
        .eq('id', id)

      if (error) throw error

      toast({
        title: "Deleted",
        description: "Migration record deleted successfully"
      })
      
      setHistory(prev => prev.filter(h => h.id !== id))
      if (expandedId === id) {
        setExpandedId(null)
      }
    } catch (error: any) {
      console.error('Error deleting migration record:', error)
      toast({
        title: "Error",
        description: "Failed to delete migration record",
        variant: "destructive"
      })
    } finally {
      setDeleting(null)
    }
  }

  const downloadRecords = (record: MigrationRecord, type: 'all' | 'errors' | 'existing') => {
    let records = record.results || []
    let filename = ''

    if (type === 'errors') {
      records = records.filter((r: any) => r.status === 'Error')
      filename = `migration_errors_${record.migration_date.split('T')[0]}.csv`
    } else if (type === 'existing') {
      records = records.filter((r: any) => r.status === 'Success' && r.isNewUser === false)
      filename = `migration_existing_${record.migration_date.split('T')[0]}.csv`
    } else {
      filename = `migration_all_${record.migration_date.split('T')[0]}.csv`
    }

    if (records.length === 0) {
      toast({
        title: "No Records",
        description: `No ${type} records found to download`,
        variant: "default"
      })
      return
    }

    const headers = ['JoinedDate', 'Name', 'MobileNumber', 'EmailAddress', 'Location', 'Balance', 'Status', 'UserType', 'Role', 'Message']
    const rows = records.map((r: any) => {
      const userType = r.status === 'Success' ? (r.isNewUser ? 'New Account' : 'Existing Account') : ''
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
        r.status || '',
        userType,
        r.userRole || '',
        safeMessage
      ].join(',')
    })

    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.join("\n")
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getFilteredResults = (results: any[], type: 'all' | 'errors' | 'existing') => {
    if (type === 'errors') {
      return results.filter((r: any) => r.status === 'Error')
    } else if (type === 'existing') {
      return results.filter((r: any) => r.status === 'Success' && r.isNewUser === false)
    }
    return results
  }

  // Group history by date
  const groupedHistory = history.reduce((groups: { [key: string]: MigrationRecord[] }, record) => {
    const date = record.migration_date.split('T')[0]
    if (!groups[date]) {
      groups[date] = []
    }
    groups[date].push(record)
    return groups
  }, {})

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Migration History
          </CardTitle>
          <CardDescription>
            View past migration results, download error records, and manage migration data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="rounded-full bg-muted p-4">
              <History className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No Migration History</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Migration records will appear here after you run a point migration.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Migration History
            </CardTitle>
            <CardDescription>
              View past migration results, download error records, and manage migration data.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={loadHistory}>
            <Loader2 className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(groupedHistory).map(([date, records]) => (
          <div key={date} className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Calendar className="h-4 w-4" />
              {new Date(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            
            <div className="space-y-2">
              {records.map((record) => (
                <div key={record.id} className="border rounded-lg overflow-hidden">
                  {/* Summary Row */}
                  <div 
                    className="flex items-center justify-between p-4 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                  >
                    <div className="flex items-center gap-4">
                      {expandedId === record.id ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div>
                        <div className="font-medium">{record.file_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(record.migration_date)} • {record.total_records} records
                        </div>
                        {(record.user_name || record.user_email) && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Run by: {record.user_name || record.user_email}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        {record.success_count}
                      </Badge>
                      {record.new_users_count > 0 && (
                        <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300">
                          {record.new_users_count} New
                        </Badge>
                      )}
                      {record.existing_users_count > 0 && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                          {record.existing_users_count} Exist
                        </Badge>
                      )}
                      {record.error_count > 0 && (
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                          <XCircle className="w-3 h-3 mr-1" />
                          {record.error_count}
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  {/* Expanded Details */}
                  {expandedId === record.id && (
                    <div className="p-4 border-t bg-white space-y-4">
                      {/* Action Buttons */}
                      <div className="flex flex-wrap gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => downloadRecords(record, 'all')}
                        >
                          <FileDown className="h-4 w-4 mr-2" />
                          Download All ({record.total_records})
                        </Button>
                        {record.error_count > 0 && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => downloadRecords(record, 'errors')}
                          >
                            <FileDown className="h-4 w-4 mr-2" />
                            Download Errors ({record.error_count})
                          </Button>
                        )}
                        {record.existing_users_count > 0 && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="text-amber-700 border-amber-200 hover:bg-amber-50"
                            onClick={() => downloadRecords(record, 'existing')}
                          >
                            <FileDown className="h-4 w-4 mr-2" />
                            Download Existing ({record.existing_users_count})
                          </Button>
                        )}
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-red-600 border-red-200 hover:bg-red-50 ml-auto"
                          onClick={() => handleDelete(record.id)}
                          disabled={deleting === record.id}
                        >
                          {deleting === record.id ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 mr-2" />
                          )}
                          Delete Record
                        </Button>
                      </div>

                      {/* Filter Tabs */}
                      <div className="flex gap-2">
                        <Button 
                          variant={filterType === 'all' ? 'default' : 'outline'} 
                          size="sm"
                          onClick={() => setFilterType('all')}
                        >
                          All ({record.total_records})
                        </Button>
                        {record.error_count > 0 && (
                          <Button 
                            variant={filterType === 'errors' ? 'default' : 'outline'} 
                            size="sm"
                            onClick={() => setFilterType('errors')}
                            className={filterType !== 'errors' ? 'text-red-600 border-red-200' : ''}
                          >
                            Errors ({record.error_count})
                          </Button>
                        )}
                        {record.existing_users_count > 0 && (
                          <Button 
                            variant={filterType === 'existing' ? 'default' : 'outline'} 
                            size="sm"
                            onClick={() => setFilterType('existing')}
                            className={filterType !== 'existing' ? 'text-amber-700 border-amber-200' : ''}
                          >
                            Existing ({record.existing_users_count})
                          </Button>
                        )}
                      </div>

                      {/* Results Table */}
                      <div className="border rounded-lg overflow-hidden max-h-[400px] overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              <TableHead className="w-12">#</TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead>Phone</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>Location</TableHead>
                              <TableHead className="text-right">Points</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Message</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {getFilteredResults(record.results || [], filterType).slice(0, 50).map((result: any, idx: number) => (
                              <TableRow key={idx} className={result.status === 'Error' ? 'bg-red-50/50' : ''}>
                                <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                                <TableCell className="font-medium">{result.name}</TableCell>
                                <TableCell className="text-sm">{result.phone}</TableCell>
                                <TableCell className="text-sm">{result.email}</TableCell>
                                <TableCell className="text-sm">{result.location}</TableCell>
                                <TableCell className="text-right font-medium">{result.points}</TableCell>
                                <TableCell>
                                  {result.status === 'Success' ? (
                                    <div className="flex flex-col gap-1">
                                      <Badge className="bg-green-100 text-green-700 w-fit">
                                        <CheckCircle2 className="w-3 h-3 mr-1" />
                                        Success
                                      </Badge>
                                      {result.isNewUser === false && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 w-fit">
                                          Existing
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <Badge className="bg-red-100 text-red-700">
                                      <XCircle className="w-3 h-3 mr-1" />
                                      Error
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground max-w-xs truncate" title={result.message}>
                                  {result.message}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {getFilteredResults(record.results || [], filterType).length > 50 && (
                          <div className="p-3 text-center text-sm text-muted-foreground bg-muted/30">
                            Showing first 50 records. Download CSV for complete list.
                          </div>
                        )}
                      </div>

                      {/* Info Alerts */}
                      {record.error_count > 0 && (
                        <Alert className="border-yellow-200 bg-yellow-50">
                          <AlertCircle className="h-4 w-4 text-yellow-600" />
                          <AlertDescription className="text-yellow-700">
                            <strong>{record.error_count} record(s)</strong> had errors. Download the error records, fix the issues in your spreadsheet, and re-upload.
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
