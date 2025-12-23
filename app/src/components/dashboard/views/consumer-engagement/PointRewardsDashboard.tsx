'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getStorageUrl } from '@/lib/utils';
import { 
  Trophy,
  Gift, 
  Plus, 
  Edit, 
  Trash2, 
  Search, 
  TrendingUp,
  Target,
  Award,
  Image as ImageIcon,
  X,
  Star,
  Sparkles,
  Crown,
  Zap,
  Medal,
  BarChart3,
  Users,
  TrendingDown,
  Calendar,
  Filter
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface PointRewardsDashboardProps {
  userProfile: any;
  onViewChange: (view: string) => void;
}

interface PointReward {
  id: string;
  reward_name: string;
  reward_description: string;
  points_required: number;
  reward_image_url?: string;
  stock_quantity?: number;
  is_featured: boolean;
  tier_level: 'bronze' | 'silver' | 'gold' | 'platinum';
  created_at: string;
  updated_at: string;
}

interface ShopPointsData {
  shop_id: string;
  shop_name: string;
  total_points: number;
  current_tier: string;
  rank: number;
  points_this_month: number;
  points_last_month: number;
  trend: 'up' | 'down' | 'stable';
}

export default function PointRewardsDashboard({ userProfile, onViewChange }: PointRewardsDashboardProps) {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'rewards' | 'my-points'>('dashboard');
  const [rewards, setRewards] = useState<PointReward[]>([]);
  const [shopPointsData, setShopPointsData] = useState<ShopPointsData[]>([]);
  const [myPoints, setMyPoints] = useState(0);
  const [myTier, setMyTier] = useState('Bronze');
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingReward, setEditingReward] = useState<PointReward | null>(null);
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [timeFilter, setTimeFilter] = useState<'all' | 'month' | 'week'>('month');
  
  // Form state
  const [rewardName, setRewardName] = useState('');
  const [rewardDescription, setRewardDescription] = useState('');
  const [pointsRequired, setPointsRequired] = useState<number>(0);
  const [rewardImageUrl, setRewardImageUrl] = useState('');
  const [stockQuantity, setStockQuantity] = useState<number | undefined>(undefined);
  const [isFeatured, setIsFeatured] = useState(false);
  const [tierLevel, setTierLevel] = useState<'bronze' | 'silver' | 'gold' | 'platinum'>('bronze');
  const [uploadingImage, setUploadingImage] = useState(false);

  // Statistics
  const [totalShops, setTotalShops] = useState(0);
  const [totalPointsAwarded, setTotalPointsAwarded] = useState(0);
  const [totalRewards, setTotalRewards] = useState(0);
  const [activeShops, setActiveShops] = useState(0);

  // Alert state
  const [alert, setAlert] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const isAdmin = userProfile.role_code === 'ADMIN' || userProfile.role_code === 'SUPER_ADMIN';
  const isShop = userProfile.org_type === 'SHOP';

  // Tier definitions
  const tiers = [
    { name: 'Bronze', minPoints: 0, maxPoints: 499, color: 'from-amber-600 to-amber-800', icon: Award, bgColor: 'bg-amber-50', borderColor: 'border-amber-200', textColor: 'text-amber-900' },
    { name: 'Silver', minPoints: 500, maxPoints: 999, color: 'from-gray-400 to-gray-600', icon: Star, bgColor: 'bg-gray-50', borderColor: 'border-gray-200', textColor: 'text-gray-900' },
    { name: 'Gold', minPoints: 1000, maxPoints: 1999, color: 'from-yellow-400 to-yellow-600', icon: Sparkles, bgColor: 'bg-yellow-50', borderColor: 'border-yellow-200', textColor: 'text-yellow-900' },
    { name: 'Platinum', minPoints: 2000, maxPoints: Infinity, color: 'from-purple-400 to-purple-600', icon: Crown, bgColor: 'bg-purple-50', borderColor: 'border-purple-200', textColor: 'text-purple-900' }
  ];

  const showAlert = (type: 'success' | 'error', message: string) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 5000);
  };

  /* eslint-disable react-hooks/exhaustive-deps */
  const fetchAdminDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Fetch all shops with their points
      const { data: shopsData, error: shopsError } = await supabase
        .from('organizations')
        .select('id, org_name, org_type_code')
        .eq('org_type_code', 'SHOP');

      if (shopsError) throw shopsError;

      // Fetch points for each shop
      const shopPointsPromises = shopsData.map(async (shop) => {
        const { data: pointsData } = await supabase
          .from('consumer_activations')
          .select('points_awarded, created_at')
          .eq('shop_id', shop.id);

        const totalPoints = pointsData?.reduce((sum, record) => sum + (record.points_awarded || 0), 0) || 0;
        
        // Calculate this month's points
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const pointsThisMonth = pointsData?.filter(record => new Date(record.created_at) >= firstDayOfMonth)
          .reduce((sum, record) => sum + (record.points_awarded || 0), 0) || 0;

        // Calculate last month's points
        const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDayOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        const pointsLastMonth = pointsData?.filter(record => {
          const date = new Date(record.created_at);
          return date >= firstDayOfLastMonth && date <= lastDayOfLastMonth;
        }).reduce((sum, record) => sum + (record.points_awarded || 0), 0) || 0;

        const trend = pointsThisMonth > pointsLastMonth ? 'up' : 
                     pointsThisMonth < pointsLastMonth ? 'down' : 'stable';

        const currentTier = tiers.find(t => totalPoints >= t.minPoints && totalPoints <= t.maxPoints)?.name || 'Bronze';

        return {
          shop_id: shop.id,
          shop_name: shop.org_name,
          total_points: totalPoints,
          current_tier: currentTier,
          rank: 0,
          points_this_month: pointsThisMonth,
          points_last_month: pointsLastMonth,
          trend
        } as ShopPointsData;
      });

      const shopPoints = await Promise.all(shopPointsPromises);
      
      // Sort by total points and assign ranks
      shopPoints.sort((a, b) => b.total_points - a.total_points);
      shopPoints.forEach((shop, index) => shop.rank = index + 1);

      setShopPointsData(shopPoints);
      setTotalShops(shopPoints.length);
      setActiveShops(shopPoints.filter(s => s.points_this_month > 0).length);
      setTotalPointsAwarded(shopPoints.reduce((sum, shop) => sum + shop.total_points, 0));
      
    } catch (error) {
      console.error('Error fetching admin dashboard:', error);
      showAlert('error', 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [timeFilter]);
  /* eslint-enable react-hooks/exhaustive-deps */

  /* eslint-disable react-hooks/exhaustive-deps */
  const fetchMyPoints = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('consumer_activations')
        .select('points_awarded')
        .eq('shop_id', userProfile.organization_id);

      if (error) throw error;

      const totalPoints = data?.reduce((sum, record) => sum + (record.points_awarded || 0), 0) || 0;
      const tier = tiers.find(t => totalPoints >= t.minPoints && totalPoints <= t.maxPoints)?.name || 'Bronze';
      
      setMyPoints(totalPoints);
      setMyTier(tier);
    } catch (error) {
      console.error('Error fetching my points:', error);
    }
  }, [userProfile.organization_id, tiers]);
  /* eslint-enable react-hooks/exhaustive-deps */

  /* eslint-disable react-hooks/exhaustive-deps */
  const fetchRewards = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('point_rewards')
        .select('*')
        .order('points_required', { ascending: true });

      if (error) throw error;
      setRewards(data || []);
      setTotalRewards(data?.length || 0);
    } catch (error) {
      console.error('Error fetching rewards:', error);
      showAlert('error', 'Failed to load rewards');
    } finally {
      setLoading(false);
    }
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (isAdmin) {
      fetchAdminDashboardData();
    }
    if (isShop) {
      fetchMyPoints();
    }
    fetchRewards();
  }, [fetchAdminDashboardData, fetchMyPoints, fetchRewards, isAdmin, isShop]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showAlert('error', 'Please upload an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showAlert('error', 'Image size should be less than 5MB');
      return;
    }

    try {
      setUploadingImage(true);

      const fileExt = file.name.split('.').pop();
      const fileName = `reward-${Date.now()}.${fileExt}`;
      const filePath = `point-rewards/${userProfile.organization_id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(filePath);

      setRewardImageUrl(publicUrl);
      showAlert('success', 'Image uploaded successfully');
    } catch (error) {
      console.error('Error uploading image:', error);
      showAlert('error', 'Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSaveReward = async () => {
    if (!rewardName.trim()) {
      showAlert('error', 'Reward name is required');
      return;
    }

    if (pointsRequired <= 0) {
      showAlert('error', 'Points required must be greater than 0');
      return;
    }

    try {
      setLoading(true);

      if (editingReward) {
        const { error } = await supabase
          .from('point_rewards')
          .update({
            reward_name: rewardName,
            reward_description: rewardDescription,
            points_required: pointsRequired,
            reward_image_url: rewardImageUrl || null,
            stock_quantity: stockQuantity || null,
            is_featured: isFeatured,
            tier_level: tierLevel,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingReward.id);

        if (error) throw error;
        showAlert('success', 'Reward updated successfully');
      } else {
        const { error } = await supabase
          .from('point_rewards')
          .insert({
            reward_name: rewardName,
            reward_description: rewardDescription,
            points_required: pointsRequired,
            reward_image_url: rewardImageUrl || null,
            stock_quantity: stockQuantity || null,
            is_featured: isFeatured,
            tier_level: tierLevel
          });

        if (error) throw error;
        showAlert('success', 'Reward created successfully');
      }

      await fetchRewards();
      handleCancelForm();
    } catch (error) {
      console.error('Error saving reward:', error);
      showAlert('error', 'Failed to save reward');
    } finally {
      setLoading(false);
    }
  };

  const handleEditReward = (reward: PointReward) => {
    setEditingReward(reward);
    setRewardName(reward.reward_name);
    setRewardDescription(reward.reward_description || '');
    setPointsRequired(reward.points_required);
    setRewardImageUrl(reward.reward_image_url || '');
    setStockQuantity(reward.stock_quantity);
    setIsFeatured(reward.is_featured);
    setTierLevel(reward.tier_level);
    setShowForm(true);
    setActiveTab('rewards');
  };

  const handleDeleteReward = async (rewardId: string) => {
    if (!confirm('Are you sure you want to delete this reward?')) {
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase
        .from('point_rewards')
        .delete()
        .eq('id', rewardId);

      if (error) throw error;
      showAlert('success', 'Reward deleted successfully');
      await fetchRewards();
    } catch (error) {
      console.error('Error deleting reward:', error);
      showAlert('error', 'Failed to delete reward');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingReward(null);
    setRewardName('');
    setRewardDescription('');
    setPointsRequired(0);
    setRewardImageUrl('');
    setStockQuantity(undefined);
    setIsFeatured(false);
    setTierLevel('bronze');
  };

  const getTierBadgeColor = (tier: string) => {
    switch (tier.toLowerCase()) {
      case 'bronze': return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'silver': return 'bg-gray-100 text-gray-800 border-gray-300';
      case 'gold': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'platinum': return 'bg-purple-100 text-purple-800 border-purple-300';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTrendIcon = (trend: string) => {
    if (trend === 'up') return <TrendingUp className="h-4 w-4 text-green-600" />;
    if (trend === 'down') return <TrendingDown className="h-4 w-4 text-red-600" />;
    return <span className="h-4 w-4 text-gray-600">−</span>;
  };

  const filteredRewards = rewards.filter(reward => {
    const matchesSearch = reward.reward_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTier = selectedTier === 'all' || reward.tier_level === selectedTier;
    return matchesSearch && matchesTier;
  });

  const topShops = shopPointsData.slice(0, 5);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Trophy className="h-8 w-8 text-yellow-500" />
            Point Rewards Management
          </h1>
          <p className="text-gray-600 mt-1">
            {isAdmin ? 'Manage rewards and track shop performance' : 'View your points and available rewards'}
          </p>
        </div>
      </div>

      {/* Alert */}
      {alert && (
        <Alert className={alert.type === 'success' ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}>
          <AlertDescription className={alert.type === 'success' ? 'text-green-800' : 'text-red-800'}>
            {alert.message}
          </AlertDescription>
        </Alert>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value: any) => setActiveTab(value)}>
        <TabsList className="grid w-full grid-cols-3">
          {isAdmin && (
            <TabsTrigger value="dashboard">
              <BarChart3 className="h-4 w-4 mr-2" />
              Dashboard
            </TabsTrigger>
          )}
          <TabsTrigger value="rewards">
            <Gift className="h-4 w-4 mr-2" />
            Rewards Catalog
          </TabsTrigger>
          {isShop && (
            <TabsTrigger value="my-points">
              <Trophy className="h-4 w-4 mr-2" />
              My Points
            </TabsTrigger>
          )}
        </TabsList>

        {/* DASHBOARD TAB - Admin Only */}
        {isAdmin && (
          <TabsContent value="dashboard" className="space-y-6">
            {/* Statistics Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <Card>
                <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6 pb-3 sm:pb-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                    <div className="mb-2 sm:mb-0">
                      <p className="text-xs sm:text-sm text-gray-600">Total Shops</p>
                      <p className="text-2xl sm:text-3xl font-bold">{totalShops}</p>
                    </div>
                    <Users className="h-8 w-8 sm:h-10 sm:w-10 text-blue-500" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6 pb-3 sm:pb-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                    <div className="mb-2 sm:mb-0">
                      <p className="text-xs sm:text-sm text-gray-600">Active Shops</p>
                      <p className="text-2xl sm:text-3xl font-bold text-green-600">{activeShops}</p>
                    </div>
                    <Zap className="h-8 w-8 sm:h-10 sm:w-10 text-green-500" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6 pb-3 sm:pb-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                    <div className="mb-2 sm:mb-0">
                      <p className="text-xs sm:text-sm text-gray-600">Total Points Awarded</p>
                      <p className="text-2xl sm:text-3xl font-bold text-yellow-600">{totalPointsAwarded.toLocaleString()}</p>
                    </div>
                    <Trophy className="h-8 w-8 sm:h-10 sm:w-10 text-yellow-500" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6 pb-3 sm:pb-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                    <div className="mb-2 sm:mb-0">
                      <p className="text-xs sm:text-sm text-gray-600">Total Rewards</p>
                      <p className="text-2xl sm:text-3xl font-bold text-purple-600">{totalRewards}</p>
                    </div>
                    <Gift className="h-8 w-8 sm:h-10 sm:w-10 text-purple-500" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Top 5 Shops Leaderboard */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Medal className="h-5 w-5 text-yellow-500" />
                      Top 5 Shops by Points
                    </CardTitle>
                    <CardDescription>Shops with the highest point collection</CardDescription>
                  </div>
                  <select
                    value={timeFilter}
                    onChange={(e) => setTimeFilter(e.target.value as any)}
                    className="px-3 py-2 border rounded-md"
                  >
                    <option value="all">All Time</option>
                    <option value="month">This Month</option>
                    <option value="week">This Week</option>
                  </select>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {topShops.map((shop, index) => (
                    <div
                      key={shop.shop_id}
                      className={`p-4 rounded-lg border-2 ${
                        index === 0 ? 'border-yellow-400 bg-yellow-50' :
                        index === 1 ? 'border-gray-400 bg-gray-50' :
                        index === 2 ? 'border-amber-600 bg-amber-50' :
                        'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`flex items-center justify-center w-12 h-12 rounded-full font-bold text-xl ${
                            index === 0 ? 'bg-yellow-400 text-white' :
                            index === 1 ? 'bg-gray-400 text-white' :
                            index === 2 ? 'bg-amber-600 text-white' :
                            'bg-gray-200 text-gray-700'
                          }`}>
                            {index + 1}
                          </div>
                          <div>
                            <h3 className="font-bold text-lg">{shop.shop_name}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge className={getTierBadgeColor(shop.current_tier)}>
                                {shop.current_tier}
                              </Badge>
                              <span className="text-sm text-gray-600 flex items-center gap-1">
                                {getTrendIcon(shop.trend)}
                                {shop.points_this_month > 0 && (
                                  <span>{shop.points_this_month} this month</span>
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-gray-900">
                            {shop.total_points.toLocaleString()}
                          </div>
                          <div className="text-sm text-gray-600">points</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* All Shops Ranking Table */}
            <Card>
              <CardHeader>
                <CardTitle>All Shops Ranking</CardTitle>
                <CardDescription>Complete leaderboard of all shops</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-3">Rank</th>
                        <th className="text-left p-3">Shop Name</th>
                        <th className="text-left p-3">Tier</th>
                        <th className="text-right p-3">Total Points</th>
                        <th className="text-right p-3">This Month</th>
                        <th className="text-right p-3">Last Month</th>
                        <th className="text-center p-3">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shopPointsData.map((shop) => (
                        <tr key={shop.shop_id} className="border-b hover:bg-gray-50">
                          <td className="p-3 font-semibold">#{shop.rank}</td>
                          <td className="p-3">{shop.shop_name}</td>
                          <td className="p-3">
                            <Badge className={getTierBadgeColor(shop.current_tier)}>
                              {shop.current_tier}
                            </Badge>
                          </td>
                          <td className="p-3 text-right font-bold">{shop.total_points.toLocaleString()}</td>
                          <td className="p-3 text-right">{shop.points_this_month.toLocaleString()}</td>
                          <td className="p-3 text-right">{shop.points_last_month.toLocaleString()}</td>
                          <td className="p-3 text-center">{getTrendIcon(shop.trend)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* REWARDS TAB */}
        <TabsContent value="rewards" className="space-y-6">
          {/* Filters and Search */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search rewards..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant={selectedTier === 'all' ? 'default' : 'outline'}
                onClick={() => setSelectedTier('all')}
              >
                All Tiers
              </Button>
              {tiers.map(tier => (
                <Button
                  key={tier.name}
                  variant={selectedTier === tier.name.toLowerCase() ? 'default' : 'outline'}
                  onClick={() => setSelectedTier(tier.name.toLowerCase())}
                  className="hidden sm:inline-flex"
                >
                  {tier.name}
                </Button>
              ))}
            </div>
            {isAdmin && (
              <Button onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Reward
              </Button>
            )}
          </div>

          {/* Admin Form */}
          {isAdmin && showForm && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{editingReward ? 'Edit Reward' : 'Add New Reward'}</CardTitle>
                  <Button variant="ghost" size="sm" onClick={handleCancelForm}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="rewardName">Reward Name *</Label>
                    <Input
                      id="rewardName"
                      placeholder="e.g., Premium Gift Voucher"
                      value={rewardName}
                      onChange={(e) => setRewardName(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="pointsRequired">Points Required *</Label>
                    <Input
                      id="pointsRequired"
                      type="number"
                      min="1"
                      placeholder="500"
                      value={pointsRequired || ''}
                      onChange={(e) => setPointsRequired(parseInt(e.target.value) || 0)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="tierLevel">Tier Level</Label>
                    <select
                      id="tierLevel"
                      value={tierLevel}
                      onChange={(e) => setTierLevel(e.target.value as any)}
                      className="w-full h-10 px-3 rounded-md border border-gray-300"
                    >
                      <option value="bronze">Bronze</option>
                      <option value="silver">Silver</option>
                      <option value="gold">Gold</option>
                      <option value="platinum">Platinum</option>
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="stockQuantity">Stock Quantity (Optional)</Label>
                    <Input
                      id="stockQuantity"
                      type="number"
                      placeholder="Leave empty for unlimited"
                      value={stockQuantity || ''}
                      onChange={(e) => setStockQuantity(e.target.value ? parseInt(e.target.value) : undefined)}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="rewardDescription">Description</Label>
                  <Textarea
                    id="rewardDescription"
                    placeholder="Describe the reward..."
                    value={rewardDescription}
                    onChange={(e) => setRewardDescription(e.target.value)}
                    rows={3}
                  />
                </div>

                <div>
                  <Label>Reward Image</Label>
                  <div className="mt-2 space-y-3">
                    {rewardImageUrl ? (
                      <div className="relative w-full h-48 border rounded-lg overflow-hidden">
                        <Image
                          src={getStorageUrl(rewardImageUrl) || rewardImageUrl}
                          alt="Reward preview"
                          layout="fill"
                          objectFit="cover"
                        />
                        <Button
                          variant="destructive"
                          size="sm"
                          className="absolute top-2 right-2"
                          onClick={() => setRewardImageUrl('')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="border-2 border-dashed rounded-lg p-8 text-center">
                        <ImageIcon className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                        <p className="text-sm text-gray-600 mb-2">Upload reward image</p>
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          disabled={uploadingImage}
                          className="max-w-xs mx-auto"
                        />
                        {uploadingImage && (
                          <p className="text-sm text-blue-600 mt-2">Uploading...</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isFeatured"
                    checked={isFeatured}
                    onChange={(e) => setIsFeatured(e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="isFeatured">Featured Reward</Label>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button onClick={handleSaveReward} disabled={loading || uploadingImage}>
                    {loading ? 'Saving...' : editingReward ? 'Update Reward' : 'Create Reward'}
                  </Button>
                  <Button variant="outline" onClick={handleCancelForm}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Rewards Grid */}
          <div>
            {loading && !showForm && (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-500">Loading rewards...</p>
              </div>
            )}

            {!loading && filteredRewards.length === 0 && (
              <Card className="p-12 text-center">
                <Gift className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                <p className="text-lg text-gray-600">No rewards found</p>
                {isAdmin && (
                  <Button onClick={() => setShowForm(true)} className="mt-4">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Your First Reward
                  </Button>
                )}
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredRewards.map((reward) => (
                <Card key={reward.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                  {/* Reward Image */}
                  <div className="relative h-48 bg-white">
                    {reward.reward_image_url ? (
                      <Image
                        src={getStorageUrl(reward.reward_image_url) || reward.reward_image_url}
                        alt={reward.reward_name}
                        layout="fill"
                        objectFit="contain"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Gift className="h-16 w-16 text-gray-400" />
                      </div>
                    )}
                    {reward.is_featured && (
                      <Badge className="absolute top-2 left-2 bg-yellow-500 text-white">
                        <Star className="h-3 w-3 mr-1" />
                        Featured
                      </Badge>
                    )}
                    <Badge className={`absolute top-2 right-2 ${getTierBadgeColor(reward.tier_level)}`}>
                      {reward.tier_level.charAt(0).toUpperCase() + reward.tier_level.slice(1)}
                    </Badge>
                  </div>

                  <CardContent className="p-4">
                    <h3 className="font-bold text-lg mb-2">{reward.reward_name}</h3>
                    {reward.reward_description && (
                      <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                        {reward.reward_description}
                      </p>
                    )}
                    
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-1 text-blue-600">
                        <Trophy className="h-5 w-5" />
                        <span className="font-bold text-xl">{reward.points_required.toLocaleString()}</span>
                        <span className="text-sm">points</span>
                      </div>
                      {reward.stock_quantity && (
                        <Badge variant="outline">
                          {reward.stock_quantity} left
                        </Badge>
                      )}
                    </div>

                    {isShop && (
                      <div>
                        {myPoints >= reward.points_required ? (
                          <Badge className="w-full justify-center bg-green-500 text-white">
                            <TrendingUp className="h-4 w-4 mr-1" />
                            You can redeem this!
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="w-full justify-center">
                            Need {(reward.points_required - myPoints).toLocaleString()} more points
                          </Badge>
                        )}
                      </div>
                    )}

                    {isAdmin && (
                      <div className="flex gap-2 mt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleEditReward(reward)}
                        >
                          <Edit className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteReward(reward.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* MY POINTS TAB - Shop Only */}
        {isShop && (
          <TabsContent value="my-points" className="space-y-6">
            {/* Current Points Card */}
            <Card className={`${tiers.find(t => t.name === myTier)?.borderColor} border-2`}>
              <CardHeader className={tiers.find(t => t.name === myTier)?.bgColor}>
                <CardTitle className="flex items-center gap-2">
                  {React.createElement(tiers.find(t => t.name === myTier)?.icon || Award, { className: 'h-6 w-6' })}
                  Your Total Points
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="text-center">
                  <div className="text-5xl font-bold text-gray-900 mb-2">
                    {myPoints.toLocaleString()}
                  </div>
                  <Badge className={getTierBadgeColor(myTier)}>
                    {myTier} Tier
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Tier Levels Overview */}
            <Card>
              <CardHeader>
                <CardTitle>Tier Levels & Benefits</CardTitle>
                <CardDescription>Unlock exclusive rewards as you collect more points</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {tiers.map((tier, index) => (
                    <div
                      key={tier.name}
                      className={`p-4 rounded-lg border-2 ${
                        myTier === tier.name
                          ? `${tier.borderColor} ${tier.bgColor}`
                          : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="text-center">
                        {React.createElement(tier.icon, { 
                          className: `h-8 w-8 mx-auto mb-2 ${
                            myTier === tier.name ? 'text-gray-900' : 'text-gray-400'
                          }`
                        })}
                        <h3 className="font-bold text-lg">{tier.name}</h3>
                        <p className="text-sm text-gray-600">
                          {tier.minPoints === 0 ? '0' : tier.minPoints}
                          {tier.maxPoints === Infinity ? '+' : `-${tier.maxPoints}`} points
                        </p>
                        {myTier === tier.name && (
                          <Badge className="mt-2 bg-green-500 text-white">Current Tier</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Available Rewards for this tier */}
            <Card>
              <CardHeader>
                <CardTitle>Rewards You Can Claim</CardTitle>
                <CardDescription>Based on your current points</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {rewards.filter(r => r.points_required <= myPoints).map((reward) => (
                    <Card key={reward.id} className="border-2 border-green-200 bg-green-50">
                      <CardContent className="p-4">
                        <div className="flex gap-4">
                          {reward.reward_image_url ? (
                            <Image
                              src={getStorageUrl(reward.reward_image_url) || reward.reward_image_url}
                              alt={reward.reward_name}
                              width={80}
                              height={80}
                              className="object-cover rounded-lg"
                            />
                          ) : (
                            <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center">
                              <Gift className="h-8 w-8 text-gray-400" />
                            </div>
                          )}
                          <div className="flex-1">
                            <h4 className="font-bold">{reward.reward_name}</h4>
                            <p className="text-sm text-gray-600 line-clamp-2">{reward.reward_description}</p>
                            <div className="flex items-center gap-1 text-blue-600 mt-2">
                              <Trophy className="h-4 w-4" />
                              <span className="font-bold">{reward.points_required.toLocaleString()}</span>
                              <span className="text-sm">points</span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
