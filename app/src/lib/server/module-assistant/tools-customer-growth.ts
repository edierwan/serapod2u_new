/**
 * Customer & Growth Module — Smart DB Tools
 *
 * Intent-based DB queries for CRM, consumer engagement, loyalty, marketing,
 * gamification, and support. Called by the module assistant to answer
 * user questions with real data.
 */
import 'server-only'
import { type SupabaseClient } from '@supabase/supabase-js'

// ─── Types ─────────────────────────────────────────────────────────

export type CGToolName =
  | 'totalConsumers'
  | 'topConsumersByPoints'
  | 'recentActivations'
  | 'activationStats'
  | 'consumerNeverScanned'
  | 'pointsSummary'
  | 'pointsLeaderboard'
  | 'activeCampaigns'
  | 'campaignStats'
  | 'luckyDrawSummary'
  | 'redeemSummary'
  | 'supportSummary'
  | 'feedbackSummary'
  | 'consumerSearch'
  | 'inactiveConsumers'
  | 'totalQrScans'
  | 'consumerActivity'

export interface CGToolResult {
  success: boolean
  tool: string
  summary: string
  rows?: Record<string, any>[]
  totalCount?: number
  truncated?: boolean
  error?: string
}

const MAX_ROWS = 25

// ─── Intent Detection ──────────────────────────────────────────────

