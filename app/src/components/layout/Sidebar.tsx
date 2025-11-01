'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { signOut } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'
import { filterMenuItems, type MenuItem } from '@/lib/menu-access'
import {
  Package,
  BarChart3,
  Building2,
  Truck,
  Users,
  FileText,
  Settings as SettingsIcon,
  LogOut,
  User,
  Menu,
  X,
  ChevronDown,
  QrCode,
  Scan,
  Gift,
  Trophy,
  ShieldCheck,
  Warehouse,
  Factory,
  BookOpen,
  ShoppingCart,
  Plus,
  TrendingUp,
  ListTree,
  Database
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface SidebarProps {
  userProfile: any
  currentView: string
  onViewChange: (view: string) => void
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
    id: 'products',
    label: 'Products',
    icon: Package,
    description: 'Product catalog',
    submenu: [
      {
        id: 'products',
        label: 'Product List',
        icon: Package,
        // Accessible to all
      },
      {
        id: 'product-management',
        label: 'Master Data',
        icon: Package,
        access: {
          // Only HQ can manage master data (categories, brands, etc)
          allowedOrgTypes: ['HQ'],
          maxRoleLevel: 30  // Admin roles only
        }
      }
    ]
  },
  {
    id: 'order-management',
    label: 'Order Management',
    icon: FileText,
    description: 'Order processing',
    submenu: [
      {
        id: 'orders',
        label: 'Orders',
        icon: FileText,
        // Accessible to all except WAREHOUSE
        access: {
          allowedOrgTypes: ['HQ', 'MANU', 'MFG', 'DIST', 'SHOP'],
          maxRoleLevel: 60
        }
      }
    ]
  },
  {
    id: 'qr-tracking',
    label: 'QR Tracking',
    icon: QrCode,
    description: 'QR code tracking system',
    submenu: [
      {
        id: 'qr-batches',
        label: 'QR Batches',
        icon: QrCode,
        access: {
          // HQ and Manufacturers manage QR batches
          allowedOrgTypes: ['HQ', 'MANU', 'MFG'],
          maxRoleLevel: 30
        }
      },
      {
        id: 'manufacturer-scan',
        label: 'Manufacturer Scan',
        icon: Factory,
        access: {
          // Only manufacturers
          allowedOrgTypes: ['MANU', 'MFG'],
          maxRoleLevel: 40
        }
      },
      {
        id: 'manufacturer-scan-v2',
        label: 'Manufacturer ScanV2',
        icon: Factory,
        access: {
          // Only manufacturers
          allowedOrgTypes: ['MANU', 'MFG'],
          maxRoleLevel: 40
        }
      },
      {
        id: 'warehouse-receive',
        label: 'Warehouse Receive',
        icon: Warehouse,
        access: {
          // Warehouses and Distributors
          allowedOrgTypes: ['WH', 'DIST', 'HQ'],
          maxRoleLevel: 40
        }
      },
      {
        id: 'warehouse-ship',
        label: 'Warehouse Ship',
        icon: Truck,
        access: {
          // Warehouses and Distributors
          allowedOrgTypes: ['WH', 'DIST', 'HQ'],
          maxRoleLevel: 40
        }
      },
      {
        id: 'consumer-scan',
        label: 'Consumer Scan',
        icon: Scan,
        access: {
          // Shops and HQ
          allowedOrgTypes: ['SHOP', 'HQ'],
          maxRoleLevel: 50
        }
      },
      {
        id: 'qr-validation',
        label: 'Validation Reports',
        icon: ShieldCheck,
        access: {
          // HQ and admins only
          allowedOrgTypes: ['HQ'],
          maxRoleLevel: 20
        }
      }
    ]
  },
  {
    id: 'consumer-engagement',
    label: 'Consumer Engagement',
    icon: Gift,
    description: 'Rewards & campaigns',
    access: {
      // HQ and shops
      allowedOrgTypes: ['HQ', 'SHOP'],
      maxRoleLevel: 50
    },
    submenu: [
      {
        id: 'journey-builder',
        label: 'Journey Builder',
        icon: BookOpen,
        access: {
          allowedOrgTypes: ['HQ'],
          maxRoleLevel: 30
        }
      },
      {
        id: 'point-catalog',
        label: 'Point Catalog',
        icon: Gift,
        access: {
          minRoleLevel: 1,
          maxRoleLevel: 30,
        }
      },
      {
        id: 'lucky-draw',
        label: 'Lucky Draw',
        icon: Trophy,
        access: {
          allowedOrgTypes: ['HQ'],
          maxRoleLevel: 30
        }
      },
      {
        id: 'redeem-gift-management',
        label: 'Redeem',
        icon: Gift,
        access: {
          allowedOrgTypes: ['HQ'],
          maxRoleLevel: 30
        }
      },
      {
        id: 'consumer-activations',
        label: 'Consumer Activations',
        icon: Scan,
        access: {
          allowedOrgTypes: ['HQ', 'SHOP'],
          maxRoleLevel: 50
        }
      },
      {
        id: 'product-catalog',
        label: 'Product Catalog',
        icon: ShoppingCart,
        access: {
          allowedOrgTypes: ['HQ', 'DIST', 'SHOP'],
          maxRoleLevel: 50
        }
      }
    ]
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: Package,
    description: 'Stock management',
    access: {
      // Exclude guests
      maxRoleLevel: 60
    },
    submenu: [
      {
        id: 'inventory-list',
        label: 'View Inventory',
        icon: Package,
        access: {
          maxRoleLevel: 60
        }
      },
      {
        id: 'add-stock',
        label: 'Add Stock',
        icon: Plus,
        access: {
          allowedOrgTypes: ['HQ'],
          maxRoleLevel: 40
        }
      },
      {
        id: 'stock-adjustment',
        label: 'Stock Adjustment',
        icon: SettingsIcon,
        access: {
          allowedOrgTypes: ['HQ'],
          maxRoleLevel: 40
        }
      },
      {
        id: 'stock-transfer',
        label: 'Stock Transfer',
        icon: Truck,
        access: {
          allowedOrgTypes: ['HQ'],
          maxRoleLevel: 40
        }
      },
      {
        id: 'stock-movements',
        label: 'Movement Reports',
        icon: ListTree,
        access: {
          maxRoleLevel: 50
        }
      },
    ]
  },
  {
    id: 'organizations',
    label: 'Organizations',
    icon: Building2,
    description: 'Supply chain partners',
    access: {
      // HQ and admin roles only
      allowedOrgTypes: ['HQ'],
      maxRoleLevel: 30
    }
  }
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
      // Admin roles only - up to distributor admin level, NOT for manufacturers
      allowedOrgTypes: ['HQ', 'DIST'],
      maxRoleLevel: 30
    }
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: FileText,
    description: 'Analytics & reports',
    access: {
      // HQ and admin roles
      allowedOrgTypes: ['HQ'],
      maxRoleLevel: 30
    }
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: SettingsIcon,
    description: 'System settings',
    access: {
      // Only HQ can access settings
      allowedOrgTypes: ['HQ']
    }
  }
]

