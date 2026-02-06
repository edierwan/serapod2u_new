'use client'

import { useState } from 'react'
import {
  HelpCircle,
  X,
  Clock,
  CalendarDays,
  CheckCircle2,
  FileText,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useHrMobile } from './HrMobileContext'

/* ─── Help content ────────────────────────────────────────────────── */

const baseTopics = [
  {
    icon: Clock,
    title: 'What is Grace Period?',
    content:
      'You have a grace period (usually 10–15 minutes) after your shift starts. Clocking in within this window is still marked "On Time". After the grace period your attendance is flagged as "Late".',
  },
  {
    icon: CalendarDays,
    title: 'How Leave Days Are Calculated',
    content:
      'Leave days are counted as business days — weekends and public holidays are excluded automatically. Half-day leave counts as 0.5 days. Your available balance = entitled − taken − pending.',
  },
  {
    icon: CheckCircle2,
    title: 'How Approvals Work',
    content:
      "When you submit a leave request it is sent to your direct manager. Some organizations use multi-step approval chains. You'll receive a notification when your request is approved or rejected.",
  },
  {
    icon: FileText,
    title: 'How to Download Payslip',
    content:
      'Go to the Payslip tab, select the month, and tap "Download PDF". If PDF download is not yet available for your organization, please contact your HR department.',
  },
]

const managerTopics = [
  {
    icon: CheckCircle2,
    title: 'Approving Leave Requests',
    content:
      'As a manager, pending requests from your team appear in the Leave → Approvals tab. Tap a request to Approve or Reject it with an optional comment.',
  },
]

/* ─── Component ───────────────────────────────────────────────────── */

export default function HrHelpDrawer() {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const { isManager } = useHrMobile()

  const topics = isManager ? [...baseTopics, ...managerTopics] : baseTopics

  return (
    <>
      {/* ── Floating button ───────────────────────────────────────── */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'fixed right-4 bottom-[84px] z-40 flex items-center gap-1.5 px-3 py-2 rounded-full',
          'bg-blue-600 text-white shadow-lg hover:bg-blue-700 active:scale-95 transition-all',
          'text-xs font-semibold',
        )}
        style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <HelpCircle className="h-4 w-4" />
        Help
      </button>

      {/* ── Drawer overlay ────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />

          {/* sheet */}
          <div className="relative bg-card rounded-t-2xl max-h-[80vh] overflow-y-auto animate-in slide-in-from-bottom duration-300">
            {/* drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>

            {/* header */}
            <div className="flex items-center justify-between px-5 pb-3">
              <h2 className="text-lg font-bold text-foreground">
                Need Help?
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-full hover:bg-accent"
              >
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>

            {/* topics */}
            <div className="px-5 pb-8 space-y-2">
              {topics.map((topic, i) => {
                const Icon = topic.icon
                const isExpanded = expanded === i
                return (
                  <div
                    key={i}
                    className="rounded-xl border border-border overflow-hidden"
                  >
                    <button
                      onClick={() => setExpanded(isExpanded ? null : i)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
                    >
                      <Icon className="h-5 w-5 text-blue-600 shrink-0" />
                      <span className="flex-1 text-sm font-medium text-foreground">
                        {topic.title}
                      </span>
                      <ChevronRight
                        className={cn(
                          'h-4 w-4 text-muted-foreground transition-transform',
                          isExpanded && 'rotate-90',
                        )}
                      />
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-3 pt-0">
                        <p className="text-sm text-muted-foreground leading-relaxed pl-8">
                          {topic.content}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