interface IntentPattern {
  tool: CGToolName
  patterns: RegExp[]
  priority: number
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    tool: 'totalConsumers',
    patterns: [
      /\b(total|jumlah|berapa|how\s*many|show|list|senarai\w*|cek|check)\b.*\b(consumers?|pengguna|pelanggan|customers?|users?|end\s*users?)\b/i,
      /\b(consumers?|pengguna|pelanggan|customers?|end\s*users?)\b.*\b(total|jumlah|berapa|how\s*many|count)\b/i,
      /^total\s*(consumers?|pengguna|pelanggan|customers?|end\s*users?)\s*\??$/i,
    ],
    priority: 10,
  },
  {
    tool: 'topConsumersByPoints',
    patterns: [
      /\b(top|tertinggi|highest|paling\s*(tinggi|banyak)|most|terbanyak|leaderboard)\b.*\b(points?|mata|baki|balance)\b/i,
      /\b(points?|mata|baki|balance)\b.*\b(top|tertinggi|highest|paling|most|leaderboard|ranking)\b/i,
      /\b(siapa|sapa|who)\b.*\b(paling|most|highest|tertinggi|top)\b.*\b(points?|mata)\b/i,
      /\b(10|ten|lima|5|sepuluh)\b.*\b(user|consumer|pengguna|pelanggan)\b.*\b(point|mata|tertinggi|highest)\b/i,
    ],
    priority: 10,
  },
  {
    tool: 'recentActivations',
    patterns: [
      /\b(recent|terkini|latest|baru|terbaru)\b.*\b(activation|pengaktifan|scan)\b/i,
      /\b(activation|pengaktifan)\b.*\b(recent|terkini|latest|baru)\b/i,
    ],
    priority: 8,
  },
  {
    tool: 'activationStats',
    patterns: [
      /\b(activation|pengaktifan|scan)\b.*\b(stat|jumlah|total|berapa|how\s*many|summary|ringkasan)\b/i,
      /\b(stat|total|jumlah|berapa|summary|ringkasan)\b.*\b(activation|pengaktifan|scan)\b/i,
    ],
    priority: 9,
  },
  {
    tool: 'consumerNeverScanned',
    patterns: [
      /\b(tak\s*pernah|never|belum|tidak\s*pernah|tiada)\b.*\b(scan|login|logged\s*in|aktivasi|activation|active)\b/i,
      /\b(consumers?|pengguna|pelanggan|users?)\b.*\b(inactive|tak\s*aktif|tidak\s*aktif|dormant)\b/i,
      /\b(siapa|sapa|who)\b.*\b(tak|never|belum)\b.*\b(scan|login|logged\s*in|active)\b/i,
    ],
    priority: 9,
  },
  {
    tool: 'pointsSummary',
    patterns: [
      /\b(points?|mata)\b.*\b(summary|ringkasan|overview|total|keseluruhan)\b/i,
      /\b(summary|ringkasan|overview|total)\b.*\b(points?|mata)\b/i,
      /^points?\s*summary\s*\??$/i,
    ],
    priority: 8,
  },
  {
    tool: 'pointsLeaderboard',
    patterns: [
      /\b(points?|mata)\b.*\b(leaderboard|ranking|rank|kedudukan)\b/i,
      /\b(leaderboard|ranking|kedudukan)\b.*\b(points?|mata|consumers?|pengguna)\b/i,
    ],
    priority: 8,
  },
  {
    tool: 'activeCampaigns',
    patterns: [
      /\b(active|aktif)\b.*\b(campaign|kempen)\b/i,
      /\b(campaign|kempen)\b.*\b(active|aktif|running|berjalan|current)\b/i,
      /^active\s*campaigns?\s*\??$/i,
    ],
    priority: 8,
  },
  {
    tool: 'campaignStats',
    patterns: [
      /\b(campaign|kempen)\b.*\b(stat|result|keputusan|performance|prestasi|jumlah|total)\b/i,
      /\b(stat|result|performance|prestasi)\b.*\b(campaign|kempen)\b/i,
    ],
    priority: 7,
  },
  {
    tool: 'luckyDrawSummary',
    patterns: [
      /\b(lucky\s*draw|cabutan\s*bertuah|undian|scratch|spin|wheel|quiz|kuiz|gamifi\w*)\b/i,
    ],
    priority: 7,
  },
  {
    tool: 'redeemSummary',
    patterns: [
      /\b(redeem|tebus|redemption|penebusan|gift|hadiah|reward|ganjaran)\b/i,
    ],
    priority: 7,
  },
  {
    tool: 'supportSummary',
    patterns: [
      /\b(support|sokongan|ticket|tiket|conversation|perbualan|complaint|aduan)\b/i,
    ],
    priority: 6,
  },
  {
    tool: 'feedbackSummary',
    patterns: [
      /\b(feedback|maklum\s*balas|review|ulasan|rating|penilaian)\b/i,
    ],
    priority: 6,
  },
  {
    tool: 'consumerSearch',
    patterns: [
      /\b(cari|search|find|look\s*up|cek|check)\b.*\b(consumers?|pengguna|pelanggan|customers?)\b/i,
      /\b(consumers?|pengguna|pelanggan|customers?)\b.*\b(cari|search|find|look\s*up|cek|check)\b/i,
    ],
    priority: 5,
  },
  {
    tool: 'inactiveConsumers',
    patterns: [
      /\b(inactive|tak\s*aktif|tidak\s*aktif|dormant|lama\s*tak)\b.*\b(consumers?|pengguna|pelanggan|customers?|users?)\b/i,
      /\b(consumers?|pengguna|pelanggan|customers?|users?)\b.*\b(inactive|tak\s*aktif|dormant|lama\s*tak)\b/i,
    ],
    priority: 7,
  },
  {
    tool: 'totalQrScans',
    patterns: [
      /\b(total|jumlah|berapa|how\s*many)\b.*\b(qr|scan|imbas)\b/i,
      /\b(qr|scan|imbas)\b.*\b(total|jumlah|berapa|how\s*many)\b/i,
    ],
    priority: 8,
  },
  {
    tool: 'consumerActivity',
    patterns: [
      /\b(consumers?|pengguna|pelanggan)\b.*\b(activity|aktiviti|engagement)\b/i,
      /\b(activity|aktiviti|engagement)\b.*\b(consumers?|pengguna|pelanggan)\b/i,
    ],
    priority: 7,
  },
]

