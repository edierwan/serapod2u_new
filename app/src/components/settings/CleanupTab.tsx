'use client'

import { useState, useCallback } from 'react'
import { useToast } from '@/components/ui/use-toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertTriangle,
  FileCode,
  Activity,
  ClipboardList,
  Download,
  Search,
  Filter,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Package,
  Code,
  Loader2,
  Shield,
  Info,
  Clock,
  TrendingUp,
  Trash2,
  Eye,
  Lock,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type {
  StaticReport,
  RuntimeReport,
  CleanupPlan,
  CleanupCandidate,
  ConfidenceLevel,
  AnalysisItem,
} from '@/types/cleanup'

interface CleanupTabProps {
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

type FilterCategory = 'all' | 'file' | 'export' | 'dependency'
type FilterConfidence = 'all' | 'high' | 'medium' | 'low'

export default function CleanupTab({ userProfile }: CleanupTabProps) {
  const { toast } = useToast()
  
  // Only Super Admin can access (role_level = 1)
  const isSuperAdmin = userProfile.roles.role_level === 1

  // Tab state
  const [activeSection, setActiveSection] = useState<'static' | 'runtime' | 'plan' | 'export'>('static')
  
  // Report data
  const [staticReport, setStaticReport] = useState<StaticReport | null>(null)
  const [runtimeReport, setRuntimeReport] = useState<RuntimeReport | null>(null)
  const [cleanupPlan, setCleanupPlan] = useState<CleanupPlan | null>(null)

  // Loading states
  const [isGeneratingStatic, setIsGeneratingStatic] = useState(false)
  const [isGeneratingRuntime, setIsGeneratingRuntime] = useState(false)
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>('all')
  const [confidenceFilter, setConfidenceFilter] = useState<FilterConfidence>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Runtime report range
  const [runtimeDays, setRuntimeDays] = useState('7')

  // Expanded sections
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['safe_to_remove']))

  // Confirmation dialog
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null)
  const [confirmTitle, setConfirmTitle] = useState('')
  const [confirmDescription, setConfirmDescription] = useState('')

  if (!isSuperAdmin) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-600" />
            <CardTitle className="text-amber-900">Access Restricted</CardTitle>
          </div>
          <CardDescription className="text-amber-700">
            Only Super Administrators can access the Code Cleanup tools.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-amber-600">
            Your current role: <strong>{userProfile.roles.role_name}</strong> (Level {userProfile.roles.role_level})
          </p>
        </CardContent>
      </Card>
    )
  }

  // Generate Static Report
  const handleGenerateStatic = async () => {
    setIsGeneratingStatic(true)
    try {
      const response = await fetch('/api/admin/cleanup/static-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          include_knip: true,
          include_tsc: true,
          include_eslint: true,
        }),
      })

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to generate report')
      }

      setStaticReport(result.report)
      toast({
        title: 'Static Analysis Complete',
        description: `Found ${result.report.summary.unusedFilesCount} unused files, ${result.report.summary.unusedExportsCount} unused exports`,
      })
    } catch (error: any) {
      toast({
        title: 'Analysis Failed',
        description: error.message || 'Could not generate static report',
        variant: 'destructive',
      })
    } finally {
      setIsGeneratingStatic(false)
    }
  }

  // Generate Runtime Report
  const handleGenerateRuntime = async () => {
    setIsGeneratingRuntime(true)
    try {
      const response = await fetch(`/api/admin/cleanup/runtime-report?range=${runtimeDays}`)
      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to generate report')
      }

      setRuntimeReport(result.report)
      toast({
        title: 'Runtime Report Generated',
        description: `Analyzed ${result.report.total_api_calls} API calls over ${runtimeDays} days`,
      })
    } catch (error: any) {
      toast({
        title: 'Report Failed',
        description: error.message || 'Could not generate runtime report',
        variant: 'destructive',
      })
    } finally {
      setIsGeneratingRuntime(false)
    }
  }

  // Generate Cleanup Plan
  const handleGeneratePlan = async () => {
    if (!staticReport) {
      toast({
        title: 'Static Report Required',
        description: 'Please generate a static report first',
        variant: 'destructive',
      })
      return
    }

    setIsGeneratingPlan(true)
    try {
      const response = await fetch('/api/admin/cleanup/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          static_report: staticReport,
          runtime_report: runtimeReport,
          include_plan: true,
          format: 'json',
        }),
      })

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to generate plan')
      }

      const exportData = JSON.parse(result.json_content)
      setCleanupPlan(exportData.cleanup_plan)

      toast({
        title: 'Cleanup Plan Generated',
        description: `${exportData.cleanup_plan.summary.safe_count} safe, ${exportData.cleanup_plan.summary.deprecate_count} to deprecate`,
      })
    } catch (error: any) {
      toast({
        title: 'Plan Generation Failed',
        description: error.message || 'Could not generate cleanup plan',
        variant: 'destructive',
      })
    } finally {
      setIsGeneratingPlan(false)
    }
  }

  // Export Report
  const handleExport = async (format: 'json' | 'markdown' | 'both') => {
    setIsExporting(true)
    try {
      const response = await fetch('/api/admin/cleanup/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          static_report: staticReport,
          runtime_report: runtimeReport,
          include_plan: true,
          format,
        }),
      })

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to export')
      }

      // Download files
      const timestamp = new Date().toISOString().split('T')[0]

      if (result.json_content && (format === 'json' || format === 'both')) {
        downloadFile(result.json_content, `cleanup-report-${timestamp}.json`, 'application/json')
      }

      if (result.markdown_content && (format === 'markdown' || format === 'both')) {
        downloadFile(result.markdown_content, `cleanup-report-${timestamp}.md`, 'text/markdown')
      }

      toast({
        title: 'Export Complete',
        description: 'Report downloaded successfully',
      })
    } catch (error: any) {
      toast({
        title: 'Export Failed',
        description: error.message || 'Could not export report',
        variant: 'destructive',
      })
    } finally {
      setIsExporting(false)
    }
  }

  // Download helper
  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast({
      title: 'Copied',
      description: 'Content copied to clipboard',
    })
  }

  // Toggle section expansion
  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections)
    if (newExpanded.has(section)) {
      newExpanded.delete(section)
    } else {
      newExpanded.add(section)
    }
    setExpandedSections(newExpanded)
  }

  // Get confidence badge color
  const getConfidenceBadge = (confidence: ConfidenceLevel) => {
    switch (confidence) {
      case 'high':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">High</Badge>
      case 'medium':
        return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Medium</Badge>
      case 'low':
        return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100">Low</Badge>
    }
  }

  // Get category icon
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'file':
        return <FileText className="w-4 h-4 text-blue-500" />
      case 'export':
        return <Code className="w-4 h-4 text-purple-500" />
      case 'dependency':
        return <Package className="w-4 h-4 text-orange-500" />
      default:
        return <FileCode className="w-4 h-4 text-gray-500" />
    }
  }

  // Filter candidates
  const filterCandidates = (candidates: CleanupCandidate[]): CleanupCandidate[] => {
    return candidates.filter(c => {
      if (categoryFilter !== 'all' && c.item.category !== categoryFilter) return false
      if (confidenceFilter !== 'all' && c.item.confidence !== confidenceFilter) return false
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          c.item.path.toLowerCase().includes(query) ||
          (c.item.name?.toLowerCase().includes(query) ?? false)
        )
      }
      return true
    })
  }

  // Generate ignore rule suggestion
  const generateIgnoreSnippet = (item: AnalysisItem): string => {
    if (item.category === 'file') {
      return `// Add to knip.json or .kniprc.json:
{
  "ignore": [
    "${item.path}"
  ]
}`
    }
    if (item.category === 'export') {
      return `// Add to knip.json:
{
  "ignoreExportsUsedInFile": {
    "${item.path}": ["${item.name}"]
  }
}`
    }
    return `// Add to knip.json:
{
  "ignoreDependencies": [
    "${item.path}"
  ]
}`
  }

  return (
    <div className="space-y-6">
      {/* Warning Banner */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-100 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-amber-900">Code Cleanup Tools</h3>
            <p className="text-sm text-amber-700 mt-1">
              Reports only. No auto-deletion. Apply changes via PR after engineer review.
            </p>
          </div>
          <Badge variant="outline" className="border-amber-300 text-amber-700">
            <Lock className="w-3 h-3 mr-1" />
            Super Admin
          </Badge>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeSection} onValueChange={(v) => setActiveSection(v as any)} className="w-full">
        <TabsList className="grid grid-cols-4 w-full bg-gray-100/80">
          <TabsTrigger value="static" className="flex items-center gap-2 data-[state=active]:bg-white">
            <FileCode className="w-4 h-4" />
            <span className="hidden sm:inline">Static Analysis</span>
            <span className="sm:hidden">Static</span>
          </TabsTrigger>
          <TabsTrigger value="runtime" className="flex items-center gap-2 data-[state=active]:bg-white">
            <Activity className="w-4 h-4" />
            <span className="hidden sm:inline">Runtime Usage</span>
            <span className="sm:hidden">Runtime</span>
          </TabsTrigger>
          <TabsTrigger value="plan" className="flex items-center gap-2 data-[state=active]:bg-white">
            <ClipboardList className="w-4 h-4" />
            <span className="hidden sm:inline">Cleanup Plan</span>
            <span className="sm:hidden">Plan</span>
          </TabsTrigger>
          <TabsTrigger value="export" className="flex items-center gap-2 data-[state=active]:bg-white">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
            <span className="sm:hidden">Export</span>
          </TabsTrigger>
        </TabsList>

        {/* Static Analysis Tab */}
        <TabsContent value="static" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FileCode className="w-5 h-5 text-blue-600" />
                    Static Code Analysis
                  </CardTitle>
                  <CardDescription>
                    Analyze codebase for unused files, exports, and dependencies using Knip, TypeScript, and ESLint
                  </CardDescription>
                </div>
                <Button
                  onClick={handleGenerateStatic}
                  disabled={isGeneratingStatic}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isGeneratingStatic ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Generate Report
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!staticReport ? (
                <div className="text-center py-12 text-gray-500">
                  <FileCode className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium">No Report Generated</p>
                  <p className="text-sm mt-1">Click &quot;Generate Report&quot; to analyze your codebase</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <StatCard
                      label="Unused Files"
                      value={staticReport.summary.unusedFilesCount}
                      icon={<FileText className="w-4 h-4" />}
                      color="blue"
                    />
                    <StatCard
                      label="Unused Exports"
                      value={staticReport.summary.unusedExportsCount}
                      icon={<Code className="w-4 h-4" />}
                      color="purple"
                    />
                    <StatCard
                      label="Unused Deps"
                      value={staticReport.summary.unusedDepsCount}
                      icon={<Package className="w-4 h-4" />}
                      color="orange"
                    />
                    <StatCard
                      label="TS Errors"
                      value={staticReport.summary.tsErrorsCount}
                      icon={<XCircle className="w-4 h-4" />}
                      color="red"
                    />
                    <StatCard
                      label="ESLint Warns"
                      value={staticReport.summary.eslintWarningsCount}
                      icon={<AlertCircle className="w-4 h-4" />}
                      color="amber"
                    />
                  </div>

                  {/* Filters */}
                  <div className="flex flex-wrap gap-3 items-center">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        placeholder="Search files, exports..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as FilterCategory)}>
                      <SelectTrigger className="w-[150px]">
                        <Filter className="w-4 h-4 mr-2" />
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        <SelectItem value="file">Files</SelectItem>
                        <SelectItem value="export">Exports</SelectItem>
                        <SelectItem value="dependency">Dependencies</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={confidenceFilter} onValueChange={(v) => setConfidenceFilter(v as FilterConfidence)}>
                      <SelectTrigger className="w-[150px]">
                        <SelectValue placeholder="Confidence" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Confidence</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Results */}
                  <div className="space-y-4">
                    {/* Unused Files */}
                    {staticReport.unused_files.length > 0 && (categoryFilter === 'all' || categoryFilter === 'file') && (
                      <CollapsibleSection
                        title="Unused Files"
                        count={staticReport.unused_files.filter(f => 
                          !searchQuery || f.toLowerCase().includes(searchQuery.toLowerCase())
                        ).length}
                        icon={<FileText className="w-4 h-4 text-blue-500" />}
                        isExpanded={expandedSections.has('unused_files')}
                        onToggle={() => toggleSection('unused_files')}
                      >
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {staticReport.unused_files
                            .filter(f => !searchQuery || f.toLowerCase().includes(searchQuery.toLowerCase()))
                            .slice(0, 50)
                            .map((file, i) => (
                              <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg hover:bg-gray-100">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                  <code className="text-sm truncate">{file}</code>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyToClipboard(generateIgnoreSnippet({ path: file, category: 'file', confidence: 'medium', reason: '' }))}
                                >
                                  <Copy className="w-3 h-3" />
                                </Button>
                              </div>
                            ))}
                        </div>
                      </CollapsibleSection>
                    )}

                    {/* Unused Exports */}
                    {staticReport.unused_exports.length > 0 && (categoryFilter === 'all' || categoryFilter === 'export') && (
                      <CollapsibleSection
                        title="Unused Exports"
                        count={staticReport.unused_exports.filter(e =>
                          !searchQuery || 
                          e.file.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          e.exportName.toLowerCase().includes(searchQuery.toLowerCase())
                        ).length}
                        icon={<Code className="w-4 h-4 text-purple-500" />}
                        isExpanded={expandedSections.has('unused_exports')}
                        onToggle={() => toggleSection('unused_exports')}
                      >
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {staticReport.unused_exports
                            .filter(e =>
                              !searchQuery ||
                              e.file.toLowerCase().includes(searchQuery.toLowerCase()) ||
                              e.exportName.toLowerCase().includes(searchQuery.toLowerCase())
                            )
                            .slice(0, 50)
                            .map((exp, i) => (
                              <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg hover:bg-gray-100">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <Code className="w-4 h-4 text-purple-500 flex-shrink-0" />
                                  <div className="truncate">
                                    <code className="text-sm">{exp.file}</code>
                                    <span className="text-gray-400 mx-1">→</span>
                                    <code className="text-sm font-semibold text-purple-700">{exp.exportName}</code>
                                  </div>
                                </div>
                                <Badge variant="outline" className="text-xs ml-2 flex-shrink-0">{exp.type}</Badge>
                              </div>
                            ))}
                        </div>
                      </CollapsibleSection>
                    )}

                    {/* Unused Dependencies */}
                    {staticReport.unused_deps.length > 0 && (categoryFilter === 'all' || categoryFilter === 'dependency') && (
                      <CollapsibleSection
                        title="Unused Dependencies"
                        count={staticReport.unused_deps.filter(d =>
                          !searchQuery || d.toLowerCase().includes(searchQuery.toLowerCase())
                        ).length}
                        icon={<Package className="w-4 h-4 text-orange-500" />}
                        isExpanded={expandedSections.has('unused_deps')}
                        onToggle={() => toggleSection('unused_deps')}
                      >
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {staticReport.unused_deps
                            .filter(d => !searchQuery || d.toLowerCase().includes(searchQuery.toLowerCase()))
                            .map((dep, i) => (
                              <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg hover:bg-gray-100">
                                <div className="flex items-center gap-2">
                                  <Package className="w-4 h-4 text-orange-500" />
                                  <code className="text-sm">{dep}</code>
                                </div>
                                {dep.startsWith('(dev)') && (
                                  <Badge variant="outline" className="text-xs">devDependency</Badge>
                                )}
                              </div>
                            ))}
                        </div>
                      </CollapsibleSection>
                    )}

                    {/* Notes */}
                    {staticReport.notes.length > 0 && (
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <Info className="w-4 h-4 text-blue-600" />
                          <span className="font-medium text-blue-900">Analysis Notes</span>
                        </div>
                        <ul className="space-y-1 text-sm text-blue-800">
                          {staticReport.notes.map((note, i) => (
                            <li key={i}>• {note}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Runtime Usage Tab */}
        <TabsContent value="runtime" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-green-600" />
                    Runtime Usage Evidence
                  </CardTitle>
                  <CardDescription>
                    Track actual API, RPC, and page usage to validate what&apos;s being used in production
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  <Select value={runtimeDays} onValueChange={setRuntimeDays}>
                    <SelectTrigger className="w-[120px]">
                      <Clock className="w-4 h-4 mr-2" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Last 24h</SelectItem>
                      <SelectItem value="7">Last 7 days</SelectItem>
                      <SelectItem value="14">Last 14 days</SelectItem>
                      <SelectItem value="30">Last 30 days</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleGenerateRuntime}
                    disabled={isGeneratingRuntime}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {isGeneratingRuntime ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Fetch Data
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!runtimeReport ? (
                <div className="text-center py-12 text-gray-500">
                  <Activity className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium">No Runtime Data</p>
                  <p className="text-sm mt-1">Click &quot;Fetch Data&quot; to load usage statistics</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-3 gap-4">
                    <StatCard
                      label="API Calls"
                      value={runtimeReport.total_api_calls}
                      icon={<TrendingUp className="w-4 h-4" />}
                      color="green"
                    />
                    <StatCard
                      label="RPC Calls"
                      value={runtimeReport.total_rpc_calls}
                      icon={<Code className="w-4 h-4" />}
                      color="purple"
                    />
                    <StatCard
                      label="Page Views"
                      value={runtimeReport.total_page_views}
                      icon={<Eye className="w-4 h-4" />}
                      color="blue"
                    />
                  </div>

                  {/* API Routes */}
                  <CollapsibleSection
                    title="API Route Usage"
                    count={runtimeReport.api_routes.length}
                    icon={<TrendingUp className="w-4 h-4 text-green-500" />}
                    isExpanded={expandedSections.has('api_routes')}
                    onToggle={() => toggleSection('api_routes')}
                  >
                    {runtimeReport.api_routes.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 px-3 font-medium">Route</th>
                              <th className="text-left py-2 px-3 font-medium">Method</th>
                              <th className="text-right py-2 px-3 font-medium">Hits</th>
                              <th className="text-right py-2 px-3 font-medium">Last Seen</th>
                            </tr>
                          </thead>
                          <tbody>
                            {runtimeReport.api_routes.slice(0, 20).map((route, i) => (
                              <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="py-2 px-3">
                                  <code className="text-sm">{route.route}</code>
                                </td>
                                <td className="py-2 px-3">
                                  <Badge variant="outline">{route.method}</Badge>
                                </td>
                                <td className="py-2 px-3 text-right font-medium">{route.hit_count}</td>
                                <td className="py-2 px-3 text-right text-gray-500">
                                  {new Date(route.last_seen).toLocaleDateString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm py-4 text-center">
                        No API usage data available. Usage tracking will begin collecting data automatically.
                      </p>
                    )}
                  </CollapsibleSection>

                  {/* RPC Calls */}
                  {runtimeReport.rpc_calls.length > 0 && (
                    <CollapsibleSection
                      title="RPC Usage"
                      count={runtimeReport.rpc_calls.length}
                      icon={<Code className="w-4 h-4 text-purple-500" />}
                      isExpanded={expandedSections.has('rpc_calls')}
                      onToggle={() => toggleSection('rpc_calls')}
                    >
                      <div className="space-y-2">
                        {runtimeReport.rpc_calls.map((rpc, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div>
                              <code className="text-sm font-medium">{rpc.rpc_name}</code>
                              <p className="text-xs text-gray-500 mt-1">
                                Called from: {rpc.caller_routes.join(', ') || 'Unknown'}
                              </p>
                            </div>
                            <div className="text-right">
                              <span className="font-medium">{rpc.hit_count}</span>
                              <p className="text-xs text-gray-500">
                                Last: {new Date(rpc.last_seen).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CollapsibleSection>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cleanup Plan Tab */}
        <TabsContent value="plan" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-purple-600" />
                    Cleanup Plan Builder
                  </CardTitle>
                  <CardDescription>
                    Merge static analysis with runtime evidence to create a safe cleanup plan
                  </CardDescription>
                </div>
                <Button
                  onClick={handleGeneratePlan}
                  disabled={isGeneratingPlan || !staticReport}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {isGeneratingPlan ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Building...
                    </>
                  ) : (
                    <>
                      <ClipboardList className="w-4 h-4 mr-2" />
                      Build Plan
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!staticReport && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg mb-6">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    <span className="text-sm text-amber-800">
                      Generate a static report first to build a cleanup plan
                    </span>
                  </div>
                </div>
              )}

              {!cleanupPlan ? (
                <div className="text-center py-12 text-gray-500">
                  <ClipboardList className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium">No Cleanup Plan</p>
                  <p className="text-sm mt-1">Click &quot;Build Plan&quot; to generate recommendations</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Summary */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-center">
                      <CheckCircle2 className="w-6 h-6 mx-auto text-green-600 mb-2" />
                      <div className="text-2xl font-bold text-green-700">{cleanupPlan.summary.safe_count}</div>
                      <div className="text-sm text-green-600">Safe to Remove</div>
                    </div>
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-center">
                      <AlertCircle className="w-6 h-6 mx-auto text-amber-600 mb-2" />
                      <div className="text-2xl font-bold text-amber-700">{cleanupPlan.summary.deprecate_count}</div>
                      <div className="text-sm text-amber-600">Deprecate First</div>
                    </div>
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center">
                      <Lock className="w-6 h-6 mx-auto text-gray-600 mb-2" />
                      <div className="text-2xl font-bold text-gray-700">{cleanupPlan.summary.keep_count}</div>
                      <div className="text-sm text-gray-600">Keep / Ignore</div>
                    </div>
                  </div>

                  {/* Filters */}
                  <div className="flex gap-3 items-center">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        placeholder="Search candidates..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as FilterCategory)}>
                      <SelectTrigger className="w-[150px]">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="file">Files</SelectItem>
                        <SelectItem value="export">Exports</SelectItem>
                        <SelectItem value="dependency">Dependencies</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Buckets */}
                  <div className="space-y-4">
                    {/* Safe to Remove */}
                    <CollapsibleSection
                      title="✅ Safe to Remove"
                      count={filterCandidates(cleanupPlan.safe_to_remove).length}
                      icon={<CheckCircle2 className="w-4 h-4 text-green-500" />}
                      isExpanded={expandedSections.has('safe_to_remove')}
                      onToggle={() => toggleSection('safe_to_remove')}
                      headerColor="bg-green-50"
                    >
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {filterCandidates(cleanupPlan.safe_to_remove).map((candidate) => (
                          <CleanupCandidateItem
                            key={candidate.id}
                            candidate={candidate}
                            onCopyIgnore={() => copyToClipboard(generateIgnoreSnippet(candidate.item))}
                          />
                        ))}
                        {filterCandidates(cleanupPlan.safe_to_remove).length === 0 && (
                          <p className="text-sm text-gray-500 py-4 text-center">No items match your filters</p>
                        )}
                      </div>
                    </CollapsibleSection>

                    {/* Deprecate First */}
                    <CollapsibleSection
                      title="⚠️ Deprecate First"
                      count={filterCandidates(cleanupPlan.deprecate_first).length}
                      icon={<AlertCircle className="w-4 h-4 text-amber-500" />}
                      isExpanded={expandedSections.has('deprecate_first')}
                      onToggle={() => toggleSection('deprecate_first')}
                      headerColor="bg-amber-50"
                    >
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {filterCandidates(cleanupPlan.deprecate_first).map((candidate) => (
                          <CleanupCandidateItem
                            key={candidate.id}
                            candidate={candidate}
                            onCopyIgnore={() => copyToClipboard(generateIgnoreSnippet(candidate.item))}
                          />
                        ))}
                        {filterCandidates(cleanupPlan.deprecate_first).length === 0 && (
                          <p className="text-sm text-gray-500 py-4 text-center">No items match your filters</p>
                        )}
                      </div>
                    </CollapsibleSection>

                    {/* Keep / Ignore */}
                    <CollapsibleSection
                      title="🔒 Keep / Ignore"
                      count={filterCandidates(cleanupPlan.keep_or_ignore).length}
                      icon={<Lock className="w-4 h-4 text-gray-500" />}
                      isExpanded={expandedSections.has('keep_or_ignore')}
                      onToggle={() => toggleSection('keep_or_ignore')}
                      headerColor="bg-gray-50"
                    >
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {filterCandidates(cleanupPlan.keep_or_ignore).slice(0, 20).map((candidate) => (
                          <CleanupCandidateItem
                            key={candidate.id}
                            candidate={candidate}
                            onCopyIgnore={() => copyToClipboard(generateIgnoreSnippet(candidate.item))}
                            compact
                          />
                        ))}
                        {filterCandidates(cleanupPlan.keep_or_ignore).length > 20 && (
                          <p className="text-sm text-gray-500 py-2 text-center">
                            +{filterCandidates(cleanupPlan.keep_or_ignore).length - 20} more items
                          </p>
                        )}
                      </div>
                    </CollapsibleSection>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Export Tab */}
        <TabsContent value="export" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="w-5 h-5 text-indigo-600" />
                Export Cleanup Report
              </CardTitle>
              <CardDescription>
                Download a comprehensive report combining static analysis, runtime data, and cleanup recommendations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Report Status */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className={`p-4 rounded-lg border ${staticReport ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {staticReport ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : (
                        <XCircle className="w-5 h-5 text-gray-400" />
                      )}
                      <span className="font-medium">Static Report</span>
                    </div>
                    <p className="text-sm text-gray-600">
                      {staticReport
                        ? `Generated ${new Date(staticReport.generated_at).toLocaleString()}`
                        : 'Not generated'}
                    </p>
                  </div>
                  <div className={`p-4 rounded-lg border ${runtimeReport ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {runtimeReport ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : (
                        <XCircle className="w-5 h-5 text-gray-400" />
                      )}
                      <span className="font-medium">Runtime Report</span>
                    </div>
                    <p className="text-sm text-gray-600">
                      {runtimeReport
                        ? `${runtimeReport.range_days} day range`
                        : 'Not fetched'}
                    </p>
                  </div>
                  <div className={`p-4 rounded-lg border ${cleanupPlan ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {cleanupPlan ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : (
                        <XCircle className="w-5 h-5 text-gray-400" />
                      )}
                      <span className="font-medium">Cleanup Plan</span>
                    </div>
                    <p className="text-sm text-gray-600">
                      {cleanupPlan
                        ? `${cleanupPlan.summary.total_candidates} candidates`
                        : 'Not built'}
                    </p>
                  </div>
                </div>

                {/* Export Buttons */}
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => handleExport('json')}
                    disabled={isExporting || !staticReport}
                    variant="outline"
                    className="flex-1 min-w-[200px]"
                  >
                    {isExporting ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <FileCode className="w-4 h-4 mr-2" />
                    )}
                    Export JSON
                  </Button>
                  <Button
                    onClick={() => handleExport('markdown')}
                    disabled={isExporting || !staticReport}
                    variant="outline"
                    className="flex-1 min-w-[200px]"
                  >
                    {isExporting ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <FileText className="w-4 h-4 mr-2" />
                    )}
                    Export Markdown
                  </Button>
                  <Button
                    onClick={() => handleExport('both')}
                    disabled={isExporting || !staticReport}
                    className="flex-1 min-w-[200px] bg-indigo-600 hover:bg-indigo-700"
                  >
                    {isExporting ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4 mr-2" />
                    )}
                    Export All
                  </Button>
                </div>

                {/* Usage Instructions */}
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="font-medium text-blue-900 mb-2 flex items-center gap-2">
                    <Info className="w-4 h-4" />
                    How to Use This Report
                  </h4>
                  <ol className="text-sm text-blue-800 space-y-2 list-decimal list-inside">
                    <li>Export the report and share with your engineering team</li>
                    <li>Review &quot;Safe to Remove&quot; items - these have high confidence and no recent usage</li>
                    <li>For &quot;Deprecate First&quot; items, add deprecation warnings before removing</li>
                    <li>Create a PR with the suggested changes - never auto-delete</li>
                    <li>Monitor the PR in staging before merging to production</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmAction?.()}>Continue</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Stat Card Component
function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: number
  icon: React.ReactNode
  color: 'blue' | 'purple' | 'orange' | 'red' | 'amber' | 'green'
}) {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    green: 'bg-green-50 border-green-200 text-green-700',
  }

  return (
    <div className={`p-4 rounded-lg border ${colorClasses[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}

// Collapsible Section Component
function CollapsibleSection({
  title,
  count,
  icon,
  isExpanded,
  onToggle,
  children,
  headerColor = 'bg-gray-50',
}: {
  title: string
  count: number
  icon: React.ReactNode
  isExpanded: boolean
  onToggle: () => void
  children: React.ReactNode
  headerColor?: string
}) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between p-3 ${headerColor} hover:bg-opacity-80 transition-colors`}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium">{title}</span>
          <Badge variant="secondary" className="ml-2">{count}</Badge>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500" />
        )}
      </button>
      {isExpanded && <div className="p-3 border-t">{children}</div>}
    </div>
  )
}

// Cleanup Candidate Item Component
function CleanupCandidateItem({
  candidate,
  onCopyIgnore,
  compact = false,
}: {
  candidate: CleanupCandidate
  onCopyIgnore: () => void
  compact?: boolean
}) {
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'file':
        return <FileText className="w-4 h-4 text-blue-500" />
      case 'export':
        return <Code className="w-4 h-4 text-purple-500" />
      case 'dependency':
        return <Package className="w-4 h-4 text-orange-500" />
      default:
        return <FileCode className="w-4 h-4 text-gray-500" />
    }
  }

  const getConfidenceBadge = (confidence: ConfidenceLevel) => {
    switch (confidence) {
      case 'high':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-xs">High</Badge>
      case 'medium':
        return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-xs">Medium</Badge>
      case 'low':
        return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100 text-xs">Low</Badge>
    }
  }

  if (compact) {
    return (
      <div className="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {getCategoryIcon(candidate.item.category)}
          <code className="text-xs truncate">{candidate.item.path}</code>
        </div>
        {getConfidenceBadge(candidate.item.confidence)}
      </div>
    )
  }

  return (
    <div className="p-3 bg-white border rounded-lg hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {getCategoryIcon(candidate.item.category)}
            <code className="text-sm font-medium truncate">{candidate.item.path}</code>
            {candidate.item.name && (
              <>
                <span className="text-gray-400">→</span>
                <code className="text-sm text-purple-700">{candidate.item.name}</code>
              </>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">{candidate.item.reason}</p>
          {!compact && (
            <div className="flex gap-4 mt-2 text-xs text-gray-600">
              <span>📊 {candidate.staticEvidence}</span>
              {candidate.runtimeEvidence && <span>🕐 {candidate.runtimeEvidence}</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {getConfidenceBadge(candidate.item.confidence)}
          <Button variant="ghost" size="sm" onClick={onCopyIgnore} title="Copy ignore rule">
            <Copy className="w-3 h-3" />
          </Button>
        </div>
      </div>
      {!compact && (
        <div className="mt-2 pt-2 border-t">
          <p className="text-xs font-medium text-gray-700">💡 {candidate.suggestedAction}</p>
        </div>
      )}
    </div>
  )
}
