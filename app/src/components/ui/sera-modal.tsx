'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SeraModalSize = 'auto' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'

const SIZE_CLASS: Record<Exclude<SeraModalSize, 'auto'>, string> = {
  sm: 'sera-modal-panel--sm',
  md: 'sera-modal-panel--md',
  lg: 'sera-modal-panel--lg',
  xl: 'sera-modal-panel--xl',
  '2xl': 'sera-modal-panel--2xl',
  full: 'sera-modal-panel--full',
}

const FIXED_SIZE_RE = /\bsera-modal-panel--(sm|md|lg|xl|2xl|full)\b/
const MAX_WIDTH_UTIL_RE = /\bmax-w-/

const AUTO_MIN_W = 28 * 16 // 28rem
const AUTO_MAX_W = 72 * 16 // 72rem
const VIEWPORT_GUTTER = 32 // 2rem total

function px(n: number) {
  return `${Math.round(n)}px`
}

function readPaddingX(el: HTMLElement) {
  const s = getComputedStyle(el)
  return (parseFloat(s.paddingLeft) || 0) + (parseFloat(s.paddingRight) || 0)
}

/** Measure a node's intrinsic width without permanently changing layout. */
function measureIntrinsicWidth(el: HTMLElement) {
  const prevWidth = el.style.width
  const prevMinWidth = el.style.minWidth
  const prevMaxWidth = el.style.maxWidth
  el.style.width = 'max-content'
  el.style.minWidth = '0'
  el.style.maxWidth = 'none'
  const w = el.scrollWidth
  el.style.width = prevWidth
  el.style.minWidth = prevMinWidth
  el.style.maxWidth = prevMaxWidth
  return w
}

const AUTO_WIDE_SELECTOR = [
  'table',
  'pre',
  'code',
  'img',
  'video',
  'canvas',
  'iframe',
  'svg',
  '[data-sera-autosize]',
  '.overflow-x-auto',
  '.overflow-auto',
  '.overflow-x-scroll',
  '[class*="min-w-"]',
].join(', ')

function measureAutoWidth(panel: HTMLElement) {
  const body = panel.querySelector('.sera-modal-body') as HTMLElement | null
  const header = panel.querySelector('.sera-modal-header') as HTMLElement | null
  const footer = panel.querySelector('.sera-modal-footer') as HTMLElement | null

  const viewportMax = Math.min(window.innerWidth - VIEWPORT_GUTTER, AUTO_MAX_W)
  const minW = Math.min(AUTO_MIN_W, viewportMax)

  let contentW = minW

  if (header) contentW = Math.max(contentW, header.scrollWidth)
  if (footer) contentW = Math.max(contentW, footer.scrollWidth)

  if (body) {
    contentW = Math.max(contentW, body.scrollWidth)
    const padX = readPaddingX(body)

    body.querySelectorAll<HTMLElement>(AUTO_WIDE_SELECTOR).forEach((node) => {
      const isScrollHost = node.matches('.overflow-x-auto, .overflow-auto, .overflow-x-scroll')
      const inner =
        isScrollHost && node.firstElementChild instanceof HTMLElement
          ? node.firstElementChild
          : node

      // Media: prefer natural/display size when available.
      if (inner instanceof HTMLImageElement) {
        const natural = inner.naturalWidth || 0
        const rendered = Math.max(inner.scrollWidth, inner.clientWidth)
        contentW = Math.max(contentW, Math.max(natural, rendered) + padX)
        return
      }
      if (inner instanceof HTMLVideoElement) {
        contentW = Math.max(contentW, Math.max(inner.videoWidth || 0, inner.scrollWidth) + padX)
        return
      }

      contentW = Math.max(contentW, measureIntrinsicWidth(inner) + padX)
      contentW = Math.max(contentW, node.scrollWidth + (node === inner ? 0 : padX))
    })

    // Multi-column layouts: CSS grids, common 2-pane flex rows, wide card rows.
    body
      .querySelectorAll<HTMLElement>(
        '.grid, [class*="grid-cols-"], [class*="columns-"], .flex-row, [class*="flex-row"], [data-sera-wide-layout]'
      )
      .forEach((node) => {
        contentW = Math.max(contentW, measureIntrinsicWidth(node) + padX)
        contentW = Math.max(contentW, node.scrollWidth + padX)
      })

    // Nested managers / dense lists often use full-width tables wrapped deeper.
    body.querySelectorAll<HTMLElement>('[role="table"], [role="grid"]').forEach((node) => {
      contentW = Math.max(contentW, measureIntrinsicWidth(node) + padX)
    })
  }

  return Math.min(viewportMax, Math.max(minW, contentW))
}