export function detectCGIntent(message: string): { tool: CGToolName | null; confidence: 'high' | 'medium' } {
  const lower = message.toLowerCase()
  let bestMatch: { tool: CGToolName; priority: number } | null = null

  for (const ip of INTENT_PATTERNS) {
    for (const p of ip.patterns) {
      if (p.test(lower)) {
        if (!bestMatch || ip.priority > bestMatch.priority) {
          bestMatch = { tool: ip.tool, priority: ip.priority }
        }
        break
      }
    }
  }

  return bestMatch
    ? { tool: bestMatch.tool, confidence: bestMatch.priority >= 8 ? 'high' : 'medium' }
    : { tool: null, confidence: 'medium' }
}

// ─── Tool Executor ─────────────────────────────────────────────────

export async function executeCGTool(
  toolName: CGToolName,
  supabase: SupabaseClient,
  orgId: string,
): Promise<CGToolResult> {
  try {
    switch (toolName) {
      case 'totalConsumers': return await totalConsumers(supabase, orgId)
      case 'topConsumersByPoints': return await topConsumersByPoints(supabase, orgId)
      case 'recentActivations': return await recentActivations(supabase, orgId)
      case 'activationStats': return await activationStats(supabase, orgId)
      case 'consumerNeverScanned': return await consumerNeverScanned(supabase, orgId)
      case 'pointsSummary': return await pointsSummary(supabase, orgId)
      case 'pointsLeaderboard': return await topConsumersByPoints(supabase, orgId)
      case 'activeCampaigns': return await activeCampaigns(supabase, orgId)
      case 'campaignStats': return await campaignStats(supabase, orgId)
      case 'luckyDrawSummary': return await luckyDrawSummary(supabase, orgId)
      case 'redeemSummary': return await redeemSummary(supabase, orgId)
      case 'supportSummary': return await supportSummary(supabase, orgId)
      case 'feedbackSummary': return await feedbackSummary(supabase, orgId)
      case 'consumerSearch': return await totalConsumers(supabase, orgId) // fallback
      case 'inactiveConsumers': return await consumerNeverScanned(supabase, orgId)
      case 'totalQrScans': return await totalQrScans(supabase, orgId)
      case 'consumerActivity': return await activationStats(supabase, orgId)
      default: return { success: false, tool: toolName, summary: 'Unknown tool' }
    }
  } catch (err: any) {
    console.error(`[CG Tool ${toolName}] Error:`, err.message)
    return { success: false, tool: toolName, summary: `Error: ${err.message}`, error: err.message }
  }
}

// ─── Tool Implementations ──────────────────────────────────────────

async function totalConsumers(supabase: SupabaseClient, orgId: string): Promise<CGToolResult> {
  // End users linked to this org via consumer activations, or global count via users table
  const { count: totalEndUsers } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)

  const { count: orgUsers } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('is_active', true)

  // Consumer point balances (from v_consumer_points_balance or points_transactions)
  const { count: consumersWithPoints } = await supabase
    .from('points_transactions')
    .select('consumer_phone', { count: 'exact', head: true })

  // Consumer activations count
  const { count: totalActivations } = await supabase
    .from('consumer_activations')
    .select('id', { count: 'exact', head: true })

  // Unique consumers from activations
  const { data: uniquePhones } = await supabase
    .from('consumer_activations')
    .select('consumer_phone')
    .limit(10000)

  const uniqueConsumers = new Set((uniquePhones ?? []).map((r: any) => r.consumer_phone)).size

  return {
    success: true,
    tool: 'totalConsumers',
    summary: `📊 **Consumer Overview:**\n- Total end users (system-wide): **${totalEndUsers ?? 0}**\n- Your org users: **${orgUsers ?? 0}**\n- Unique consumers (via activations): **${uniqueConsumers}**\n- Total activations: **${totalActivations ?? 0}**\n- Consumers with points transactions: **${consumersWithPoints ?? 0}**`,
    totalCount: totalEndUsers ?? 0,
  }
}

