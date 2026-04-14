import type { SupabaseClient } from '@supabase/supabase-js'
import { endOfDay, endOfWeek, format, startOfDay, startOfWeek, subDays } from 'date-fns'

import { normalizePhoneE164 } from '@/utils/phone'

export type DailyReportingMode = 'daily' | 'weekly'

type ReportingScanRow = {
  id: string
  consumer_id: string | null
  scanned_at: string | null
  consumer_user?: {
    id: string
    full_name: string | null
    phone: string | null
    email: string | null
  } | null
}

export type DailyReportingCustomerDetail = {
  key: string
  name: string
  phone: string
  scans: number
  lastScan: string | null
}

export type DailyReportingData = {
  reportDateIso: string
  reportDateLabel: string
  reportType: DailyReportingMode
  periodStartIso: string
  periodEndIso: string
  todayScans: number
  yesterdayScans: number
  thisWeekScans: number
  uniqueCustomers: number
  uniqueCustomerDetails: DailyReportingCustomerDetail[]
}

export type DailyReportingConfig = {
  reportType: DailyReportingMode
  enableReplyAction: boolean
}

const DEFAULT_PAGE_SIZE = 10

function normalizeText(value: string | null | undefined) {
  const text = value?.trim()
  return text ? text : null
}

function normalizePhoneValue(phone: string | null | undefined) {
  const value = normalizeText(phone)
  if (!value || value === '-') return null

  try {
    return normalizePhoneE164(value)
  } catch {
    return value
  }
}

function resolveConsumerIdentity(scan: ReportingScanRow) {
  const phone = normalizePhoneValue(scan.consumer_user?.phone)
  const email = normalizeText(scan.consumer_user?.email)
  const name = normalizeText(scan.consumer_user?.full_name)
  const key = scan.consumer_id || phone || email

  return {
    key,
    name: name || phone || email || 'Unknown Customer',
    phone: phone || '',
  }
}

export function normalizeDailyReportingConfig(value: any): DailyReportingConfig {
  const reportType = value?.report_type === 'weekly' ? 'weekly' : 'daily'
  const enableReplyAction = value?.enable_reply_action !== false

  return { reportType, enableReplyAction }
}

export function getDailyReportingTemplate(enableReplyAction: boolean) {
  const baseMessage = [
    '📊 Daily Reporting',
    'Date: {report_date}',
    '',
    'Today Scan: {today_scans}',
    'Yesterday Scan: {yesterday_scans}',
    'This Week Scan: {this_week_scans}',
    'Unique Customer: {unique_customers}',
  ]

  if (enableReplyAction) {
    baseMessage.push('', 'Reply 1 to view unique customer details.')
  }

  return baseMessage.join('\n')
}

export function renderDailyReportingMessage(data: DailyReportingData, enableReplyAction: boolean) {
  return getDailyReportingTemplate(enableReplyAction)
    .replace('{report_date}', data.reportDateLabel)
    .replace('{today_scans}', data.todayScans.toLocaleString('en-MY'))
    .replace('{yesterday_scans}', data.yesterdayScans.toLocaleString('en-MY'))
    .replace('{this_week_scans}', data.thisWeekScans.toLocaleString('en-MY'))
    .replace('{unique_customers}', data.uniqueCustomers.toLocaleString('en-MY'))
}

export function buildDailyReportingDetailMessage(
  data: DailyReportingData,
  pageNumber: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
) {
  if (data.uniqueCustomerDetails.length === 0) {
    return {
      text: 'No unique customer detail found for this report.',
      pageNumber: 0,
      hasMore: false,
    }
  }

  const startIndex = Math.max(0, (pageNumber - 1) * pageSize)
  const pageItems = data.uniqueCustomerDetails.slice(startIndex, startIndex + pageSize)

  if (pageItems.length === 0) {
    return {
      text: 'No unique customer detail found for this report.',
      pageNumber: Math.max(pageNumber, 1),
      hasMore: false,
    }
  }

  const lines = [
    '👥 Unique Customer Details',
    `Total: ${data.uniqueCustomers.toLocaleString('en-MY')}`,
    '',
    ...pageItems.map((customer, index) => {
      const ordinal = startIndex + index + 1
      const label = customer.phone && customer.name !== customer.phone
        ? `${customer.name} - ${customer.phone}`
        : customer.phone || customer.name || 'Unknown Customer'

      return `${ordinal}. ${label}`
    }),
  ]

  const hasMore = startIndex + pageItems.length < data.uniqueCustomerDetails.length
  if (hasMore) {
    lines.push('', 'Reply 2 for more.')
  }

  return {
    text: lines.join('\n'),
    pageNumber,
    hasMore,
  }
}