function measureAutoHeight(panel: HTMLElement) {
  const body = panel.querySelector('.sera-modal-body') as HTMLElement | null
  const header = panel.querySelector('.sera-modal-header') as HTMLElement | null
  const footer = panel.querySelector('.sera-modal-footer') as HTMLElement | null
  const viewportMax = Math.min(window.innerHeight * 0.9, window.visualViewport?.height
    ? window.visualViewport.height * 0.9
    : window.innerHeight * 0.9)

  const chrome =
    (header?.offsetHeight ?? 0) +
    (footer?.offsetHeight ?? 0)

  // Prefer content scrollHeight so tall tables grow the panel until the viewport cap.
  const bodyH = body ? Math.max(body.scrollHeight, body.offsetHeight) : 0
  const natural = chrome + bodyH
  return Math.min(viewportMax, Math.max(natural, 1))
}

/** Shared Serapod modal shell for custom (non-Radix) overlays. */
export function SeraModalOverlay({
  className,
  children,
  onBackdropClick,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { onBackdropClick?: () => void }) {
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const overlay = (
    <div
      className={cn('sera-modal-overlay', className)}
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackdropClick?.()
      }}
      {...props}
    >
      {children}
    </div>
  )

  // Portal to body so sticky module top-navs (z-40) never cover the modal.
  if (!mounted || typeof document === 'undefined') return null
  return createPortal(overlay, document.body)
}

export function SeraModalPanel({
  className,
  children,
  size = 'auto',
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { size?: SeraModalSize }) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const hasFixedSizeClass = FIXED_SIZE_RE.test(className ?? '')
  const hasMaxWidthUtil = MAX_WIDTH_UTIL_RE.test(className ?? '')
  const useAuto = size === 'auto' && !hasFixedSizeClass && !hasMaxWidthUtil

  const lastSizeRef = React.useRef({ w: 0, h: 0 })
  const measuringRef = React.useRef(false)

  const applyAutoSize = React.useCallback(() => {
    const panel = panelRef.current
    if (!panel || !useAuto || measuringRef.current) return

    measuringRef.current = true
    try {
      const w = measureAutoWidth(panel)
      panel.style.setProperty('--sera-modal-auto-w', px(w))
      // Re-flow at the new width before measuring height (tables wrap differently).
      void panel.offsetWidth
      const h = measureAutoHeight(panel)

      const prev = lastSizeRef.current
      if (Math.abs(prev.w - w) < 2 && Math.abs(prev.h - h) < 2) return
      lastSizeRef.current = { w, h }
      panel.style.setProperty('--sera-modal-auto-h', px(h))
    } finally {
      measuringRef.current = false
    }
  }, [useAuto])

  React.useLayoutEffect(() => {
    if (!useAuto) {
      const panel = panelRef.current
      panel?.style.removeProperty('--sera-modal-auto-w')
      panel?.style.removeProperty('--sera-modal-auto-h')
      lastSizeRef.current = { w: 0, h: 0 }
      return
    }
    const panel = panelRef.current
    if (!panel) return

    applyAutoSize()

    const ro = new ResizeObserver(() => {
      applyAutoSize()
    })
    // Observe body/content only — observing the panel itself loops when we set width/height.
    const body = panel.querySelector('.sera-modal-body')
    if (body) ro.observe(body)
    panel.querySelectorAll('table, [data-sera-autosize]').forEach((node) => ro.observe(node))

    window.addEventListener('resize', applyAutoSize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', applyAutoSize)
    }
  }, [useAuto, applyAutoSize, children])

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      className={cn(
        'sera-modal-panel',
        useAuto && 'sera-modal-panel--auto',
        size !== 'auto' && SIZE_CLASS[size],
        className
      )}
      onClick={(e) => e.stopPropagation()}
      style={style}
      {...props}
    >
      {children}
    </div>
  )
}

export function SeraModalHeader({
  className,
  title,
  onClose,
  sticky,
  children,
}: {
  className?: string
  title?: React.ReactNode
  onClose?: () => void
  sticky?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={cn('sera-modal-header', sticky && 'is-sticky', className)}>
      {children ?? (title != null ? <h2 className="sera-modal-title">{title}</h2> : null)}
      {onClose && (
        <button type="button" onClick={onClose} className="sera-modal-close" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

export function SeraModalBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('sera-modal-body', className)} {...props}>
      {children}
    </div>
  )
}

export function SeraModalFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('sera-modal-footer', className)} {...props}>
      {children}
    </div>
  )
}
