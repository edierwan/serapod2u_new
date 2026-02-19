'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { signOut } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'
import { filterMenuItems, type MenuItem } from '@/lib/menu-access'
import { usePermissions } from '@/hooks/usePermissions'
import { getStorageUrl, cn } from '@/lib/utils'
import {
  Package,
  BarChart3,
  Building2,
  Truck,
  MessageSquare,
  Users,
  FileText,
  Settings as SettingsIcon,
  LogOut,
  User,
  Menu,
  X,
  Store,
  ChevronDown,
  ChevronRight,
  QrCode,
  Scan,
  Gift,
  Trophy,
  ShieldCheck,
  Warehouse,
  Factory,
  BookOpen,
  ShoppingCart,
  Inbox,
  Plus,
  TrendingUp,
  ListTree,
  Database,
  Calculator,
  Receipt,
  Briefcase,
  UsersRound,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useTranslation } from '@/lib/i18n/LanguageProvider'
import { isSupplyChainViewId } from '@/modules/supply-chain/supplyChainNav'
import { isCustomerGrowthViewId } from '@/modules/customer-growth/customerGrowthNav'

interface SidebarProps {
  userProfile: any
  currentView: string
  onViewChange: (view: string) => void
  onCollapseChange?: (collapsed: boolean) => void
  initialCollapsed?: boolean
}

// Main navigation menu items with access control
// Main navigation menu items with access control
const navigationItems: MenuItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: BarChart3,
    description: 'Overview and analytics',
    // Accessible to all users
  },
  {
    id: 'reporting',
    label: 'Reporting',
    icon: TrendingUp,
    description: 'Executive reports & insights',
    access: {
      allowedOrgTypes: ['HQ', 'DIST', 'WH'], // Removed MFG/MANU
      maxRoleLevel: 40 // Managers and above
    }
  },
  {
    id: 'supply-chain',
    label: 'Supply Chain',
    icon: Truck,
    description: 'Products, orders, tracking & inventory',
    // Supply Chain submenu moved to Supply Chain top-nav bar (src/modules/supply-chain/supplyChainNav.ts)
    // Sidebar now shows Supply Chain as a single module entry → navigates to /supply-chain
  },
  {
    id: 'customer-growth',
    label: 'Customer & Growth',
    icon: UsersRound,
    description: 'CRM, marketing, loyalty & product catalog',
    access: {
      allowedOrgTypes: ['HQ', 'DIST', 'WH', 'SHOP'],
    },
    // Submenu moved to Customer & Growth top-nav bar (src/modules/customer-growth/customerGrowthNav.ts)
    // Sidebar now shows Customer & Growth as a single module entry → navigates to /customer-growth
  },

  {
    id: 'hr',
    label: 'HR',
    icon: Briefcase,
    description: 'People & organization structure',
    access: {
      allowedOrgTypes: ['HQ', 'DIST', 'WH', 'SHOP'],
      requiredPermissionsAny: ['view_users', 'view_settings'],
      maxRoleLevel: 60
    },
    // HR submenu moved to HR top-nav bar (src/modules/hr/hrNav.ts)
    // Sidebar now shows HR as a single module entry → navigates to /hr
  },

  {
    id: 'finance',
    label: 'Finance',
    icon: Calculator,
    description: 'Finance & Accounting',
    access: {
      allowedOrgTypes: ['HQ', 'DIST', 'WH'],
      maxRoleLevel: 40
    },
    // Finance submenu moved to Finance top-nav bar (src/modules/finance/financeNav.ts)
    // Sidebar now shows Finance as a single module entry → navigates to /finance
  },
]

const secondaryItems: MenuItem[] = [
  {
    id: 'my-profile',
    label: 'My Profile',
    icon: User,
    description: 'Personal profile and preferences',
    // Accessible to all authenticated users (replaces User Management for non-admins)
  },
  {
    id: 'users',
    label: 'User Management',
    icon: Users,
    description: 'User management',
    access: {
      allowedOrgTypes: ['HQ', 'DIST', 'WH', 'SHOP'],
      requiredPermission: 'view_users'
    }
  },

  {
    id: 'settings',
    label: 'Settings',
    icon: SettingsIcon,
    description: 'System settings',
    access: {
      // Only HQ can access settings
      // Restrict to Level 40 and below (higher privilege)
      allowedOrgTypes: ['HQ'],
      maxRoleLevel: 40
    }
  }
]


