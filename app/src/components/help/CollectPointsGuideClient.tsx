'use client'

import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Coins,
  Copy,
  ExternalLink,
  KeyRound,
  MessageCircle,
  Play,
  Share2,
  UserPlus,
  Volume2,
  type LucideIcon,
} from 'lucide-react'

export type HelpVideoSource =
  | { kind: 'embed'; src: string }
  | { kind: 'video'; src: string }
  | { kind: 'link'; src: string }
  | null

export type HelpGuide = {
  id: string
  number: string
  label: string
  title: string
  description: string
  duration: string
  icon: 'register' | 'collect' | 'password'
  source: HelpVideoSource
  steps: string[]
  voiceOver: string
}

type Props = {
  guides: HelpGuide[]
  guideUrl: string
  whatsappText: string
  demoProductUrl: string
}

const guideIcons: Record<HelpGuide['icon'], LucideIcon> = {
  register: UserPlus,
  collect: Coins,
  password: KeyRound,
}

export function CollectPointsGuideClient({
  guides,
  guideUrl,
  whatsappText,
  demoProductUrl,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [copiedKey, setCopiedKey] = useState<'guide' | 'whatsapp' | 'share' | null>(null)
  const activeGuide = guides[activeIndex]
  const ActiveIcon = guideIcons[activeGuide.icon]

  const moveGuide = (direction: -1 | 1) => {
    setActiveIndex((current) => (current + direction + guides.length) % guides.length)
  }

  const copy = async (key: 'guide' | 'whatsapp' | 'share', value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const element = document.createElement('textarea')
      element.value = value
      document.body.appendChild(element)
      element.select()
      document.execCommand('copy')
      document.body.removeChild(element)
    }
    setCopiedKey(key)
    window.setTimeout(() => setCopiedKey(null), 2000)
  }

  const shareGuide = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Serapod2U Rewards Help',
          text: 'Learn how to register, collect points, and reset your password.',
          url: guideUrl,
        })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    await copy('share', guideUrl)
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        {guides.map((guide, index) => {
          const Icon = guideIcons[guide.icon]
          const isActive = index === activeIndex
          return (
            <button
              key={guide.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-pressed={isActive}
              className={`group relative flex items-center gap-3 overflow-hidden rounded-2xl border px-4 py-4 text-left shadow-[0_12px_32px_-24px_rgba(20,18,16,0.35)] transition ${
                isActive
                  ? 'border-[#e85d04]/40 bg-[#f3f3f4]'
                  : 'border-[#d8dade] bg-[#f3f3f4] hover:-translate-y-0.5 hover:border-[#e85d04]/25'
              }`}
            >
              {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-[#e85d04]" />}
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
                  isActive ? 'bg-[#e85d04] text-white' : 'bg-[#e4e5e8] text-[#5f6570]'
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-[#878b91]">
                  {guide.number} / {guide.label}
                </span>
                <span className={`mt-1 block text-sm font-semibold ${isActive ? 'text-[#141210]' : 'text-[#4d4a46]'}`}>
                  {guide.title}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-5 grid overflow-hidden rounded-2xl border border-[#d8dade] bg-[#f3f3f4] shadow-[0_22px_55px_-28px_rgba(20,18,16,0.35)] lg:min-h-[520px] lg:grid-cols-[minmax(0,1.25fr)_minmax(330px,0.75fr)]">
        <div className="relative aspect-video min-h-[250px] overflow-hidden bg-[#141210] sm:min-h-[380px] lg:aspect-auto lg:min-h-[520px]">
          {activeGuide.source?.kind === 'embed' ? (
            <iframe
              key={activeGuide.id}
              src={activeGuide.source.src}
              title={activeGuide.title}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : activeGuide.source?.kind === 'video' ? (
            <video key={activeGuide.id} className="h-full w-full object-contain" controls preload="metadata" playsInline>
              <source src={activeGuide.source.src} />
              Your browser does not support this video.
            </video>
          ) : activeGuide.source?.kind === 'link' ? (
            <a
              href={activeGuide.source.src}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-full flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_50%_42%,#3a312b_0%,#141210_64%)] text-white"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#e85d04] shadow-[0_16px_42px_rgba(232,93,4,0.35)]">
                <Play className="ml-1 h-6 w-6 fill-current" />
              </span>
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                Open video
                <ExternalLink className="h-4 w-4" />
              </span>
            </a>
          ) : (
            <div className="flex h-full flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_42%,#3a312b_0%,#141210_64%)] px-8 text-center text-white">
              <span className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-[#f17a2e]">
                <ActiveIcon className="h-7 w-7" />
              </span>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-white/42">Video ready to connect</p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-white/62">
                Add the final recording URL and it will play here automatically.
              </p>
            </div>
          )}

          <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2">
            <span className="rounded-lg bg-black/45 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-white backdrop-blur-md">
              Guide {activeGuide.number}
            </span>
            <span className="flex items-center gap-1.5 rounded-lg bg-black/45 px-2.5 py-1.5 text-[10px] font-medium text-white/80 backdrop-blur-md">
              <Clock3 className="h-3 w-3" />
              {activeGuide.duration}
            </span>
          </div>

          <div className="absolute bottom-4 right-4 flex gap-2">
            <button
              type="button"
              onClick={() => moveGuide(-1)}
              aria-label="Previous guide"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => moveGuide(1)}
              aria-label="Next guide"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e85d04] text-white shadow-lg transition hover:bg-[#c44a00]"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-col p-6 sm:p-8">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#e85d04]">
              {activeGuide.label}
            </p>
            <h3 className="mt-2 font-[family-name:var(--font-sera-display),Syne,sans-serif] text-2xl font-semibold leading-tight tracking-tight">
              {activeGuide.title}
            </h3>
            <p className="mt-3 text-sm leading-6 text-[#5f6570]">{activeGuide.description}</p>
          </div>

          <ol className="mt-7 space-y-3">
            {activeGuide.steps.map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#e85d04]/10 text-[10px] font-bold text-[#e85d04]">
                  {index + 1}
                </span>
                <span className="pt-0.5 text-sm leading-5 text-[#35312d]">{step}</span>
              </li>
            ))}
          </ol>

          <details className="group mt-7 border-t border-[#d8dade] pt-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[#2a2622]">
              <span className="flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-[#e85d04]" />
                English voice-over script
              </span>
              <ChevronDown className="h-4 w-4 text-[#85898f] transition group-open:rotate-180" />
            </summary>
            <p className="mt-4 border-l-2 border-[#e85d04] pl-4 text-sm leading-7 text-[#5f6570]">
              {activeGuide.voiceOver}
            </p>
          </details>
        </div>
      </div>

      <div className="mt-5 grid overflow-hidden rounded-2xl border border-[#d8dade] bg-[#f3f3f4] shadow-[0_12px_32px_-24px_rgba(20,18,16,0.35)] lg:grid-cols-[1fr_auto]">
        <div className="p-6 sm:p-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#e85d04]">Share with customers</p>
          <h3 className="mt-2 font-[family-name:var(--font-sera-display),Syne,sans-serif] text-xl font-semibold">
            One guide link, ready for every channel.
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#5f6570]">
            Send it through WhatsApp, add it to a QR poster, or include it in customer support replies.
          </p>
          <a
            href={demoProductUrl}
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#e85d04] hover:text-[#c44a00]"
          >
            Open the live product demo
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <div className="flex flex-wrap content-center gap-2.5 border-t border-[#d8dade] bg-[#ececed] p-6 lg:max-w-[430px] lg:border-l lg:border-t-0 lg:p-8">
          <button
            type="button"
            onClick={() => void shareGuide()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#e85d04] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#c44a00]"
          >
            {copiedKey === 'share' ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
            {copiedKey === 'share' ? 'Link copied' : 'Share guide'}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1ebe57]"
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </a>
          <button
            type="button"
            onClick={() => void copy('guide', guideUrl)}
            className="inline-flex items-center gap-2 rounded-xl border border-[#d8dade] bg-[#f3f3f4] px-4 py-3 text-sm font-semibold text-[#2a2622] transition hover:border-[#e85d04]/30 hover:text-[#e85d04]"
          >
            {copiedKey === 'guide' ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {copiedKey === 'guide' ? 'Copied' : 'Copy link'}
          </button>
          <button
            type="button"
            onClick={() => void copy('whatsapp', whatsappText)}
            className="inline-flex items-center gap-2 rounded-xl border border-[#d8dade] bg-[#f3f3f4] px-4 py-3 text-sm font-semibold text-[#2a2622] transition hover:border-[#e85d04]/30 hover:text-[#e85d04]"
          >
            {copiedKey === 'whatsapp' ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {copiedKey === 'whatsapp' ? 'Message copied' : 'Copy message'}
          </button>
        </div>
      </div>
    </div>
  )
}
