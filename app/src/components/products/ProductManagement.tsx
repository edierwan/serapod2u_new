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
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onViewChange?.('products')}
              className="h-8 w-8 p-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Product Management</h1>
              <p className="text-gray-600">Manage categories, brands, groups, variants, and create products</p>
            </div>
          </div>
        </div>
        <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center">
          <Package className="w-6 h-6 text-blue-600" />
        </div>
      </div>

      {/* Tabs */}
      <Card>
        <CardContent className="p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-6 lg:grid-cols-6 mb-6">
              <TabsTrigger value="categories" className="text-xs sm:text-sm">
                Categories
              </TabsTrigger>
              <TabsTrigger value="brands" className="text-xs sm:text-sm">
                Brands
              </TabsTrigger>
              <TabsTrigger value="groups" className="text-xs sm:text-sm">
                Groups
              </TabsTrigger>
              <TabsTrigger value="subgroups" className="text-xs sm:text-sm">
                Sub-Groups
              </TabsTrigger>
              <TabsTrigger value="variants" className="text-xs sm:text-sm">
                Variants
              </TabsTrigger>
              <TabsTrigger value="create-product" className="text-xs sm:text-sm">
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
