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

type ActivityRecord = {
  id: string
  createdAt: string
  recipientPhone: string
  eventType: string
  purpose: string
  status: string
  provider: string
  errorMessage: string
}

const PURPOSE_LABELS: Record<string, string> = {
  password_reset: "Password Reset",
  registration_verification: "Registration",
  phone_verification: "Phone Verification",
  order_notification: "Order Notification",
  document_workflow: "Document Workflow",
  inventory_stock: "Inventory & Stock",
  qr_consumer: "QR & Consumer",
  user_account: "User Account",
  system: "System",
}

const PURPOSE_BY_CATEGORY: Record<string, string> = {
  order: "order_notification",
  document: "document_workflow",
  inventory: "inventory_stock",
  qr: "qr_consumer",
  user: "user_account",
}

function normalizePhoneForSearch(value: string) {
  return String(value || "").replace(/\D/g, "")
}

function parseProviderResponse(value: unknown): Record<string, any> | null {
  if (!value) return null
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, any>
        : null
    } catch {
      return null
    }
  }
  return null
}

function resolveLogRecipientPhone(recipientValue: unknown, providerResponse: unknown) {
  const directValue = String(recipientValue || "").trim()
  if (directValue && directValue.toLowerCase() !== "unknown") {
    return directValue
  }

  const response = parseProviderResponse(providerResponse)
  const gatewayRecipient = String(response?.to || response?.jid || "").trim()
  if (!gatewayRecipient) return ""

  return gatewayRecipient
    .replace(/@s\.whatsapp\.net$/i, "")
    .replace(/^\+/, "")
}

function formatPurposeLabel(value: string) {
  return PURPOSE_LABELS[value] || value.replace(/_/g, " ")
}

export function WhatsAppActivityTab({ userProfile }: WhatsAppActivityTabProps) {
  const [events, setEvents] = useState<ActivityRecord[]>([])
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
      const orgId = (userProfile as any)?.organization_id || (userProfile as any)?.organizations?.id || null

      const [eventsResult, logsResult, typesResult] = await Promise.all([
        (supabase as any)
          .from("notification_events")
          .select("id, created_at, status, recipient_phone, event_type, purpose, provider, error_message")
          .eq("channel", "whatsapp")
          .order("created_at", { ascending: false })
          .limit(200),
        orgId
          ? (supabase as any)
            .from("notification_logs")
            .select("id, created_at, sent_at, delivered_at, failed_at, status, recipient_value, event_code, provider_name, error_message, provider_response")
            .eq("channel", "whatsapp")
            .eq("org_id", orgId)
            .order("created_at", { ascending: false })
            .limit(200)
          : Promise.resolve({ data: [], error: null }),
        (supabase as any)
          .from("notification_types")
          .select("event_code, category")
      ])

      if (eventsResult.error || logsResult.error || typesResult.error) {
        console.error("Error loading WhatsApp activity:", eventsResult.error || logsResult.error || typesResult.error)
        return
      }

      const categoryByEventCode = new Map<string, string>(
        (typesResult.data || []).map((type: any) => [type.event_code, type.category])
      )

      const notificationEvents: ActivityRecord[] = (eventsResult.data || []).map((event: any) => ({
        id: `event-${event.id}`,
        createdAt: event.created_at,
        recipientPhone: String(event.recipient_phone || "").trim(),
        eventType: String(event.event_type || ""),
        purpose: String(event.purpose || "system"),
        status: String(event.status || "unknown"),
        provider: String(event.provider || ""),
        errorMessage: String(event.error_message || ""),
      }))

      const notificationLogs: ActivityRecord[] = (logsResult.data || []).map((log: any) => ({
        id: `log-${log.id}`,
        createdAt: log.sent_at || log.delivered_at || log.failed_at || log.created_at,
        recipientPhone: resolveLogRecipientPhone(log.recipient_value, log.provider_response),
        eventType: String(log.event_code || ""),
        purpose: PURPOSE_BY_CATEGORY[categoryByEventCode.get(String(log.event_code || "")) || ""] || "system",
        status: String(log.status || "unknown"),
        provider: String(log.provider_name || ""),
        errorMessage: String(log.error_message || ""),
      }))

      const normalizedPhoneFilter = normalizePhoneForSearch(filterPhone)
      const merged = [...notificationLogs, ...notificationEvents]
        .filter((event) => {
          if (filterPurpose !== "all" && event.purpose !== filterPurpose) return false
          if (filterStatus !== "all" && event.status !== filterStatus) return false
          if (normalizedPhoneFilter && !normalizePhoneForSearch(event.recipientPhone).includes(normalizedPhoneFilter)) {
            return false
          }
          return true
        })
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())

      const paginated = merged.slice((page - 1) * pageSize, page * pageSize)
      setEvents(paginated)
      setTotal(merged.length)
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
                <SelectItem value="document_workflow">Document Workflow</SelectItem>
                <SelectItem value="inventory_stock">Inventory & Stock</SelectItem>
                <SelectItem value="qr_consumer">QR & Consumer</SelectItem>
                <SelectItem value="user_account">User Account</SelectItem>
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
                <SelectItem value="queued">Queued</SelectItem>
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
                          {new Date(evt.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-900 font-mono">
                          {evt.recipientPhone || "-"}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700">
                          {(evt.eventType || "").replace(/_/g, " ")}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {formatPurposeLabel(evt.purpose || "")}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${evt.status === "sent" ? "bg-green-100 text-green-800" :
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
                        <td className="px-3 py-2 text-xs text-red-600 max-w-[200px] truncate" title={evt.errorMessage || ""}>
                          {evt.errorMessage || "-"}
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