interface SidebarNavItemProps {
  icon: any
  label: string
  isActive?: boolean
  hasChildren?: boolean
  isOpen?: boolean
  onClick?: () => void
  isCollapsed?: boolean
  className?: string
}

const SidebarNavItem = ({
  icon: Icon,
  label,
  isActive,
  hasChildren,
  isOpen,
  onClick,
  isCollapsed,
  className,
}: SidebarNavItemProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-colors group select-none outline-none focus-visible:ring-2 focus-visible:ring-gray-200",
        isActive
          ? "bg-gray-100 dark:bg-gray-800/80 text-gray-900 dark:text-gray-100 font-semibold"
          : "text-gray-600 dark:text-gray-400 font-normal hover:bg-gray-50 dark:hover:bg-gray-800/40",
        className
      )}
      title={isCollapsed ? label : undefined}
    >
      <Icon
        className={cn(
          "w-[18px] h-[18px] flex-shrink-0 transition-colors",
          isActive
            ? "text-gray-600 dark:text-gray-300"
            : "text-gray-400 dark:text-gray-500 group-hover:text-gray-500 dark:group-hover:text-gray-400"
        )}
        strokeWidth={1.5}
      />
      {!isCollapsed && (
        <>
          <span className="flex-1 text-left leading-none">{label}</span>
          {hasChildren && (
            <ChevronRight
              className={cn(
                "h-4 w-4 text-gray-400 ml-auto transition-transform duration-200",
                isOpen && "rotate-90"
              )}
              strokeWidth={1.5}
            />
          )}
        </>
      )}
    </button>
  )
}

