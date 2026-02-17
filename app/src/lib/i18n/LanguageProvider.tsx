'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import {
  type Locale,
  DEFAULT_LOCALE,
  getTranslation,
} from '@/lib/i18n/translations'

// ── Context ──────────────────────────────────────────────────────

interface LanguageContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string) => string
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key) => key,
})

// ── Provider ─────────────────────────────────────────────────────

const STORAGE_KEY = 'serapod2u-language'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null
      if (saved && ['en', 'ms', 'zh'].includes(saved)) {
        setLocaleState(saved)
      }
    } catch {
      // SSR or storage unavailable
    }
  }, [])

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale)
    try {
      localStorage.setItem(STORAGE_KEY, newLocale)
    } catch {
      // Storage unavailable
    }
    // Update the html lang attribute
    if (typeof document !== 'undefined') {
      document.documentElement.lang = newLocale
    }
  }, [])

  const t = useCallback(
    (key: string) => getTranslation(locale, key),
    [locale]
  )

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

// ── Hook ─────────────────────────────────────────────────────────

export function useTranslation() {
  return useContext(LanguageContext)
}

export function useLocale() {
  return useContext(LanguageContext).locale
}
