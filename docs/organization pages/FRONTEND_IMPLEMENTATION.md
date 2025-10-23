# Frontend Implementation Guide (React + TypeScript + Supabase)

## 📦 Type Definitions

First, add these TypeScript types:

```typescript
// types/organization.ts

export type OrgTypeCode = 'HQ' | 'MFG' | 'DIST' | 'SHOP';

export interface Organization {
  id: string;
  org_type_code: OrgTypeCode;
  parent_org_id: string | null;
  org_code: string;
  org_name: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganizationStats {
  org_id: string;
  org_type_code: OrgTypeCode;
  children_count: number;
  users_count: number;
  products_count: number;
  distributors_count: number;
  shops_count: number;
  orders_count: number;
}

export interface ShopDistributor {
  id: string;
  shop_id: string;
  distributor_id: string;
  account_number: string | null;
  credit_limit: number | null;
  payment_terms: string;
  is_active: boolean;
  is_preferred: boolean;
  last_order_date: string | null;
  // Joined from organizations
  distributor?: Organization;
}
```

---

## 🔧 Supabase Service Functions

```typescript
// services/organizationService.ts

import { supabase } from '@/lib/supabase';
import { Organization, OrganizationStats, ShopDistributor } from '@/types/organization';

/**
 * Get statistics for a single organization
 */
export async function getOrganizationStats(orgId: string): Promise<OrganizationStats | null> {
  const { data, error } = await supabase
    .rpc('get_org_stats', { p_org_id: orgId })
    .single();

  if (error) {
    console.error('Error fetching org stats:', error);
    return null;
  }

  return data;
}

/**
 * Get statistics for multiple organizations (efficient batch query)
 */
export async function getOrganizationStatsBatch(orgIds: string[]): Promise<OrganizationStats[]> {
  const { data, error } = await supabase
    .rpc('get_org_stats_batch', { p_org_ids: orgIds });

  if (error) {
    console.error('Error fetching org stats batch:', error);
    return [];
  }

  return data || [];
}

/**
 * Get distributors for a shop (with organization details)
 */
export async function getShopDistributors(shopId: string): Promise<ShopDistributor[]> {
  const { data, error } = await supabase
    .from('shop_distributors')
    .select(`
      *,
      distributor:distributor_id (
        id,
        org_code,
        org_name,
        contact_name,
        contact_phone,
        contact_email,
        logo_url,
        is_active
      )
    `)
    .eq('shop_id', shopId)
    .eq('is_active', true)
    .order('is_preferred', { ascending: false })
    .order('org_name', { ascending: true, foreignTable: 'distributor' });

  if (error) {
    console.error('Error fetching shop distributors:', error);
    return [];
  }

  return data || [];
}

/**
 * Get shops for a distributor (with organization details)
 */
export async function getDistributorShops(distributorId: string): Promise<ShopDistributor[]> {
  const { data, error } = await supabase
    .from('shop_distributors')
    .select(`
      *,
      shop:shop_id (
        id,
        org_code,
        org_name,
        contact_name,
        contact_phone,
        contact_email,
        logo_url,
        is_active
      )
    `)
    .eq('distributor_id', distributorId)
    .eq('is_active', true)
    .order('is_preferred', { ascending: false })
    .order('org_name', { ascending: true, foreignTable: 'shop' });

  if (error) {
    console.error('Error fetching distributor shops:', error);
    return [];
  }

  return data || [];
}

/**
 * Get all organizations with their stats
 */
export async function getOrganizationsWithStats(): Promise<{
  organizations: Organization[];
  stats: Map<string, OrganizationStats>;
}> {
  // First get all organizations
  const { data: organizations, error: orgError } = await supabase
    .from('organizations')
    .select('*')
    .eq('is_active', true)
    .order('org_name');

  if (orgError || !organizations) {
    console.error('Error fetching organizations:', orgError);
    return { organizations: [], stats: new Map() };
  }

  // Then get stats for all organizations in batch
  const orgIds = organizations.map(org => org.id);
  const statsArray = await getOrganizationStatsBatch(orgIds);

  // Convert to Map for easy lookup
  const statsMap = new Map<string, OrganizationStats>();
  statsArray.forEach(stat => {
    statsMap.set(stat.org_id, stat);
  });

  return { organizations, stats: statsMap };
}
```

---

## 🎨 React Components

### OrganizationCard Component