async function topConsumersByPoints(supabase: SupabaseClient, _orgId: string): Promise<CGToolResult> {
  // Get consumers with highest point balances
  const { data, error } = await supabase
    .from('points_transactions')
    .select('consumer_phone, points_amount, balance_after, transaction_type, created_at')
    .order('balance_after', { ascending: false })
    .limit(200)

  if (error) throw error

  // Aggregate by phone to get current balance
  const balanceMap = new Map<string, { phone: string; balance: number; totalEarned: number; txCount: number }>()
  for (const row of (data ?? [])) {
    const existing = balanceMap.get(row.consumer_phone)
    if (!existing) {
      balanceMap.set(row.consumer_phone, {
        phone: row.consumer_phone,
        balance: row.balance_after ?? 0,
        totalEarned: row.points_amount > 0 ? row.points_amount : 0,
        txCount: 1,
      })
    } else {
      // Update to highest balance seen
      if ((row.balance_after ?? 0) > existing.balance) existing.balance = row.balance_after ?? 0
      if (row.points_amount > 0) existing.totalEarned += row.points_amount
      existing.txCount++
    }
  }

  // Also try to get names from consumer_activations
  const phones = Array.from(balanceMap.keys()).slice(0, 20)
  const { data: nameData } = await supabase
    .from('consumer_activations')
    .select('consumer_phone, consumer_name')
    .in('consumer_phone', phones)

  const nameMap = new Map<string, string>()
  for (const n of (nameData ?? [])) {
    if (n.consumer_name && !nameMap.has(n.consumer_phone)) {
      nameMap.set(n.consumer_phone, n.consumer_name)
    }
  }

  const sorted = Array.from(balanceMap.values())
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 10)

  const rows = sorted.map((r, i) => ({
    rank: i + 1,
    name: nameMap.get(r.phone) ?? '—',
    phone: r.phone,
    current_balance: r.balance,
    total_earned: r.totalEarned,
    transactions: r.txCount,
  }))

  return {
    success: true,
    tool: 'topConsumersByPoints',
    summary: `🏆 **Top ${rows.length} Consumers by Points:**\n${rows.map(r => `${r.rank}. **${r.name || r.phone}** — ${r.current_balance} pts (${r.transactions} txns)`).join('\n')}`,
    rows,
    totalCount: balanceMap.size,
  }
}

async function recentActivations(supabase: SupabaseClient, _orgId: string): Promise<CGToolResult> {
  const { data, count } = await supabase
    .from('consumer_activations')
    .select('id, consumer_name, consumer_phone, product_name, points_awarded, activated_at', { count: 'exact' })
    .order('activated_at', { ascending: false })
    .limit(MAX_ROWS)

  const rows = (data ?? []).map((r: any) => ({
    name: r.consumer_name ?? '—',
    phone: r.consumer_phone,
    product: r.product_name ?? '—',
    points: r.points_awarded ?? 0,
    date: r.activated_at,
  }))

  return {
    success: true,
    tool: 'recentActivations',
    summary: `📋 **Recent Activations** (${count ?? rows.length} total):\n${rows.slice(0, 10).map(r => `- **${r.name}** (${r.phone}) scanned *${r.product}* — ${r.points} pts`).join('\n')}`,
    rows,
    totalCount: count ?? rows.length,
    truncated: (count ?? 0) > MAX_ROWS,
  }
}

async function activationStats(supabase: SupabaseClient, _orgId: string): Promise<CGToolResult> {
  const { count: totalActivations } = await supabase
    .from('consumer_activations')
    .select('id', { count: 'exact', head: true })

  const { count: totalScans } = await supabase
    .from('consumer_qr_scans')
    .select('id', { count: 'exact', head: true })

  // Today's scans
  const today = new Date().toISOString().split('T')[0]
  const { count: todayScans } = await supabase
    .from('consumer_qr_scans')
    .select('id', { count: 'exact', head: true })
    .gte('scanned_at', today)

  // Unique consumers from scans
  const { data: uniqueData } = await supabase
    .from('consumer_qr_scans')
    .select('consumer_id')
    .limit(10000)

  const uniqueConsumers = new Set((uniqueData ?? []).map((r: any) => r.consumer_id)).size

  // Total points distributed
  const { data: pointsData } = await supabase
    .from('points_transactions')
    .select('points_amount')
    .gt('points_amount', 0)
    .limit(10000)

  const totalPoints = (pointsData ?? []).reduce((sum: number, r: any) => sum + (r.points_amount || 0), 0)

  return {
    success: true,
    tool: 'activationStats',
    summary: `📊 **Consumer Activity Stats:**\n- Total QR Scans: **${totalScans ?? 0}**\n- Total Activations: **${totalActivations ?? 0}**\n- Today's Scans: **${todayScans ?? 0}**\n- Unique Consumers: **${uniqueConsumers}**\n- Total Points Distributed: **${totalPoints}**`,
  }
}

