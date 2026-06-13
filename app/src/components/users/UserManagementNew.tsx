"use client";

import { useState, useEffect, useMemo } from "react";
import { getOrgTypeName } from "@/lib/utils/orgHierarchy";
import { useSupabaseAuth } from "@/lib/hooks/useSupabaseAuth";
import { useToast } from "@/components/ui/use-toast";
import {
  createUserWithAuth,
  updateUserWithAuth,
} from "@/lib/actions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Users,
  Search,
  Plus,
  Loader2,
  Edit,
  CheckCircle,
  XCircle,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Power,
  Save,
  ChevronLeft,
  ChevronRight,
  Circle,
  AlertTriangle,
  Shield,
  Building2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import UserDialogNew from "./UserDialogNew";
import type { User as UserType, Role, Organization } from "@/types/user";
import { getStorageUrl } from "@/lib/utils";
import { compressAvatar, formatFileSize } from "@/lib/utils/imageCompression";
import { updateUserHr } from "@/lib/api/hr";
import { samePhone } from "@/utils/phone";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500, 1000, -1] as const; // -1 represents "All"

const formatRelativeTime = (dateString: string | null): string => {
  if (!dateString) return "Never";
  try {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  } catch {
    return "Unknown";
  }
};

const formatDateTime = (dateString: string | null): string => {
  if (!dateString) return "Never";
  try {
    return new Date(dateString).toLocaleString();
  } catch {
    return "Unknown";
  }
};

// Check if user is online (logged in within last 15 minutes)
const isUserOnline = (lastLoginAt: string | null): boolean => {
  if (!lastLoginAt) return false;
  try {
    const lastLogin = new Date(lastLoginAt);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastLogin.getTime()) / (1000 * 60);
    return diffMinutes <= 15;
  } catch {
    return false;
  }
};

interface User {
  id: string;
  email: string;
  full_name: string | null;
  call_name?: string | null;
  phone: string | null;
  referral_phone: string | null;
  consumer_claim_confirmed_at: string | null;
  is_active: boolean;
  is_verified: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  avatar_url: string | null;
  role_code: string;
  organization_id: string;
}

interface UserProfile {
  id: string;
  role_code: string;
  organization_id: string;
  roles: { role_level: number };
}

type MasterOrganization = Organization & {
  contact_name?: string | null;
  contact_title?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  address?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_id?: string | null;
  district_id?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  website?: string | null;
  hot_flavour_brands?: string | null;
  sells_serapod_flavour?: boolean | null;
  sells_sbox?: boolean | null;
  sells_sbox_special_edition?: boolean | null;
  is_active?: boolean | null;
  updated_at?: string | null;
};

type SortField =
  | "full_name"
  | "role_code"
  | "is_active"
  | "organization_id"
  | "created_at"
  | "referral_phone"
  | "last_login_at";
type SortDirection = "asc" | "desc";

const getUserDisplayName = (user: Pick<User, "call_name" | "full_name" | "email">): string => {
  return user.call_name?.trim() || user.full_name?.trim() || user.email || "No Name";
};