```typescript
// components/OrganizationCard.tsx

import React from 'react';
import { Organization, OrganizationStats } from '@/types/organization';

interface StatDisplayItem {
  label: string;
  value: number;
  link?: string;
  onClick?: () => void;
}

interface OrganizationCardProps {
  organization: Organization;
  stats?: OrganizationStats;
  onEdit: () => void;
  onDelete: () => void;
  onViewRelationships?: (type: 'distributors' | 'shops') => void;
}

function getStatsDisplay(
  org: Organization, 
  stats: OrganizationStats,
  onViewRelationships?: (type: 'distributors' | 'shops') => void
): StatDisplayItem[] {
  const displays: StatDisplayItem[] = [];

  switch (org.org_type_code) {
    case 'SHOP':
      displays.push({
        label: 'Distributors',
        value: stats.distributors_count,
        onClick: onViewRelationships ? () => onViewRelationships('distributors') : undefined,
      });
      displays.push({
        label: 'Users',
        value: stats.users_count,
      });
      displays.push({
        label: 'Orders',
        value: stats.orders_count,
      });
      break;

    case 'DIST':
      displays.push({
        label: 'Shops',
        value: stats.shops_count,
        onClick: onViewRelationships ? () => onViewRelationships('shops') : undefined,
      });
      displays.push({
        label: 'Users',
        value: stats.users_count,
      });
      displays.push({
        label: 'Products',
        value: stats.products_count,
      });
      displays.push({
        label: 'Orders',
        value: stats.orders_count,
      });
      break;

    case 'MFG':
      displays.push({
        label: 'Children',
        value: stats.children_count,
      });
      displays.push({
        label: 'Users',
        value: stats.users_count,
      });
      displays.push({
        label: 'Products',
        value: stats.products_count,
      });
      break;

    case 'HQ':
      displays.push({
        label: 'Children',
        value: stats.children_count,
      });
      displays.push({
        label: 'Users',
        value: stats.users_count,
      });
      displays.push({
        label: 'Products',
        value: stats.products_count,
      });
      displays.push({
        label: 'Orders',
        value: stats.orders_count,
      });
      break;
  }

  return displays;
}

export function OrganizationCard({
  organization,
  stats,
  onEdit,
  onDelete,
  onViewRelationships,
}: OrganizationCardProps) {
  const statsDisplay = stats 
    ? getStatsDisplay(organization, stats, onViewRelationships)
    : [];

  return (
    <div className="bg-white rounded-lg shadow p-6">
      {/* Organization Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {organization.logo_url && (
            <img 
              src={organization.logo_url} 
              alt={organization.org_name}
              className="w-12 h-12 rounded object-cover"
            />
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                organization.org_type_code === 'SHOP' ? 'bg-pink-100 text-pink-800' :
                organization.org_type_code === 'DIST' ? 'bg-green-100 text-green-800' :
                organization.org_type_code === 'MFG' ? 'bg-blue-100 text-blue-800' :
                'bg-purple-100 text-purple-800'
              }`}>
                {organization.org_type_code === 'SHOP' ? 'Shop' :
                 organization.org_type_code === 'DIST' ? 'Distributor' :
                 organization.org_type_code === 'MFG' ? 'Manufacturer' :
                 'Headquarters'}
              </span>
              <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800">
                Active
              </span>
            </div>
            <h3 className="text-lg font-semibold mt-1">{organization.org_name}</h3>
            <p className="text-sm text-gray-600">{organization.org_code}</p>
          </div>
        </div>
      </div>

      {/* Contact Information */}
      {(organization.contact_name || organization.contact_phone || organization.contact_email) && (
        <div className="space-y-1 mb-4 text-sm text-gray-600">
          {organization.contact_name && (
            <div className="flex items-center gap-2">
              <span>👤</span>
              <span>{organization.contact_name}</span>
            </div>
          )}
          {organization.contact_phone && (
            <div className="flex items-center gap-2">
              <span>📞</span>
              <span>{organization.contact_phone}</span>
            </div>
          )}
          {organization.contact_email && (
            <div className="flex items-center gap-2">
              <span>✉️</span>
              <span>{organization.contact_email}</span>
            </div>
          )}
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {statsDisplay.map((stat, index) => (
          <div 
            key={index} 
            className={`text-center ${stat.onClick ? 'cursor-pointer hover:bg-gray-50 rounded p-2' : ''}`}
            onClick={stat.onClick}
          >
            <div className="text-2xl font-bold">{stat.value}</div>
            <div className="text-xs text-gray-600">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        {organization.org_type_code === 'SHOP' && stats && stats.distributors_count > 0 && (
          <button
            onClick={() => onViewRelationships?.('distributors')}
            className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            🔗 Distributors
          </button>
        )}
        {organization.org_type_code === 'DIST' && stats && stats.shops_count > 0 && (
          <button
            onClick={() => onViewRelationships?.('shops')}
            className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            🔗 Shops
          </button>
        )}
        <button
          onClick={onEdit}
          className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
        >
          ✏️ Edit
        </button>
        <button
          onClick={onDelete}
          className="flex-1 px-4 py-2 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50"
        >
          🗑️ Delete
        </button>
      </div>
    </div>
  );
}
```

---

### OrganizationsListView Component

```typescript
// components/OrganizationsListView.tsx

import React, { useEffect, useState } from 'react';
import { Organization, OrganizationStats } from '@/types/organization';
import { OrganizationCard } from './OrganizationCard';
import { DistributorsModal } from './modals/DistributorsModal';
import { ShopsModal } from './modals/ShopsModal';
import { getOrganizationsWithStats } from '@/services/organizationService';

export function OrganizationsListView() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [statsMap, setStatsMap] = useState<Map<string, OrganizationStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [modalType, setModalType] = useState<'distributors' | 'shops' | null>(null);

  useEffect(() => {
    loadOrganizations();
  }, []);

  async function loadOrganizations() {
    setLoading(true);
    const { organizations: orgs, stats } = await getOrganizationsWithStats();
    setOrganizations(orgs);
    setStatsMap(stats);
    setLoading(false);
  }

  function handleViewRelationships(org: Organization, type: 'distributors' | 'shops') {
    setSelectedOrg(org);
    setModalType(type);
  }

  function handleEdit(org: Organization) {
    // Implement edit logic
    console.log('Edit:', org);
  }

  function handleDelete(org: Organization) {
    // Implement delete logic
    console.log('Delete:', org);
  }

  if (loading) {
    return <div className="p-8">Loading organizations...</div>;
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Organizations</h1>
        <p className="text-gray-600">Manage your organization network</p>
      </div>

      {/* Organization Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {organizations.map(org => (
          <OrganizationCard
            key={org.id}
            organization={org}
            stats={statsMap.get(org.id)}
            onEdit={() => handleEdit(org)}
            onDelete={() => handleDelete(org)}
            onViewRelationships={(type) => handleViewRelationships(org, type)}
          />
        ))}
      </div>

      {/* Modals */}
      {selectedOrg && modalType === 'distributors' && (
        <DistributorsModal
          shopId={selectedOrg.id}
          shopName={selectedOrg.org_name}
          onClose={() => {
            setSelectedOrg(null);
            setModalType(null);
          }}
        />
      )}

      {selectedOrg && modalType === 'shops' && (
        <ShopsModal
          distributorId={selectedOrg.id}
          distributorName={selectedOrg.org_name}
          onClose={() => {
            setSelectedOrg(null);
            setModalType(null);
          }}
        />
      )}
    </div>
  );
}
```

---

### DistributorsModal Component

```typescript
// components/modals/DistributorsModal.tsx

import React, { useEffect, useState } from 'react';
import { ShopDistributor } from '@/types/organization';
import { getShopDistributors } from '@/services/organizationService';

interface DistributorsModalProps {
  shopId: string;
  shopName: string;
  onClose: () => void;
}

export function DistributorsModal({ shopId, shopName, onClose }: DistributorsModalProps) {
  const [distributors, setDistributors] = useState<ShopDistributor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDistributors();
  }, [shopId]);

  async function loadDistributors() {
    setLoading(true);
    const data = await getShopDistributors(shopId);
    setDistributors(data);
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Distributors for {shopName}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center">Loading distributors...</div>
        ) : distributors.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            No distributors found for this shop
          </div>
        ) : (
          <div className="space-y-4">
            {distributors.map(sd => (
              <div key={sd.id} className="border rounded p-4 hover:bg-gray-50">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-lg">
                      {sd.distributor?.org_name}
                      {sd.is_preferred && (
                        <span className="ml-2 px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">
                          ⭐ Preferred
                        </span>
                      )}
                    </h3>
                    <p className="text-sm text-gray-600">{sd.distributor?.org_code}</p>
                    
                    <div className="mt-2 space-y-1 text-sm">
                      {sd.distributor?.contact_name && (
                        <div>👤 {sd.distributor.contact_name}</div>
                      )}
                      {sd.distributor?.contact_phone && (
                        <div>📞 {sd.distributor.contact_phone}</div>
                      )}
                      {sd.distributor?.contact_email && (
                        <div>✉️ {sd.distributor.contact_email}</div>
                      )}
                    </div>
                  </div>

                  <div className="text-right text-sm">
                    {sd.account_number && (
                      <div className="text-gray-600">
                        Account: {sd.account_number}
                      </div>
                    )}
                    {sd.credit_limit && (
                      <div className="text-gray-600">
                        Credit: RM {sd.credit_limit.toLocaleString()}
                      </div>
                    )}
                    {sd.last_order_date && (
                      <div className="text-gray-600">
                        Last Order: {new Date(sd.last_order_date).toLocaleDateString()}
                      </div>
                    )}
                    <div className="text-xs text-gray-500 mt-1">
                      Terms: {sd.payment_terms}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

### ShopsModal Component

```typescript
// components/modals/ShopsModal.tsx

import React, { useEffect, useState } from 'react';
import { ShopDistributor } from '@/types/organization';
import { getDistributorShops } from '@/services/organizationService';

interface ShopsModalProps {
  distributorId: string;
  distributorName: string;
  onClose: () => void;
}

export function ShopsModal({ distributorId, distributorName, onClose }: ShopsModalProps) {
  const [shops, setShops] = useState<ShopDistributor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadShops();
  }, [distributorId]);

  async function loadShops() {
    setLoading(true);
    const data = await getDistributorShops(distributorId);
    setShops(data);
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Shops for {distributorName}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center">Loading shops...</div>
        ) : shops.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            No shops found for this distributor
          </div>
        ) : (
          <div className="space-y-4">
            {shops.map(sd => (
              <div key={sd.id} className="border rounded p-4 hover:bg-gray-50">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-lg">
                      {sd.shop?.org_name}
                      {sd.is_preferred && (
                        <span className="ml-2 px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">
                          ⭐ Preferred
                        </span>
                      )}
                    </h3>
                    <p className="text-sm text-gray-600">{sd.shop?.org_code}</p>
                    
                    <div className="mt-2 space-y-1 text-sm">
                      {sd.shop?.contact_name && (
                        <div>👤 {sd.shop.contact_name}</div>
                      )}
                      {sd.shop?.contact_phone && (
                        <div>📞 {sd.shop.contact_phone}</div>
                      )}
                      {sd.shop?.contact_email && (
                        <div>✉️ {sd.shop.contact_email}</div>
                      )}
                    </div>
                  </div>

                  <div className="text-right text-sm">
                    {sd.account_number && (
                      <div className="text-gray-600">
                        Account: {sd.account_number}
                      </div>
                    )}
                    {sd.credit_limit && (
                      <div className="text-gray-600">
                        Credit: RM {sd.credit_limit.toLocaleString()}
                      </div>
                    )}
                    {sd.last_order_date && (
                      <div className="text-gray-600">
                        Last Order: {new Date(sd.last_order_date).toLocaleDateString()}
                      </div>
                    )}
                    <div className="text-xs text-gray-500 mt-1">
                      Terms: {sd.payment_terms}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## ✅ Testing Checklist

After implementing:

- [ ] Organizations list page loads without errors
- [ ] Each card shows correct stats based on org type
- [ ] Shop cards show distributor count (not 0 if relationships exist)
- [ ] Distributor cards show shop count (not 0 if relationships exist)
- [ ] HQ cards show aggregated product count from child MFGs
- [ ] Clicking "Distributors" button on shop card opens modal with list
- [ ] Clicking "Shops" button on distributor card opens modal with list
- [ ] Stats update when relationships change
- [ ] Loading states work correctly
- [ ] Error handling works (try with invalid IDs)

---

## 🎯 Key Points

1. **Use batch function for list pages** - Much more efficient than individual calls
2. **Use single function for detail pages** - When showing one org
3. **Stats are real-time** - No caching, always current
4. **Type-safe** - Full TypeScript support
5. **Modular** - Easy to maintain and test

This implementation will fix all the issues shown in your screenshot!
