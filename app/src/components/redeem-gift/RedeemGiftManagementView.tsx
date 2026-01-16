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
    Gift,
    Plus,
    Edit,
    Trash2,
    Search,
    Package,
    Image as ImageIcon,
    Check,
    X,
    Upload,
    TrendingUp,
    Users,
    Calendar,
    BarChart3
} from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface RedeemGiftManagementViewProps {
    userProfile: any;
    onViewChange: (view: string) => void;
    initialOrderId?: string;
}

interface Order {
    id: string;
    order_no: string;
    display_doc_no?: string;
    legacy_order_no?: string;  // Original order_no (e.g., ORD-HM-0126-19)
    order_type: string;
    status: string;
    has_redeem: boolean | null;
    company_id: string;
}


interface RedeemGift {
    id: string;
    order_id: string | null;
    redeem_type: 'order' | 'master';
    category: 'gift' | 'point_pool';
    gift_name: string;
    gift_description: string | null;
    gift_image_url?: string | null;
    total_quantity?: number;
    claimed_quantity?: number;
    quantity_available?: number;
    points_per_collection?: number;
    total_points_allocated?: number;
    remaining_points?: number;
    collection_option_1?: boolean;
    collection_option_2?: boolean;
    status?: string;
    created_at: string;
    updated_at: string;
}