async function consumerNeverScanned(supabase: SupabaseClient, _orgId: string): Promise<CGToolResult> {
  // Users who have never made a QR scan — end users with no consumer_qr_scans record
  // This is complex with Supabase, so we get end users and check against scans
  const { data: endUsers } = await supabase
    .from('users')
    .select('id, full_name, phone, email, created_at')
    .order('created_at', { ascending: false })
    .limit(500)

  const { data: scannedUsers } = await supabase
    .from('consumer_qr_scans')
    .select('consumer_id')
    .limit(10000)

  const scannedSet = new Set((scannedUsers ?? []).map((r: any) => r.consumer_id))

  const neverScanned = (endUsers ?? [])
    .filter((u: any) => !scannedSet.has(u.id))
    .slice(0, MAX_ROWS)

  const rows = neverScanned.map((u: any) => ({
    name: u.full_name ?? '—',
    phone: u.phone ?? '—',
    email: u.email ?? '—',
    joined: u.created_at,
  }))

  return {
    success: true,
    tool: 'consumerNeverScanned',
    summary: `📋 **Consumers Who Never Scanned** (${rows.length} found):\n${rows.slice(0, 10).map(r => `- **${r.name}** (${r.phone}) — joined ${r.joined?.split('T')[0] ?? '?'}`).join('\n')}`,
    rows,
    totalCount: rows.length,
    truncated: (endUsers ?? []).length >= 500,
  }
}

async function pointsSummary(supabase: SupabaseClient, _orgId: string): Promise<CGToolResult> {
  const { data: pts } = await supabase
    .from('points_transactions')
    .select('points_amount, transaction_type, balance_after')
    .limit(10000)

  let totalEarned = 0, totalRedeemed = 0, txCount = 0
  for (const r of (pts ?? [])) {
    txCount++
    if (r.points_amount > 0) totalEarned += r.points_amount
    else totalRedeemed += Math.abs(r.points_amount)
  }

  // Unique consumers
  const { data: phones } = await supabase
    .from('points_transactions')
    .select('consumer_phone')
    .limit(10000)

  const uniqueConsumers = new Set((phones ?? []).map((r: any) => r.consumer_phone)).size

  // Points rules
  const { data: rules, count: rulesCount } = await supabase
    .from('points_rules')
    .select('id, name, points_per_scan, is_active', { count: 'exact' })
    .limit(10)

  return {
    success: true,
    tool: 'pointsSummary',
    summary: `💰 **Points Summary:**\n- Total Earned: **${totalEarned}** pts\n- Total Redeemed: **${totalRedeemed}** pts\n- Net in Circulation: **${totalEarned - totalRedeemed}** pts\n- Unique Holders: **${uniqueConsumers}**\n- Total Transactions: **${txCount}**\n- Active Rules: **${rulesCount ?? 0}**`,
    rows: (rules ?? []).map((r: any) => ({ name: r.name, points_per_scan: r.points_per_scan, active: r.is_active })),
  }
}