export default function Sidebar({ userProfile, currentView, onViewChange, onCollapseChange, initialCollapsed }: SidebarProps) {
  const { hasPermission, loading: permissionsLoading, permissions } = usePermissions(
    userProfile?.roles?.role_level,
    userProfile?.role_code,
    userProfile?.department_id
  )
  const { t } = useTranslation()

  // Translation map for sidebar navigation labels
  const labelMap: Record<string, string> = {
    'Dashboard': t('sidebar.dashboard'),
    'Reporting': t('sidebar.reporting'),
    'Supply Chain': t('sidebar.supplyChain'),
    'Customer & Growth': t('sidebar.customerGrowth'),
    'HR': t('sidebar.hr'),
    'Finance': t('sidebar.finance'),
    'My Profile': t('sidebar.myProfile'),
    'User Management': t('sidebar.userManagement'),
    'Settings': t('sidebar.settings'),
  }
  const tLabel = (label: string) => labelMap[label] || label
  const [isCollapsed, setIsCollapsedRaw] = useState(() => {
    if (typeof initialCollapsed === 'boolean') return initialCollapsed
    if (typeof window !== 'undefined') {
      return localStorage.getItem('ui.sidebarCollapsed') === 'true'
    }
    return false
  })

  const setIsCollapsed = (v: boolean | ((prev: boolean) => boolean)) => {
    setIsCollapsedRaw((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      if (typeof window !== 'undefined') localStorage.setItem('ui.sidebarCollapsed', String(next))
      onCollapseChange?.(next)
      return next
    })
  }
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null)
  const [expandedNestedMenu, setExpandedNestedMenu] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [currentDateTime, setCurrentDateTime] = useState(new Date())
  const [isMounted, setIsMounted] = useState(false)
  const [brandingSettings, setBrandingSettings] = useState<any>(null)
  const [qrTrackingVisibility, setQrTrackingVisibility] = useState({
    manufacturer: { scan: true, scan2: true },
    warehouse: { receive: true, receive2: true, ship: true }
  })
  const router = useRouter()
  const supabase = createClient()

  const resolveHrPath = (id: string) => {
    if (id === 'hr') return '/hr'
    if (id.startsWith('hr/')) return `/${id}`
    if (id.startsWith('hr-')) return `/hr/${id.replace('hr-', '')}`
    return null
  }

  const resolveFinancePath = (id: string) => {
    if (id === 'finance') return '/finance'
    if (id.startsWith('finance/')) return `/${id}`
    return null
  }

  const resolveSettingsPath = (id: string) => {
    if (id === 'settings') return '/settings'
    if (id.startsWith('settings/')) return `/${id}`
    return null
  }

  const resolveSupplyChainPath = (id: string) => {
    if (id === 'supply-chain') return '/supply-chain'
    return null
  }

  const resolveCustomerGrowthPath = (id: string) => {
    if (id === 'customer-growth') return '/customer-growth'
    return null
  }

  /** Resolve module-level navigation paths (HR, Finance, Settings, Supply Chain, Customer Growth, etc.) */
  const resolveModulePath = (id: string) => {
    return resolveHrPath(id) || resolveFinancePath(id) || resolveSettingsPath(id) || resolveSupplyChainPath(id) || resolveCustomerGrowthPath(id)
  }

  // Set mounted flag after client-side hydration
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Load branding settings from organization
  useEffect(() => {
    const loadBranding = async () => {
      if (!userProfile?.organization_id) return

      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('settings, logo_url, updated_at')
          .eq('id', userProfile.organization_id)
          .single()

        if (!error && data) {
          let settings: Record<string, any> = {}

          // Handle case where settings is a string (JSON)
          if (typeof data.settings === 'string') {
            try {
              settings = JSON.parse(data.settings)
            } catch (e) {
              console.error('Failed to parse settings JSON in Sidebar:', e)
              settings = {}
            }
          } else if (typeof data.settings === 'object' && data.settings !== null) {
            settings = data.settings as Record<string, any>
          }

          const branding = settings?.branding
          const logoUrl = branding?.logoUrl || data.logo_url
          setBrandingSettings({
            appName: branding?.appName || 'Serapod2U',
            appTagline: branding?.appTagline || 'Supply Chain',
            logoUrl: logoUrl ? `${logoUrl.split('?')[0]}?t=${new Date(data.updated_at || Date.now()).getTime()}` : null
          })

          // Load QR Tracking visibility from system_preferences
          // We wrap this in a try-catch because if the migration hasn't run, this might fail
          let loadedFromPrefs = false
          try {
            const { data: prefs, error: prefsError } = await supabase
              .from('system_preferences' as any)
              .select('*')
              .eq('company_id', userProfile.organization_id)
              .eq('module', 'qr_tracking') as { data: any[] | null, error: any }

            if (prefsError) {
              // Log warning but don't crash - likely migration missing
              console.warn('System preferences load warning (using fallback):', prefsError)
            } else if (prefs && prefs.length > 0) {
              setQrTrackingVisibility({
                manufacturer: {
                  scan: prefs.find((p: any) => p.key === 'manufacturer_scan')?.value?.visible ?? true,
                  scan2: prefs.find((p: any) => p.key === 'manufacturer_scan_2')?.value?.visible ?? true,
                },
                warehouse: {
                  receive: prefs.find((p: any) => p.key === 'warehouse_receive')?.value?.visible ?? true,
                  receive2: prefs.find((p: any) => p.key === 'warehouse_receive_2')?.value?.visible ?? true,
                  ship: prefs.find((p: any) => p.key === 'warehouse_ship')?.value?.visible ?? true,
                }
              })
              loadedFromPrefs = true
            }
          } catch (err) {
            console.warn('System preferences fetch error:', err)
          }

          // Fallback to legacy settings if system preferences failed or returned no data
          if (!loadedFromPrefs && settings?.qr_tracking_visibility) {
            console.log('Loading QR visibility from legacy settings:', settings.qr_tracking_visibility)
            setQrTrackingVisibility(prev => ({
              manufacturer: {
                ...prev.manufacturer,
                ...(settings.qr_tracking_visibility?.manufacturer || {})
              },
              warehouse: {
                ...prev.warehouse,
                ...(settings.qr_tracking_visibility?.warehouse || {})
              }
            }))
          }
        }
      } catch (error) {
        console.error('Failed to load branding:', error)
      }
    }

    loadBranding()

    // Listen for settings updates
    const handleSettingsUpdate = () => {
      loadBranding()
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('settingsUpdated', handleSettingsUpdate)
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('settingsUpdated', handleSettingsUpdate)
      }
    }
  }, [supabase, userProfile.organization_id])

  // Persist expanded menu state to session storage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (expandedMenu) {
        sessionStorage.setItem('sidebarExpandedMenu', expandedMenu)
      } else {
        sessionStorage.removeItem('sidebarExpandedMenu')
      }
    }
  }, [expandedMenu])

  // Auto-expand parent menu when navigating to a submenu item (including nested)
  useEffect(() => {
    // Check for direct submenu match
    let parentMenu = navigationItems.find(item =>
      item.submenu?.some(sub => sub.id === currentView)
    )

    // Check for nested submenu match (by id or targetView)
    if (!parentMenu) {
      parentMenu = navigationItems.find(item =>
        item.submenu?.some((sub: any) =>
          sub.nestedSubmenu?.some((nested: any) =>
            nested.id === currentView || nested.targetView === currentView
          )
        )
      )

      // Also expand the nested submenu
      if (parentMenu) {
        const nestedParent = parentMenu.submenu?.find((sub: any) =>
          sub.nestedSubmenu?.some((nested: any) =>
            nested.id === currentView || nested.targetView === currentView
          )
        )
        if (nestedParent && expandedNestedMenu !== nestedParent.id) {
          setExpandedNestedMenu(nestedParent.id)
        }
      }
    }

    if (parentMenu && expandedMenu !== parentMenu.id) {
      setExpandedMenu(parentMenu.id)
    }
  }, [currentView])

  // Update date/time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  // Format date/time
  const formatDateTime = () => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    const day = days[currentDateTime.getDay()]
    const date = currentDateTime.getDate()
    const month = months[currentDateTime.getMonth()]
    const year = currentDateTime.getFullYear()

    let hours = currentDateTime.getHours()
    const minutes = currentDateTime.getMinutes()
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12 || 12 // Convert to 12-hour format

    const formattedTime = `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`
    const formattedDate = `${date} ${month} ${year}`

    return { day, date: formattedDate, time: formattedTime }
  }

  const { day, date, time } = formatDateTime()

  // Filter menu items based on user role and organization
  const filteredNavigationItems = useMemo(() => {
    // Don't filter items while permissions are loading - this prevents premature filtering
    if (permissionsLoading) {
      console.log('[Sidebar] Permissions still loading, showing empty menus temporarily')
      return []
    }

    console.log('[Sidebar] Filtering navigation items with permissions:', Object.keys(permissions).length, 'permissions loaded')
    let items = filterMenuItems(navigationItems, userProfile, hasPermission)

    return items
  }, [userProfile, qrTrackingVisibility, hasPermission, permissionsLoading, permissions])

  const filteredSecondaryItems = useMemo(() => {
    // Don't filter items while permissions are loading
    if (permissionsLoading) {
      console.log('[Sidebar] Permissions still loading for secondary items')
      return []
    }

    // Debug logs for secondary items
    console.log('[Sidebar Debug] User Profile Role:', {
      role_level: userProfile?.roles?.role_level,
      role_id: userProfile?.roles?.role_id,
      role_code: userProfile?.roles?.role_code,
      id: userProfile?.roles?.id
    })
    console.log('[Sidebar Debug] permissionsLoading:', permissionsLoading)
    console.log('[Sidebar Debug] hasPermission("view_users"):', hasPermission('view_users'))
    if (permissions && typeof permissions === 'object') {
      console.log('[Sidebar Debug] Permissions keys:', Object.keys(permissions))
    }

    const items = filterMenuItems(secondaryItems, userProfile, hasPermission)
    console.log('[Sidebar Debug] Filtered Secondary Items:', items.map(i => i.id))

    return items
  },
    [userProfile, hasPermission, permissionsLoading, permissions]
  )

  const handleSignOut = async (e?: React.MouseEvent) => {
    // Prevent accidental clicks
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }

    // Confirm before logging out to prevent accidental logouts
    if (!confirm('Are you sure you want to sign out?')) {
      return
    }

    setIsSigningOut(true)
    try {
      // Use server action to properly clear cookies and session
      await signOut()
    } catch (error) {
      console.error('Sign out error:', error)
      // Fallback: force redirect even if server action fails
      window.location.href = '/login'
    } finally {
      setIsSigningOut(false)
    }
  }

  // Helper function to get user initials from name or email
  const getInitials = (fullName: string | null | undefined, email: string | null | undefined): string => {
    if (fullName) {
      return fullName
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    }
    if (email) {
      return email.substring(0, 2).toUpperCase()
    }
    return 'U'
  }

  return (
    <>
      {/* Mobile Menu Button - Fixed Top Left */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-blue-600 text-white rounded-lg shadow-lg hover:bg-blue-700 transition-colors"
        aria-label="Toggle menu"
      >
        {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        bg-card border-r border-border flex flex-col transition-all duration-300
        fixed lg:static inset-y-0 left-0 z-40
        ${isCollapsed ? 'w-16' : 'w-64'}
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            {!isCollapsed && (
              <div className="flex items-center gap-3 flex-1">
                {brandingSettings?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={brandingSettings.logoUrl}
                    alt="Logo"
                    className="h-8 w-8 rounded-lg object-cover flex-shrink-0"
                    onError={(e) => {
                      // Fallback to default icon if image fails to load
                      e.currentTarget.style.display = 'none'
                      e.currentTarget.nextElementSibling?.classList.remove('hidden')
                    }}
                  />
                ) : null}
                <div className={`h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0 ${brandingSettings?.logoUrl ? 'hidden' : ''}`}>
                  <Package className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="font-semibold text-foreground">
                    {brandingSettings?.appName || 'Serapod2U'}
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    {brandingSettings?.appTagline || 'Supply Chain'}
                  </p>
                  {/* Date & Time Display */}
                  <div className="mt-1.5 pt-1.5 border-t border-gray-200">
                    <div className="text-[10px] text-gray-600 space-y-0.5 leading-tight">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-500">Date:</span>
                        <span className="text-gray-700">{isMounted ? date : '--'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-500">Day:</span>
                        <span className="text-gray-700">{isMounted ? day : '--'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-500">Time:</span>
                        <span className="text-gray-700">{isMounted ? time : '--:-- --'}</span>
                      </div>
                      <div className="flex items-center gap-1.5 pt-1 mt-1 border-t border-gray-100">
                        <span className="font-medium text-gray-500">Login:</span>
                        <span className="text-gray-700 truncate max-w-[140px]" title={userProfile?.email}>{userProfile?.email || '--'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center gap-1">
              {!isCollapsed && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="h-8 w-8 p-0 flex-shrink-0 text-muted-foreground hover:text-destructive"
                  title="Sign Out"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="h-8 w-8 p-0 flex-shrink-0"
              >
                {isCollapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto">
          <nav className="p-2 flex flex-col gap-4">
            {/* Main Navigation */}
            <div className="flex flex-col gap-1">
              {filteredNavigationItems.map((item: any) => {
                // Check if current view matches any submenu or nested submenu
                const isActive = currentView === item.id ||
                  // HR module: highlight when on any HR sub-route
                  (item.id === 'hr' && currentView.startsWith('hr/')) ||
                  // Finance module: highlight when on any Finance sub-route
                  (item.id === 'finance' && currentView.startsWith('finance/')) ||
                  // Settings module: highlight when on any Settings sub-route
                  (item.id === 'settings' && currentView.startsWith('settings/')) ||
                  // Supply Chain module: highlight when on any SC child view
                  (item.id === 'supply-chain' && isSupplyChainViewId(currentView)) ||
                  // Customer & Growth domain: highlight when on any child module view
                  (item.id === 'customer-growth' && isCustomerGrowthViewId(currentView)) ||
                  (item.submenu?.some((sub: any) =>
                    sub.id === currentView ||
                    sub.targetView === currentView ||
                    (sub.nestedSubmenu?.some((nested: any) =>
                      nested.id === currentView || nested.targetView === currentView
                    ))
                  ))
                const isMenuOpen = expandedMenu === item.id

                return (
                  <div key={item.id}>
                    <SidebarNavItem
                      icon={item.icon}
                      label={tLabel(item.label)}
                      isActive={isActive}
                      hasChildren={!!item.submenu}
                      isOpen={isMenuOpen}
                      isCollapsed={isCollapsed}
                      onClick={() => {
                        if (item.submenu) {
                          setExpandedMenu(isMenuOpen ? null : item.id)
                        } else {
                          const modulePath = resolveModulePath(item.id)
                          if (modulePath) {
                            // Always update view state first so the component re-renders
                            // even if the URL hasn't changed (e.g. navigating back to
                            // Supply Chain after visiting My Profile on the same page).
                            onViewChange(item.id)
                            router.push(modulePath)
                            setIsMobileMenuOpen(false)
                          } else {
                            onViewChange(item.id)
                            setIsMobileMenuOpen(false) // Close mobile menu on navigation
                          }
                        }
                      }}
                    />

                    {/* Submenu */}
                    {item.submenu && isMenuOpen && !isCollapsed && (
                      <div className="mt-1 space-y-0.5 ml-4 border-l border-gray-100 pl-2">
                        {item.submenu.map((subitem: any) => {
                          const hasNestedSubmenu = subitem.nestedSubmenu && subitem.nestedSubmenu.length > 0
                          const isNestedMenuOpen = expandedNestedMenu === subitem.id

                          // Check if this submenu or any of its nested items are active
                          const isSubitemActive = currentView === subitem.id ||
                            (hasNestedSubmenu && subitem.nestedSubmenu.some((nested: any) =>
                              currentView === nested.id || currentView === nested.targetView
                            ))

                          return (
                            <div key={subitem.id}>
                              <SidebarNavItem
                                icon={subitem.icon}
                                label={subitem.label}
                                isActive={isSubitemActive}
                                hasChildren={hasNestedSubmenu}
                                isOpen={isNestedMenuOpen}
                                isCollapsed={isCollapsed}
                                className="py-2 h-9"
                                onClick={() => {
                                  if (hasNestedSubmenu) {
                                    setExpandedNestedMenu(isNestedMenuOpen ? null : subitem.id)
                                  } else {
                                    const modulePath = resolveModulePath(subitem.id)
                                    if (modulePath) {
                                      router.push(modulePath)
                                      setIsMobileMenuOpen(false)
                                    } else {
                                      onViewChange(subitem.id)
                                      setIsMobileMenuOpen(false)
                                    }
                                  }
                                }}
                              />

                              {/* Nested Submenu */}
                              {hasNestedSubmenu && isNestedMenuOpen && (
                                <div className="mt-0.5 space-y-0.5 ml-4 border-l border-gray-100 pl-2">
                                  {subitem.nestedSubmenu.map((nestedItem: any) => {
                                    const targetView = nestedItem.targetView || nestedItem.id
                                    const isNestedActive = currentView === nestedItem.id || currentView === targetView

                                    return (
                                      <SidebarNavItem
                                        key={nestedItem.id}
                                        icon={nestedItem.icon}
                                        label={nestedItem.label}
                                        isActive={isNestedActive}
                                        hasChildren={false}
                                        isCollapsed={isCollapsed}
                                        className="py-2 h-9"
                                        onClick={() => {
                                          const modulePath = resolveModulePath(targetView)
                                          if (modulePath) {
                                            router.push(modulePath)
                                          } else {
                                            onViewChange(targetView)
                                          }
                                          setIsMobileMenuOpen(false)
                                        }}
                                      />
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
              })}
            </div>

            {/* Divider */}
            <div className="border-t border-border/50 mx-2" />

            {/* Secondary Navigation */}
            <div className="flex flex-col gap-1">
              {filteredSecondaryItems.map((item) => {
                const isActive = currentView === item.id

                return (
                  <SidebarNavItem
                    key={item.id}
                    icon={item.icon}
                    label={tLabel(item.label)}
                    isActive={isActive}
                    isCollapsed={isCollapsed}
                    onClick={() => {
                      onViewChange(item.id)
                      setIsMobileMenuOpen(false) // Close mobile menu on navigation
                    }}
                  />
                )
              })}
            </div>
          </nav>
        </div>

        {/* User Profile Section */}
        <div className="p-4 border-t border-border">
          {!isCollapsed && (
            <div className="mb-3">
              <div className="flex items-center gap-3 p-2 rounded-lg bg-accent">
                <Avatar className="h-8 w-8">
                  {userProfile?.avatar_url && (
                    <AvatarImage
                      src={getStorageUrl(`${userProfile.avatar_url.split('?')[0]}?t=${new Date(userProfile.updated_at || Date.now()).getTime()}`) || userProfile.avatar_url}
                      alt={userProfile.full_name || 'User'}
                    />
                  )}
                  <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white text-xs font-semibold">
                    {getInitials(userProfile?.full_name, userProfile?.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {userProfile?.email || 'User'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {userProfile?.roles?.role_name || 'Guest'} • {userProfile?.organizations?.org_name || 'No Org'}
                  </p>
                </div>
              </div>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="w-full justify-start gap-3 text-foreground hover:bg-accent"
            title={isCollapsed ? t('common.signOut') : undefined}
          >
            <LogOut className="h-4 w-4 flex-shrink-0" />
            {!isCollapsed && (isSigningOut ? t('common.loading') : t('common.signOut'))}
          </Button>
        </div>
      </div>
    </>
  )
}