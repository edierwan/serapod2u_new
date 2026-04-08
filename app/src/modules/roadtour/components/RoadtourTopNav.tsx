'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Map, ChevronDown, ChevronRight, Menu as MenuIcon } from 'lucide-react'
import {
  roadtourNavGroups,
  getActiveRoadtourGroup,
  type RoadtourNavGroup,
  type RoadtourNavChild,
} from '@/modules/roadtour/roadtourNav'
import { cn } from '@/lib/utils'

interface RoadtourTopNavProps {
  currentView: string
  onNavigate: (viewId: string) => void
}

export default function RoadtourTopNav({ currentView, onNavigate }: RoadtourTopNavProps) {
  const router = useRouter()
  const [openGroupId, setOpenGroupId] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [dropdownStyle, setDropdownStyle] = useState<{ left: number; top: number }>({ left: 0, top: 0 })

  const activeGroupId = useMemo(() => getActiveRoadtourGroup(currentView), [currentView])

  const isGroupActive = useCallback(
    (group: RoadtourNavGroup) =>
      group.id === activeGroupId || group.children.some((c) => c.id === currentView),
    [currentView, activeGroupId]
  )

  const isChildActive = useCallback(
    (child: RoadtourNavChild) => child.id === currentView,
    [currentView]
  )

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpenGroupId(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (openGroupId && dropdownRef.current) {
      const btn = buttonRefs.current[openGroupId]
      if (btn) {
        const rect = btn.getBoundingClientRect()
        const parentRect = dropdownRef.current.getBoundingClientRect()
        setDropdownStyle({ left: rect.left - parentRect.left, top: rect.bottom - parentRect.top })
      }
    }
  }, [openGroupId])

  const handleNav = useCallback(
    (childId: string) => {
      onNavigate(childId)
      setOpenGroupId(null)
      setMobileMenuOpen(false)
    }, [onNavigate]
  )

  return (
    <div className="sticky top-0 z-40 bg-card border-b border-border print:hidden">
      <div className="flex items-center h-11 px-3 gap-2">
        <div className="flex items-center gap-1.5 shrink-0 mr-1">
          <button onClick={() => onNavigate('roadtour')}
            className="flex items-center gap-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2.5 py-0.5 rounded text-sm font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors">
            <Map className="h-3 w-3" />
            <span>RoadTour</span>
          </button>
        </div>

        {/* Desktop */}
        <div ref={dropdownRef} className="hidden md:flex items-center flex-1 min-w-0 relative">
          <nav className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide" role="menubar">
            {roadtourNavGroups.map((group) => {
              const active = isGroupActive(group)
              const open = openGroupId === group.id
              const Icon = group.icon
              return (
                <button key={group.id}
                  ref={(el) => { buttonRefs.current[group.id] = el }}
                  role="menuitem" aria-haspopup="true" aria-expanded={open}
                  onClick={() => setOpenGroupId(open ? null : group.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors',
                    active ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    open && !active && 'bg-accent text-accent-foreground'
                  )}>
                  <Icon className="h-3.5 w-3.5" />{group.label}
                  <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                </button>
              )
            })}
          </nav>

          {openGroupId && (() => {
            const group = roadtourNavGroups.find((g) => g.id === openGroupId)
            if (!group) return null
            return (
              <div role="menu"
                className="absolute min-w-[200px] bg-popover border border-border rounded-lg shadow-lg py-1 z-50 animate-in fade-in-0 zoom-in-95 duration-100"
                style={{ left: dropdownStyle.left, top: dropdownStyle.top + 4 }}>
                {group.children.map((child) => {
                  const ChildIcon = child.icon
                  const childActive = isChildActive(child)
                  return (
                    <button key={child.id} role="menuitem" onClick={() => handleNav(child.id)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                        childActive ? 'bg-blue-50 text-blue-700 font-semibold dark:bg-blue-900/30 dark:text-blue-300' : 'text-foreground hover:bg-accent'
                      )}>
                      <ChildIcon className="h-3.5 w-3.5 shrink-0" /><span>{child.label}</span>
                    </button>
                  )
                })}
              </div>
            )
          })()}
        </div>

        {/* Mobile */}
        <div className="flex md:hidden flex-1 min-w-0">
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent">
            <MenuIcon className="h-4 w-4" /><span>Menu</span>
            <ChevronDown className={cn('h-3 w-3 transition-transform', mobileMenuOpen && 'rotate-180')} />
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-card max-h-[60vh] overflow-y-auto">
          {roadtourNavGroups.map((group) => {
            const active = isGroupActive(group)
            const open = openGroupId === group.id
            const Icon = group.icon
            return (
              <div key={group.id}>
                <button onClick={() => setOpenGroupId(open ? null : group.id)}
                  className={cn('w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors',
                    active ? 'bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200' : 'text-foreground hover:bg-accent')}>
                  <Icon className="h-4 w-4" /><span className="flex-1 text-left">{group.label}</span>
                  <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
                </button>
                {open && (
                  <div className="bg-accent/30">
                    {group.children.map((child) => {
                      const ChildIcon = child.icon
                      const childActive = isChildActive(child)
                      return (
                        <button key={child.id} onClick={() => handleNav(child.id)}
                          className={cn('w-full flex items-center gap-2.5 pl-10 pr-4 py-2 text-sm transition-colors',
                            childActive ? 'bg-blue-50 text-blue-700 font-semibold dark:bg-blue-900/30 dark:text-blue-300' : 'text-muted-foreground hover:bg-accent')}>
                          <ChildIcon className="h-3.5 w-3.5 shrink-0" /><span>{child.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
