'use client'

import { useState } from 'react'
import { Check, Copy, MessageCircle } from 'lucide-react'

type CollectPointsGuideClientProps = {
  guideUrl: string
  demoProductUrl: string
  whatsappText: string
}

export function CollectPointsGuideClient({
  guideUrl,
  demoProductUrl,
  whatsappText,
}: CollectPointsGuideClientProps) {
  const [copiedKey, setCopiedKey] = useState<'guide' | 'whatsapp' | 'demo' | null>(null)

  const copy = async (key: 'guide' | 'whatsapp' | 'demo', value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey(null), 2000)
    } catch {
      const el = document.createElement('textarea')
      el.value = value
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey(null), 2000)
    }
  }

  const whatsappShareHref = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void copy('whatsapp', whatsappText)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1ebe57]"
      >
        {copiedKey === 'whatsapp' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copiedKey === 'whatsapp' ? 'Copied WhatsApp text' : 'Copy WhatsApp message'}
      </button>

      <a
        href={whatsappShareHref}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
      >
        <MessageCircle className="h-4 w-4" />
        Open WhatsApp share
      </a>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void copy('guide', guideUrl)}
          className="flex items-center justify-center gap-2 rounded-xl border border-[var(--sera-line,#e8eaed)] bg-white px-3 py-2.5 text-sm font-medium text-[var(--sera-ink,#141210)] hover:bg-[var(--sera-mist,#f2f3f5)]"
        >
          {copiedKey === 'guide' ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          {copiedKey === 'guide' ? 'Guide link copied' : 'Copy guide link'}
        </button>
        <button
          type="button"
          onClick={() => void copy('demo', demoProductUrl)}
          className="flex items-center justify-center gap-2 rounded-xl border border-[var(--sera-line,#e8eaed)] bg-white px-3 py-2.5 text-sm font-medium text-[var(--sera-ink,#141210)] hover:bg-[var(--sera-mist,#f2f3f5)]"
        >
          {copiedKey === 'demo' ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          {copiedKey === 'demo' ? 'Demo QR link copied' : 'Copy demo product link'}
        </button>
      </div>
    </div>
  )
}
