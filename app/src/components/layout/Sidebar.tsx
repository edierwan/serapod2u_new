"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { filterMenuItems, type MenuItem } from "@/lib/menu-access";
import { usePermissions } from "@/hooks/usePermissions";
import { SERAPOD_LOGO_PATH } from "@/lib/brand";
import { getStorageUrl, cn } from "@/lib/utils";
import {
  BarChart3,
  Bell,
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
  PanelLeftClose,
  PanelLeft,
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
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useTranslation } from "@/lib/i18n/LanguageProvider";
import { isSupplyChainViewId } from "@/modules/supply-chain/supplyChainNav";
import { isCustomerGrowthViewId } from "@/modules/customer-growth/customerGrowthNav";

interface SidebarProps {
  userProfile: any;
  currentView: string;
  onViewChange: (view: string) => void;
  onCollapseChange?: (collapsed: boolean) => void;
  initialCollapsed?: boolean;
}

// Main navigation menu items with access control
// Main navigation menu items with access control
const navigationItems: MenuItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: BarChart3,
    description: "Overview and analytics",
    // Accessible to all users
  },
  {
    id: "reporting",
    label: "Reporting",
    icon: TrendingUp,
    description: "Executive reports & insights",
    access: {
      allowedOrgTypes: ["HQ", "DIST", "WH"], // Removed MFG/MANU
      maxRoleLevel: 40, // Managers and above
    },
  },
  {
    id: "supply-chain",
    label: "Supply Chain",
    icon: Truck,
    description: "Products, orders, tracking & inventory",
    // Supply Chain submenu moved to Supply Chain top-nav bar (src/modules/supply-chain/supplyChainNav.ts)
    // Sidebar now shows Supply Chain as a single module entry → navigates to /supply-chain
  },
  {
    id: "customer-growth",
    label: "Customer & Growth",
    icon: UsersRound,
    description: "CRM, marketing, loyalty & product catalog",
    access: {
      allowedOrgTypes: ["HQ", "DIST", "WH", "SHOP"],
    },
    // Submenu moved to Customer & Growth top-nav bar (src/modules/customer-growth/customerGrowthNav.ts)
    // Sidebar now shows Customer & Growth as a single module entry → navigates to /customer-growth
  },

  {
    id: "hr",
    label: "HR",
    icon: Briefcase,
    description: "People & organization structure",
    access: {
      allowedOrgTypes: ["HQ", "DIST", "WH", "SHOP"],
      requiredPermissionsAny: ["view_users", "view_settings"],
      maxRoleLevel: 60,
    },
    // HR submenu moved to HR top-nav bar (src/modules/hr/hrNav.ts)
    // Sidebar now shows HR as a single module entry → navigates to /hr
  },

  {
    id: "finance",
    label: "Finance",
    icon: Calculator,
    description: "Finance & Accounting",
    access: {
      allowedOrgTypes: ["HQ", "DIST", "WH"],
      maxRoleLevel: 40,
    },
    // Finance submenu moved to Finance top-nav bar (src/modules/finance/financeNav.ts)
    // Sidebar now shows Finance as a single module entry → navigates to /finance
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    description: "Operational notification monitoring",
    access: {
      allowedOrgTypes: ["HQ"],
      maxRoleLevel: 40,
    },
  },
];

const secondaryItems: MenuItem[] = [
  {
    id: "my-profile",
    label: "My Profile",
    icon: User,
    description: "Personal profile and preferences",
    // Accessible to all authenticated users (replaces User Management for non-admins)
  },
  {
    id: "users",
    label: "User Management",
    icon: Users,
    description: "User management",
    access: {
      allowedOrgTypes: ["HQ", "DIST", "WH", "SHOP"],
      requiredPermission: "view_users",
    },
  },

  {
    id: "settings",
    label: "Settings",
    icon: SettingsIcon,
    description: "System settings",
    access: {
      // Only HQ can access settings
      // Restrict to Level 40 and below (higher privilege)
      allowedOrgTypes: ["HQ"],
      maxRoleLevel: 40,
    },
  },
];

