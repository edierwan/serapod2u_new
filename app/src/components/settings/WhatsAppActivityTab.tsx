"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ChevronLeft, ChevronRight, MessageCircle } from "lucide-react"
import type { UserProfileWithRelations } from "@/lib/server/get-user-profile"

interface WhatsAppActivityTabProps {
  userProfile: UserProfileWithRelations
}

export function WhatsAppActivityTab({ userProfile }: WhatsAppActivityTabProps) {
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [filterPurpose, setFilterPurpose] = useState("all")
  const [filterStatus, setFilterStatus] = useState("all")
  const [filterPhone, setFilterPhone] = useState("")
  const pageSize = 20

  const supabase = createClient()

  async function loadActivity() {
    setLoading(true)
    try {
      let query = (supabase as any)
        .from("notification_events")
        .select("*", { count: "exact" })
        .eq("channel", "whatsapp")
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1)

      if (filterPurpose !== "all") query = query.eq("purpose", filterPurpose)
      if (filterStatus !== "all") query = query.eq("status", filterStatus)
      if (filterPhone.trim()) query = query.ilike("recipient_phone", `%${filterPhone.trim()}%`)

      const { data, count, error } = await query
      if (error) {
        console.error("Error loading WhatsApp activity:", error)
        return
      }
      setEvents(data || [])
      setTotal(count || 0)
    } catch (err) {
      console.error("Error loading WhatsApp activity:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadActivity()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterPurpose, filterStatus, filterPhone])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-green-600" />
            WhatsApp Activity
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor all WhatsApp notification events including OTP delivery, password resets, and system notifications.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <Select value={filterPurpose} onValueChange={(v) => { setFilterPurpose(v); setPage(1) }}>
              <SelectTrigger>
                <SelectValue placeholder="All Purposes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Purposes</SelectItem>
                <SelectItem value="password_reset">Password Reset</SelectItem>
                <SelectItem value="registration_verification">Registration</SelectItem>
                <SelectItem value="phone_verification">Phone Verification</SelectItem>
                <SelectItem value="order_notification">Order Notification</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(1) }}>
              <SelectTrigger>
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="verified">Verified</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="rate_limited">Rate Limited</SelectItem>
                <SelectItem value="no_account">No Account</SelectItem>
                <SelectItem value="send_failed">Send Failed</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Filter by phone..."
              value={filterPhone}
              onChange={(e) => { setFilterPhone(e.target.value); setPage(1) }}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading WhatsApp activity...</div>
          ) : events.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No WhatsApp activity found</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Date & Time</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Phone</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Event</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Purpose</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Status</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Provider</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {events.map((evt: any) => (
                      <tr key={evt.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                          {new Date(evt.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-900 font-mono">
                          {evt.recipient_phone || "-"}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700">
                          {(evt.event_type || "").replace(/_/g, " ")}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {(evt.purpose || "").replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            evt.status === "sent" ? "bg-green-100 text-green-800" :
                            evt.status === "failed" || evt.status === "send_failed" ? "bg-red-100 text-red-800" :
                            evt.status === "verified" ? "bg-blue-100 text-blue-800" :
                            evt.status === "completed" ? "bg-emerald-100 text-emerald-800" :
                            evt.status === "rate_limited" ? "bg-orange-100 text-orange-800" :
                            evt.status === "no_account" ? "bg-gray-100 text-gray-600" :
                            "bg-gray-100 text-gray-800"
                          }`}>
                            {evt.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">{evt.provider || "-"}</td>
                        <td className="px-3 py-2 text-xs text-red-600 max-w-[200px] truncate" title={evt.error_message || ""}>
                          {evt.error_message || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <p className="text-sm text-gray-500">
                  Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} results
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-gray-700">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page * pageSize >= total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
