'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
    Zap
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';

interface PointCatalogViewNewProps {
    userProfile: any;
    onViewChange: (view: string) => void;
}

interface PointReward {
    id: string;
    reward_name: string;
    reward_description: string | null;
    points_required: number;
    reward_image_url?: string | null;
    stock_quantity?: number | null;
    is_featured: boolean | null;
    tier_level: string;
    created_at: string;
    updated_at: string;
}

interface ShopPoints {
    total_points: number;
    current_tier: string;
    next_tier: string;
    points_to_next_tier: number;
}

export default function PointCatalogViewNew({ userProfile, onViewChange }: PointCatalogViewNewProps) {
    const supabase = createClient();
    const [rewards, setRewards] = useState<PointReward[]>([]);
    const [shopPoints, setShopPoints] = useState<ShopPoints>({
        total_points: 0,
        current_tier: 'Bronze',
        next_tier: 'Silver',
        points_to_next_tier: 500
    });
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editingReward, setEditingReward] = useState<PointReward | null>(null);
    const [selectedTier, setSelectedTier] = useState<string>('all');

    // Form state
    const [rewardName, setRewardName] = useState('');
    const [rewardDescription, setRewardDescription] = useState('');
    const [pointsRequired, setPointsRequired] = useState<number>(0);
    const [rewardImageUrl, setRewardImageUrl] = useState('');
    const [stockQuantity, setStockQuantity] = useState<number | undefined>(undefined);
    const [isFeatured, setIsFeatured] = useState(false);
    const [tierLevel, setTierLevel] = useState<string>('bronze');
    const [uploadingImage, setUploadingImage] = useState(false);

    // Alert state
    const [alert, setAlert] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    // Check if user is from HQ organization (not shop/distributor/warehouse)
    // Only HQ organization users should see admin features
    const isAdmin = userProfile.org_type !== 'SHOP' && userProfile.org_type !== 'DISTRIBUTOR' && userProfile.org_type !== 'WAREHOUSE';
    const isShop = userProfile.org_type === 'SHOP';

    // Tier definitions
    const tiers = [
        { name: 'Bronze', minPoints: 0, maxPoints: 499, color: 'from-amber-600 to-amber-800', icon: Award, bgColor: 'bg-amber-50', borderColor: 'border-amber-200' },
        { name: 'Silver', minPoints: 500, maxPoints: 999, color: 'from-gray-400 to-gray-600', icon: Star, bgColor: 'bg-gray-50', borderColor: 'border-gray-200' },
        { name: 'Gold', minPoints: 1000, maxPoints: 1999, color: 'from-yellow-400 to-yellow-600', icon: Sparkles, bgColor: 'bg-yellow-50', borderColor: 'border-yellow-200' },
        { name: 'Platinum', minPoints: 2000, maxPoints: Infinity, color: 'from-purple-400 to-purple-600', icon: Crown, bgColor: 'bg-purple-50', borderColor: 'border-purple-200' }
    ];

    const showAlert = (type: 'success' | 'error', message: string) => {
        setAlert({ type, message });
        setTimeout(() => setAlert(null), 5000);
    };

    /* eslint-disable react-hooks/exhaustive-deps */
    const fetchShopPoints = useCallback(async () => {
        try {
            // TODO: Replace with actual points calculation from database
            // This would typically query consumer_activations or points_transactions table
            const { data, error } = await supabase
                .from('consumer_activations')
                .select('points_awarded')
                .eq('shop_id', userProfile.organization_id);

            if (error) throw error;

            const totalPoints = data?.reduce((sum, record) => sum + (record.points_awarded || 0), 0) || 0;

            // Calculate tier
            let currentTier = tiers[0];
            let nextTier = tiers[1];

            for (let i = 0; i < tiers.length; i++) {
                if (totalPoints >= tiers[i].minPoints && totalPoints <= tiers[i].maxPoints) {
                    currentTier = tiers[i];
                    nextTier = tiers[i + 1] || tiers[i];
                    break;
                }
            }

            const pointsToNext = nextTier.minPoints - totalPoints;

            setShopPoints({
                total_points: totalPoints,
                current_tier: currentTier.name,
                next_tier: nextTier.name,
                points_to_next_tier: pointsToNext > 0 ? pointsToNext : 0
            });
        } catch (error) {
            console.error('Error fetching shop points:', error);
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
        } catch (error) {
            console.error('Error fetching rewards:', error);
            showAlert('error', 'Failed to load rewards');
        } finally {
            setLoading(false);
        }
    }, []);
    /* eslint-enable react-hooks/exhaustive-deps */

    useEffect(() => {
        fetchRewards();
        if (isShop) {
            fetchShopPoints();
        }
    }, [fetchRewards, fetchShopPoints, isShop]);

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
        setStockQuantity(reward.stock_quantity ?? undefined);
        setIsFeatured(reward.is_featured ?? false);
        setTierLevel(reward.tier_level);
        setShowForm(true);
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

    const getCurrentTierInfo = () => {
        return tiers.find(t => t.name === shopPoints.current_tier) || tiers[0];
    };

    const getNextTierInfo = () => {
        return tiers.find(t => t.name === shopPoints.next_tier) || tiers[0];
    };

    const filteredRewards = rewards.filter(reward => {
        const matchesSearch = reward.reward_name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesTier = selectedTier === 'all' || reward.tier_level === selectedTier;
        return matchesSearch && matchesTier;
    });

    const getTierBadgeColor = (tier: string) => {
        switch (tier) {
            case 'bronze': return 'bg-amber-100 text-amber-800 border-amber-300';
            case 'silver': return 'bg-gray-100 text-gray-800 border-gray-300';
            case 'gold': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
            case 'platinum': return 'bg-purple-100 text-purple-800 border-purple-300';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const progressPercentage = shopPoints.points_to_next_tier > 0
        ? ((shopPoints.total_points % 500) / 500) * 100
        : 100;

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <Trophy className="h-8 w-8 text-yellow-500" />
                        Point Rewards Catalog
                    </h1>
                    <p className="text-gray-600 mt-1">
                        {isShop ? 'View your points and available rewards' : 'Manage point rewards and prizes'}
                    </p>
                </div>
                {isAdmin && (
                    <Button onClick={() => setShowForm(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Reward
                    </Button>
                )}
            </div>

            {/* Alert */}
            {alert && (
                <Alert className={alert.type === 'success' ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}>
                    <AlertDescription className={alert.type === 'success' ? 'text-green-800' : 'text-red-800'}>
                        {alert.message}
                    </AlertDescription>
                </Alert>
            )}

            {/* Shop Points Dashboard (Only for Shop users) */}
            {isShop && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Current Points Card */}
                    <Card className={`${getCurrentTierInfo().borderColor} border-2`}>
                        <CardHeader className={`${getCurrentTierInfo().bgColor}`}>
                            <CardTitle className="flex items-center gap-2">
                                {React.createElement(getCurrentTierInfo().icon, { className: 'h-6 w-6' })}
                                Your Total Points
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="text-center">
                                <div className="text-5xl font-bold text-gray-900 mb-2">
                                    {shopPoints.total_points.toLocaleString()}
                                </div>
                                <Badge className={getTierBadgeColor(shopPoints.current_tier.toLowerCase())}>
                                    {shopPoints.current_tier} Tier
                                </Badge>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Progress to Next Tier */}
                    <Card className="lg:col-span-2">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Target className="h-5 w-5" />
                                Progress to {shopPoints.next_tier} Tier
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-medium">{shopPoints.current_tier}</span>
                                    <span className="font-medium">{shopPoints.next_tier}</span>
                                </div>
                                <Progress value={progressPercentage} className="h-3" />
                                <div className="flex items-center justify-between text-sm text-gray-600">
                                    <span>{shopPoints.total_points} points</span>
                                    <span>{getNextTierInfo().minPoints} points</span>
                                </div>
                            </div>

                            {shopPoints.points_to_next_tier > 0 ? (
                                <div className="flex items-center gap-2 p-4 bg-blue-50 rounded-lg border border-blue-200">
                                    <Zap className="h-5 w-5 text-blue-600" />
                                    <div>
                                        <p className="text-sm font-semibold text-blue-900">
                                            Only {shopPoints.points_to_next_tier} more points to {shopPoints.next_tier}!
                                        </p>
                                        <p className="text-xs text-blue-700">Keep engaging consumers to earn more rewards</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 p-4 bg-green-50 rounded-lg border border-green-200">
                                    <Crown className="h-5 w-5 text-green-600" />
                                    <div>
                                        <p className="text-sm font-semibold text-green-900">
                                            Congratulations! You&apos;ve reached the highest tier!
                                        </p>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Tier Levels Overview (Only for Shop users) */}
            {isShop && (
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
                                    className={`p-4 rounded-lg border-2 ${shopPoints.current_tier === tier.name
                                            ? `${tier.borderColor} ${tier.bgColor}`
                                            : 'border-gray-200 bg-gray-50'
                                        }`}
                                >
                                    <div className="text-center">
                                        {React.createElement(tier.icon, {
                                            className: `h-8 w-8 mx-auto mb-2 ${shopPoints.current_tier === tier.name ? 'text-gray-900' : 'text-gray-400'
                                                }`
                                        })}
                                        <h3 className="font-bold text-lg">{tier.name}</h3>
                                        <p className="text-sm text-gray-600">
                                            {tier.minPoints === 0 ? '0' : tier.minPoints}
                                            {tier.maxPoints === Infinity ? '+' : `-${tier.maxPoints}`} points
                                        </p>
                                        {shopPoints.current_tier === tier.name && (
                                            <Badge className="mt-2 bg-green-500 text-white">Current Tier</Badge>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

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
                                    <div className="relative w-full h-48 border rounded-lg overflow-hidden bg-gray-50">
                                        <Image
                                            src={rewardImageUrl}
                                            alt="Reward preview"
                                            layout="fill"
                                            objectFit="contain"
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

            {/* Rewards Catalog */}
            <div>
                <h2 className="text-2xl font-bold mb-4">Available Rewards</h2>

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
                                        src={reward.reward_image_url}
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
                                        {shopPoints.total_points >= reward.points_required ? (
                                            <Badge className="w-full justify-center bg-green-500 text-white">
                                                <TrendingUp className="h-4 w-4 mr-1" />
                                                You can redeem this!
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="w-full justify-center">
                                                Need {(reward.points_required - shopPoints.total_points).toLocaleString()} more points
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
        </div>
    );
}