export default function RedeemGiftManagementView({ userProfile, onViewChange, initialOrderId }: RedeemGiftManagementViewProps) {
    const supabase = createClient();
    const [orders, setOrders] = useState<Order[]>([]);
    const [gifts, setGifts] = useState<RedeemGift[]>([]);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editingGift, setEditingGift] = useState<RedeemGift | null>(null);

    // Filter State
    const [redeemScope, setRedeemScope] = useState<'order' | 'master'>('order');

    // Form state
    const [redeemType, setRedeemType] = useState<'order' | 'master'>('order'); // For the form (usually matches scope but explicit)
    const [redeemCategory, setRedeemCategory] = useState<'gift' | 'point_pool'>('gift');
    const [giftName, setGiftName] = useState('');
    const [giftDescription, setGiftDescription] = useState('');
    const [giftImageUrl, setGiftImageUrl] = useState('');
    const [quantityAvailable, setQuantityAvailable] = useState<number | undefined>(undefined);
    
    // Point Pool Form State
    const [pointsPerCollection, setPointsPerCollection] = useState<number>(0);
    const [totalPointsAllocated, setTotalPointsAllocated] = useState<number>(0);
    const [collectionOption1, setCollectionOption1] = useState<boolean>(false);
    const [collectionOption2, setCollectionOption2] = useState<boolean>(false);

    const [uploadingImage, setUploadingImage] = useState(false);

    // Statistics state
    const [totalGifts, setTotalGifts] = useState(0);
    const [totalRedemptions, setTotalRedemptions] = useState(0);
    const [redemptionsThisMonth, setRedemptionsThisMonth] = useState(0);
    const [mostPopularGift, setMostPopularGift] = useState<string>('');

    // Alert state
    const [alert, setAlert] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    const showAlert = (type: 'success' | 'error', message: string) => {
        setAlert({ type, message });
        setTimeout(() => setAlert(null), 5000);
    };

    /* eslint-disable react-hooks/exhaustive-deps */
    const fetchRedemptionStatistics = useCallback(async () => {
        try {
            // Fetch total gifts defined
            const { data: allGifts, error: giftsError } = await supabase
                .from('redeem_gifts')
                .select('id, gift_name, order_id')
                .eq('is_active', true);

            if (giftsError) {
                console.error('Error fetching gifts:', giftsError);
            }

            setTotalGifts(allGifts?.length || 0);

            // Fetch total redemptions from consumer_qr_scans
            const { count: totalCount, error: totalError } = await supabase
                .from('consumer_qr_scans')
                .select('id', { count: 'exact', head: true })
                .eq('redeemed_gift', true);

            if (totalError) {
                console.error('Error fetching total redemptions:', totalError);
            } else {
                setTotalRedemptions(totalCount || 0);
            }

            // Fetch redemptions this month
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            const { count: monthCount, error: monthError } = await supabase
                .from('consumer_qr_scans')
                .select('id', { count: 'exact', head: true })
                .eq('redeemed_gift', true)
                .gte('scanned_at', startOfMonth.toISOString());

            if (monthError) {
                console.error('Error fetching month redemptions:', monthError);
            } else {
                setRedemptionsThisMonth(monthCount || 0);
            }

            // Find most popular gift (most redeemed)
            // This requires joining consumer_qr_scans with qr_codes to get gift info
            // For now, set to N/A - can be enhanced later
            setMostPopularGift('N/A');

        } catch (error) {
            console.error('Error fetching redemption statistics:', error);
        }
    }, []);
    /* eslint-enable react-hooks/exhaustive-deps */

    /* eslint-disable react-hooks/exhaustive-deps */
    const fetchOrders = useCallback(async () => {
        try {
            setLoading(true);
            // Use buyer_org_id or seller_org_id to find orders for this organization
            const { data, error } = await supabase
                .from('orders')
                .select('id, order_no, display_doc_no, order_type, status, has_redeem, company_id')
                .or(`buyer_org_id.eq.${userProfile.organization_id},seller_org_id.eq.${userProfile.organization_id}`)
                .eq('has_redeem', true)
                .order('order_no', { ascending: false });

            if (error) throw error;

            // Transform to include legacy_order_no
            const transformedOrders = (data || []).map(order => ({
                ...order,
                legacy_order_no: order.order_no,  // Keep original order_no as legacy
                order_no: order.display_doc_no || order.order_no  // Use display_doc_no when available
            }));

            setOrders(transformedOrders);
        } catch (error) {
            console.error('Error fetching orders:', error);
            showAlert('error', 'Failed to load orders');
        } finally {
            setLoading(false);
        }
    }, [userProfile.organization_id]);
    /* eslint-enable react-hooks/exhaustive-deps */

    /* eslint-disable react-hooks/exhaustive-deps */
    const fetchGifts = useCallback(async (orderId?: string) => {
        try {
            setLoading(true);
            let query = supabase
                .from('redeem_gifts')
                .select('*')
                .order('created_at', { ascending: false });

            if (redeemScope === 'order') {
                if (!orderId) {
                    setGifts([]);
                    setLoading(false);
                    return;
                }
                query = query.eq('order_id', orderId);
            } else {
                // Master scope
                query = query.is('order_id', null);
            }

            const { data, error } = await query;

            if (error) throw error;
            setGifts(data || []);
        } catch (error) {
            console.error('Error fetching gifts:', error);
            showAlert('error', 'Failed to load gifts');
        } finally {
            setLoading(false);
        }
    }, [redeemScope]);
    /* eslint-enable react-hooks/exhaustive-deps */

    useEffect(() => {
        fetchOrders();
        fetchRedemptionStatistics();
    }, [fetchOrders, fetchRedemptionStatistics]);

    // Handle initial order selection from URL
    useEffect(() => {
        if (orders.length > 0 && initialOrderId && !selectedOrder && redeemScope === 'order') {
            const order = orders.find(o => o.id === initialOrderId);
            if (order) {
                setSelectedOrder(order);
            }
        }
    }, [orders, initialOrderId, selectedOrder, redeemScope]);

    useEffect(() => {
        if (redeemScope === 'master') {
            fetchGifts();
        } else if (selectedOrder) {
            fetchGifts(selectedOrder.id);
        } else {
            setGifts([]);
        }
    }, [selectedOrder, fetchGifts, redeemScope]);

    const resizeImage = (file: File, maxWidth: number = 800, maxHeight: number = 600): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = document.createElement('img');
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Calculate new dimensions maintaining aspect ratio
                    if (width > height) {
                        if (width > maxWidth) {
                            height = Math.round((height * maxWidth) / width);
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width = Math.round((width * maxHeight) / height);
                            height = maxHeight;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }

                    ctx.drawImage(img, 0, 0, width, height);

                    // Convert to blob with quality optimization
                    canvas.toBlob(
                        (blob) => {
                            if (blob) {
                                resolve(blob);
                            } else {
                                reject(new Error('Failed to create blob'));
                            }
                        },
                        'image/jpeg',
                        0.85 // 85% quality for good balance between quality and file size
                    );
                };
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = e.target?.result as string;
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            showAlert('error', 'Please upload an image file');
            return;
        }

        // Validate file size (max 5MB for original file)
        if (file.size > 5 * 1024 * 1024) {
            showAlert('error', 'Image size should be less than 5MB');
            return;
        }

        try {
            setUploadingImage(true);

            // Resize image to mobile-friendly dimensions (800x600 max)
            const resizedBlob = await resizeImage(file, 800, 600);

            // Create unique filename
            const fileExt = file.name.split('.').pop();
            const fileName = `gift-${Date.now()}.jpg`; // Always save as JPEG after resizing
            const filePath = `redemption-gifts/${userProfile.organization_id}/${fileName}`;

            // Upload resized image to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('product-images')
                .upload(filePath, resizedBlob, {
                    contentType: 'image/jpeg',
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) throw uploadError;

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from('product-images')
                .getPublicUrl(filePath);

            setGiftImageUrl(publicUrl);
            showAlert('success', 'Image uploaded and optimized successfully');
        } catch (error) {
            console.error('Error uploading image:', error);
            showAlert('error', 'Failed to upload image');
        } finally {
            setUploadingImage(false);
        }
    };

    const handleSaveGift = async () => {
        if (redeemScope === 'order' && !selectedOrder) {
            showAlert('error', 'Please select an order first');
            return;
        }

        if (!giftName.trim()) {
            showAlert('error', 'Gift name is required');
            return;
        }

        if (redeemCategory === 'point_pool') {
            if (pointsPerCollection <= 0) {
                showAlert('error', 'Points per collection must be greater than 0');
                return;
            }
            if (totalPointsAllocated <= 0) {
                showAlert('error', 'Total points must be greater than 0');
                return;
            }
        }

        try {
            setLoading(true);

            const payload: any = {
                gift_name: giftName,
                gift_description: giftDescription,
                gift_image_url: giftImageUrl || null,
                redeem_type: redeemScope,
                category: redeemCategory,
                updated_at: new Date().toISOString()
            };

            if (redeemCategory === 'point_pool') {
                payload.points_per_collection = pointsPerCollection;
                payload.total_points_allocated = totalPointsAllocated;
                payload.collection_option_1 = collectionOption1;
                payload.collection_option_2 = collectionOption2;
                // Note: remaining_points not updated on edit here to prevent reset, only on create
            } else {
                payload.total_quantity = quantityAvailable || 0;
            }

            if (editingGift) {
                // Update existing gift
                const { error } = await supabase
                    .from('redeem_gifts')
                    .update(payload)
                    .eq('id', editingGift.id);

                if (error) throw error;
                showAlert('success', 'Gift updated successfully');
            } else {
                // Create new gift
                if (redeemScope === 'order' && selectedOrder) {
                    payload.order_id = selectedOrder.id;
                }
                payload.claimed_quantity = 0;
                payload.is_active = true;
                
                if (redeemCategory === 'point_pool') {
                    payload.remaining_points = totalPointsAllocated;
                }

                const { error } = await supabase
                    .from('redeem_gifts')
                    .insert(payload);

                if (error) throw error;
                showAlert('success', 'Gift created successfully');
            }

            // Refresh gifts list
            await fetchGifts(selectedOrder?.id);
            handleCancelForm();
        } catch (error) {
            console.error('Error saving gift:', error);
            showAlert('error', 'Failed to save gift');
        } finally {
            setLoading(false);
        }
    };

    const handleEditGift = (gift: RedeemGift) => {
        setEditingGift(gift);
        setGiftName(gift.gift_name);
        setGiftDescription(gift.gift_description || '');
        setGiftImageUrl(gift.gift_image_url || '');
        
        // Restore category and type
        setRedeemCategory(gift.category || 'gift');
        setRedeemType(gift.redeem_type || 'order'); 

        if (gift.category === 'point_pool') {
            setPointsPerCollection(gift.points_per_collection || 0);
            setTotalPointsAllocated(gift.total_points_allocated || 0);
            setCollectionOption1(gift.collection_option_1 || false);
            setCollectionOption2(gift.collection_option_2 || false);
        } else {
            // Use total_quantity from the database
            setQuantityAvailable(gift.total_quantity);
        }
        setShowForm(true);
    };

    const handleDeleteGift = async (giftId: string) => {
        if (!confirm('Are you sure you want to delete this gift? This action cannot be undone.')) {
            return;
        }

        try {
            setLoading(true);
            const { error } = await supabase
                .from('redeem_gifts')
                .delete()
                .eq('id', giftId);

            if (error) throw error;
            showAlert('success', 'Gift deleted successfully');

            if (selectedOrder) {
                await fetchGifts(selectedOrder.id);
            }
        } catch (error) {
            console.error('Error deleting gift:', error);
            showAlert('error', 'Failed to delete gift');
        } finally {
            setLoading(false);
        }
    };

    const handleCancelForm = () => {
        setShowForm(false);
        setEditingGift(null);
        setGiftName('');
        setGiftDescription('');
        setGiftImageUrl('');
        setQuantityAvailable(undefined);
        setPointsPerCollection(0);
        setTotalPointsAllocated(0);
        setCollectionOption1(false);
        setCollectionOption2(false);
        setRedeemCategory('gift');
    };

    const filteredOrders = orders.filter(order =>
        order.order_no.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Redeem Gift Management</h1>
                    <p className="text-gray-600 mt-1">Manage free gifts that consumers can claim when scanning QR codes at shops</p>
                </div>
            </div>

            {/* Scope Selection */}
            <div className="bg-white p-4 rounded-lg border shadow-sm flex items-center gap-4">
                <span className="font-medium text-sm text-gray-700">Redeem Scope:</span>
                <div className="flex gap-2">
                    <Button 
                        variant={redeemScope === 'order' ? 'default' : 'outline'}
                        onClick={() => setRedeemScope('order')}
                        size="sm"
                        className="gap-2"
                    >
                        <Package className="h-4 w-4" />
                        By Order
                    </Button>
                    <Button 
                        variant={redeemScope === 'master' ? 'default' : 'outline'}
                        onClick={() => setRedeemScope('master')}
                        size="sm"
                        className="gap-2"
                    >
                        <Gift className="h-4 w-4" />
                        Master Redeem (Global)
                    </Button>
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

            {/* Statistics Dashboard */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <Card>
                    <CardContent className="pt-3 sm:pt-4 lg:pt-6 px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs sm:text-sm text-gray-600">Total Gifts Defined</p>
                                <p className="text-xl sm:text-2xl lg:text-3xl font-bold">{totalGifts}</p>
                            </div>
                            <Gift className="h-6 w-6 sm:h-8 sm:w-8 lg:h-10 lg:w-10 text-blue-500" />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-3 sm:pt-4 lg:pt-6 px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs sm:text-sm text-gray-600">Total Redemptions</p>
                                <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-green-600">{totalRedemptions}</p>
                            </div>
                            <TrendingUp className="h-6 w-6 sm:h-8 sm:w-8 lg:h-10 lg:w-10 text-green-500" />
                        </div>
                        <p className="text-xs text-gray-500 mt-2 hidden sm:block">All time</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-3 sm:pt-4 lg:pt-6 px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs sm:text-sm text-gray-600">This Month</p>
                                <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-purple-600">{redemptionsThisMonth}</p>
                            </div>
                            <Calendar className="h-6 w-6 sm:h-8 sm:w-8 lg:h-10 lg:w-10 text-purple-500" />
                        </div>
                        <p className="text-xs text-gray-500 mt-2 hidden sm:block">Redemptions</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-3 sm:pt-4 lg:pt-6 px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
                        <div className="flex items-center justify-between">
                            <div className="min-w-0 flex-1">
                                <p className="text-xs sm:text-sm text-gray-600">Most Popular</p>
                                <p className="text-base sm:text-lg font-bold text-yellow-600 truncate">{mostPopularGift}</p>
                            </div>
                            <BarChart3 className="h-6 w-6 sm:h-8 sm:w-8 lg:h-10 lg:w-10 text-yellow-500 flex-shrink-0" />
                        </div>
                        <p className="text-xs text-gray-500 mt-2 hidden sm:block">Gift item</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Order Selection Panel */}
                {redeemScope === 'order' && (
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Package className="h-5 w-5" />
                            Select Order
                        </CardTitle>
                        <CardDescription>Choose an order with redemption enabled</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                                placeholder="Search order number..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-9"
                            />
                        </div>

                        {/* Order List */}
                        <div className="space-y-2 max-h-[600px] overflow-y-auto">
                            {loading && !selectedOrder && (
                                <div className="text-center py-8 text-gray-500">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                                    <p className="mt-2">Loading orders...</p>
                                </div>
                            )}

                            {!loading && filteredOrders.length === 0 && (
                                <div className="text-center py-8 text-gray-500">
                                    <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                                    <p>No orders with redemption found</p>
                                </div>
                            )}

                            {filteredOrders.map((order) => (
                                <Card
                                    key={order.id}
                                    className={`cursor-pointer transition-all hover:shadow-md ${selectedOrder?.id === order.id ? 'border-blue-500 bg-blue-50' : ''
                                        }`}
                                    onClick={() => setSelectedOrder(order)}
                                >
                                    <CardContent className="p-4">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <p className="font-semibold">{order.order_no}</p>
                                                {order.legacy_order_no && order.legacy_order_no !== order.order_no && (
                                                    <p className="text-[10px] text-gray-400">Legacy: {order.legacy_order_no}</p>
                                                )}
                                                <p className="text-sm text-gray-600">{order.order_type}</p>
                                                <Badge variant="outline" className="mt-1">
                                                    {order.status}
                                                </Badge>
                                            </div>
                                            {selectedOrder?.id === order.id && (
                                                <Check className="h-5 w-5 text-blue-600" />
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </CardContent>
                </Card>
                )}

                {/* Gifts Management Panel */}
                <Card className={redeemScope === 'order' ? "lg:col-span-2" : "lg:col-span-3"}>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Gift className="h-5 w-5" />
                                    {redeemScope === 'master' ? 'Master Redeem Gifts' : 'Redemption Gifts'}
                                    {selectedOrder && (
                                        <Badge variant="outline" className="ml-2">
                                            {selectedOrder.order_no}
                                        </Badge>
                                    )}
                                </CardTitle>
                                <CardDescription>
                                    {redeemScope === 'master' 
                                        ? 'Manage global redemption gifts available to all users' 
                                        : (selectedOrder
                                            ? 'Define what free gifts consumers will receive'
                                            : 'Select an order to manage its gifts')}
                                </CardDescription>
                            </div>
                            {(redeemScope === 'master' || selectedOrder) && !showForm && (
                                <Button onClick={() => setShowForm(true)}>
                                    <Plus className="h-4 w-4 mr-2" />
                                    {redeemScope === 'master' ? 'Add Master Gift' : 'Add Gift'}
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        {(!selectedOrder && redeemScope === 'order') ? (
                            <div className="text-center py-12 text-gray-500">
                                <Gift className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                <p className="text-lg">Select an order to view and manage gifts</p>
                            </div>
                        ) : showForm ? (
                            /* Gift Form */
                            <div className="space-y-4">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold">
                                        {editingGift ? 'Edit Gift' : 'Add New Gift'}
                                    </h3>
                                    <Button variant="ghost" size="sm" onClick={handleCancelForm}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>

                                <div className="space-y-4">
                                    {/* Category Selector */}
                                    <div>
                                        <Label className="mb-2 block">Category</Label>
                                        <Select 
                                            value={redeemCategory} 
                                            onValueChange={(val: 'gift' | 'point_pool') => setRedeemCategory(val)}
                                            disabled={!!editingGift}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select Category" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="gift">Standard Gift</SelectItem>
                                                <SelectItem value="point_pool">Point Redeem Pool</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div>
                                        <Label htmlFor="giftName">
                                            {redeemCategory === 'point_pool' ? 'Reward Name *' : 'Gift Name *'}
                                        </Label>
                                        <Input
                                            id="giftName"
                                            placeholder="e.g., Premium Coffee Mug or 100 Points Reward"
                                            value={giftName}
                                            onChange={(e) => setGiftName(e.target.value)}
                                        />
                                    </div>

                                    <div>
                                        <Label htmlFor="giftDescription">Description</Label>
                                        <Textarea
                                            id="giftDescription"
                                            placeholder="Describe the gift..."
                                            value={giftDescription}
                                            onChange={(e) => setGiftDescription(e.target.value)}
                                            rows={3}
                                        />
                                    </div>

                                    {redeemCategory === 'point_pool' ? (
                                        <>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <Label htmlFor="pointsPerCollection">Points per Collection *</Label>
                                                    <Input
                                                        id="pointsPerCollection"
                                                        type="number"
                                                        placeholder="e.g. 100"
                                                        value={pointsPerCollection || ''}
                                                        onChange={(e) => setPointsPerCollection(parseInt(e.target.value) || 0)}
                                                    />
                                                </div>
                                                <div>
                                                    <Label htmlFor="totalPointsAllocated">Total Points Allocated *</Label>
                                                    <Input
                                                        id="totalPointsAllocated"
                                                        type="number"
                                                        placeholder="e.g. 1000"
                                                        value={totalPointsAllocated || ''}
                                                        onChange={(e) => setTotalPointsAllocated(parseInt(e.target.value) || 0)}
                                                        disabled={!!editingGift} 
                                                    />
                                                </div>
                                            </div>
                                            
                                            <div className="space-y-3 pt-2 bg-gray-50 p-4 rounded-md border">
                                                <Label className="font-semibold">Collection Options</Label>
                                                <div className="flex flex-col gap-3">
                                                    <div className="flex items-start space-x-2">
                                                        <input
                                                            type="checkbox"
                                                            id="opt1"
                                                            checked={collectionOption1}
                                                            onChange={(e) => setCollectionOption1(e.target.checked)}
                                                            className="mt-1 rounded border-gray-300"
                                                        />
                                                        <div>
                                                            <Label htmlFor="opt1" className="cursor-pointer font-medium">Option 1 - Per user only (based on user ID)</Label>
                                                            <p className="text-xs text-gray-500">If enabled, each user can only collect this reward based on the collection mode below.</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-start space-x-2">
                                                        <input
                                                            type="checkbox"
                                                            id="opt2"
                                                            checked={collectionOption2}
                                                            onChange={(e) => setCollectionOption2(e.target.checked)}
                                                            className="mt-1 rounded border-gray-300"
                                                        />
                                                        <div>
                                                            <Label htmlFor="opt2" className="cursor-pointer font-medium">Option 2 - Everyday (daily collection)</Label>
                                                            <p className="text-xs text-gray-500">If enabled, users can collect once per day. Otherwise, collection is one-time only.</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div>
                                            <Label htmlFor="quantityAvailable">Quantity Available (Optional)</Label>
                                            <Input
                                                id="quantityAvailable"
                                                type="number"
                                                placeholder="Leave empty for unlimited"
                                                value={quantityAvailable || ''}
                                                onChange={(e) => setQuantityAvailable(e.target.value ? parseInt(e.target.value) : undefined)}
                                            />
                                        </div>
                                    )}

                                    <div>
                                        <Label>Gift Image</Label>
                                        <div className="mt-2 space-y-3">
                                            {giftImageUrl ? (
                                                <div className="relative w-full border rounded-lg overflow-hidden bg-gray-50">
                                                    <div className="relative w-full h-64">
                                                        <Image
                                                            src={getStorageUrl(giftImageUrl) || giftImageUrl}
                                                            alt="Gift preview"
                                                            layout="fill"
                                                            objectFit="contain"
                                                        />
                                                    </div>
                                                    <Button
                                                        variant="destructive"
                                                        size="sm"
                                                        className="absolute top-2 right-2"
                                                        onClick={() => setGiftImageUrl('')}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                    <p className="text-xs text-gray-500 text-center py-2 border-t bg-white">
                                                        Preview: Full image will be shown on mobile
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                                                    <ImageIcon className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                                                    <p className="text-sm text-gray-600 mb-2">Upload gift image</p>
                                                    <Input
                                                        type="file"
                                                        accept="image/*"
                                                        onChange={handleImageUpload}
                                                        disabled={uploadingImage}
                                                        className="max-w-xs mx-auto"
                                                    />
                                                    {uploadingImage && (
                                                        <p className="text-sm text-blue-600 mt-2">Uploading and optimizing...</p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-2 pt-4">
                                    <Button onClick={handleSaveGift} disabled={loading || uploadingImage}>
                                        {loading ? 'Saving...' : editingGift ? 'Update Gift' : 'Create Gift'}
                                    </Button>
                                    <Button variant="outline" onClick={handleCancelForm}>
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            /* Gifts List */
                            <div className="space-y-3">
                                {loading && (
                                    <div className="text-center py-8 text-gray-500">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                                        <p className="mt-2">Loading gifts...</p>
                                    </div>
                                )}

                                {!loading && gifts.length === 0 && (
                                    <div className="text-center py-12 text-gray-500">
                                        <Gift className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                        <p className="text-lg mb-2">No gifts defined yet</p>
                                        <p className="text-sm">Click &quot;Add Gift&quot; to create your first gift</p>
                                    </div>
                                )}

                                {!loading && gifts.map((gift) => {
                                    const isPool = gift.category === 'point_pool';
                                    const totalQty = (gift as any).total_quantity || 0;
                                    const claimedQty = (gift as any).claimed_quantity || 0;
                                    const remaining = totalQty - claimedQty;
                                    
                                    // Pool specific
                                    const totalPoints = gift.total_points_allocated || 0;
                                    const remainingPoints = gift.remaining_points !== undefined ? gift.remaining_points : totalPoints;
                                    const pointsPer = gift.points_per_collection || 0;
                                    const isDaily = gift.collection_option_2;
                                    const isOnce = gift.collection_option_1 && !isDaily;

                                    return (
                                        <Card key={gift.id} className="hover:shadow-md transition-shadow">
                                            <CardContent className="p-4">
                                                <div className="flex gap-4">
                                                    {/* Gift Image */}
                                                    {gift.gift_image_url ? (
                                                        <div className="w-24 h-24 bg-gray-50 rounded-lg overflow-hidden flex-shrink-0">
                                                            <Image
                                                                src={getStorageUrl(gift.gift_image_url) || gift.gift_image_url}
                                                                alt={gift.gift_name}
                                                                width={96}
                                                                height={96}
                                                                className="object-contain w-full h-full"
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="w-24 h-24 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                                            <ImageIcon className="h-8 w-8 text-gray-400" />
                                                        </div>
                                                    )}

                                                    {/* Gift Details */}
                                                    <div className="flex-1">
                                                        <div className="flex items-start justify-between">
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <h4 className="font-semibold text-lg">{gift.gift_name}</h4>
                                                                    {isPool && (
                                                                        <>
                                                                            <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100 text-[10px]">Point Pool</Badge>
                                                                            {isDaily && <Badge variant="outline" className="text-[10px]">Daily</Badge>}
                                                                            {isOnce && <Badge variant="outline" className="text-[10px]">One-time</Badge>}
                                                                        </>
                                                                    )}
                                                                </div>
                                                                
                                                                {gift.gift_description && (
                                                                    <p className="text-sm text-gray-600 mt-1">{gift.gift_description}</p>
                                                                )}
                                                                
                                                                {isPool ? (
                                                                     <div className="mt-2 space-y-1">
                                                                         <div className="text-sm">
                                                                             <span className="font-bold text-green-600">+{pointsPer} Points</span> / claim
                                                                         </div>
                                                                         <div className="flex gap-2 text-xs text-gray-500">
                                                                              <span>Pool: {remainingPoints} / {totalPoints} pts</span>
                                                                         </div>
                                                                     </div>
                                                                ) : (
                                                                    totalQty > 0 ? (
                                                                    <div className="mt-2 space-x-2">
                                                                        <Badge variant="outline">
                                                                            {remaining} available
                                                                        </Badge>
                                                                        <Badge variant="secondary">
                                                                            {claimedQty} claimed
                                                                        </Badge>
                                                                    </div>
                                                                    ) : (
                                                                    <Badge variant="outline" className="mt-2">
                                                                        Unlimited
                                                                    </Badge>
                                                                    )
                                                                )}
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => handleEditGift(gift)}
                                                                >
                                                                    <Edit className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => handleDeleteGift(gift.id)}
                                                                >
                                                                    <Trash2 className="h-4 w-4 text-red-600" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