export default function UserManagementNew({
  userProfile,
}: {
  userProfile: UserProfile;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [orgTypeFilter, setOrgTypeFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [organizationDialogOpen, setOrganizationDialogOpen] = useState(false);
  const [organizationLoading, setOrganizationLoading] = useState(false);
  const [organizationSaving, setOrganizationSaving] = useState(false);
  const [selectedOrganization, setSelectedOrganization] = useState<MasterOrganization | null>(null);
  const [organizationForm, setOrganizationForm] = useState<Partial<MasterOrganization>>({});
  const [organizationDialogUser, setOrganizationDialogUser] = useState<User | null>(null);

  // Delete progress state
  const [deleteProgress, setDeleteProgress] = useState<{
    isDeleting: boolean;
    current: number;
    total: number;
    progress: number;
    success: number;
    errors: number;
    message: string;
  } | null>(null);

  const { isReady, supabase } = useSupabaseAuth();
  const { toast } = useToast();

  const resolveCurrentUserLevel = () => {
    const roleLevel = userProfile?.roles?.role_level;
    if (typeof roleLevel === "number") return roleLevel;
    const roleCode = userProfile?.role_code?.toUpperCase();
    if (roleCode === "SUPERADMIN" || roleCode === "SUPER" || roleCode === "SA") return 1;
    if (roleCode === "HQ_ADMIN" || roleCode === "HQ") return 10;
    if (roleCode === "POWER_USER" || roleCode === "POWER") return 20;
    return 999;
  };

  const canManageUserDeletion = () => resolveCurrentUserLevel() <= 10;

  const currentUserLevel = resolveCurrentUserLevel();
  const canEditSelectedOrganization =
    currentUserLevel === 1 &&
    selectedOrganization?.org_type_code === "SHOP" &&
    organizationDialogUser?.organization_id === selectedOrganization?.id;

  useEffect(() => {
    if (isReady) {
      loadUsers();
      loadRoles();
      loadOrganizations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  const loadUsers = async () => {
    if (!isReady) return;
    try {
      setLoading(true);

      // Get current user's role level - users can only see same level and below (higher numbers)
      const currentUserLevel = resolveCurrentUserLevel();
      // Super Admin and HQ Admin can see all users, others see filtered by level
      const isPowerUser = currentUserLevel <= 20;

      // Fetch all users using pagination to overcome Supabase 1000 row limit
      const allUsers: any[] = [];
      const PAGE_SIZE = 1000;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        let query = supabase
          .from("users")
          .select(
            `
            *,
            roles:role_code (
              role_name,
              role_level
            )
          `,
            { count: "exact" }
          )
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        // Filter by organization for non-power users
        if (!isPowerUser) {
          // Allow users to see their own organization AND independent users (null organization)
          // This is important for HQ/Managers (Level 40) managing independent consumers (Level 50)
          query = query.or(`organization_id.eq.${userProfile.organization_id},organization_id.is.null`);
        }

        const { data, error, count } = await query;

        if (error) throw error;

        if (data && data.length > 0) {
          allUsers.push(...data);
          offset += PAGE_SIZE;
          // Check if we've fetched all records
          hasMore = count ? allUsers.length < count : data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      const data = allUsers;

      // Filter users based on role level visibility
      console.log(`[UserManagement] Current User Level: ${currentUserLevel}, isPowerUser: ${isPowerUser}`)
      console.log(`[UserManagement] Query URL params approximated:`, !isPowerUser ? `or=(organization_id.eq.${userProfile.organization_id},organization_id.is.null)` : 'ALL')

      const visibleUsers = (data || []).filter((u: any) => {
        const userRoleLevel = u.roles?.role_level || 999;

        // Debug visibility logic
        // if (u.email.includes('indep') || u.role_code === 'USER') {
        //   console.log(`Checking visibility for ${u.email}: Level ${userRoleLevel} vs My Level ${currentUserLevel}`)
        // }

        // Power users (level <= 20) can see all users
        if (currentUserLevel <= 20) return true;
        // Others can only see users at same level or below (higher number)
        return userRoleLevel >= currentUserLevel;
      });

      console.log(
        "📊 Loaded users:",
        visibleUsers.length,
        "users (filtered from",
        data?.length,
        ") for level",
        currentUserLevel,
      );
      setUsers(visibleUsers as User[]);
    } catch (error) {
      console.error("Error loading users:", error);
      toast({
        title: "Load Failed",
        description: "Could not load users. Please refresh.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadRoles = async () => {
    try {
      const { data, error } = await supabase
        .from("roles")
        .select("role_code, role_name, role_level")
        .eq("is_active", true)
        .order("role_level", { ascending: true });

      if (error) throw error;
      setRoles((data || []) as Role[]);
    } catch (error) {
      console.error("Error loading roles:", error);
    }
  };

  const loadOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, org_name, org_code, org_type_code, branch")
        .eq("is_active", true)
        .order("org_name", { ascending: true });

      if (error) throw error;
      setOrganizations((data || []) as Organization[]);
    } catch (error) {
      console.error("Error loading organizations:", error);
    }
  };

  const handleOrganizationFieldChange = (field: keyof MasterOrganization, value: any) => {
    setOrganizationForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleOpenOrganizationDialog = async (user: User, organization: Organization) => {
    setOrganizationDialogUser(user);
    setSelectedOrganization(null);
    setOrganizationForm({});
    setOrganizationDialogOpen(true);
    setOrganizationLoading(true);

    try {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", organization.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Organization not found.");

      const org = data as MasterOrganization;
      setSelectedOrganization(org);
      setOrganizationForm(org);
    } catch (error) {
      console.error("Error loading organization:", error);
      toast({
        title: "Load Failed",
        description: error instanceof Error ? error.message : "Could not load organization master data.",
        variant: "destructive",
      });
      setOrganizationDialogOpen(false);
    } finally {
      setOrganizationLoading(false);
    }
  };

  const handleSaveOrganization = async () => {
    if (!selectedOrganization || !canEditSelectedOrganization) return;

    try {
      setOrganizationSaving(true);

      const updatePayload = {
        org_name: organizationForm.org_name?.trim() || selectedOrganization.org_name,
        branch: organizationForm.branch?.trim() || null,
        contact_name: organizationForm.contact_name?.trim() || null,
        contact_title: organizationForm.contact_title?.trim() || null,
        contact_phone: organizationForm.contact_phone?.trim() || null,
        contact_email: organizationForm.contact_email?.trim() || null,
        address: organizationForm.address?.trim() || null,
        address_line2: organizationForm.address_line2?.trim() || null,
        city: organizationForm.city?.trim() || null,
        postal_code: organizationForm.postal_code?.trim() || null,
        country_code: organizationForm.country_code?.trim() || null,
        website: organizationForm.website?.trim() || null,
        hot_flavour_brands: organizationForm.hot_flavour_brands?.trim() || null,
        sells_serapod_flavour: Boolean(organizationForm.sells_serapod_flavour),
        sells_sbox: Boolean(organizationForm.sells_sbox),
        sells_sbox_special_edition: Boolean(organizationForm.sells_sbox_special_edition),
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await (supabase as any)
        .from("organizations")
        .update(updatePayload)
        .eq("id", selectedOrganization.id)
        .eq("org_type_code", "SHOP")
        .select("*")
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Organization update was not applied.");

      const updated = data as MasterOrganization;
      setSelectedOrganization(updated);
      setOrganizationForm(updated);
      setOrganizations((prev) =>
        prev.map((org) =>
          org.id === updated.id
            ? {
              ...org,
              org_name: updated.org_name,
              org_code: updated.org_code,
              org_type_code: updated.org_type_code,
              branch: updated.branch,
            }
            : org,
        ),
      );

      toast({
        title: "Organization Updated",
        description: `${updated.org_name} master data has been saved.`,
      });
    } catch (error) {
      console.error("Error saving organization:", error);
      toast({
        title: "Save Failed",
        description: error instanceof Error ? error.message : "Could not save organization master data.",
        variant: "destructive",
      });
    } finally {
      setOrganizationSaving(false);
    }
  };

  // Track latest QR activity per visible user so Last Activity reflects either
  // direct login or premium-template / QR usage, whichever is newer.
  const [lastScanMap, setLastScanMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!isReady || users.length === 0) {
      setLastScanMap(new Map());
      return;
    }

    const loadLastScans = async () => {
      try {
        const userIds = users.map((user) => user.id).filter(Boolean);

        if (userIds.length === 0) {
          setLastScanMap(new Map());
          return;
        }

        const chunkSize = 250;
        const chunks: string[][] = [];

        for (let index = 0; index < userIds.length; index += chunkSize) {
          chunks.push(userIds.slice(index, index + chunkSize));
        }

        const results = await Promise.all(
          chunks.map(async (chunk) => {
            const { data, error } = await supabase
              .from('consumer_qr_scans')
              .select('consumer_id, scanned_at')
              .in('consumer_id', chunk)
              .eq('is_manual_adjustment', false)
              .not('scanned_at', 'is', null)
              .order('scanned_at', { ascending: false });

            if (error) {
              throw error;
            }

            return data || [];
          }),
        );

        const map = new Map<string, string>();
        results.flat().forEach((row: any) => {
          if (!row.consumer_id || !row.scanned_at) {
            return;
          }

          const existing = map.get(row.consumer_id);
          if (!existing || row.scanned_at > existing) {
            map.set(row.consumer_id, row.scanned_at);
          }
        });
        setLastScanMap(map);
      } catch (err) {
        console.error('Last scan load error:', err);
      }
    };

    loadLastScans();
  }, [isReady, supabase, users]);

  const getLatestActivityAt = (user: User): string | null => {
    const lastScanAt = lastScanMap.get(user.id) || null;

    if (!user.last_login_at) return lastScanAt;
    if (!lastScanAt) return user.last_login_at;

    return new Date(user.last_login_at).getTime() >= new Date(lastScanAt).getTime()
      ? user.last_login_at
      : lastScanAt;
  };

  const hasConsumerLaneConfirmation = (user: User): boolean => {
    if (!user.consumer_claim_confirmed_at) {
      return false;
    }

    const org = organizations.find((candidate) => candidate.id === user.organization_id);
    const isLinkedShopProfile = Boolean(org && org.org_type_code === 'SHOP' && user.referral_phone);

    return !isLinkedShopProfile;
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle direction if clicking same field
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // Set new field with default ascending direction
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // Select all filtered users except current user
      const newSelected = new Set(
        filteredUsers.filter((u) => u.id !== userProfile.id).map((u) => u.id),
      );
      setSelectedUsers(newSelected);
    } else {
      setSelectedUsers(new Set());
    }
  };

  const handleSelectUser = (userId: string, checked: boolean) => {
    const newSelected = new Set(selectedUsers);
    if (checked) {
      newSelected.add(userId);
    } else {
      newSelected.delete(userId);
    }
    setSelectedUsers(newSelected);
  };

  const handleBulkDelete = async () => {
    if (selectedUsers.size === 0) return;

    // Validate levels before proceeding
    const currentUserLevel = resolveCurrentUserLevel();
    if (!canManageUserDeletion()) {
      toast({
        title: "Access Denied",
        description: "Only HQ Admin or Super Admin can delete users.",
        variant: "destructive",
      });
      return;
    }

    const ids = Array.from(selectedUsers);

    // Check if any selected user has higher privileges (lower role level number)
    // Note: lower role_level = higher privilege (e.g. 1 is Super Admin)
    const usersToDelete = users.filter(u => ids.includes(u.id));
    const unauthorized = usersToDelete.filter(u => {
      const level = (u as any).roles?.role_level || 999;
      return level < currentUserLevel;
    });

    if (unauthorized.length > 0) {
      toast({
        title: "Permission Denied",
        description: `You cannot delete ${unauthorized.length} users because they have higher privileges than you.`,
        variant: "destructive"
      });
      return;
    }

    if (ids.length === 1) {
      const targetUser = usersToDelete[0];
      if (!targetUser) {
        toast({
          title: "User Not Found",
          description: "The selected user could not be loaded. Please refresh and try again.",
          variant: "destructive",
        });
        return;
      }

      setSelectedUsers(new Set());
      await handleDeleteUser(
        targetUser.id,
        targetUser.full_name || targetUser.email || "selected user",
      );
      return;
    }

    toast({
      title: "OTP Required",
      description: "Bulk delete is disabled because each user deletion requires OTP confirmation. Delete users one at a time.",
      variant: "default",
    });
    return;
  };

  const handleSaveUser = async (
    userData: Partial<UserType> & { password?: string },
    avatarFile?: File | null,
    resetPassword?: { password: string },
  ) => {
    try {
      setIsSaving(true);
      const currentUserLevel = resolveCurrentUserLevel();

      const buildHrPayload = () => {
        const payload: Record<string, any> = {}
        if (userData.department_id) payload.department_id = userData.department_id;
        if ((userData as any).position_id) payload.position_id = (userData as any).position_id;
        if ((userData as any).manager_user_id) payload.manager_user_id = (userData as any).manager_user_id;
        if ((userData as any).employment_type) payload.employment_type = (userData as any).employment_type;
        if ((userData as any).join_date) payload.join_date = (userData as any).join_date;
        if ((userData as any).employment_status && (userData as any).employment_status !== 'active') payload.employment_status = (userData as any).employment_status;
        return payload;
      };

      // Validate Role Level permissions
      if (userData.role_code) {
        const targetRole = roles.find(r => r.role_code === userData.role_code);
        if (targetRole && targetRole.role_level < currentUserLevel) {
          throw new Error("You cannot assign a role level higher than your own.");
        }
      }

      if (editingUser) {
        // UPDATE existing user

        // Check if allow to edit this user
        // We need to look up the level of the user being edited.
        // The editingUser object comes from state, let's see if it has the nested role info
        // or check against the roles list
        const targetUserRoleCode = editingUser.role_code;
        const targetUserRole = roles.find(r => r.role_code === targetUserRoleCode);
        const targetUserLevel = targetUserRole?.role_level || 999;

        if (targetUserLevel < currentUserLevel) {
          throw new Error("You cannot edit a user with a higher role level than your own.");
        }

        let updateData: any = {
          full_name: userData.full_name,
          call_name: (userData as any).call_name || null,
          phone: userData.phone,
          role_code: userData.role_code,
          organization_id: userData.organization_id,
          is_active: userData.is_active ?? true,
        };

        // Include end user / independent user fields if present
        if ("shop_name" in userData) updateData.shop_name = (userData as any).shop_name || null;
        if ("address" in userData) updateData.address = (userData as any).address || null;
        if ("referral_phone" in userData) updateData.referral_phone = (userData as any).referral_phone || null;
        if ("can_be_reference" in userData) updateData.can_be_reference = !!(userData as any).can_be_reference;

        // Handle password reset (admin only)
        if (resetPassword && resetPassword.password) {
          try {
            const response = await fetch("/api/users/reset-password", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                user_id: editingUser.id,
                new_password: resetPassword.password,
              }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
              throw new Error(result.error || "Failed to reset password");
            }

            toast({
              title: "Password Reset",
              description: "User password has been reset successfully",
              variant: "default",
            });
          } catch (resetError: any) {
            console.error("Password reset error:", resetError);
            toast({
              title: "Password Reset Failed",
              description: resetError.message || "Failed to reset password",
              variant: "destructive",
            });
            // Don't throw - continue with other updates
          }
        }

        // Handle Bank Details Update (if provided)
        if (
          (userData as any).bank_id ||
          (userData as any).bank_account_number
        ) {
          // For end users (no organization), save bank details directly to user record
          const isEndUserEdit = !userData.organization_id;
          if (isEndUserEdit) {
            // Bank fields will be included in updateData and saved to user table
            if ((userData as any).bank_id) updateData.bank_id = (userData as any).bank_id;
            if ((userData as any).bank_account_number) updateData.bank_account_number = (userData as any).bank_account_number;
            if ((userData as any).bank_account_holder_name) updateData.bank_account_holder_name = (userData as any).bank_account_holder_name;
          } else {
            // For org users, update bank details on the organization
            try {
              const bankResponse = await fetch(
                "/api/organization/update-bank-details",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    organizationId: userData.organization_id,
                    bankId: (userData as any).bank_id,
                    bankAccountNumber: (userData as any).bank_account_number,
                    bankAccountHolderName: (userData as any)
                      .bank_account_holder_name,
                  }),
                },
              );

              if (!bankResponse.ok) {
                const errorData = await bankResponse.json();
                throw new Error(
                  errorData.error || "Failed to update bank details",
                );
              }
            } catch (bankError: any) {
              console.error("Error updating bank details:", bankError);
              toast({
                title: "Bank Details Update Failed",
                description: bankError.message || "Failed to update bank details",
                variant: "destructive",
              });
              // Continue with user update
            }
          }
        }

        // Handle avatar upload
        if (avatarFile) {
          try {
            // Compress avatar first
            const compressionResult = await compressAvatar(avatarFile);

            toast({
              title: "🖼️ Avatar Compressed",
              description: `${formatFileSize(compressionResult.originalSize)} → ${formatFileSize(compressionResult.compressedSize)} (${compressionResult.compressionRatio.toFixed(1)}% smaller)`,
            });

            // Delete old avatar if exists
            if (editingUser.avatar_url) {
              const oldPath = editingUser.avatar_url
                .split("/")
                .pop()
                ?.split("?")[0];
              if (oldPath) {
                await supabase.storage
                  .from("avatars")
                  .remove([`${editingUser.id}/${oldPath}`]);
              }
            }

            // Upload new avatar
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
            const filePath = `${editingUser.id}/${fileName}`;

            const { error: uploadError } = await supabase.storage
              .from("avatars")
              .upload(filePath, compressionResult.file, {
                contentType: compressionResult.file.type,
                cacheControl: "3600",
                upsert: true,
              });

            if (uploadError) {
              console.error("Avatar upload error:", uploadError);
              const errorMsg = uploadError.message?.includes(
                "maximum allowed size",
              )
                ? "Avatar upload failed. Image should auto-compress to ~10KB. Please try a different image."
                : `Avatar upload failed: ${uploadError.message}`;
              throw new Error(errorMsg);
            }

            // Get public URL without cache-busting params (will be added in display)
            const { data: urlData } = supabase.storage
              .from("avatars")
              .getPublicUrl(filePath);

            updateData.avatar_url = urlData.publicUrl;
          } catch (avatarError: any) {
            console.error("Avatar upload error:", avatarError);
            toast({
              title: "Warning",
              description:
                avatarError.message ||
                "Avatar upload failed, but user data saved.",
              variant: "default",
            });
          }
        }

        // Update user in database
        const result = await updateUserWithAuth(editingUser.id, updateData, {
          id: userProfile.id,
          role_code: userProfile.role_code,
        });

        if (!result.success)
          throw new Error(result.error || "Failed to update user");

        const hrPayload = buildHrPayload();
        if (Object.keys(hrPayload).length > 0) {
          const hrResult = await updateUserHr(editingUser.id, hrPayload);
          if (!hrResult.success) {
            toast({
              title: "HR Fields Update Failed",
              description: hrResult.error || "Failed to update HR fields",
              variant: "destructive",
            });
          }
        }

        toast({
          title: "Success",
          description: `${userData.full_name} updated successfully`,
        });
        setDialogOpen(false);
        setEditingUser(null);
        await loadUsers();
      } else {
        // CREATE new user
        if (
          !userData.email ||
          !userData.full_name ||
          !userData.role_code ||
          !userData.password
        ) {
          throw new Error("Email, Name, Role, and Password are required");
        }

        const result = await createUserWithAuth({
          email: userData.email,
          password: userData.password,
          full_name: userData.full_name,
          call_name: (userData as any).call_name || undefined,
          role_code: userData.role_code,
          organization_id:
            userData.organization_id || undefined, // Don't auto-assign to admin's org - allow independent users
          phone: userData.phone || undefined,
        });

        if (!result.success) {
          // Provide friendly error messages for common errors
          let errorMessage = result.error || "Failed to create user";

          if (
            errorMessage.toLowerCase().includes("already been registered") ||
            errorMessage.toLowerCase().includes("already exists") ||
            errorMessage.toLowerCase().includes("duplicate")
          ) {
            errorMessage = `The email address "${userData.email}" is already registered in the system. Please use a different email address.`;
          }

          throw new Error(errorMessage);
        }

        const hrPayload = buildHrPayload();
        if (Object.keys(hrPayload).length > 0) {
          const hrResult = await updateUserHr(result.user_id, hrPayload);
          if (!hrResult.success) {
            toast({
              title: "HR Fields Update Failed",
              description: hrResult.error || "Failed to update HR fields",
              variant: "destructive",
            });
          }
        }

        // Handle Bank Details Update (if provided)
        if (
          (userData as any).bank_id ||
          (userData as any).bank_account_number
        ) {
          try {
            const bankResponse = await fetch(
              "/api/organization/update-bank-details",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  organizationId:
                    userData.organization_id || undefined, // Don't default to admin's org for independent users
                  bankId: (userData as any).bank_id,
                  bankAccountNumber: (userData as any).bank_account_number,
                  bankAccountHolderName: (userData as any)
                    .bank_account_holder_name,
                }),
              },
            );

            if (!bankResponse.ok) {
              const errorData = await bankResponse.json();
              throw new Error(
                errorData.error || "Failed to update bank details",
              );
            }
          } catch (bankError: any) {
            console.error("Error updating bank details:", bankError);
            toast({
              title: "Bank Details Update Failed",
              description: bankError.message || "Failed to update bank details",
              variant: "destructive",
            });
          }
        }

        // Upload avatar if provided
        if (avatarFile) {
          try {
            // Compress avatar first
            const compressionResult = await compressAvatar(avatarFile);

            toast({
              title: "🖼️ Avatar Compressed",
              description: `${formatFileSize(compressionResult.originalSize)} → ${formatFileSize(compressionResult.compressedSize)} (${compressionResult.compressionRatio.toFixed(1)}% smaller)`,
            });

            const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
            const filePath = `${result.user_id}/${fileName}`;

            const { error: uploadError } = await supabase.storage
              .from("avatars")
              .upload(filePath, compressionResult.file, {
                contentType: compressionResult.file.type,
                cacheControl: "3600",
                upsert: true,
              });

            if (!uploadError) {
              const { data: urlData } = supabase.storage
                .from("avatars")
                .getPublicUrl(filePath);

              // Store clean URL without cache-busting params
              const { error: updateError } = await (supabase as any)
                .from("users")
                .update({ avatar_url: urlData.publicUrl })
                .eq("id", result.user_id);

              if (updateError) {
                console.error("Avatar URL update error:", updateError);
              }
            } else {
              console.error("Avatar upload error:", uploadError);
              const errorMsg = uploadError.message?.includes(
                "maximum allowed size",
              )
                ? "Avatar upload failed. Image should auto-compress to ~10KB. Please try a different image."
                : `Avatar upload failed: ${uploadError.message}`;
              toast({
                title: "Avatar Upload Warning",
                description: errorMsg,
                variant: "default",
              });
            }
          } catch (avatarError: any) {
            console.error("Avatar upload error:", avatarError);
            toast({
              title: "Avatar Upload Warning",
              description: avatarError.message || "Failed to upload avatar",
              variant: "default",
            });
          }
        }

        console.log("✅ User created successfully, reloading user list...");
        toast({
          title: "Success",
          description: `${userData.full_name} created successfully`,
        });
        setDialogOpen(false);

        // Small delay to ensure database transaction completes
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Force reload users to update the list
        await loadUsers();
        console.log("🔄 User list reloaded after creation");
      }
    } catch (error) {
      console.error("❌ Error saving user:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to save user",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (
    userId: string,
    currentStatus: boolean,
    userName: string,
  ) => {
    try {
      setIsSaving(true);

      const currentUserLevel = resolveCurrentUserLevel();
      const targetUser = users.find(u => u.id === userId);
      // Access nested roles safely
      const targetUserLevel = (targetUser as any)?.roles?.role_level || 999;

      if (targetUserLevel < currentUserLevel) {
        throw new Error("You cannot modify a user with a higher role level than your own.");
      }

      const { error } = await (supabase as any)
        .from("users")
        .update({ is_active: !currentStatus })
        .eq("id", userId);

      if (error) throw error;

      toast({
        title: "Success",
        description: `${userName} ${!currentStatus ? "activated" : "deactivated"} successfully`,
      });

      await loadUsers();
    } catch (error) {
      console.error("Error toggling user status:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to update user status",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // --- OTP-protected deletion state ---
  const [deleteOtpOpen, setDeleteOtpOpen] = useState(false);
  const [deleteOtpStep, setDeleteOtpStep] = useState<'confirm' | 'otp' | 'deleting'>('confirm');
  const [deleteTargetUser, setDeleteTargetUser] = useState<{ id: string; name: string } | null>(null);
  const [deleteOtpCode, setDeleteOtpCode] = useState('');
  const [deleteOtpCodeId, setDeleteOtpCodeId] = useState('');
  const [deleteOtpMaskedPhone, setDeleteOtpMaskedPhone] = useState('');
  const [deleteOtpError, setDeleteOtpError] = useState('');
  const [deleteOtpSending, setDeleteOtpSending] = useState(false);

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!canManageUserDeletion()) {
      toast({ title: "Access Denied", description: "Only HQ Admin or Super Admin can delete users.", variant: "destructive" });
      return;
    }
    if (userId === userProfile.id) {
      toast({ title: "Not Allowed", description: "Cannot delete your own account.", variant: "destructive" });
      return;
    }
    setDeleteTargetUser({ id: userId, name: userName });
    setDeleteOtpStep('confirm');
    setDeleteOtpCode('');
    setDeleteOtpCodeId('');
    setDeleteOtpError('');
    setDeleteOtpOpen(true);
  };

  const handleDeleteOtpRequest = async () => {
    if (!deleteTargetUser) return;
    setDeleteOtpSending(true);
    setDeleteOtpError('');
    try {
      const res = await fetch('/api/admin/delete-user-otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: deleteTargetUser.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP');
      setDeleteOtpCodeId(data.codeId);
      setDeleteOtpMaskedPhone(data.maskedPhone);
      setDeleteOtpStep('otp');
    } catch (err: any) {
      setDeleteOtpError(err.message);
    } finally {
      setDeleteOtpSending(false);
    }
  };

  const handleDeleteOtpVerify = async () => {
    if (!deleteTargetUser || !deleteOtpCode || !deleteOtpCodeId) return;
    setDeleteOtpSending(true);
    setDeleteOtpError('');
    try {
      setDeleteOtpStep('deleting');
      const res = await fetch('/api/admin/delete-user-otp/verify-and-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: deleteTargetUser.id, code: deleteOtpCode, codeId: deleteOtpCodeId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDeleteOtpStep('otp');
        throw new Error(data.error || 'Verification failed');
      }
      toast({ title: "User Deleted", description: data.message || `${deleteTargetUser.name} deleted successfully` });
      setDeleteOtpOpen(false);
      await loadUsers();
    } catch (err: any) {
      setDeleteOtpError(err.message);
    } finally {
      setDeleteOtpSending(false);
    }
  };

  const filteredUsers = useMemo(() => {
    return users
      .filter((user) => {
        // Search filter with phone normalization
        const normalizePhoneForSearch = (p: string) => {
          if (!p) return '';
          // Strip all non-digits for comparison
          return p.replace(/\D/g, '');
        };

        const searchLower = searchQuery.toLowerCase();
        const searchDigits = normalizePhoneForSearch(searchQuery);
        const userPhoneDigits = normalizePhoneForSearch(user.phone || '');

        const matchesSearch =
          user.call_name?.toLowerCase().includes(searchLower) ||
          user.full_name?.toLowerCase().includes(searchLower) ||
          user.email.toLowerCase().includes(searchLower) ||
          user.phone?.includes(searchQuery) ||
          // Also match normalized phone (digits only)
          (searchDigits.length >= 8 && userPhoneDigits.includes(searchDigits));

        // Role filter
        const matchesRole = !roleFilter || user.role_code === roleFilter;

        // Organization filter
        const matchesOrg = !orgFilter || user.organization_id === orgFilter;

        // Organization Type filter
        const userOrg = organizations.find(
          (o) => o.id === user.organization_id,
        );
        const matchesOrgType =
          !orgTypeFilter ||
          (orgTypeFilter === "END_USER" && !user.organization_id) ||
          (userOrg && userOrg.org_type_code === orgTypeFilter);

        // Status filter
        const matchesStatus =
          !statusFilter ||
          (statusFilter === "online" && isUserOnline(getLatestActivityAt(user))) ||
          (statusFilter === "active" && user.is_active) ||
          (statusFilter === "inactive" && !user.is_active) ||
          (statusFilter === "verified" && user.is_verified) ||
          (statusFilter === "unverified" && !user.is_verified) ||
          (statusFilter === "consumer-verified" && hasConsumerLaneConfirmation(user));

        return (
          matchesSearch &&
          matchesRole &&
          matchesOrg &&
          matchesOrgType &&
          matchesStatus
        );
      })
      .sort((a, b) => {
        let aVal: any = a[sortField];
        let bVal: any = b[sortField];

        // Handle null values
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        // Handle different data types
        if (sortField === "created_at") {
          aVal = new Date(aVal).getTime();
          bVal = new Date(bVal).getTime();
        } else if (sortField === "last_login_at") {
          aVal = getLatestActivityAt(a);
          bVal = getLatestActivityAt(b);
          aVal = aVal ? new Date(aVal).getTime() : 0;
          bVal = bVal ? new Date(bVal).getTime() : 0;
        } else if (sortField === "is_active") {
          aVal = aVal ? 1 : 0;
          bVal = bVal ? 1 : 0;
        } else if (sortField === "full_name") {
          aVal = getUserDisplayName(a).toLowerCase();
          bVal = getUserDisplayName(b).toLowerCase();
        } else if (sortField === "role_code") {
          aVal =
            roles.find((r) => r.role_code === a.role_code)?.role_name ||
            a.role_code;
          bVal =
            roles.find((r) => r.role_code === b.role_code)?.role_name ||
            b.role_code;
          aVal = aVal.toLowerCase();
          bVal = bVal.toLowerCase();
        } else if (sortField === "organization_id") {
          aVal =
            organizations.find((o) => o.id === a.organization_id)?.org_name ||
            "";
          bVal =
            organizations.find((o) => o.id === b.organization_id)?.org_name ||
            "";
          aVal = aVal.toLowerCase();
          bVal = bVal.toLowerCase();
        }

        if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
        if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
        return 0;
      });
  }, [
    users,
    searchQuery,
    roleFilter,
    orgFilter,
    orgTypeFilter,
    statusFilter,
    sortField,
    sortDirection,
    organizations,
    roles,
    lastScanMap,
  ]);

  // Pagination calculations - handle "All" option when pageSize is -1
  const effectivePageSize = pageSize === -1 ? filteredUsers.length : pageSize;
  const totalPages = pageSize === -1 ? 1 : Math.ceil(filteredUsers.length / pageSize);
  const startIndex = (currentPage - 1) * effectivePageSize;
  const endIndex = startIndex + effectivePageSize;
  const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    roleFilter,
    orgFilter,
    orgTypeFilter,
    statusFilter,
    pageSize,
  ]);

  const stats = {
    total: filteredUsers.length, // Show filtered count based on active filters
    active: filteredUsers.filter((u) => u.is_active).length,
    verified: filteredUsers.filter((u) => u.is_verified).length,
    online: filteredUsers.filter((u) => isUserOnline(getLatestActivityAt(u))).length,
  };

  const getInitials = (name: string | null): string => {
    if (!name) return "U";
    const parts = name.trim().split(" ");
    if (parts.length >= 2)
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  };

  const getRoleBadgeColor = (roleCode: string): string => {
    const colors: Record<string, string> = {
      SUPER: "bg-purple-100 text-purple-800",
      HQ_ADMIN: "bg-blue-100 text-blue-800",
      MANU_ADMIN: "bg-indigo-100 text-indigo-800",
      DIST_ADMIN: "bg-green-100 text-green-800",
      WH_MANAGER: "bg-orange-100 text-orange-800",
      SHOP_MANAGER: "bg-pink-100 text-pink-800",
      USER: "bg-gray-100 text-gray-800",
    };
    return colors[roleCode] || "bg-gray-100 text-gray-800";
  };

  // Use shared getOrgTypeName from @/lib/utils/orgHierarchy

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-600">
            Manage system users and access permissions
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingUser(null);
            setDialogOpen(true);
          }}
          className="bg-blue-600 hover:bg-blue-700"
          disabled={isSaving}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add User
        </Button>
      </div>

      <UserDialogNew
        user={editingUser}
        roles={roles}
        organizations={organizations}
        open={dialogOpen}
        isSaving={isSaving}
        currentUserRoleLevel={currentUserLevel}
        onOpenChange={setDialogOpen}
        onSave={handleSaveUser}
      />

      <Dialog open={organizationDialogOpen} onOpenChange={(open) => {
        if (!organizationSaving) setOrganizationDialogOpen(open);
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              Organization Master Data
            </DialogTitle>
            <DialogDescription>
              {organizationLoading
                ? "Loading organization details..."
                : canEditSelectedOrganization
                  ? "Super Admin can update this shop organization from User Management."
                  : "View-only. Editing is available only to Super Admin for users attached to a shop organization."}
            </DialogDescription>
          </DialogHeader>

          {organizationLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
            </div>
          ) : selectedOrganization ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Organization Code</label>
                  <Input value={selectedOrganization.org_code || ""} disabled />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Organization Type</label>
                  <Input value={getOrgTypeName(selectedOrganization.org_type_code || "")} disabled />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <Input value={selectedOrganization.is_active === false ? "Inactive" : "Active"} disabled />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Organization Name</label>
                  <Input
                    value={organizationForm.org_name || ""}
                    onChange={(event) => handleOrganizationFieldChange("org_name", event.target.value)}
                    disabled={!canEditSelectedOrganization}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
                  <Input
                    value={organizationForm.branch || ""}
                    onChange={(event) => handleOrganizationFieldChange("branch", event.target.value)}
                    disabled={!canEditSelectedOrganization}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                  <Input
                    value={organizationForm.contact_name || ""}
                    onChange={(event) => handleOrganizationFieldChange("contact_name", event.target.value)}
                    disabled={!canEditSelectedOrganization}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Title</label>
                  <Input
                    value={organizationForm.contact_title || ""}
                    onChange={(event) => handleOrganizationFieldChange("contact_title", event.target.value)}
                    disabled={!canEditSelectedOrganization}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Phone</label>
                  <Input
                    value={organizationForm.contact_phone || ""}
                    onChange={(event) => handleOrganizationFieldChange("contact_phone", event.target.value)}
                    disabled={!canEditSelectedOrganization}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                  <Input
                    value={organizationForm.contact_email || ""}
                    onChange={(event) => handleOrganizationFieldChange("contact_email", event.target.value)}
                    disabled={!canEditSelectedOrganization}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <textarea
                    value={organizationForm.address || ""}
                    onChange={(event) => handleOrganizationFieldChange("address", event.target.value)}
                    disabled={!canEditSelectedOrganization}
                    className="min-h-[84px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label>
                  <textarea
                    value={organizationForm.address_line2 || ""}
                    onChange={(event) => handleOrganizationFieldChange("address_line2", event.target.value)}
                    disabled={!canEditSelectedOrganization}
                    className="min-h-[84px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <Input
                    value={organizationForm.city || ""}
                    onChange={(event) => handleOrganizationFieldChange("city", event.target.value)}
                    disabled={!canEditSelectedOrganization}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Postal Code</label>
                  <Input
                    value={organizationForm.postal_code || ""}
                    onChange={(event) => handleOrganizationFieldChange("postal_code", event.target.value)}
                    disabled={!canEditSelectedOrganization}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Country Code</label>
                  <Input
                    value={organizationForm.country_code || ""}
                    onChange={(event) => handleOrganizationFieldChange("country_code", event.target.value)}
                    disabled={!canEditSelectedOrganization}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                  <Input
                    value={organizationForm.website || ""}
                    onChange={(event) => handleOrganizationFieldChange("website", event.target.value)}
                    disabled={!canEditSelectedOrganization}
                  />
                </div>
              </div>

              {selectedOrganization.org_type_code === "SHOP" && (
                <div className="rounded-lg border p-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Hot Flavour Brands</label>
                    <Input
                      value={organizationForm.hot_flavour_brands || ""}
                      onChange={(event) => handleOrganizationFieldChange("hot_flavour_brands", event.target.value)}
                      disabled={!canEditSelectedOrganization}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <Checkbox
                        checked={Boolean(organizationForm.sells_serapod_flavour)}
                        onCheckedChange={(checked) => handleOrganizationFieldChange("sells_serapod_flavour", checked === true)}
                        disabled={!canEditSelectedOrganization}
                      />
                      Sells Serapod Flavour
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <Checkbox
                        checked={Boolean(organizationForm.sells_sbox)}
                        onCheckedChange={(checked) => handleOrganizationFieldChange("sells_sbox", checked === true)}
                        disabled={!canEditSelectedOrganization}
                      />
                      Sells S.Box
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <Checkbox
                        checked={Boolean(organizationForm.sells_sbox_special_edition)}
                        onCheckedChange={(checked) => handleOrganizationFieldChange("sells_sbox_special_edition", checked === true)}
                        disabled={!canEditSelectedOrganization}
                      />
                      Sells S.Box Special Edition
                    </label>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOrganizationDialogOpen(false)}
              disabled={organizationSaving}
            >
              Close
            </Button>
            {canEditSelectedOrganization && (
              <Button onClick={handleSaveOrganization} disabled={organizationSaving}>
                {organizationSaving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Save Organization
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Users</p>
                <p className="text-3xl font-bold text-gray-900">
                  {stats.total}
                </p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Online Now</p>
                <p className="text-3xl font-bold text-emerald-600">
                  {stats.online}
                </p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-emerald-50 flex items-center justify-center relative">
                <Circle className="w-6 h-6 text-emerald-600 fill-emerald-500" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Active Users</p>
                <p className="text-3xl font-bold text-green-600">
                  {stats.active}
                </p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-green-50 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Verified Users</p>
                <p className="text-3xl font-bold text-purple-600">
                  {stats.verified}
                </p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-purple-50 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Filters Row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Role Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Role
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                onChange={(e) => setRoleFilter(e.target.value)}
                value={roleFilter}
              >
                <option value="">All Roles</option>
                {roles.map((role) => (
                  <option key={role.role_code} value={role.role_code}>
                    {role.role_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Organization Type Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Organization Type
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                onChange={(e) => setOrgTypeFilter(e.target.value)}
                value={orgTypeFilter}
              >
                <option value="">All Types</option>
                {Array.from(
                  new Set(organizations.map((org) => org.org_type_code)),
                )
                  .filter((t): t is string => !!t)
                  .map((typeCode) => (
                    <option key={typeCode} value={typeCode}>
                      {getOrgTypeName(typeCode)}
                    </option>
                  ))}
              </select>
            </div>

            {/* Organization Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Organization
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                onChange={(e) => setOrgFilter(e.target.value)}
                value={orgFilter}
              >
                <option value="">All Organizations</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.org_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Status
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                onChange={(e) => setStatusFilter(e.target.value)}
                value={statusFilter}
              >
                <option value="">All Status</option>
                <option value="online">🟢 Online Now</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="verified">Verified</option>
                <option value="unverified">Unverified</option>
                <option value="consumer-verified">Consumer Verified</option>
              </select>
            </div>
          </div>

          {/* Search Box */}
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-gray-400" />
            <Input
              placeholder="Search users by name, email, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardContent className="pt-6">
          {/* Delete Progress Indicator */}
          {deleteProgress && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {deleteProgress.isDeleting ? (
                    <Loader2 className="w-5 h-5 text-red-600 animate-spin" />
                  ) : (
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  )}
                  <span className="text-sm font-medium text-red-900">
                    {deleteProgress.message}
                  </span>
                </div>
                <span className="text-sm text-red-700">
                  {deleteProgress.current} / {deleteProgress.total}
                </span>
              </div>
              <Progress value={deleteProgress.progress} className="h-2" />
              <div className="flex justify-between text-xs text-red-600">
                <span>
                  ✓ {deleteProgress.success} success
                </span>
                {deleteProgress.errors > 0 && (
                  <span>
                    ✗ {deleteProgress.errors} errors
                  </span>
                )}
              </div>
            </div>
          )}

          {selectedUsers.size > 0 && !deleteProgress && (
            <div className="mb-4 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium text-blue-900">
                  {selectedUsers.size} user{selectedUsers.size > 1 ? "s" : ""}{" "}
                  selected
                </span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={isSaving}
                className="gap-2"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                {canManageUserDeletion()
                  ? selectedUsers.size === 1
                    ? "Delete Selected User (OTP)"
                    : "Delete One User at a Time"
                  : `Delete ${selectedUsers.size} User${selectedUsers.size > 1 ? "s" : ""}`}
              </Button>
            </div>
          )}
          {filteredUsers.length > 0 ? (
            <>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={
                            filteredUsers.filter((u) => u.id !== userProfile.id)
                              .length > 0 &&
                            filteredUsers
                              .filter((u) => u.id !== userProfile.id)
                              .every((u) => selectedUsers.has(u.id))
                          }
                          onCheckedChange={handleSelectAll}
                          disabled={
                            filteredUsers.filter((u) => u.id !== userProfile.id)
                              .length === 0
                          }
                        />
                      </TableHead>
                      <TableHead className="w-12 text-center">#</TableHead>
                      <TableHead>
                        <button
                          onClick={() => handleSort("full_name")}
                          className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium"
                        >
                          User
                          {sortField === "full_name" ? (
                            sortDirection === "asc" ? (
                              <ArrowUp className="w-4 h-4" />
                            ) : (
                              <ArrowDown className="w-4 h-4" />
                            )
                          ) : (
                            <ArrowUpDown className="w-4 h-4 opacity-30" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          onClick={() => handleSort("role_code")}
                          className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium"
                        >
                          Role
                          {sortField === "role_code" ? (
                            sortDirection === "asc" ? (
                              <ArrowUp className="w-4 h-4" />
                            ) : (
                              <ArrowDown className="w-4 h-4" />
                            )
                          ) : (
                            <ArrowUpDown className="w-4 h-4 opacity-30" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          onClick={() => handleSort("organization_id")}
                          className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium"
                        >
                          Organization
                          {sortField === "organization_id" ? (
                            sortDirection === "asc" ? (
                              <ArrowUp className="w-4 h-4" />
                            ) : (
                              <ArrowDown className="w-4 h-4" />
                            )
                          ) : (
                            <ArrowUpDown className="w-4 h-4 opacity-30" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          onClick={() => handleSort("referral_phone")}
                          className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium"
                        >
                          Reference
                          {sortField === "referral_phone" ? (
                            sortDirection === "asc" ? (
                              <ArrowUp className="w-4 h-4" />
                            ) : (
                              <ArrowDown className="w-4 h-4" />
                            )
                          ) : (
                            <ArrowUpDown className="w-4 h-4 opacity-30" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          onClick={() => handleSort("last_login_at")}
                          className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium"
                        >
                          Last Activity
                          {sortField === "last_login_at" ? (
                            sortDirection === "asc" ? (
                              <ArrowUp className="w-4 h-4" />
                            ) : (
                              <ArrowDown className="w-4 h-4" />
                            )
                          ) : (
                            <ArrowUpDown className="w-4 h-4 opacity-30" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedUsers.map((user, index) => (
                      <TableRow key={user.id} className="hover:bg-gray-50">
                        <TableCell>
                          <Checkbox
                            checked={selectedUsers.has(user.id)}
                            onCheckedChange={(checked) =>
                              handleSelectUser(user.id, checked as boolean)
                            }
                            disabled={user.id === userProfile.id}
                          />
                        </TableCell>
                        <TableCell className="text-center text-gray-500 text-sm">
                          {startIndex + index + 1}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <Avatar className="w-10 h-10">
                                {user.avatar_url && (
                                  <AvatarImage
                                    src={
                                      getStorageUrl(
                                        `${user.avatar_url.split("?")[0]}?t=${new Date(user.updated_at).getTime()}`,
                                      ) || user.avatar_url
                                    }
                                    alt={getUserDisplayName(user)}
                                    key={`avatar-${user.id}-${user.updated_at}`}
                                  />
                                )}
                                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white text-xs font-medium">
                                  {getInitials(getUserDisplayName(user))}
                                </AvatarFallback>
                              </Avatar>
                              {/* Online status indicator */}
                              {isUserOnline(getLatestActivityAt(user)) && (
                                <span
                                  className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"
                                  title="Online now"
                                />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <button
                                onClick={() => {
                                  setEditingUser(user);
                                  setDialogOpen(true);
                                }}
                                className="text-gray-900 truncate font-medium hover:text-blue-600 hover:underline transition-colors text-left block max-w-full"
                                title="Click to edit user"
                              >
                                {getUserDisplayName(user)}
                              </button>
                              {user.phone && (
                                <div className="text-xs text-gray-500 truncate">
                                  {user.phone}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={getRoleBadgeColor(user.role_code)}
                          >
                            {roles.find((r) => r.role_code === user.role_code)
                              ?.role_name || user.role_code}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            {(() => {
                              const org = organizations.find(o => o.id === user.organization_id);
                              if (!org) return <span className="text-gray-400 italic">End User</span>;
                              if (org.org_type_code === 'SHOP') {
                                return (
                                  <div>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenOrganizationDialog(user, org)}
                                      className="text-left text-gray-900 font-medium hover:text-blue-600 hover:underline"
                                      title="View organization master data"
                                    >
                                      {org.org_name}
                                    </button>
                                    {org.branch && <span className="text-gray-500 text-xs ml-1">({org.branch})</span>}
                                  </div>
                                );
                              }
                              return (
                                <button
                                  type="button"
                                  onClick={() => handleOpenOrganizationDialog(user, org)}
                                  className="text-left text-gray-900 hover:text-blue-600 hover:underline"
                                  title="View organization master data"
                                >
                                  {getOrgTypeName(org.org_type_code || "")}
                                </button>
                              );
                            })()}
                          </div>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            if (!user.referral_phone) {
                              return <span className="text-gray-900">-</span>;
                            }

                            const referenceUser = users.find((candidate) => {
                              if (!candidate.phone || candidate.id === user.id) return false;
                              return samePhone(candidate.phone, user.referral_phone);
                            });

                            if (!referenceUser) {
                              return <span className="text-gray-900">{user.referral_phone}</span>;
                            }

                            return (
                              <div className="min-w-0">
                                <div className="text-gray-900 font-medium truncate">
                                  {getUserDisplayName(referenceUser)}
                                </div>
                                <div className="text-xs text-gray-500 truncate">
                                  {referenceUser.phone || user.referral_phone}
                                </div>
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {isUserOnline(getLatestActivityAt(user)) && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1 animate-pulse" />
                                Online
                              </span>
                            )}
                            <span
                              className={
                                getLatestActivityAt(user)
                                  ? "text-gray-900"
                                  : "text-gray-400 italic"
                              }
                              title={formatDateTime(getLatestActivityAt(user))}
                            >
                              {formatRelativeTime(getLatestActivityAt(user))}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <TooltipProvider delayDuration={150}>
                            <div className="flex items-center justify-end gap-1">
                              {hasConsumerLaneConfirmation(user) && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-600">
                                      <Shield className="w-4 h-4" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Consumer lane confirmed on {formatDateTime(user.consumer_claim_confirmed_at)}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  handleToggleActive(
                                    user.id,
                                    user.is_active,
                                    user.full_name || user.email,
                                  )
                                }
                                disabled={isSaving || user.id === userProfile.id}
                                className={
                                  user.is_active
                                    ? "text-green-600 hover:text-green-700 hover:bg-green-50"
                                    : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                                }
                                title={
                                  user.id === userProfile.id
                                    ? "Cannot deactivate yourself"
                                    : user.is_active
                                      ? "Deactivate user"
                                      : "Activate user"
                                }
                              >
                                <Power className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingUser(user);
                                  setDialogOpen(true);
                                }}
                                disabled={isSaving}
                                className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                title="Edit user"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              {canManageUserDeletion() && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleDeleteUser(
                                      user.id,
                                      user.full_name || user.email,
                                    )
                                  }
                                  disabled={isSaving || user.id === userProfile.id}
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  title={
                                    user.id === userProfile.id
                                      ? "Cannot delete yourself"
                                      : "Delete user (OTP required)"
                                  }
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TooltipProvider>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-4 px-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Rows per page:</span>
                  <select
                    className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size === -1 ? "All" : size}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-600">
                    Showing {startIndex + 1} to{" "}
                    {Math.min(endIndex, filteredUsers.length)} of{" "}
                    {filteredUsers.length} users
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1 || pageSize === -1}
                      className="hidden sm:flex"
                    >
                      First
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((prev) => Math.max(1, prev - 1))
                      }
                      disabled={currentPage === 1 || pageSize === -1}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="px-3 py-1 text-sm font-medium">
                      {pageSize === -1 ? "All" : `Page ${currentPage} of ${totalPages || 1}`}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                      }
                      disabled={currentPage >= totalPages || pageSize === -1}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage >= totalPages || pageSize === -1}
                      className="hidden sm:flex"
                    >
                      Last
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No users found
              </h3>
              <p className="text-gray-600">
                {searchQuery
                  ? "No users match your search"
                  : "Start by adding your first user"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* OTP-Protected Delete User Dialog */}
      <Dialog open={deleteOtpOpen} onOpenChange={(open) => { if (!deleteOtpSending) { setDeleteOtpOpen(open); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" />
              {deleteOtpStep === 'confirm' ? 'Delete User' : deleteOtpStep === 'otp' ? 'Enter Verification Code' : 'Deleting User...'}
            </DialogTitle>
            <DialogDescription>
              {deleteOtpStep === 'confirm' && (
                <>This will permanently delete <strong>{deleteTargetUser?.name}</strong> and all related data. A WhatsApp verification code will be sent to the organization&apos;s registered phone.</>
              )}
              {deleteOtpStep === 'otp' && (
                <>A 4-digit code was sent to <strong>{deleteOtpMaskedPhone}</strong>. Enter it below to confirm deletion.</>
              )}
              {deleteOtpStep === 'deleting' && 'Please wait while the user is being deleted...'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {deleteOtpStep === 'confirm' && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <Shield className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-red-800">
                    <p className="font-medium mb-1">This action cannot be undone.</p>
                    <ul className="list-disc ml-4 space-y-0.5 text-xs">
                      <li>User will be removed from database & auth</li>
                      <li>All audit logs, points, and activations will be deleted</li>
                      <li>QR scan records will be anonymized</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {deleteOtpStep === 'otp' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Verification Code</label>
                  <Input
                    type="text"
                    maxLength={4}
                    value={deleteOtpCode}
                    onChange={(e) => setDeleteOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="0000"
                    className="text-center text-2xl tracking-widest font-mono h-12"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-gray-500 text-center">Code expires in 5 minutes</p>
              </div>
            )}

            {deleteOtpStep === 'deleting' && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-8 h-8 animate-spin text-red-600" />
              </div>
            )}

            {deleteOtpError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600 text-center">{deleteOtpError}</p>
              </div>
            )}
          </div>

          <DialogFooter className="flex gap-2 sm:gap-2">
            {deleteOtpStep !== 'deleting' && (
              <Button variant="outline" onClick={() => setDeleteOtpOpen(false)} disabled={deleteOtpSending}>
                Cancel
              </Button>
            )}
            {deleteOtpStep === 'confirm' && (
              <Button
                variant="destructive"
                onClick={handleDeleteOtpRequest}
                disabled={deleteOtpSending}
              >
                {deleteOtpSending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</> : 'Send Verification Code'}
              </Button>
            )}
            {deleteOtpStep === 'otp' && (
              <Button
                variant="destructive"
                onClick={handleDeleteOtpVerify}
                disabled={deleteOtpSending || deleteOtpCode.length !== 4}
              >
                {deleteOtpSending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying...</> : 'Verify & Delete'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