async function activeCampaigns(supabase: SupabaseClient, _orgId: string): Promise<CGToolResult> {
  const { data: mktg, count: mktgCount } = await supabase
    .from('marketing_campaigns')
    .select('id, name, status, created_at', { count: 'exact' })
    .eq('status', 'active')
    .limit(MAX_ROWS)

  const { data: lucky, count: luckyCount } = await supabase
    .from('lucky_draw_campaigns')
    .select('id, campaign_name, status, start_date, end_date', { count: 'exact' })
    .in('status', ['active', 'running'])
    .limit(10)

  const rows = [
    ...(mktg ?? []).map((r: any) => ({ type: 'Marketing', name: r.name, status: r.status, date: r.created_at })),
    ...(lucky ?? []).map((r: any) => ({ type: 'Lucky Draw', name: r.campaign_name, status: r.status, date: r.start_date })),
  ]

  return {
    success: true,
    tool: 'activeCampaigns',
    summary: `📢 **Active Campaigns:**\n- Marketing: **${mktgCount ?? 0}** active\n- Lucky Draw: **${luckyCount ?? 0}** active\n${rows.slice(0, 10).map(r => `- [${r.type}] **${r.name}** — ${r.status}`).join('\n')}`,
    rows,
    totalCount: (mktgCount ?? 0) + (luckyCount ?? 0),
  }
}

async function campaignStats(supabase: SupabaseClient, _orgId: string): Promise<CGToolResult> {
  const { count: totalMktg } = await supabase.from('marketing_campaigns').select('id', { count: 'exact', head: true })
  const { count: activeMktg } = await supabase.from('marketing_campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active')
  const { count: totalLucky } = await supabase.from('lucky_draw_campaigns').select('id', { count: 'exact', head: true })
  const { count: totalEntries } = await supabase.from('lucky_draw_entries').select('id', { count: 'exact', head: true })
  const { count: totalSends } = await supabase.from('marketing_send_logs').select('id', { count: 'exact', head: true })

  return {
    success: true,
    tool: 'campaignStats',
    summary: `📊 **Campaign Stats:**\n- Marketing Campaigns: **${totalMktg ?? 0}** total, **${activeMktg ?? 0}** active\n- Lucky Draw Campaigns: **${totalLucky ?? 0}**\n- Lucky Draw Entries: **${totalEntries ?? 0}**\n- Marketing Messages Sent: **${totalSends ?? 0}**`,
  }
}

async function luckyDrawSummary(supabase: SupabaseClient, _orgId: string): Promise<CGToolResult> {
  const { data: campaigns } = await supabase
    .from('lucky_draw_campaigns')
    .select('id, campaign_name, campaign_code, status, start_date, end_date')
    .order('created_at', { ascending: false })
    .limit(10)

  const { count: totalEntries } = await supabase.from('lucky_draw_entries').select('id', { count: 'exact', head: true })
  const { count: winners } = await supabase.from('lucky_draw_entries').select('id', { count: 'exact', head: true }).eq('is_winner', true)
  const { count: scratchPlays } = await supabase.from('scratch_card_plays').select('id', { count: 'exact', head: true })
  const { count: spinPlays } = await supabase.from('spin_wheel_plays').select('id', { count: 'exact', head: true })
  const { count: quizPlays } = await supabase.from('daily_quiz_plays').select('id', { count: 'exact', head: true })

  return {
    success: true,
    tool: 'luckyDrawSummary',
    summary: `🎰 **Gamification Summary:**\n- Lucky Draw Entries: **${totalEntries ?? 0}** (${winners ?? 0} winners)\n- Scratch Card Plays: **${scratchPlays ?? 0}**\n- Spin Wheel Plays: **${spinPlays ?? 0}**\n- Daily Quiz Plays: **${quizPlays ?? 0}**\n\n**Campaigns:**\n${(campaigns ?? []).map((c: any) => `- **${c.campaign_name}** [${c.status}] ${c.start_date ?? ''}`).join('\n') || 'No campaigns found'}`,
    rows: campaigns ?? [],
  }
}

