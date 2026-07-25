'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import SupplyChainPageHeader from '@/modules/supply-chain/components/SupplyChainPageHeader'
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

const TAB_TRIGGER_CLASS =
  'h-auto min-h-9 w-full whitespace-normal rounded-xl border border-[var(--sera-line)] px-2.5 py-2 text-[11px] font-medium leading-tight text-[var(--sera-muted)] transition data-[state=active]:border-[var(--sera-orange)] data-[state=active]:bg-[var(--sera-orange)] data-[state=active]:text-white sm:px-3 sm:text-sm'

export default function ProductManagement({ userProfile, onViewChange }: ProductManagementProps) {
  const [activeTab, setActiveTab] = useState('categories')
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1)
  }

  return (
    <div className="sera-sc-page space-y-6">
      <div className="flex items-start gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onViewChange?.('products')}
          className="shrink-0 mt-1 border border-transparent hover:border-[var(--sera-line)]"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <SupplyChainPageHeader
          eyebrow="Products"
          title="Product Management"
          description="Manage categories, brands, groups, variants, and create products"
        />
      </div>

      <Card className="sera-sc-panel overflow-hidden shadow-none">
        <CardContent className="p-4 sm:p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            {/* !h-auto overrides shadcn TabsList h-10 so multi-row grid never overlaps content */}
            <TabsList className="mb-6 grid !h-auto w-full grid-cols-2 gap-2 rounded-2xl bg-transparent p-0 sm:grid-cols-3 lg:grid-cols-6 sm:gap-3">
              <TabsTrigger value="categories" className={TAB_TRIGGER_CLASS}>Categories</TabsTrigger>
              <TabsTrigger value="brands" className={TAB_TRIGGER_CLASS}>Brands</TabsTrigger>
              <TabsTrigger value="groups" className={TAB_TRIGGER_CLASS}>Groups</TabsTrigger>
              <TabsTrigger value="subgroups" className={TAB_TRIGGER_CLASS}>Sub-Groups</TabsTrigger>
              <TabsTrigger value="variants" className={TAB_TRIGGER_CLASS}>Variants</TabsTrigger>
              <TabsTrigger value="create-product" className={TAB_TRIGGER_CLASS}>New Product</TabsTrigger>
            </TabsList>

            <TabsContent value="categories" className="space-y-4">
              <CategoriesTab userProfile={userProfile} onRefresh={handleRefresh} refreshTrigger={refreshTrigger} />
            </TabsContent>
            <TabsContent value="brands" className="space-y-4">
              <BrandsTab userProfile={userProfile} onRefresh={handleRefresh} refreshTrigger={refreshTrigger} />
            </TabsContent>
            <TabsContent value="groups" className="space-y-4">
              <GroupsTab userProfile={userProfile} onRefresh={handleRefresh} refreshTrigger={refreshTrigger} />
            </TabsContent>
            <TabsContent value="subgroups" className="space-y-4">
              <SubGroupsTab userProfile={userProfile} onRefresh={handleRefresh} refreshTrigger={refreshTrigger} />
            </TabsContent>
            <TabsContent value="variants" className="space-y-4">
              <VariantsTab userProfile={userProfile} onRefresh={handleRefresh} refreshTrigger={refreshTrigger} />
            </TabsContent>
            <TabsContent value="create-product" className="space-y-4">
              <CreateProductTab userProfile={userProfile} onViewChange={onViewChange} onRefresh={handleRefresh} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
