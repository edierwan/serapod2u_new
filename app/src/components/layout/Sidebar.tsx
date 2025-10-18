'use client'

import { useState, useMemo } from 'react'
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
  Settings,
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
  Factory
} from 'lucide-react'

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
        // Accessible to all except GUEST
        access: {
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
        id: 'redemption-catalog', 
        label: 'Redemption Catalog', 
        icon: Gift,
        access: {
          allowedOrgTypes: ['HQ', 'SHOP'],
          maxRoleLevel: 50
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
        id: 'consumer-activations', 
        label: 'Consumer Activations', 
        icon: Scan,
        access: {
          allowedOrgTypes: ['HQ', 'SHOP'],
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
    }
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
    icon: Settings,
    description: 'System settings',
    access: {
      // Only HQ can access settings
      allowedOrgTypes: ['HQ']
    }
  }
]

export default function Sidebar({ userProfile, currentView, onViewChange }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const router = useRouter()
  const supabase = createClient()

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

  return (
    <div className={`bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ${
      isCollapsed ? 'w-16' : 'w-64'
    }`}>
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          {!isCollapsed && (
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Package className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="font-semibold text-gray-900">Serapod2U</h1>
                <p className="text-xs text-gray-600">Supply Chain</p>
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="h-8 w-8 p-0"
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
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive 
                        ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                        : 'text-gray-700 hover:bg-gray-50'
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
                    <div className="ml-4 mt-1 space-y-1 border-l border-gray-200 pl-2">
                      {item.submenu.map((subitem: any) => (
                        <button
                          key={subitem.id}
                          onClick={() => onViewChange(subitem.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                            currentView === subitem.id
                              ? 'bg-blue-100 text-blue-700 font-medium'
                              : 'text-gray-600 hover:bg-gray-50'
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
          <div className="border-t border-gray-200 my-4" />

          {/* Secondary Navigation */}
          <div className="space-y-1">
            {filteredSecondaryItems.map((item) => {
              const Icon = item.icon
              const isActive = currentView === item.id
              
              return (
                <button
                  key={item.id}
                  onClick={() => onViewChange(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive 
                      ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                      : 'text-gray-700 hover:bg-gray-50'
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
      <div className="p-4 border-t border-gray-200">
        {!isCollapsed && (
          <div className="mb-3">
            <div className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
              <div className="h-8 w-8 bg-blue-600 rounded-full flex items-center justify-center">
                <User className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {userProfile?.email || 'User'}
                </p>
                <p className="text-xs text-gray-600 truncate">
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
          className="w-full justify-start gap-3 text-gray-700 hover:bg-gray-50"
          title={isCollapsed ? 'Sign Out' : undefined}
        >
          <LogOut className="h-4 w-4 flex-shrink-0" />
          {!isCollapsed && (isSigningOut ? 'Signing out...' : 'Sign Out')}
        </Button>
      </div>
    </div>
  )
}