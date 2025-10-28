/**
 * Mobile-first responsive utilities for Serapod2u
 */

export const MOBILE_BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const

export const MIN_TOUCH_TARGET = 48 // 48px minimum touch target for accessibility

/**
 * Tailwind classes for responsive touch targets
 */
export const touchTargetClasses = {
  button: 'min-h-[48px] min-w-[48px] active:scale-95 transition-transform',
  checkbox: 'h-6 w-6 md:h-5 md:w-5',
  icon: 'h-5 w-5 md:h-4 md:w-4',
  input: 'min-h-[48px] text-base', // Prevent iOS zoom on focus
}

/**
 * Responsive table wrapper classes
 */
export const responsiveTableClasses = {
  container: 'overflow-x-auto -mx-4 sm:mx-0',
  table: 'min-w-full',
  hideOnMobile: 'hidden md:table-cell',
  hideOnDesktop: 'md:hidden',
}

/**
 * Modal/Dialog responsive classes
 */
export const modalClasses = {
  overlay: 'fixed inset-0 z-50 bg-black/50',
  content: 'fixed z-50 w-full sm:max-w-lg bottom-0 sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 rounded-t-2xl sm:rounded-lg',
  header: 'sticky top-0 bg-white border-b px-4 py-3 sm:px-6 sm:py-4',
  body: 'max-h-[80vh] overflow-y-auto px-4 py-4 sm:px-6',
  footer: 'sticky bottom-0 bg-white border-t px-4 py-3 sm:px-6 flex gap-2 sm:gap-3',
}

/**
 * Sidebar responsive classes
 */
export const sidebarClasses = {
  overlay: 'lg:hidden fixed inset-0 z-40 bg-black/50',
  container: 'fixed inset-y-0 left-0 z-50 w-72 sm:w-80 lg:w-64 xl:w-72 transform transition-transform duration-300 lg:translate-x-0',
  header: 'h-16 sm:h-20 flex items-center justify-between px-4 sm:px-6',
  nav: 'overflow-y-auto h-[calc(100vh-4rem)] sm:h-[calc(100vh-5rem)] pb-20',
  menuButton: 'lg:hidden fixed top-4 left-4 z-30 rounded-lg bg-white shadow-lg p-2',
}

/**
 * Card responsive classes
 */
export const cardClasses = {
  container: 'rounded-lg border bg-card text-card-foreground shadow-sm',
  header: 'px-4 py-3 sm:px-6 sm:py-4',
  body: 'px-4 py-3 sm:px-6',
  footer: 'px-4 py-3 sm:px-6 border-t',
}

/**
 * Grid responsive patterns
 */
export const gridClasses = {
  cards: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6',
  stats: 'grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4',
  form: 'grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6',
}

/**
 * Typography responsive classes
 */
export const textClasses = {
  h1: 'text-2xl sm:text-3xl lg:text-4xl font-bold',
  h2: 'text-xl sm:text-2xl lg:text-3xl font-semibold',
  h3: 'text-lg sm:text-xl font-semibold',
  h4: 'text-base sm:text-lg font-medium',
  body: 'text-sm sm:text-base',
  small: 'text-xs sm:text-sm',
}

/**
 * Spacing responsive classes
 */
export const spacingClasses = {
  section: 'space-y-4 sm:space-y-6',
  stack: 'space-y-3 sm:space-y-4',
  inline: 'space-x-2 sm:space-x-3',
  page: 'p-4 sm:p-6 lg:p-8',
}

/**
 * Detect if user is on mobile device
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth < MOBILE_BREAKPOINTS.md
}

/**
 * Detect if user is on touch device
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

/**
 * Prevent iOS zoom on input focus
 */
export function preventIOSZoom() {
  if (typeof document === 'undefined') return

  const viewport = document.querySelector('meta[name=viewport]')
  if (viewport instanceof HTMLMetaElement) {
    const content = viewport.getAttribute('content') || ''
    if (!content.includes('maximum-scale')) {
      viewport.setAttribute(
        'content',
        `${content}, maximum-scale=1.0, user-scalable=0`
      )
    }
  }
}

/**
 * Format for mobile-friendly display
 */
export function truncateText(text: string, maxLength: number = 30): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

/**
 * Mobile-optimized number formatting
 */
export function formatNumberMobile(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return value.toString()
}
