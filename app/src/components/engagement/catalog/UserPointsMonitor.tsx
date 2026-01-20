import { useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, Users, Trophy, Edit, History, ArrowUpDown } from "lucide-react"
import { formatNumber, formatDateLabel } from "./catalog-utils"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PointMigration } from "./PointMigration"
import { MigrationHistory } from "./MigrationHistory"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface ConsumerUser {
  user_id: string
  consumer_name: string
  consumer_phone: string | null
  consumer_email: string | null
  consumer_location?: string | null
  current_balance: number
  total_collected_system: number
  total_collected_manual: number
  total_migration: number
  total_redeemed: number
  transaction_count: number
  last_transaction_date: string | null
  last_migration_by_name?: string | null
}

interface UserPointsMonitorProps {
  users: ConsumerUser[]
  loading: boolean
  onAdjustPoints: (user: ConsumerUser) => void
  onRefresh?: () => void
}

export function UserPointsMonitor({ users, loading, onAdjustPoints, onRefresh }: UserPointsMonitorProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [sortConfig, setSortConfig] = useState<{ key: keyof ConsumerUser; direction: 'asc' | 'desc' } | null>(null)

  const filteredUsers = users.filter(user => {
    const term = searchTerm.toLowerCase()
    return (
      user.consumer_name.toLowerCase().includes(term) ||
      (user.consumer_phone || "").toLowerCase().includes(term) ||
      (user.consumer_email || "").toLowerCase().includes(term)
    )
  })

  const handleSort = (key: keyof ConsumerUser) => {
    let direction: 'asc' | 'desc' = 'asc'
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc'
    }
    setSortConfig({ key, direction })
  }

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    if (!sortConfig) return 0

    const aValue = a[sortConfig.key]
    const bValue = b[sortConfig.key]

    if (aValue === bValue) return 0

    // Handle nulls
    if (aValue === null || aValue === undefined) return 1
    if (bValue === null || bValue === undefined) return -1

    if (sortConfig.direction === 'asc') {
      return aValue < bValue ? -1 : 1
    } else {
      return aValue > bValue ? -1 : 1
    }
  })

  const totalPages = Math.ceil(sortedUsers.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedUsers = sortedUsers.slice(startIndex, endIndex)

  // Reset to page 1 when search changes
  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setCurrentPage(1)
  }

  const SortableHeader = ({ label, sortKey }: { label: string, sortKey: keyof ConsumerUser }) => (
    <th
      className="px-4 py-3 font-medium cursor-pointer hover:bg-muted/80 transition-colors"
      onClick={() => handleSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sortConfig?.key === sortKey ? 'text-primary' : 'text-muted-foreground'}`} />
      </div>
    </th>
  )

  return (
    <Tabs defaultValue="monitor" className="space-y-4">
      <TabsList>
        <TabsTrigger value="monitor">Monitor Points</TabsTrigger>
        <TabsTrigger value="migration">Point Migration</TabsTrigger>
        <TabsTrigger value="history">Migration History</TabsTrigger>
      </TabsList>

      <TabsContent value="monitor" className="space-y-4">
        {/* Info Banner */}
        <Card className="border-purple-200 bg-purple-50/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-purple-100 p-2">
                <Users className="h-5 w-5 text-purple-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-purple-900">Consumer Point Collection System</h3>
                <p className="mt-1 text-sm text-purple-800">
                  Individual consumers collect points through the mobile app.
                  All point collections are tracked here for monitoring and management.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-purple-700">
                  <Badge variant="secondary" className="bg-purple-100 text-purple-700">
                    ✓ Individual Accounts
                  </Badge>
                  <Badge variant="secondary" className="bg-purple-100 text-purple-700">
                    ✓ Real-time Balance Updates
                  </Badge>
                  <Badge variant="secondary" className="bg-purple-100 text-purple-700">
                    ✓ Transaction History
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Trophy className="h-4 w-4" /> Consumer Point Balances
                </CardTitle>
                <CardDescription>Monitor consumer point collections and balances.</CardDescription>
              </div>
              <div className="relative sm:min-w-[280px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search by name, phone, or email..."
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="rounded-full bg-muted p-4">
                  <Users className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">No consumers found</h3>
                <p className="text-sm text-muted-foreground">
                  {searchTerm ? "Try adjusting your search terms." : "No consumers have collected points yet."}
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium w-[50px]">#</th>
                        <SortableHeader label="Consumer" sortKey="consumer_name" />
                        <SortableHeader label="Location" sortKey="consumer_location" />
                        <SortableHeader label="Current Balance" sortKey="current_balance" />
                        <SortableHeader label="Collected (System)" sortKey="total_collected_system" />
                        <SortableHeader label="Collected (Manual)" sortKey="total_collected_manual" />
                        <SortableHeader label="Migration Points" sortKey="total_migration" />
                        <SortableHeader label="Total Redeemed" sortKey="total_redeemed" />
                        <SortableHeader label="Transactions" sortKey="transaction_count" />
                        <SortableHeader label="Last Activity" sortKey="last_transaction_date" />
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {paginatedUsers.map((user, index) => (
                        <tr key={user.user_id} className="hover:bg-muted/50">
                          <td className="px-4 py-4 text-muted-foreground">
                            {startIndex + index + 1}
                          </td>
                          <td className="px-4 py-4">
                            <div className="font-medium">
                              <Link href={`/dashboard?view=user-profile&id=${user.user_id}`} className="text-primary hover:underline">
                                {user.consumer_name}
                              </Link>
                            </div>
                            <div className="text-xs text-muted-foreground">{user.consumer_phone}</div>
                            <div className="text-xs text-muted-foreground">{user.consumer_email}</div>
                          </td>
                          <td className="px-4 py-4">
                            <span className="text-sm text-gray-700">
                              {user.consumer_location || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2 font-bold text-primary">
                              <Trophy className="h-4 w-4" />
                              {formatNumber(user.current_balance)}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="text-green-600">
                              +{formatNumber(user.total_collected_system)}
                            </div>
                            <div className="text-xs text-muted-foreground">via QR scans</div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="text-blue-600">
                              {user.total_collected_manual > 0 ? '+' : ''}{formatNumber(user.total_collected_manual)}
                            </div>
                            <div className="text-xs text-muted-foreground">by admin</div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="text-purple-600 font-medium">
                              {user.total_migration > 0 ? '+' : ''}{formatNumber(user.total_migration)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {user.last_migration_by_name ? `by ${user.last_migration_by_name}` : 'via migration'}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="text-orange-600">
                              -{formatNumber(user.total_redeemed)}
                            </div>
                          </td>
                          <td className="px-4 py-4">{user.transaction_count}</td>
                          <td className="px-4 py-4 text-muted-foreground">
                            {user.last_transaction_date ? formatDateLabel(user.last_transaction_date) : "Never"}
                          </td>
                          <td className="px-4 py-4 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              onClick={() => onAdjustPoints(user)}
                            >
                              <Edit className="h-4 w-4" /> Adjust Points
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {filteredUsers.length > 0 && (
                  <div className="mt-4 flex items-center justify-between border-t pt-4">
                    <div className="flex items-center gap-4">
                      <div className="text-sm text-muted-foreground">
                        Showing {startIndex + 1} to {Math.min(endIndex, filteredUsers.length)} of {filteredUsers.length} results
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Rows per page:</span>
                        <Select
                          value={itemsPerPage.toString()}
                          onValueChange={(value) => {
                            setItemsPerPage(Number(value))
                            setCurrentPage(1)
                          }}
                        >
                          <SelectTrigger className="h-8 w-[70px]">
                            <SelectValue placeholder={itemsPerPage} />
                          </SelectTrigger>
                          <SelectContent side="top">
                            {[10, 20, 30, 40, 50].map((pageSize) => (
                              <SelectItem key={pageSize} value={pageSize.toString()}>
                                {pageSize}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                          let pageNum: number
                          if (totalPages <= 5) {
                            pageNum = i + 1
                          } else if (currentPage <= 3) {
                            pageNum = i + 1
                          } else if (currentPage >= totalPages - 2) {
                            pageNum = totalPages - 4 + i
                          } else {
                            pageNum = currentPage - 2 + i
                          }
                          return (
                            <Button
                              key={pageNum}
                              variant={currentPage === pageNum ? "default" : "outline"}
                              size="sm"
                              onClick={() => setCurrentPage(pageNum)}
                              className="w-8"
                            >
                              {pageNum}
                            </Button>
                          )
                        })}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="migration">
        <PointMigration onMigrationComplete={onRefresh} />
      </TabsContent>

      <TabsContent value="history">
        <MigrationHistory onRefresh={onRefresh} />
      </TabsContent>
    </Tabs>
  )
}
