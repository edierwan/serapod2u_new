'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'
type ThemeVariant = 'default' | 'slate' | 'ocean' | 'forest' | 'purple' | 'sunset' | 'black' | 'nord'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  resolvedTheme: 'light' | 'dark'
  themeVariant: ThemeVariant
  setThemeVariant: (variant: ThemeVariant) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')
  const [themeVariant, setThemeVariantState] = useState<ThemeVariant>('default')

  useEffect(() => {
    // Load theme and variant from localStorage on mount
    const savedTheme = localStorage.getItem('theme') as Theme | null
    const savedVariant = localStorage.getItem('themeVariant') as ThemeVariant | null
    
    if (savedTheme) {
      setThemeState(savedTheme)
    } else {
      // Check system preference
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      setThemeState('system')
    }
    
    if (savedVariant) {
      setThemeVariantState(savedVariant)
    }
  }, [])

  useEffect(() => {
    // Apply theme to document
    const root = document.documentElement
    
    let effectiveTheme: 'light' | 'dark' = 'light'
    
    if (theme === 'system') {
      // Use system preference
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      effectiveTheme = systemPrefersDark ? 'dark' : 'light'
    } else {
      effectiveTheme = theme
    }
    
    setResolvedTheme(effectiveTheme)
    
    // Remove all theme classes first
    root.classList.remove('light', 'dark', 'theme-slate', 'theme-ocean', 'theme-forest', 'theme-purple', 'theme-sunset', 'theme-black', 'theme-nord')
    
    // Add the effective theme class
    if (effectiveTheme === 'dark' && themeVariant === 'default') {
      root.classList.add('dark')
    } else if (themeVariant !== 'default') {
      root.classList.add(`theme-${themeVariant}`)
    } else {
      root.classList.add(effectiveTheme)
    }
    
    // Save to localStorage
    localStorage.setItem('theme', theme)
  }, [theme, themeVariant])

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handleChange = (e: MediaQueryListEvent) => {
      const effectiveTheme = e.matches ? 'dark' : 'light'
      setResolvedTheme(effectiveTheme)
      const root = document.documentElement
      root.classList.remove('light', 'dark')
      root.classList.add(effectiveTheme)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme)
  }

  const setThemeVariant = (variant: ThemeVariant) => {
    setThemeVariantState(variant)
    localStorage.setItem('themeVariant', variant)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme, themeVariant, setThemeVariant }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