interface SidebarNavItemProps {
  icon: any;
  label: string;
  isActive?: boolean;
  hasChildren?: boolean;
  isOpen?: boolean;
  onClick?: () => void;
  isCollapsed?: boolean;
  className?: string;
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
        "group relative w-full flex items-center gap-3 rounded-xl text-sm transition-all duration-200 select-none outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        isCollapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5",
        isActive
          ? "bg-primary/10 text-primary font-medium shadow-sm"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        className,
      )}
      title={isCollapsed ? label : undefined}
    >
      {isActive && !isCollapsed && (
        <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
          isActive
            ? "bg-primary/15 text-primary"
            : "bg-muted/50 text-muted-foreground group-hover:bg-muted group-hover:text-foreground",
        )}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      {!isCollapsed && (
        <>
          <span className="flex-1 text-left leading-snug">{label}</span>
          {hasChildren && (
            <ChevronRight
              className={cn(
                "ml-auto h-4 w-4 text-muted-foreground transition-transform duration-200",
                isOpen && "rotate-90 text-primary",
              )}
              strokeWidth={1.75}
            />
          )}
        </>
      )}
    </button>
  );
};

export default function Sidebar({
  userProfile,
  currentView,
  onViewChange,
  onCollapseChange,
  initialCollapsed,
}: SidebarProps) {
  const {
    hasPermission,
    loading: permissionsLoading,
    permissions,
  } = usePermissions(
    userProfile?.roles?.role_level,
    userProfile?.role_code,
    userProfile?.department_id,
  );
  const { t } = useTranslation();

  // Translation map for sidebar navigation labels
  const labelMap: Record<string, string> = {
    Dashboard: t("sidebar.dashboard"),
    Reporting: t("sidebar.reporting"),
    "Supply Chain": t("sidebar.supplyChain"),
    "Customer & Growth": t("sidebar.customerGrowth"),
    HR: t("sidebar.hr"),
    Finance: t("sidebar.finance"),
    Notifications: t("sidebar.notifications"),
    "My Profile": t("sidebar.myProfile"),
    "User Management": t("sidebar.userManagement"),
    Settings: t("sidebar.settings"),
  };
  const tLabel = (label: string) => labelMap[label] || label;
  const [isCollapsed, setIsCollapsedRaw] = useState(() => {
    if (typeof initialCollapsed === "boolean") return initialCollapsed;
    if (typeof window !== "undefined") {
      return localStorage.getItem("ui.sidebarCollapsed") === "true";
    }
    return false;
  });

  const setIsCollapsed = (v: boolean | ((prev: boolean) => boolean)) => {
    setIsCollapsedRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      if (typeof window !== "undefined")
        localStorage.setItem("ui.sidebarCollapsed", String(next));
      onCollapseChange?.(next);
      return next;
    });
  };
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
  const [expandedNestedMenu, setExpandedNestedMenu] = useState<string | null>(
    null,
  );
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [currentDateTime, setCurrentDateTime] = useState(new Date());
  const [isMounted, setIsMounted] = useState(false);
  const [brandingSettings, setBrandingSettings] = useState<any>(null);
  const [qrTrackingVisibility, setQrTrackingVisibility] = useState({
    manufacturer: { scan: true, scan2: true },
    warehouse: { receive: true, receive2: true, ship: true },
  });
  const router = useRouter();
  const supabase = createClient();

  const resolveHrPath = (id: string) => {
    if (id === "hr") return "/hr";
    if (id.startsWith("hr/")) return `/${id}`;
    if (id.startsWith("hr-")) return `/hr/${id.replace("hr-", "")}`;
    return null;
  };

  const resolveFinancePath = (id: string) => {
    if (id === "finance") return "/finance";
    if (id.startsWith("finance/")) return `/${id}`;
    return null;
  };

  const resolveSettingsPath = (id: string) => {
    if (id === "settings") return "/settings";
    if (id.startsWith("settings/")) return `/${id}`;
    return null;
  };

  const resolveSupplyChainPath = (id: string) => {
    if (id === "supply-chain") return "/supply-chain";
    return null;
  };

  const resolveCustomerGrowthPath = (id: string) => {
    if (id === "customer-growth") return "/customer-growth";
    return null;
  };

  const resolveNotificationsPath = (id: string) => {
    if (id === "notifications") return "/notifications";
    if (id.startsWith("notifications/")) return `/${id}`;
    return null;
  };

  /** Resolve module-level navigation paths (HR, Finance, Settings, Supply Chain, Customer Growth, etc.) */
  const resolveModulePath = (id: string) => {
    return (
      resolveHrPath(id) ||
      resolveFinancePath(id) ||
      resolveSettingsPath(id) ||
      resolveSupplyChainPath(id) ||
      resolveCustomerGrowthPath(id) ||
      resolveNotificationsPath(id)
    );
  };

  // Set mounted flag after client-side hydration
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Load branding settings from organization
  useEffect(() => {
    const loadBranding = async () => {
      if (!userProfile?.organization_id) return;

      try {
        const { data, error } = await supabase
          .from("organizations")
          .select("settings, logo_url, updated_at")
          .eq("id", userProfile.organization_id)
          .single();

        if (!error && data) {
          let settings: Record<string, any> = {};

          // Handle case where settings is a string (JSON)
          if (typeof data.settings === "string") {
            try {
              settings = JSON.parse(data.settings);
            } catch (e) {
              console.error("Failed to parse settings JSON in Sidebar:", e);
              settings = {};
            }
          } else if (
            typeof data.settings === "object" &&
            data.settings !== null
          ) {
            settings = data.settings as Record<string, any>;
          }

          const branding = settings?.branding;
          const logoUrl = branding?.logoUrl || data.logo_url;
          setBrandingSettings({
            appName: branding?.appName || "Serapod2U",
            appTagline: branding?.appTagline || "Supply Chain",
            logoUrl: logoUrl
              ? `${logoUrl.split("?")[0]}?t=${new Date(data.updated_at || Date.now()).getTime()}`
              : null,
          });

          // Load QR Tracking visibility from system_preferences
          // We wrap this in a try-catch because if the migration hasn't run, this might fail
          let loadedFromPrefs = false;
          try {
            const { data: prefs, error: prefsError } = (await supabase
              .from("system_preferences" as any)
              .select("*")
              .eq("company_id", userProfile.organization_id)
              .eq("module", "qr_tracking")) as {
              data: any[] | null;
              error: any;
            };

            if (prefsError) {
              // Log warning but don't crash - likely migration missing
              console.warn(
                "System preferences load warning (using fallback):",
                prefsError,
              );
            } else if (prefs && prefs.length > 0) {
              setQrTrackingVisibility({
                manufacturer: {
                  scan:
                    prefs.find((p: any) => p.key === "manufacturer_scan")?.value
                      ?.visible ?? true,
                  scan2:
                    prefs.find((p: any) => p.key === "manufacturer_scan_2")
                      ?.value?.visible ?? true,
                },
                warehouse: {
                  receive:
                    prefs.find((p: any) => p.key === "warehouse_receive")?.value
                      ?.visible ?? true,
                  receive2:
                    prefs.find((p: any) => p.key === "warehouse_receive_2")
                      ?.value?.visible ?? true,
                  ship:
                    prefs.find((p: any) => p.key === "warehouse_ship")?.value
                      ?.visible ?? true,
                },
              });
              loadedFromPrefs = true;
            }
          } catch (err) {
            console.warn("System preferences fetch error:", err);
          }

          // Fallback to legacy settings if system preferences failed or returned no data
          if (!loadedFromPrefs && settings?.qr_tracking_visibility) {
            console.log(
              "Loading QR visibility from legacy settings:",
              settings.qr_tracking_visibility,
            );
            setQrTrackingVisibility((prev) => ({
              manufacturer: {
                ...prev.manufacturer,
                ...(settings.qr_tracking_visibility?.manufacturer || {}),
              },
              warehouse: {
                ...prev.warehouse,
                ...(settings.qr_tracking_visibility?.warehouse || {}),
              },
            }));
          }
        }
      } catch (error) {
        console.error("Failed to load branding:", error);
      }
    };

    loadBranding();

    // Listen for settings updates
    const handleSettingsUpdate = () => {
      loadBranding();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("settingsUpdated", handleSettingsUpdate);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("settingsUpdated", handleSettingsUpdate);
      }
    };
  }, [supabase, userProfile.organization_id]);

  // Persist expanded menu state to session storage whenever it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (expandedMenu) {
        sessionStorage.setItem("sidebarExpandedMenu", expandedMenu);
      } else {
        sessionStorage.removeItem("sidebarExpandedMenu");
      }
    }
  }, [expandedMenu]);

  // Auto-expand parent menu when navigating to a submenu item (including nested)
  useEffect(() => {
    // Check for direct submenu match
    let parentMenu = navigationItems.find((item) =>
      item.submenu?.some((sub) => sub.id === currentView),
    );

    // Check for nested submenu match (by id or targetView)
    if (!parentMenu) {
      parentMenu = navigationItems.find((item) =>
        item.submenu?.some((sub: any) =>
          sub.nestedSubmenu?.some(
            (nested: any) =>
              nested.id === currentView || nested.targetView === currentView,
          ),
        ),
      );

      // Also expand the nested submenu
      if (parentMenu) {
        const nestedParent = parentMenu.submenu?.find((sub: any) =>
          sub.nestedSubmenu?.some(
            (nested: any) =>
              nested.id === currentView || nested.targetView === currentView,
          ),
        );
        if (nestedParent && expandedNestedMenu !== nestedParent.id) {
          setExpandedNestedMenu(nestedParent.id);
        }
      }
    }

    if (parentMenu && expandedMenu !== parentMenu.id) {
      setExpandedMenu(parentMenu.id);
    }
  }, [currentView]);

  // Update date/time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Format date/time
  const formatDateTime = () => {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const day = days[currentDateTime.getDay()];
    const date = currentDateTime.getDate();
    const month = months[currentDateTime.getMonth()];
    const year = currentDateTime.getFullYear();

    let hours = currentDateTime.getHours();
    const minutes = currentDateTime.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12; // Convert to 12-hour format

    const formattedTime = `${hours}:${minutes.toString().padStart(2, "0")} ${ampm}`;
    const formattedDate = `${date} ${month} ${year}`;

    return { day, date: formattedDate, time: formattedTime };
  };

  const { day, date, time } = formatDateTime();

  // Filter menu items based on user role and organization
  // While permissions are loading, use a permissive checker (returns true for all)
  // so items appear immediately; once loaded, exact permissions apply.
  const permissiveCheck = useMemo(() => () => true, []);

  const filteredNavigationItems = useMemo(() => {
    const checker = permissionsLoading ? permissiveCheck : hasPermission;
    const items = filterMenuItems(navigationItems, userProfile, checker);
    return items;
  }, [
    userProfile,
    qrTrackingVisibility,
    hasPermission,
    permissionsLoading,
    permissions,
    permissiveCheck,
  ]);

  const filteredSecondaryItems = useMemo(() => {
    const checker = permissionsLoading ? permissiveCheck : hasPermission;
    const items = filterMenuItems(secondaryItems, userProfile, checker);
    return items;
  }, [
    userProfile,
    hasPermission,
    permissionsLoading,
    permissions,
    permissiveCheck,
  ]);

  const handleSignOut = async (e?: React.MouseEvent) => {
    // Prevent accidental clicks
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Confirm before logging out to prevent accidental logouts
    if (!confirm("Are you sure you want to sign out?")) {
      return;
    }

    setIsSigningOut(true);
    try {
      // Use server action to properly clear cookies and session
      await signOut();
    } catch (error) {
      console.error("Sign out error:", error);
      // Fallback: force redirect even if server action fails
      window.location.href = "/login";
    } finally {
      setIsSigningOut(false);
    }
  };

  // Helper function to get user initials from name or email
  const getInitials = (
    fullName: string | null | undefined,
    email: string | null | undefined,
  ): string => {
    if (fullName) {
      return fullName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    if (email) {
      return email.substring(0, 2).toUpperCase();
    }
    return "U";
  };

  const sidebarLogoSrc = brandingSettings?.logoUrl || SERAPOD_LOGO_PATH;

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-foreground shadow-lg transition-colors hover:bg-muted"
        aria-label="Toggle menu"
      >
        {isMobileMenuOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <Menu className="h-5 w-5" />
        )}
      </button>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          "relative flex flex-col border-r border-border/80 bg-gradient-to-b from-card via-card to-muted/20 shadow-sm transition-all duration-300",
          "fixed inset-y-0 left-0 z-40 lg:static",
          isCollapsed ? "w-[4.5rem]" : "w-72",
          isMobileMenuOpen
            ? "translate-x-0"
            : "-translate-x-full lg:translate-x-0",
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-1/2 z-20 hidden h-7 w-7 -translate-y-1/2 rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm transition hover:bg-muted hover:text-foreground lg:flex"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <PanelLeft className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" />
          )}
        </Button>

        {/* Header */}
        <div className="border-b border-border/70 px-3 py-4">
          <div className={cn("space-y-2", isCollapsed && "space-y-2")}>
            <div
              style={{ display: "flex", justifyContent: "center" }}
              className={cn(
                "min-w-0",
                isCollapsed ? "flex justify-center" : "space-y-2",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sidebarLogoSrc}
                alt="Serapod"
                style={{ width: "200px", height: "40px", objectFit: "cover" }}
                className={cn(
                  "object-contain",
                  isCollapsed
                    ? "h-9 w-9 rounded-md"
                    : "h-10 w-auto max-w-[200px]",
                )}
                onError={(e) => {
                  if (e.currentTarget.src.endsWith(SERAPOD_LOGO_PATH)) return;
                  e.currentTarget.src = SERAPOD_LOGO_PATH;
                }}
              />
              {/* {!isCollapsed && (
                <div className="min-w-0">
                  <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
                    {brandingSettings?.appName || "Serapod2U"}
                  </h1>
                  <p className="truncate text-xs text-muted-foreground">
                    {brandingSettings?.appTagline || "Supply Chain"}
                  </p>
                </div>
              )} */}
            </div>
          </div>

          {!isCollapsed && (
            <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Session
              </p>
              <p className="mt-0.5 text-xs text-foreground">
                {isMounted ? `${day}, ${date} • ${time}` : "--"}
              </p>
              <p
                className="mt-1 truncate text-[11px] text-muted-foreground"
                title={userProfile?.email}
              >
                {userProfile?.email || "--"}
              </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto px-2 py-3 scrollbar-thin">
          <nav className="flex flex-col gap-5">
            {/* Main Navigation */}
            <div className="flex flex-col gap-1">
              {!isCollapsed && (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  Modules
                </p>
              )}
              {filteredNavigationItems.map((item: any) => {
                // Check if current view matches any submenu or nested submenu
                const isActive =
                  currentView === item.id ||
                  // HR module: highlight when on any HR sub-route
                  (item.id === "hr" && currentView.startsWith("hr/")) ||
                  // Finance module: highlight when on any Finance sub-route
                  (item.id === "finance" &&
                    currentView.startsWith("finance/")) ||
                  // Notifications module: highlight when on any Notifications sub-route
                  (item.id === "notifications" &&
                    currentView.startsWith("notifications/")) ||
                  // Settings module: highlight when on any Settings sub-route
                  (item.id === "settings" &&
                    currentView.startsWith("settings/")) ||
                  // Supply Chain module: highlight when on any SC child view
                  (item.id === "supply-chain" &&
                    isSupplyChainViewId(currentView)) ||
                  // Customer & Growth domain: highlight when on any child module view
                  (item.id === "customer-growth" &&
                    isCustomerGrowthViewId(currentView)) ||
                  item.submenu?.some(
                    (sub: any) =>
                      sub.id === currentView ||
                      sub.targetView === currentView ||
                      sub.nestedSubmenu?.some(
                        (nested: any) =>
                          nested.id === currentView ||
                          nested.targetView === currentView,
                      ),
                  );
                const isMenuOpen = expandedMenu === item.id;

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
                          setExpandedMenu(isMenuOpen ? null : item.id);
                        } else {
                          // onViewChange (handleViewChange) handles both
                          // setCurrentView and router.push for module-level
                          // pages, so we don't need a separate router.push here.
                          onViewChange(item.id);
                          setIsMobileMenuOpen(false);
                        }
                      }}
                    />

                    {/* Submenu */}
                    {item.submenu && isMenuOpen && !isCollapsed && (
                      <div className="mt-1 space-y-0.5 border-l border-border/70 pl-2 ml-5">
                        {item.submenu.map((subitem: any) => {
                          const hasNestedSubmenu =
                            subitem.nestedSubmenu &&
                            subitem.nestedSubmenu.length > 0;
                          const isNestedMenuOpen =
                            expandedNestedMenu === subitem.id;

                          // Check if this submenu or any of its nested items are active
                          const isSubitemActive =
                            currentView === subitem.id ||
                            (hasNestedSubmenu &&
                              subitem.nestedSubmenu.some(
                                (nested: any) =>
                                  currentView === nested.id ||
                                  currentView === nested.targetView,
                              ));

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
                                    setExpandedNestedMenu(
                                      isNestedMenuOpen ? null : subitem.id,
                                    );
                                  } else {
                                    const modulePath = resolveModulePath(
                                      subitem.id,
                                    );
                                    if (modulePath) {
                                      router.push(modulePath);
                                      setIsMobileMenuOpen(false);
                                    } else {
                                      onViewChange(subitem.id);
                                      setIsMobileMenuOpen(false);
                                    }
                                  }
                                }}
                              />

                              {/* Nested Submenu */}
                              {hasNestedSubmenu && isNestedMenuOpen && (
                                <div className="mt-0.5 space-y-0.5 border-l border-border/70 pl-2 ml-5">
                                  {subitem.nestedSubmenu.map(
                                    (nestedItem: any) => {
                                      const targetView =
                                        nestedItem.targetView || nestedItem.id;
                                      const isNestedActive =
                                        currentView === nestedItem.id ||
                                        currentView === targetView;

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
                                            const modulePath =
                                              resolveModulePath(targetView);
                                            if (modulePath) {
                                              router.push(modulePath);
                                            } else {
                                              onViewChange(targetView);
                                            }
                                            setIsMobileMenuOpen(false);
                                          }}
                                        />
                                      );
                                    },
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mx-2 border-t border-border/60" />

            {/* Secondary Navigation */}
            <div className="flex flex-col gap-1">
              {!isCollapsed && (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  Account
                </p>
              )}
              {filteredSecondaryItems.map((item) => {
                const isActive = currentView === item.id;

                return (
                  <SidebarNavItem
                    key={item.id}
                    icon={item.icon}
                    label={tLabel(item.label)}
                    isActive={isActive}
                    isCollapsed={isCollapsed}
                    onClick={() => {
                      onViewChange(item.id);
                      setIsMobileMenuOpen(false); // Close mobile menu on navigation
                    }}
                  />
                );
              })}
            </div>
          </nav>
        </div>

        {/* User Profile Section */}
        <div className="border-t border-border/70 bg-muted/10 p-3">
          {!isCollapsed && (
            <div className="mb-2 rounded-xl border border-border/60 bg-card p-3 shadow-sm">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 ring-2 ring-background">
                  {userProfile?.avatar_url && (
                    <AvatarImage
                      src={
                        getStorageUrl(
                          `${userProfile.avatar_url.split("?")[0]}?t=${new Date(userProfile.updated_at || Date.now()).getTime()}`,
                        ) || userProfile.avatar_url
                      }
                      alt={userProfile.full_name || "User"}
                    />
                  )}
                  <AvatarFallback className="bg-gradient-to-br from-brand to-orange-700 text-xs font-semibold text-white">
                    {getInitials(userProfile?.full_name, userProfile?.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {userProfile?.full_name || userProfile?.email || "User"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {userProfile?.roles?.role_name || "Guest"}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground/80">
                    {userProfile?.organizations?.org_name || "No Org"}
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
            className={cn(
              "w-full gap-3 text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
              isCollapsed ? "justify-center px-2" : "justify-start",
            )}
            title={isCollapsed ? t("common.signOut") : undefined}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!isCollapsed &&
              (isSigningOut ? t("common.loading") : t("common.signOut"))}
          </Button>
        </div>
      </div>
    </>
  );
}