async function redeemSummary(supabase: SupabaseClient, _orgId: string): Promise<CGToolResult> {
  const { data: items, count: itemCount } = await supabase
    .from('redeem_items')
    .select('id, item_name, points_required, stock_quantity, is_active', { count: 'exact' })
    .limit(MAX_ROWS)

  const { count: totalRedemptions } = await supabase.from('redeem_transactions').select('id', { count: 'exact', head: true })
  const { count: giftsClaimed } = await supabase.from('redeem_gift_transactions').select('id', { count: 'exact', head: true })

  const activeItems = (items ?? []).filter((i: any) => i.is_active)

  return {
    success: true,
    tool: 'redeemSummary',
    summary: `🎁 **Redemption Summary:**\n- Redeem Items: **${itemCount ?? 0}** total, **${activeItems.length}** active\n- Total Redemptions: **${totalRedemptions ?? 0}**\n- Gifts Claimed: **${giftsClaimed ?? 0}**\n\n**Available Items:**\n${activeItems.slice(0, 5).map((i: any) => `- **${i.item_name}** — ${i.points_required} pts (stock: ${i.stock_quantity})`).join('\n') || 'No active items'}`,
    rows: items ?? [],
    totalCount: itemCount ?? 0,
  }
}

async function supportSummary(supabase: SupabaseClient, _orgId: string): Promise<CGToolResult> {
  const { count: totalConvos } = await supabase.from('support_conversations').select('id', { count: 'exact', head: true })
  const { count: openConvos } = await supabase.from('support_conversations').select('id', { count: 'exact', head: true }).eq('status', 'open')
  const { count: totalMessages } = await supabase.from('support_conversation_messages').select('id', { count: 'exact', head: true })
  const { count: totalAnnouncements } = await supabase.from('support_announcements').select('id', { count: 'exact', head: true })

  return {
    success: true,
    tool: 'supportSummary',
    summary: `💬 **Support Summary:**\n- Total Conversations: **${totalConvos ?? 0}**\n- Open Tickets: **${openConvos ?? 0}**\n- Total Messages: **${totalMessages ?? 0}**\n- Announcements: **${totalAnnouncements ?? 0}**`,
  }
}

async function feedbackSummary(supabase: SupabaseClient, _orgId: string): Promise<CGToolResult> {
  const { data: feedback, count } = await supabase
    .from('consumer_feedback')
    .select('id, rating, comment, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)

  const ratings = (feedback ?? [])
  const avgRating = ratings.length > 0
    ? (ratings.reduce((s: number, r: any) => s + (r.rating || 0), 0) / ratings.length).toFixed(1)
    : 'N/A'

  return {
    success: true,
    tool: 'feedbackSummary',
    summary: `📝 **Feedback Summary:**\n- Total Feedback: **${count ?? 0}**\n- Average Rating: **${avgRating}**/5\n\n**Recent:**\n${ratings.slice(0, 5).map((r: any) => `- ⭐${r.rating ?? '?'} — "${(r.comment ?? '').slice(0, 80)}"`).join('\n') || 'No feedback yet'}`,
    rows: feedback ?? [],
    totalCount: count ?? 0,
  }
}

async function totalQrScans(supabase: SupabaseClient, _orgId: string): Promise<CGToolResult> {
  const { count: total } = await supabase.from('consumer_qr_scans').select('id', { count: 'exact', head: true })

  const today = new Date().toISOString().split('T')[0]
  const { count: todayCount } = await supabase.from('consumer_qr_scans').select('id', { count: 'exact', head: true }).gte('scanned_at', today)

  return {
    success: true,
    tool: 'totalQrScans',
    summary: `📱 **QR Scan Stats:**\n- Total QR Scans: **${total ?? 0}**\n- Today's Scans: **${todayCount ?? 0}**`,
  }
}

// ─── Suggestions Builder ───────────────────────────────────────────

export const CG_SUGGESTIONS = [
  { label: 'Total consumers?', intent: 'totalConsumers' },
  { label: 'Top 10 by points?', intent: 'topConsumersByPoints' },
  { label: 'Recent activations?', intent: 'recentActivations' },
  { label: 'Points summary?', intent: 'pointsSummary' },
  { label: 'Active campaigns?', intent: 'activeCampaigns' },
  { label: 'Redemption stats?', intent: 'redeemSummary' },
]
