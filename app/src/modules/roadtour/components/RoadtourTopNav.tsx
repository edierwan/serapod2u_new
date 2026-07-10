'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Map, ChevronDown, ChevronRight, Menu as MenuIcon } from 'lucide-react'
import {
  roadtourNavGroups,
  findRoadtourGroupForView,
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

  const activeGroupId = useMemo(() => findRoadtourGroupForView(currentView)?.id ?? null, [currentView])

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
    <div className="sticky top-0 z-40 border-b border-border/70 bg-background/95 backdrop-blur print:hidden">
      <div className="flex h-10 items-center gap-1.5 px-3">
        <div className="flex items-center gap-1.5 shrink-0 mr-1">
          <button onClick={() => onNavigate('roadtour')}
            className="flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2.5 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-muted">
            <Map className="h-3 w-3 text-brand" />
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
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium whitespace-nowrap transition-colors',
                    active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                    open && !active && 'bg-muted/60 text-foreground'
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
                className="absolute z-50 min-w-[200px] animate-in fade-in-0 zoom-in-95 rounded-md border border-border bg-popover py-1 shadow-sm duration-100"
                style={{ left: dropdownStyle.left, top: dropdownStyle.top + 4 }}>
                {group.children.map((child) => {
                  const ChildIcon = child.icon
                  const childActive = isChildActive(child)
                  return (
                    <button key={child.id} role="menuitem" onClick={() => handleNav(child.id)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                        childActive ? 'bg-muted text-foreground font-medium' : 'text-foreground hover:bg-muted/70'
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
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-muted/70">
            <MenuIcon className="h-4 w-4" /><span>Menu</span>
            <ChevronDown className={cn('h-3 w-3 transition-transform', mobileMenuOpen && 'rotate-180')} />
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden max-h-[60vh] overflow-y-auto border-t border-border bg-card">
          {roadtourNavGroups.map((group) => {
            const active = isGroupActive(group)
            const open = openGroupId === group.id
            const Icon = group.icon
            return (
              <div key={group.id}>
                <button onClick={() => setOpenGroupId(open ? null : group.id)}
                  className={cn('w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors',
                    active ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/70')}>
                  <Icon className="h-4 w-4" /><span className="flex-1 text-left">{group.label}</span>
                  <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
                </button>
                {open && (
                  <div className="bg-muted/30">
                    {group.children.map((child) => {
                      const ChildIcon = child.icon
                      const childActive = isChildActive(child)
                      return (
                        <button key={child.id} onClick={() => handleNav(child.id)}
                          className={cn('w-full flex items-center gap-2.5 py-2 pl-10 pr-4 text-sm transition-colors',
                            childActive ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/70')}>
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