export default function Sidebar({ userProfile, currentView, onViewChange }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [currentDateTime, setCurrentDateTime] = useState(new Date())
  const [isMounted, setIsMounted] = useState(false)
  const [brandingSettings, setBrandingSettings] = useState<any>(null)
  const router = useRouter()
  const supabase = createClient()

  // Set mounted flag after client-side hydration
  useEffect(() => {
    setIsMounted(true)
    // Restore expanded menu state from session storage
    const savedExpandedMenu = typeof window !== 'undefined' 
      ? sessionStorage.getItem('sidebarExpandedMenu') 
      : null
    if (savedExpandedMenu) {
      setExpandedMenu(savedExpandedMenu)
    }
  }, [])
  
  // Load branding settings from organization
  useEffect(() => {
    const loadBranding = async () => {
      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('settings, logo_url, updated_at')
          .eq('id', userProfile.organization_id)
          .single()
        
        if (!error && data) {
          const logoUrl = data.settings?.branding?.logoUrl || data.logo_url
          setBrandingSettings({
            appName: data.settings?.branding?.appName || 'Serapod2U',
            appTagline: data.settings?.branding?.appTagline || 'Supply Chain',
            logoUrl: logoUrl ? `${logoUrl.split('?')[0]}?t=${new Date(data.updated_at || Date.now()).getTime()}` : null
          })
        }
      } catch (error) {
        console.error('Failed to load branding:', error)
      }
    }
    
    loadBranding()
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

  // Auto-expand parent menu when navigating to a submenu item
  useEffect(() => {
    const parentMenu = navigationItems.find(item => 
      item.submenu?.some(sub => sub.id === currentView)
    )
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
  const filteredNavigationItems = useMemo(() =>
    filterMenuItems(navigationItems, userProfile),
    [userProfile]
  )

  const filteredSecondaryItems = useMemo(() =>
    filterMenuItems(secondaryItems, userProfile),
    [userProfile]
  )

  const handleSignOut = async () => {
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
                  </div>
                </div>
              </div>
            </div>
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

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto">
        <nav className="p-4 space-y-2">
          {/* Main Navigation */}
          <div className="space-y-1">
            {filteredNavigationItems.map((item: any) => {
              const Icon = item.icon
              const isActive = currentView === item.id || (item.submenu?.some((sub: any) => sub.id === currentView))
              const isMenuOpen = expandedMenu === item.id

              return (
                <div key={item.id}>
                  <button
                    onClick={() => {
                      if (item.submenu) {
                        setExpandedMenu(isMenuOpen ? null : item.id)
                      } else {
                        onViewChange(item.id)
                        setIsMobileMenuOpen(false) // Close mobile menu on navigation
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive
                        ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800'
                        : 'text-foreground hover:bg-accent'
                      }`}
                    title={isCollapsed ? item.label : undefined}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    {!isCollapsed && (
                      <div className="text-left flex-1">
                        <div>{item.label}</div>
                      </div>
                    )}
                    {!isCollapsed && item.submenu && (
                      <ChevronDown className={`h-4 w-4 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
                    )}
                  </button>

                                    {/* Submenu */}
                  {item.submenu && isMenuOpen && !isCollapsed && (
                    <div className="ml-4 mt-1 space-y-1 border-l border-border pl-2">
                      {item.submenu.map((subitem: any) => (
                        <button
                          key={subitem.id}
                          onClick={() => {
                            onViewChange(subitem.id)
                            setIsMobileMenuOpen(false) // Close mobile menu on navigation
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${currentView === subitem.id
                              ? 'bg-blue-100 text-blue-700 font-medium dark:bg-blue-900/30 dark:text-blue-300'
                              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                            }`}
                        >
                          <subitem.icon className="h-4 w-4" />
                          <span>{subitem.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Divider */}
          <div className="border-t border-border my-4" />

          {/* Secondary Navigation */}
          <div className="space-y-1">
            {filteredSecondaryItems.map((item) => {
              const Icon = item.icon
              const isActive = currentView === item.id

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onViewChange(item.id)
                    setIsMobileMenuOpen(false) // Close mobile menu on navigation
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive
                      ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800'
                      : 'text-foreground hover:bg-accent'
                    }`}
                  title={isCollapsed ? item.label : undefined}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {!isCollapsed && (
                    <div className="text-left">
                      <div>{item.label}</div>
                    </div>
                  )}
                </button>
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
                    src={`${userProfile.avatar_url.split('?')[0]}?t=${new Date(userProfile.updated_at || Date.now()).getTime()}`}
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
          title={isCollapsed ? 'Sign Out' : undefined}
        >
          <LogOut className="h-4 w-4 flex-shrink-0" />
          {!isCollapsed && (isSigningOut ? 'Signing out...' : 'Sign Out')}
        </Button>
      </div>
    </div>
    </>
  )
}