export function getRequestedDetailPage(replyText: string, lastPageSent: number | null | undefined) {
  const normalizedReply = replyText.trim()

  if (normalizedReply === '1') return 1
  if (normalizedReply === '2') return Math.max((lastPageSent || 1) + 1, 2)
  return null
}

export async function buildDailyReportingData(
  supabase: SupabaseClient<any, any, any>,
  params: {
    reportType: DailyReportingMode
    referenceDate?: Date
  },
): Promise<DailyReportingData> {
  const referenceDate = params.referenceDate || new Date()
  const reportDate = startOfDay(referenceDate)
  const todayStart = startOfDay(referenceDate)
  const todayEnd = endOfDay(referenceDate)
  const yesterdayStart = startOfDay(subDays(referenceDate, 1))
  const yesterdayEnd = endOfDay(subDays(referenceDate, 1))
  const weekStart = startOfWeek(referenceDate, { weekStartsOn: 1 })
  const fullWeekEnd = endOfWeek(referenceDate, { weekStartsOn: 1 })
  const reportingWeekEnd = params.reportType === 'weekly' ? endOfDay(fullWeekEnd) : todayEnd
  const queryStart = new Date(Math.min(yesterdayStart.getTime(), weekStart.getTime()))
  const queryEnd = params.reportType === 'weekly' ? endOfDay(fullWeekEnd) : todayEnd

  const { data, error } = await (supabase as any)
    .from('consumer_qr_scans')
    .select(`
      id,
      consumer_id,
      scanned_at,
      consumer_user:users!consumer_qr_scans_consumer_id_fkey (
        id,
        full_name,
        phone,
        email
      )
    `)
    .eq('is_manual_adjustment', false)
    .gte('scanned_at', queryStart.toISOString())
    .lte('scanned_at', queryEnd.toISOString())
    .order('scanned_at', { ascending: false })

  if (error) {
    throw error
  }

  const scans = ((data || []) as ReportingScanRow[]).filter((scan) => scan.scanned_at)
  const isBetween = (value: string | null, start: Date, end: Date) => {
    if (!value) return false
    const time = new Date(value).getTime()
    return time >= start.getTime() && time <= end.getTime()
  }

  const todayScans = scans.filter((scan) => isBetween(scan.scanned_at, todayStart, todayEnd)).length
  const yesterdayScans = scans.filter((scan) => isBetween(scan.scanned_at, yesterdayStart, yesterdayEnd)).length

  const weekScans = scans.filter((scan) => isBetween(scan.scanned_at, weekStart, reportingWeekEnd))
  const customerMap = new Map<string, DailyReportingCustomerDetail>()

  weekScans.forEach((scan) => {
    const identity = resolveConsumerIdentity(scan)
    if (!identity.key) return

    const existing = customerMap.get(identity.key) || {
      key: identity.key,
      name: identity.name,
      phone: identity.phone,
      scans: 0,
      lastScan: null,
    }

    existing.scans += 1
    if (scan.scanned_at && (!existing.lastScan || scan.scanned_at > existing.lastScan)) {
      existing.lastScan = scan.scanned_at
      existing.name = identity.name || existing.name
      existing.phone = identity.phone || existing.phone
    }

    customerMap.set(identity.key, existing)
  })

  const uniqueCustomerDetails = [...customerMap.values()].sort((left, right) => {
    if (right.scans !== left.scans) return right.scans - left.scans
    return (right.lastScan || '').localeCompare(left.lastScan || '')
  })

  return {
    reportDateIso: format(reportDate, 'yyyy-MM-dd'),
    reportDateLabel: format(referenceDate, 'dd MMM yyyy'),
    reportType: params.reportType,
    periodStartIso: weekStart.toISOString(),
    periodEndIso: reportingWeekEnd.toISOString(),
    todayScans,
    yesterdayScans,
    thisWeekScans: weekScans.length,
    uniqueCustomers: uniqueCustomerDetails.length,
    uniqueCustomerDetails,
  }
}