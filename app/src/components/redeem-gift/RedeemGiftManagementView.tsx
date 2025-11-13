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
}

interface Order {
    id: string;
    order_no: string;
    order_type: string;
    status: string;
    has_redeem: boolean | null;
    company_id: string;
}

interface RedeemGift {
    id: string;
    order_id: string;
    gift_name: string;
    gift_description: string | null;
    gift_image_url?: string | null;
    total_quantity?: number;
    claimed_quantity?: number;
    quantity_available?: number;
    created_at: string;
    updated_at: string;
}

export default function RedeemGiftManagementView({ userProfile, onViewChange }: RedeemGiftManagementViewProps) {
  const supabase = createClient();
  const [orders, setOrders] = useState<Order[]>([]);
  const [gifts, setGifts] = useState<RedeemGift[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingGift, setEditingGift] = useState<RedeemGift | null>(null);
  
  // Form state
  const [giftName, setGiftName] = useState('');
  const [giftDescription, setGiftDescription] = useState('');
  const [giftImageUrl, setGiftImageUrl] = useState('');
  const [quantityAvailable, setQuantityAvailable] = useState<number | undefined>(undefined);
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
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_no, order_type, status, has_redeem, company_id')
        .eq('company_id', userProfile.organization_id)
        .eq('has_redeem', true)
        .order('order_no', { ascending: false });

      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
      showAlert('error', 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [userProfile.organization_id]);
  /* eslint-enable react-hooks/exhaustive-deps */

  /* eslint-disable react-hooks/exhaustive-deps */
  const fetchGifts = useCallback(async (orderId: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('redeem_gifts')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setGifts(data || []);
    } catch (error) {
      console.error('Error fetching gifts:', error);
      showAlert('error', 'Failed to load gifts');
    } finally {
      setLoading(false);
    }
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    fetchOrders();
    fetchRedemptionStatistics();
  }, [fetchOrders, fetchRedemptionStatistics]);

  useEffect(() => {
    if (selectedOrder) {
      fetchGifts(selectedOrder.id);
    }
  }, [selectedOrder, fetchGifts]);

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
        if (!selectedOrder) {
            showAlert('error', 'Please select an order first');
            return;
        }

        if (!giftName.trim()) {
            showAlert('error', 'Gift name is required');
            return;
        }

        try {
            setLoading(true);

            if (editingGift) {
                // Update existing gift
                const { error } = await supabase
                    .from('redeem_gifts')
                    .update({
                        gift_name: giftName,
                        gift_description: giftDescription,
                        gift_image_url: giftImageUrl || null,
                        total_quantity: quantityAvailable || 0,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', editingGift.id);

                if (error) throw error;
                showAlert('success', 'Gift updated successfully');
            } else {
                // Create new gift
                const { error } = await supabase
                    .from('redeem_gifts')
                    .insert({
                        order_id: selectedOrder.id,
                        gift_name: giftName,
                        gift_description: giftDescription,
                        gift_image_url: giftImageUrl || null,
                        total_quantity: quantityAvailable || 0,
                        claimed_quantity: 0,
                        is_active: true
                    });

                if (error) throw error;
                showAlert('success', 'Gift created successfully');
            }

            // Refresh gifts list
            await fetchGifts(selectedOrder.id);
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
        // Use total_quantity from the database
        setQuantityAvailable((gift as any).total_quantity);
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

                {/* Gifts Management Panel */}
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Gift className="h-5 w-5" />
                                    Redemption Gifts
                                    {selectedOrder && (
                                        <Badge variant="outline" className="ml-2">
                                            {selectedOrder.order_no}
                                        </Badge>
                                    )}
                                </CardTitle>
                                <CardDescription>
                                    {selectedOrder
                                        ? 'Define what free gifts consumers will receive'
                                        : 'Select an order to manage its gifts'}
                                </CardDescription>
                            </div>
                            {selectedOrder && !showForm && (
                                <Button onClick={() => setShowForm(true)}>
                                    <Plus className="h-4 w-4 mr-2" />
                                    Add Gift
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        {!selectedOrder ? (
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
                                    <div>
                                        <Label htmlFor="giftName">Gift Name *</Label>
                                        <Input
                                            id="giftName"
                                            placeholder="e.g., Premium Coffee Mug"
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

                                    <div>
                                        <Label>Gift Image</Label>
                                        <div className="mt-2 space-y-3">
                                            {giftImageUrl ? (
                                                <div className="relative w-full border rounded-lg overflow-hidden bg-gray-50">
                                                    <div className="relative w-full h-64">
                                                        <Image
                                                            src={giftImageUrl}
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
                                                    const totalQty = (gift as any).total_quantity || 0;
                                                    const claimedQty = (gift as any).claimed_quantity || 0;
                                                    const remaining = totalQty - claimedQty;
                                                    
                                                    return (
                                                        <Card key={gift.id} className="hover:shadow-md transition-shadow">
                                                            <CardContent className="p-4">
                                                                <div className="flex gap-4">
                                                                    {/* Gift Image */}
                                                                    {gift.gift_image_url ? (
                                                                        <div className="w-24 h-24 bg-gray-50 rounded-lg overflow-hidden flex-shrink-0">
                                                                            <Image
                                                                                src={gift.gift_image_url}
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
                                                                                <h4 className="font-semibold text-lg">{gift.gift_name}</h4>
                                                                                {gift.gift_description && (
                                                                                    <p className="text-sm text-gray-600 mt-1">{gift.gift_description}</p>
                                                                                )}
                                                                                {totalQty > 0 && (
                                                                                    <div className="mt-2 space-x-2">
                                                                                        <Badge variant="outline">
                                                                                            {remaining} available
                                                                                        </Badge>
                                                                                        <Badge variant="secondary">
                                                                                            {claimedQty} claimed
                                                                                        </Badge>
                                                                                    </div>
                                                                                )}
                                                                                {totalQty === 0 && (
                                                                                    <Badge variant="outline" className="mt-2">
                                                                                        Unlimited
                                                                                    </Badge>
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
