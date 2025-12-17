'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Package } from 'lucide-react'
import CategoriesTab from './tabs/CategoriesTab'
import BrandsTab from './tabs/BrandsTab'
import GroupsTab from './tabs/GroupsTab'
import SubGroupsTab from './tabs/SubGroupsTab'
import VariantsTab from './tabs/VariantsTab'
import CreateProductTab from './tabs/CreateProductTab'

interface ProductManagementProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

export default function ProductManagement({ userProfile, onViewChange }: ProductManagementProps) {
  const [activeTab, setActiveTab] = useState('categories')
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onViewChange?.('products')}
            className="h-9 w-9 sm:h-8 sm:w-8 p-0 rounded-full border border-gray-200 shadow-sm"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-gray-900 sm:text-xl">Product Management</h1>
            <p className="text-xs text-gray-600 sm:text-sm">
              Manage categories, brands, groups, variants, and create products
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 sm:h-12 sm:w-12">
            <Package className="h-5 w-5 text-blue-600 sm:h-6 sm:w-6" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Card>
        <CardContent className="p-4 sm:p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 gap-2 rounded-2xl bg-transparent p-0 sm:grid-cols-6 sm:gap-3 mb-6">
              <TabsTrigger
                value="categories"
                className="rounded-xl border border-gray-200 px-3 py-2 text-[11px] font-medium text-gray-600 shadow-sm transition data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white sm:text-sm"
              >
                Categories
              </TabsTrigger>
              <TabsTrigger
                value="brands"
                className="rounded-xl border border-gray-200 px-3 py-2 text-[11px] font-medium text-gray-600 shadow-sm transition data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white sm:text-sm"
              >
                Brands
              </TabsTrigger>
              <TabsTrigger
                value="groups"
                className="rounded-xl border border-gray-200 px-3 py-2 text-[11px] font-medium text-gray-600 shadow-sm transition data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white sm:text-sm"
              >
                Groups
              </TabsTrigger>
              <TabsTrigger
                value="subgroups"
                className="rounded-xl border border-gray-200 px-3 py-2 text-[11px] font-medium text-gray-600 shadow-sm transition data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white sm:text-sm"
              >
                Sub-Groups
              </TabsTrigger>
              <TabsTrigger
                value="variants"
                className="rounded-xl border border-gray-200 px-3 py-2 text-[11px] font-medium text-gray-600 shadow-sm transition data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white sm:text-sm"
              >
                Variants
              </TabsTrigger>
              <TabsTrigger
                value="create-product"
                className="rounded-xl border border-gray-200 px-3 py-2 text-[11px] font-medium text-gray-600 shadow-sm transition data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white sm:text-sm"
              >
                New Product
              </TabsTrigger>
            </TabsList>

            {/* Tab Contents */}
            <TabsContent value="categories" className="space-y-4">
              <CategoriesTab
                userProfile={userProfile}
                onRefresh={handleRefresh}
                refreshTrigger={refreshTrigger}
              />
            </TabsContent>

            <TabsContent value="brands" className="space-y-4">
              <BrandsTab
                userProfile={userProfile}
                onRefresh={handleRefresh}
                refreshTrigger={refreshTrigger}
              />
            </TabsContent>

            <TabsContent value="groups" className="space-y-4">
              <GroupsTab
                userProfile={userProfile}
                onRefresh={handleRefresh}
                refreshTrigger={refreshTrigger}
              />
            </TabsContent>

            <TabsContent value="subgroups" className="space-y-4">
              <SubGroupsTab
                userProfile={userProfile}
                onRefresh={handleRefresh}
                refreshTrigger={refreshTrigger}
              />
            </TabsContent>

            <TabsContent value="variants" className="space-y-4">
              <VariantsTab
                userProfile={userProfile}
                onRefresh={handleRefresh}
                refreshTrigger={refreshTrigger}
              />
            </TabsContent>

            <TabsContent value="create-product" className="space-y-4">
              <CreateProductTab
                userProfile={userProfile}
                onViewChange={onViewChange}
                onRefresh={handleRefresh}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
