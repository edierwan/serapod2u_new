import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, Users, Trophy, Edit, History } from "lucide-react"
import { formatNumber, formatDateLabel } from "./catalog-utils"

interface ConsumerUser {
  user_id: string
  consumer_name: string
  consumer_phone: string | null
  consumer_email: string | null
  current_balance: number
  total_collected_system: number
  total_collected_manual: number
  total_redeemed: number
  transaction_count: number
  last_transaction_date: string | null
}

interface UserPointsMonitorProps {
  users: ConsumerUser[]
  loading: boolean
  onAdjustPoints: (user: ConsumerUser) => void
}

export function UserPointsMonitor({ users, loading, onAdjustPoints }: UserPointsMonitorProps) {
  const [searchTerm, setSearchTerm] = useState("")

  const filteredUsers = users.filter(user => {
    const term = searchTerm.toLowerCase()
    return (
      user.consumer_name.toLowerCase().includes(term) ||
      (user.consumer_phone || "").toLowerCase().includes(term) ||
      (user.consumer_email || "").toLowerCase().includes(term)
    )
  })

  return (
    <div className="space-y-4">
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
                onChange={(e) => setSearchTerm(e.target.value)}
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
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Consumer</th>
                    <th className="px-4 py-3 font-medium">Current Balance</th>
                    <th className="px-4 py-3 font-medium">Collected (System)</th>
                    <th className="px-4 py-3 font-medium">Collected (Manual)</th>
                    <th className="px-4 py-3 font-medium">Total Redeemed</th>
                    <th className="px-4 py-3 font-medium">Transactions</th>
                    <th className="px-4 py-3 font-medium">Last Activity</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredUsers.map((user) => (
                    <tr key={user.user_id} className="hover:bg-muted/50">
                      <td className="px-4 py-4">
                        <div className="font-medium">{user.consumer_name}</div>
                        <div className="text-xs text-muted-foreground">{user.consumer_phone}</div>
                        <div className="text-xs text-muted-foreground">{user.consumer_email}</div>
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
          )}
        </CardContent>
      </Card>
    </div>
  )
}
