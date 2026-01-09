'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { formatNumber } from '@/lib/utils/formatters'
import { createClient } from '@/lib/supabase/client'
import { logoutConsumer } from '@/app/actions/consumer'
import { registerConsumer } from '@/lib/actions'
import { SupportChatWidget } from '@/components/support/SupportChatWidget'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import {
    Home,
    Gift,
    Star,
    Gamepad2,
    User,
    ChevronRight,
    ChevronLeft,
    Coins,
    Trophy,
    Sparkles,
    CheckCircle2,
    ArrowLeft,
    X,
    XCircle,
    ShoppingBag,
    Ticket,
    Crown,
    Zap,
    Package,
    LogIn,
    CreditCard,
    LogOut,
    Eye,
    EyeOff,
    Loader2,
    Mail,
    Phone,
    Settings,
    Lock,
    Shield,
    MapPin,
    Save,
    Check,
    MessageSquare,
    Send,
    TrendingUp,
    Grid3x3,
    List,
    Ghost,
    AlertTriangle,
    AlertCircle,
    Camera
} from 'lucide-react'
import { SecurityCodeModal } from '../SecurityCodeModal'
import { AnnouncementBanner } from '../AnnouncementBanner'
import ScratchCard from '../ScratchCard'
import SpinWheelGame from '../SpinWheelGame'
import DailyQuizGame from '../DailyQuizGame'
import { extractTokenFromQRCode } from '@/utils/qrSecurity'
import { PointEarnedAnimation } from '@/components/animations/PointEarnedAnimation'
import { LuckyDrawSuccessAnimation } from '@/components/animations/LuckyDrawSuccessAnimation'
import { GenuineProductAnimation } from '@/components/animations/GenuineProductAnimation'
import { RewardRedemptionAnimation } from '@/components/animations/RewardRedemptionAnimation'
import { GiftClaimedAnimation } from '@/components/animations/GiftClaimedAnimation'
import { InsufficientPointsAnimation } from '@/components/animations/InsufficientPointsAnimation'
import { validatePhoneNumber, normalizePhone, getStorageUrl } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'

// Types
interface JourneyConfig {
    id?: string
    welcome_title: string
    welcome_message: string
    thank_you_message: string
    primary_color: string
    button_color: string
    points_enabled: boolean
    lucky_draw_enabled: boolean
    redemption_enabled: boolean
    require_security_code?: boolean
    // Per-feature security code bypass
    skip_security_code_for_points?: boolean
    skip_security_code_for_lucky_draw?: boolean
    skip_security_code_for_redemption?: boolean
    skip_security_code_for_scratch_card?: boolean
    show_product_image?: boolean
    product_image_source?: 'variant' | 'custom' | 'genuine_badge'
    custom_image_url?: string
    genuine_badge_style?: string
    variant_image_url?: string | null
    lucky_draw_image_url?: string | null
    lucky_draw_campaign_name?: string | null
    lucky_draw_prizes?: any[]
    enable_scratch_card_game?: boolean
    points_title?: string | null
    points_description?: string | null
    lucky_draw_title?: string
    lucky_draw_description?: string
    redemption_title?: string
    redemption_description?: string
    scratch_card_title?: string
    scratch_card_description?: string
    banner_config?: {
        enabled: boolean
        template: 'grid' | 'carousel'
        location?: 'home' | 'rewards' | 'products' | 'profile'
        items: Array<{
            id: string
            image_url: string
            link_to?: 'rewards' | 'products' | 'contact-us' | 'no-link' | string
            expires_at?: string
            page?: 'home' | 'rewards' | 'products' | 'profile'
        }>
    }
}

interface RewardItem {
    id: string
    item_name: string
    item_description: string | null
    points_required: number
    point_offer?: number | null
    item_image_url: string | null
    additional_images?: string[]
    item_code: string
    stock_quantity: number | null
    is_active: boolean | null
}

interface ProductItem {
    id: string
    product_name: string
    product_description: string | null
    product_code: string
    brand_name?: string
    category_name?: string
    hide_price?: boolean
    primary_image_url?: string | null
    variants?: {
        id: string
        variant_name: string
        suggested_retail_price: number | null
        other_price?: number | null
        image_url?: string | null
    }[]
}

type TabType = 'home' | 'rewards' | 'products' | 'games' | 'profile' | 'account-settings' | 'lucky-draw' | 'play-scratch-card' | 'spin-wheel' | 'daily-quiz'

interface ProductInfo {
    product_name?: string
    variant_name?: string
    brand_name?: string
}

interface PremiumLoyaltyTemplateProps {
    config: JourneyConfig
    qrCode?: string
    orgId?: string
    isLive?: boolean
    consumerPhone?: string
    productInfo?: ProductInfo
}

export default function PremiumLoyaltyTemplate({
    config,
    qrCode,
    orgId,
    isLive = false,
    consumerPhone,
    productInfo
}: PremiumLoyaltyTemplateProps) {
    const supabase = createClient()
    const { toast } = useToast()
    const [activeTab, setActiveTab] = useState<TabType>('home')

    // Scratch Card State
    const [scratchResult, setScratchResult] = useState<{ isWin: boolean, rewardName: string } | null>(null)
    const [isScratching, setIsScratching] = useState(false)
    const [scratchError, setScratchError] = useState<string | null>(null)
    const [scratchCardAlreadyPlayed, setScratchCardAlreadyPlayed] = useState(false)
    const [scratchCardPreviousReward, setScratchCardPreviousReward] = useState<string | null>(null)
    const [qrCodeDbId, setQrCodeDbId] = useState<string | null>(null)

    const [userPoints, setUserPoints] = useState(0)
    const [userName, setUserName] = useState('')
    const [userEmail, setUserEmail] = useState('')
    const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null)
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
    const [shopName, setShopName] = useState('')
    const [rewards, setRewards] = useState<RewardItem[]>([])
    const [products, setProducts] = useState<ProductItem[]>([])
    const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null)
    const [selectedRewardForDetail, setSelectedRewardForDetail] = useState<RewardItem | null>(null)
    const [currentRewardImageIndex, setCurrentRewardImageIndex] = useState(0)

    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleAvatarClick = () => {
        if (isAuthenticated) {
            fileInputRef.current?.click()
        }
    }

    const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        try {
            if (!event.target.files || event.target.files.length === 0) {
                return
            }

            // Get user ID from state or auth
            let currentUserId = userId
            if (!currentUserId) {
                const { data: { user } } = await supabase.auth.getUser()
                if (user) currentUserId = user.id
            }

            if (!currentUserId) {
                toast({
                    title: "Error",
                    description: "You must be logged in to upload an avatar",
                    variant: "destructive"
                })
                return
            }

            const file = event.target.files[0]
            const fileExt = file.name.split('.').pop()
            const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`
            const filePath = `${currentUserId}/${fileName}`

            setIsUploadingAvatar(true)

            // 1. Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, file)

            if (uploadError) {
                throw uploadError
            }

            // 2. Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('avatars')
                .getPublicUrl(filePath)

            // 3. Update User Profile
            const { error: updateError } = await supabase
                .from('users')
                .update({ avatar_url: publicUrl })
                .eq('id', currentUserId)

            if (updateError) {
                throw updateError
            }

            // 4. Update Local State
            setUserAvatarUrl(publicUrl)
            toast({
                title: "Success",
                description: "Avatar updated successfully",
            })

        } catch (error: any) {
            console.error('Error uploading avatar:', error)
            toast({
                title: "Error",
                description: "Failed to upload avatar: " + error.message,
                variant: "destructive"
            })
        } finally {
            setIsUploadingAvatar(false)
            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
        }
    }
    const [showRewardDetailModal, setShowRewardDetailModal] = useState(false)
    const [loadingRewards, setLoadingRewards] = useState(false)
    const [loadingProducts, setLoadingProducts] = useState(false)
    const [pointsCollected, setPointsCollected] = useState(false)
    const [qrPointsCollected, setQrPointsCollected] = useState(false) // From DB - persists across sessions
    const [pointsEarned, setPointsEarned] = useState(0)
    const [lastEarnedPoints, setLastEarnedPoints] = useState(0) // Persists after modal closes
    const [totalBalance, setTotalBalance] = useState(0)
    const [previousBalance, setPreviousBalance] = useState(0)
    const [luckyDrawEntered, setLuckyDrawEntered] = useState(false)
    const [luckyDrawQrUsed, setLuckyDrawQrUsed] = useState(false) // Track if QR already used for lucky draw
    const [checkingQrStatus, setCheckingQrStatus] = useState(true) // Start true to show loading

    // Control visibility of Free Gifts section in Rewards tab
    const [showFreeGifts, setShowFreeGifts] = useState(false)

    // Points collection modal states
    const [showPointsLoginModal, setShowPointsLoginModal] = useState(false)
    const [showShopPassword, setShowShopPassword] = useState(false)
    const [shopId, setShopId] = useState('')
    const [shopPassword, setShopPassword] = useState('')
    const [collectingPoints, setCollectingPoints] = useState(false)
    const [pointsError, setPointsError] = useState('')
    const [showPointsSuccessModal, setShowPointsSuccessModal] = useState(false)

    // Auth states (for profile login)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [isShopUser, setIsShopUser] = useState(false)
    const [authLoading, setAuthLoading] = useState(true)

    // Ref to track if we're currently fetching profile (prevents duplicate fetches)
    const isFetchingProfileRef = useRef(false)
    const lastProfileFetchTimeRef = useRef(0)
    const lastProfileRefreshRef = useRef(0)

    // Game active states
    const [activeGames, setActiveGames] = useState({
        scratch: false,
        spin: false,
        quiz: false
    })

    useEffect(() => {
        if (config?.id) {
            checkActiveGames()
        }
    }, [config?.id])

    const checkActiveGames = async () => {
        if (!config?.id) return

        try {
            // Use API route to bypass RLS for public consumer access
            const response = await fetch(`/api/consumer/active-games?journey_config_id=${config.id}`)
            const result = await response.json()

            if (result.success) {
                setActiveGames({
                    scratch: result.activeGames?.scratch || false,
                    spin: result.activeGames?.spin || false,
                    quiz: result.activeGames?.quiz || false
                })
            } else {
                console.error('Error checking active games:', result.error)
            }
        } catch (error) {
            console.error('Error checking active games:', error)
        }
    }

    // Fetch banks
    useEffect(() => {
        const fetchBanks = async () => {
            const { data, error } = await supabase
                .from('msia_banks')
                .select('*')
                .eq('is_active', true)
                .order('short_name')

            if (data) {
                setBanks(data)
            }
        }

        fetchBanks()
    }, [])

    const [showLoginForm, setShowLoginForm] = useState(false)
    const [loginEmail, setLoginEmail] = useState('')
    const [loginPassword, setLoginPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = useState(false)
    const [loginLoading, setLoginLoading] = useState(false)
    const [loginError, setLoginError] = useState('')
    const [emailError, setEmailError] = useState('')
    const [phoneError, setPhoneError] = useState('')
    const [isSignUp, setIsSignUp] = useState(false)

    // Signup states
    const [signUpName, setSignUpName] = useState('')
    const [signUpPhone, setSignUpPhone] = useState('')
    const [signUpLocation, setSignUpLocation] = useState('')
    const [signUpConfirmPassword, setSignUpConfirmPassword] = useState('')

    // Security modal states
    const [showSecurityModal, setShowSecurityModal] = useState(false)
    const [securityVerified, setSecurityVerified] = useState(false)
    const [pendingAction, setPendingAction] = useState<string | null>(null)

    // Form states for lucky draw
    const [customerName, setCustomerName] = useState('')
    const [customerPhone, setCustomerPhone] = useState('')
    const [customerEmail, setCustomerEmail] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [showLuckyDrawSuccess, setShowLuckyDrawSuccess] = useState(false)
    const [luckyDrawError, setLuckyDrawError] = useState('')
    const [luckyDrawPhoneError, setLuckyDrawPhoneError] = useState('')
    const [luckyDrawEmailError, setLuckyDrawEmailError] = useState('')

    // Account settings states
    const [userPhone, setUserPhone] = useState('')
    const [userId, setUserId] = useState<string | null>(null)
    const [editingName, setEditingName] = useState(false)
    const [editingPhone, setEditingPhone] = useState(false)

    // Bank details state
    const [bankDetails, setBankDetails] = useState<{
        bankId: string | null
        bankName: string | null
        accountNumber: string | null
        holderName: string | null
    }>({ bankId: null, bankName: null, accountNumber: null, holderName: null })
    const [showBankDetailsModal, setShowBankDetailsModal] = useState(false)
    const [newName, setNewName] = useState('')
    const [newPhone, setNewPhone] = useState('')
    const [savingProfile, setSavingProfile] = useState(false)
    const [profileSaveError, setProfileSaveError] = useState('')
    const [profileSaveSuccess, setProfileSaveSuccess] = useState(false)

    // Bank Account states
    const [banks, setBanks] = useState<any[]>([])
    const [bankId, setBankId] = useState('')
    const [bankAccountNumber, setBankAccountNumber] = useState('')
    const [bankAccountHolderName, setBankAccountHolderName] = useState('')
    const [showBankInfo, setShowBankInfo] = useState(false)
    const [bankError, setBankError] = useState('')

    // Address states
    const [userAddress, setUserAddress] = useState('')
    const [editingAddress, setEditingAddress] = useState(false)
    const [newAddress, setNewAddress] = useState('')

    // Password change states
    const [showChangePassword, setShowChangePassword] = useState(false)
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [showCurrentPassword, setShowCurrentPassword] = useState(false)
    const [showNewPassword, setShowNewPassword] = useState(false)
    const [showChangeConfirmPassword, setShowChangeConfirmPassword] = useState(false)
    const [changingPassword, setChangingPassword] = useState(false)
    const [passwordError, setPasswordError] = useState('')
    const [passwordSuccess, setPasswordSuccess] = useState(false)
    const [showProfileInfo, setShowProfileInfo] = useState(false)

    // Genuine product verified animation state
    const [showGenuineVerified, setShowGenuineVerified] = useState(false)

    // Points animation state
    const [showPointsAnimation, setShowPointsAnimation] = useState(false)
    const [displayPoints, setDisplayPoints] = useState(0)

    // Animate points counter
    useEffect(() => {
        if (showPointsAnimation) {
            let start = 0
            const end = userPoints
            const duration = 2000
            const startTime = Date.now()

            const animate = () => {
                const now = Date.now()
                const progress = Math.min((now - startTime) / duration, 1)
                const easeOutQuart = 1 - Math.pow(1 - progress, 4)

                setDisplayPoints(Math.floor(start + (end - start) * easeOutQuart))

                if (progress < 1) {
                    requestAnimationFrame(animate)
                }
            }

            requestAnimationFrame(animate)
        } else {
            setDisplayPoints(0)
        }
    }, [showPointsAnimation, userPoints])

    // Reward redemption states
    const [selectedReward, setSelectedReward] = useState<RewardItem | null>(null)
    const [showRedeemConfirm, setShowRedeemConfirm] = useState(false)
    const [redeeming, setRedeeming] = useState(false)
    const [redeemError, setRedeemError] = useState('')
    const [showRedeemSuccess, setShowRedeemSuccess] = useState(false)
    const [redemptionDetails, setRedemptionDetails] = useState<{
        rewardName: string
        pointsDeducted: number
        newBalance: number
        redemptionCode: string
    } | null>(null)
    // Track last redeemed reward for Recent Activity display
    const [lastRedeemedReward, setLastRedeemedReward] = useState<{
        rewardName: string
        pointsDeducted: number
    } | null>(null)

    const [showInsufficientPoints, setShowInsufficientPoints] = useState(false)
    const [insufficientPointsData, setInsufficientPointsData] = useState<{ needed: number, available: number } | null>(null)

    // Rewards tab category states
    type RewardCategoryType = 'All' | 'Scanned' | 'Point History' | 'History'
    const [rewardCategory, setRewardCategory] = useState<RewardCategoryType>('All')
    const [redemptionHistory, setRedemptionHistory] = useState<any[]>([])
    const [pointsHistory, setPointsHistory] = useState<any[]>([])
    const [scannedProducts, setScannedProducts] = useState<any[]>([])
    const [loadingRedemptionHistory, setLoadingRedemptionHistory] = useState(false)
    const [loadingPointsHistory, setLoadingPointsHistory] = useState(false)
    const [loadingScannedProducts, setLoadingScannedProducts] = useState(false)

    // Pagination states
    const [redemptionPage, setRedemptionPage] = useState(1)
    const [pointsPage, setPointsPage] = useState(1)
    const [scannedPage, setScannedPage] = useState(1)
    const [scannedViewMode, setScannedViewMode] = useState<'grid' | 'list'>('list')
    const itemsPerPage = 10

    // Feedback states
    const [showFeedbackModal, setShowFeedbackModal] = useState(false)
    const [feedbackTitle, setFeedbackTitle] = useState('')
    const [feedbackMessage, setFeedbackMessage] = useState('')
    const [submittingFeedback, setSubmittingFeedback] = useState(false)
    const [feedbackError, setFeedbackError] = useState('')
    const [feedbackSuccess, setFeedbackSuccess] = useState(false)

    // Free Gift Redemption states
    interface FreeGift {
        id: string
        gift_name: string
        gift_description: string | null
        gift_image_url: string | null
        total_quantity: number
        claimed_quantity: number
    }
    const [freeGifts, setFreeGifts] = useState<FreeGift[]>([])
    const [loadingFreeGifts, setLoadingFreeGifts] = useState(false)
    const [giftRedeemed, setGiftRedeemed] = useState(false)
    const [giftQrUsed, setGiftQrUsed] = useState(false)
    const [selectedGift, setSelectedGift] = useState<FreeGift | null>(null)
    const [showGiftConfirm, setShowGiftConfirm] = useState(false)
    const [claimingGift, setClaimingGift] = useState(false)
    const [giftError, setGiftError] = useState('')
    const [showGiftSuccess, setShowGiftSuccess] = useState(false)
    const [claimedGiftName, setClaimedGiftName] = useState('')

    // Helper function to check if user is from SHOP organization (uses API to bypass RLS)
    const checkUserOrganization = async (userId: string, force: boolean = false) => {
        // Prevent duplicate simultaneous fetches unless forced
        if (!force && isFetchingProfileRef.current) {
            console.log('🔐 Profile fetch already in progress, skipping...')
            return { success: false, isShop: false, fullName: '', organizationId: null, avatarUrl: null, orgName: '', phone: '', pointsBalance: 0, duplicate: true }
        }

        // Prevent duplicate fetches if fetched recently (within 2 seconds)
        if (!force && Date.now() - lastProfileFetchTimeRef.current < 2000) {
            console.log('🔐 Profile fetched recently, skipping...')
            return { success: false, isShop: false, fullName: '', organizationId: null, avatarUrl: null, orgName: '', phone: '', pointsBalance: 0, duplicate: true }
        }

        isFetchingProfileRef.current = true

        try {
            console.log('🔐 checkUserOrganization - Starting for userId:', userId)

            // Get current session to pass token
            const { data: { session }, error: sessionError } = await supabase.auth.getSession()
            if (sessionError || !session || !session.access_token) {
                console.error('🔐 Session missing/invalid:', sessionError)
                // Treat missing session as invalid so caller can clear state
                return { isShop: false, fullName: '', organizationId: null, avatarUrl: null, orgName: '', phone: '', pointsBalance: 0, sessionInvalid: true }
            }
            const token = session.access_token
            console.log('🔐 Got session token:', !!token)

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s timeout

            // Use API endpoint to fetch profile (bypasses RLS issues)
            const response = await fetch('/api/user/profile', {
                headers: {
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                    'Content-Type': 'application/json'
                },
                credentials: 'include', // Important: include cookies for auth
                signal: controller.signal
            }).finally(() => clearTimeout(timeoutId))

            console.log('🔐 Profile API response status:', response.status)

            // Handle 401 - session is invalid/expired
            if (response.status === 401) {
                console.log('🔐 Session expired/invalid (401), clearing auth and browser storage...')

                // Clear browser storage to remove stale session data
                if (typeof window !== 'undefined') {
                    const localKeys = Object.keys(localStorage)
                    localKeys.forEach(key => {
                        if (key.includes('supabase') || key.includes('sb-')) {
                            localStorage.removeItem(key)
                        }
                    })
                    const sessionKeys = Object.keys(sessionStorage)
                    sessionKeys.forEach(key => {
                        if (key.includes('supabase') || key.includes('sb-')) {
                            sessionStorage.removeItem(key)
                        }
                    })
                }

                await supabase.auth.signOut({ scope: 'local' })
                return { success: false, isShop: false, fullName: '', organizationId: null, avatarUrl: null, orgName: '', phone: '', pointsBalance: 0, sessionInvalid: true }
            }

            const result = await response.json()
            console.log('🔐 Profile API result:', result)

            if (!result.success || !result.profile) {
                console.error('🔐 Error fetching user profile via API:', result.error)
                return { success: false, isShop: false, fullName: '', organizationId: null, avatarUrl: null, orgName: '', phone: '', pointsBalance: 0 }
            }

            const profile = result.profile
            console.log('🔐 User profile fetched via API:', {
                fullName: profile.fullName,
                avatarUrl: profile.avatarUrl,
                phone: profile.phone,
                organizationId: profile.organizationId,
                isShop: profile.isShop,
                orgName: profile.orgName,
                pointsBalance: profile.pointsBalance
            })

            // Update last fetch time
            lastProfileFetchTimeRef.current = Date.now()

            return {
                success: true,
                isShop: profile.isShop === true, // Explicit boolean conversion
                fullName: profile.fullName || '',
                organizationId: profile.organizationId,
                avatarUrl: profile.avatarUrl,
                orgName: profile.orgName || '',
                phone: profile.phone || '',
                address: profile.address || '',
                pointsBalance: profile.pointsBalance || 0,
                bankId: profile.bankId || '',
                bankName: profile.bankName || '',
                bankAccountNumber: profile.bankAccountNumber || '',
                bankAccountHolderName: profile.bankAccountHolderName || ''
            }
        } catch (error) {
            console.error('🔐 Error checking user organization:', error)
            return { success: false, isShop: false, fullName: '', organizationId: null, avatarUrl: null, orgName: '', phone: '', pointsBalance: 0 }
        } finally {
            isFetchingProfileRef.current = false
        }
    }

    // Ref to track if initial auth check completed (prevents double profile fetch)
    const initialAuthCheckDoneRef = useRef(false)

    // Check auth status on mount
    useEffect(() => {
        // IMPORTANT: Mark that auth check is starting immediately
        // This prevents onAuthStateChange from running before initial check is done
        const isInitialCheck = !initialAuthCheckDoneRef.current
        if (isInitialCheck) {
            console.log('🔐 Starting initial auth check - blocking onAuthStateChange')
        }

        const checkAuth = async () => {
            // Set a timeout to ensure authLoading becomes false even if API hangs
            const authTimeout = setTimeout(() => {
                console.log('🔐 Auth check timeout - forcing authLoading to false')
                setAuthLoading(false)
                initialAuthCheckDoneRef.current = true
            }, 5000) // 5 second timeout

            try {
                console.log('🔐 Checking auth status...')

                // Check for active session marker in sessionStorage
                const activeSessionMarker = sessionStorage.getItem('serapod_active_session')

                // If user has logged in during this browser session, preserve their session
                if (activeSessionMarker === 'logged_in') {
                    console.log('🔐 Active session marker found - user previously logged in this session')
                    // Continue to validate the session below
                } else if (!activeSessionMarker) {
                    // No session marker - this could be a fresh scan or returning user
                    // Don't clear sessions immediately - check if there's a valid session first
                    console.log('🔐 No session marker - checking for existing valid session')
                    sessionStorage.setItem('serapod_active_session', 'checked')
                }

                // Validate session with server using getUser()
                const { data: userData, error: getUserError } = await supabase.auth.getUser()
                let user = userData?.user || null
                let authError = getUserError || null

                console.log('🔐 getUser result:', user?.id, user?.email, 'Error:', authError?.message)

                // If getUser fails with auth error or no user, user is not authenticated
                if (authError || !user) {
                    console.log('🔐 No valid session found')
                    setIsAuthenticated(false)
                    setIsShopUser(false)
                    setUserEmail('')
                    setUserName('')
                    setUserPoints(0)
                    setUserAvatarUrl(null)
                    setShopName('')
                    setUserPhone('')
                    setUserId(null)
                    clearTimeout(authTimeout)
                    setAuthLoading(false)
                    initialAuthCheckDoneRef.current = true
                    return
                }

                // User exists and is valid - they are authenticated!
                console.log('🔐 User session validated with server')
                setIsAuthenticated(true)
                setUserEmail(user.email || '')
                setUserId(user.id)
                setUserName(user.user_metadata?.full_name || user.email?.split('@')[0] || 'User')

                // Mark session as logged in so it persists across QR scans
                sessionStorage.setItem('serapod_active_session', 'logged_in')

                // Fetch profile data
                console.log('🔐 User found, fetching profile data...')

                try {
                    const profileResult = await checkUserOrganization(user.id)
                    const { success, isShop, fullName, organizationId, avatarUrl, orgName, phone, address, pointsBalance, sessionInvalid, bankId, bankAccountNumber, bankAccountHolderName } = profileResult as any

                    if (sessionInvalid) {
                        console.log('🔐 Session was invalid, clearing auth state')
                        await supabase.auth.signOut()
                        setIsAuthenticated(false)
                        setIsShopUser(false)
                        setUserEmail('')
                        setUserName('')
                        setUserPoints(0)
                        setUserAvatarUrl(null)
                        setShopName('')
                        setUserPhone('')
                        setUserId(null)
                        initialAuthCheckDoneRef.current = true
                        return
                    }

                    if (success) {
                        console.log('🔐 Profile data received:', { isShop, fullName, avatarUrl, orgName, phone, pointsBalance })
                        setIsShopUser(isShop)
                        setUserName(fullName || user.user_metadata?.full_name || user.email?.split('@')[0] || '')
                        setUserAvatarUrl(avatarUrl)
                        setShopName(orgName)
                        setUserPhone(phone)
                        setNewName(fullName || user.user_metadata?.full_name || user.email?.split('@')[0] || '')
                        setNewPhone(phone)

                        // Set points and bank details for ALL users (Shop and Independent)
                        console.log('🔐 Setting user points balance:', pointsBalance)
                        setUserPoints(pointsBalance)
                        // Set bank details
                        setBankId(bankId || '')
                        setBankAccountNumber(bankAccountNumber || '')
                        setBankAccountHolderName(bankAccountHolderName || '')
                        // Set address
                        setUserAddress(address || '')
                        setNewAddress(address || '')
                    } else {
                        console.warn('🔐 Profile fetch failed, using basic info')
                        setUserName(user.user_metadata?.full_name || user.email?.split('@')[0] || 'User')
                        setIsShopUser(false)
                    }
                } catch (profileError) {
                    console.error('🔐 Profile fetch error:', profileError)
                    setUserName(user.user_metadata?.full_name || user.email?.split('@')[0] || 'User')
                    setIsShopUser(false)
                }
            } catch (error) {
                console.error('Auth check error:', error)
            } finally {
                clearTimeout(authTimeout)
                setAuthLoading(false)
                initialAuthCheckDoneRef.current = true
                console.log('🔐 Initial auth check completed - onAuthStateChange now active')
            }
        }

        // Run initial auth check first
        checkAuth()

        // IMPORTANT: Set up auth listener AFTER a small delay to ensure initial check starts first
        // This prevents race conditions where onAuthStateChange fires before checkAuth completes
        const setupAuthListener = () => {
            const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
                console.log('🔐 Auth state changed:', event, '| Has session:', !!session?.user, '| Initial check done:', initialAuthCheckDoneRef.current)

                // CRITICAL: Skip ALL events until initial auth check is complete
                if (!initialAuthCheckDoneRef.current) {
                    console.log('🔐 Skipping auth state change - initial check not done yet')
                    return
                }

                // Skip INITIAL_SESSION - this is just the first sync on page load
                if (event === 'INITIAL_SESSION') {
                    console.log('🔐 Skipping INITIAL_SESSION - already handled by checkAuth')
                    return
                }

                // Only process SIGNED_IN and SIGNED_OUT events to avoid duplicate fetches
                if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') {
                    console.log('🔐 Skipping non-essential auth event:', event)
                    return
                }

                if (session?.user && event === 'SIGNED_IN') {
                    console.log('🔐 Processing SIGNED_IN event')
                    // User just signed in - set authenticated immediately
                    setIsAuthenticated(true)
                    setUserEmail(session.user.email || '')
                    setUserId(session.user.id)

                    // Mark active session
                    sessionStorage.setItem('serapod_active_session', 'logged_in')

                    // Skip profile fetch if already in progress
                    if (isFetchingProfileRef.current) {
                        console.log('🔐 Profile fetch already in progress, skipping')
                        return
                    }

                    // Fetch profile
                    try {
                        const { success, isShop, fullName, organizationId, avatarUrl, orgName, phone, address, pointsBalance, bankId, bankAccountNumber, bankAccountHolderName } = await checkUserOrganization(session.user.id) as any

                        if (success) {
                            console.log('🔐 Profile fetched on SIGNED_IN')
                            setIsShopUser(isShop)
                            setUserName(fullName || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '')
                            setUserAvatarUrl(avatarUrl)
                            setShopName(orgName)
                            setUserPhone(phone)
                            setNewName(fullName || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '')
                            setNewPhone(phone)

                            // Set points and bank details for ALL users
                            setUserPoints(pointsBalance)
                            setBankId(bankId || '')
                            setBankAccountNumber(bankAccountNumber || '')
                            setBankAccountHolderName(bankAccountHolderName || '')
                            // Set address
                            setUserAddress(address || '')
                            setNewAddress(address || '')
                        }
                    } catch (error) {
                        console.error('🔐 Profile fetch error on auth change:', error)
                    }
                } else if (event === 'SIGNED_OUT') {
                    console.log('🔐 Processing SIGNED_OUT event')
                    // User signed out - clear all state
                    sessionStorage.removeItem('serapod_active_session')
                    setIsAuthenticated(false)
                    setIsShopUser(false)
                    setUserEmail('')
                    setUserName('')
                    setUserPoints(0)
                    setUserAvatarUrl(null)
                    setShopName('')
                    setUserPhone('')
                    setUserId(null)
                }
            })

            return subscription
        }

        // Set up the auth listener
        const subscription = setupAuthListener()

        return () => {
            subscription.unsubscribe()
        }
    }, [supabase, qrCode])

    // Show genuine product verified animation on page load
    useEffect(() => {
        if (isLive && productInfo?.product_name) {
            // Show animation after a brief delay
            const timer = setTimeout(() => {
                setShowGenuineVerified(true)
                // Auto-hide after 4 seconds
                setTimeout(() => {
                    setShowGenuineVerified(false)
                    setShowPointsAnimation(true)
                }, 4000)
            }, 500)
            return () => clearTimeout(timer)
        } else {
            // If no genuine animation, show points animation immediately
            const timer = setTimeout(() => setShowPointsAnimation(true), 500)
            return () => clearTimeout(timer)
        }
    }, [isLive, productInfo])

    // Fetch rewards on mount for Featured Rewards section
    useEffect(() => {
        if (isLive && orgId) {
            fetchRewards()
        }
    }, [isLive, orgId])

    // Fetch rewards from API when rewards tab is active
    useEffect(() => {
        if (activeTab === 'rewards' && isLive && orgId) {
            fetchRewards()
        }
    }, [activeTab, isLive, orgId])

    // Fetch free gifts when rewards tab is active (fixes issue where free gifts don't show when directly navigating to Rewards)
    useEffect(() => {
        if (activeTab === 'rewards' && isLive && qrCode && config.redemption_enabled) {
            fetchFreeGifts()
            checkGiftRedeemStatus()
        }
    }, [activeTab, isLive, qrCode, config.redemption_enabled])

    // Fetch rewards tab data when user logs in while on rewards tab
    useEffect(() => {
        if (activeTab === 'rewards' && isAuthenticated && isLive) {
            console.log('🔐 User authenticated on rewards tab, fetching data for category:', rewardCategory)
            // Fetch data based on current category
            if (rewardCategory === 'History') {
                fetchRedemptionHistory()
            } else if (rewardCategory === 'Point History') {
                fetchPointsHistory()
            } else if (rewardCategory === 'Scanned') {
                fetchScannedProducts()
            }
        }
    }, [isAuthenticated, activeTab, isLive])

    // Fetch products from API when products tab is active
    useEffect(() => {
        if (activeTab === 'products' && isLive && orgId) {
            fetchProducts()
        }
    }, [activeTab, isLive, orgId])

    // Ensure profile state is fresh whenever user opens Profile tab (handles stale/expired sessions)
    useEffect(() => {
        const refreshProfileIfNeeded = async () => {
            if (activeTab !== 'profile') return

            // If not authenticated, show login form
            if (!isAuthenticated) {
                setShowLoginForm(true)
                return
            }

            if (!userId) return

            // Avoid duplicate / overly frequent fetches (5s cooldown)
            const now = Date.now()
            if (isFetchingProfileRef.current) return
            if (now - lastProfileRefreshRef.current < 5000) return

            isFetchingProfileRef.current = true
            try {
                const profile = await checkUserOrganization(userId, true)
                lastProfileRefreshRef.current = Date.now()

                if (!profile.success || profile.sessionInvalid) {
                    await supabase.auth.signOut()
                    setIsAuthenticated(false)
                    setIsShopUser(false)
                    setUserEmail('')
                    setUserName('')
                    setUserPoints(0)
                    setUserAvatarUrl(null)
                    setShopName('')
                    setUserPhone('')
                    setUserId(null)
                    setShowLoginForm(true)
                    return
                }

                setIsShopUser(profile.isShop)
                setUserName(profile.fullName || userName)
                setUserAvatarUrl(profile.avatarUrl)
                setShopName(profile.orgName || shopName)
                setUserPhone(profile.phone || userPhone)
                if (profile.isShop) {
                    setUserPoints(profile.pointsBalance)
                }
            } catch (err) {
                console.error('🔐 Profile refresh on profile tab failed:', err)
            } finally {
                isFetchingProfileRef.current = false
            }
        }

        refreshProfileIfNeeded()
    }, [activeTab, isAuthenticated, userId, supabase, userName, shopName, userPhone])

    // Check QR status function - reusable for multiple calls
    const checkQrStatusFromApi = async (): Promise<{ isLuckyDrawEntered: boolean, isPointsCollected: boolean }> => {
        if (!qrCode) return { isLuckyDrawEntered: false, isPointsCollected: false }

        try {
            const response = await fetch(`/api/consumer/check-lucky-draw-status?qr_code=${encodeURIComponent(qrCode)}`)
            const data = await response.json()

            if (data.success) {
                return {
                    isLuckyDrawEntered: data.is_lucky_draw_entered || false,
                    isPointsCollected: data.is_points_collected || false
                }
            }
        } catch (error) {
            console.error('Error checking QR status:', error)
        }
        return { isLuckyDrawEntered: false, isPointsCollected: false }
    }

    // Check QR status on mount - this prevents button clicks if already used
    useEffect(() => {
        const checkQrStatus = async () => {
            if (!qrCode) {
                setCheckingQrStatus(false)
                return
            }

            setCheckingQrStatus(true)

            // Add timeout to prevent infinite loading
            const timeoutId = setTimeout(() => {
                console.warn('⚠️ QR status check timed out, enabling buttons')
                setCheckingQrStatus(false)
            }, 10000) // 10 second timeout

            try {
                const controller = new AbortController()
                const fetchTimeoutId = setTimeout(() => controller.abort(), 8000)

                const response = await fetch(
                    `/api/consumer/check-lucky-draw-status?qr_code=${encodeURIComponent(qrCode)}`,
                    { signal: controller.signal }
                )
                clearTimeout(fetchTimeoutId)

                const data = await response.json()

                if (data.success) {
                    // Check if points already collected from this QR
                    if (data.is_points_collected) {
                        setQrPointsCollected(true)
                        setPointsCollected(true)
                    }

                    // Check if lucky draw already entered from this QR
                    if (data.is_lucky_draw_entered) {
                        setLuckyDrawQrUsed(true)
                        setLuckyDrawEntered(true)
                        // Pre-fill entry details if available
                        if (data.entry_details) {
                            setCustomerName(data.entry_details.consumer_name || '')
                            setCustomerPhone(data.entry_details.consumer_phone || '')
                        }
                    }

                    // Check if gift already redeemed from this QR
                    if (data.is_gift_redeemed) {
                        setGiftQrUsed(true)
                        setGiftRedeemed(true)
                    }

                    // Check if scratch card already played from this QR
                    if (data.is_scratch_card_played) {
                        setScratchCardAlreadyPlayed(true)
                        if (data.scratch_card_reward) {
                            setScratchCardPreviousReward(data.scratch_card_reward)
                        }
                    }

                    // Store the QR code DB ID for scratch card plays
                    if (data.qr_code_id) {
                        setQrCodeDbId(data.qr_code_id)
                    }
                }
            } catch (error: any) {
                if (error.name === 'AbortError') {
                    console.warn('⚠️ QR status check aborted (timeout)')
                } else {
                    console.error('Error checking QR status:', error)
                }
            } finally {
                clearTimeout(timeoutId)
                setCheckingQrStatus(false)
            }
        }

        // Check on mount - always check QR status for returning visitors
        if (isLive && qrCode) {
            checkQrStatus()
        } else {
            // Not live or no QR code - immediately set checking to false
            setCheckingQrStatus(false)
        }
    }, [isLive, qrCode]) // Only run on mount and when qrCode changes

    // Clear login form when QR code changes (new scan)
    useEffect(() => {
        console.log('🔐 QR code changed, clearing login form state')
        setLoginEmail('')
        setLoginPassword('')
        setLoginError('')
        setEmailError('')
        setPhoneError('')
        setLoginLoading(false)
        setShowLoginForm(false)
    }, [qrCode])

    // Clear login form when user becomes authenticated
    useEffect(() => {
        if (isAuthenticated) {
            console.log('🔐 User authenticated, clearing login form')
            setLoginEmail('')
            setLoginPassword('')
            setLoginError('')
            setEmailError('')
            setPhoneError('')
            setLoginLoading(false)
            setShowLoginForm(false)
        }
    }, [isAuthenticated])

    // Re-check QR status when navigating to lucky-draw tab (bulletproof double-check)
    useEffect(() => {
        const recheckStatus = async () => {
            if (activeTab === 'lucky-draw' && isLive && qrCode && !luckyDrawQrUsed && !luckyDrawEntered) {
                setCheckingQrStatus(true)
                const status = await checkQrStatusFromApi()
                if (status.isLuckyDrawEntered) {
                    setLuckyDrawQrUsed(true)
                    setLuckyDrawEntered(true)
                }
                setCheckingQrStatus(false)
            }
        }
        recheckStatus()
    }, [activeTab, isLive, qrCode])

    const fetchRewards = async () => {
        if (!orgId) return
        setLoadingRewards(true)
        try {
            // Use API route to bypass RLS for public consumer access
            const response = await fetch(`/api/consumer/rewards?org_id=${orgId}`)
            const result = await response.json()

            if (result.success) {
                setRewards(result.rewards || [])
            } else {
                console.error('Error fetching rewards:', result.error)
                setRewards([])
            }
        } catch (error) {
            console.error('Error fetching rewards:', error)
            setRewards([])
        } finally {
            setLoadingRewards(false)
        }
    }

    const fetchProducts = async () => {
        if (!orgId) return
        setLoadingProducts(true)
        try {
            // Use API route to bypass RLS for public consumer access
            const response = await fetch(`/api/consumer/products?org_id=${orgId}`)
            const result = await response.json()

            if (result.success) {
                setProducts(result.products || [])
            } else {
                console.error('Error fetching products:', result.error)
                setProducts([])
            }
        } catch (error) {
            console.error('Error fetching products:', error)
            setProducts([])
        } finally {
            setLoadingProducts(false)
        }
    }

    // Fetch redemption history
    const fetchRedemptionHistory = async () => {
        if (!isAuthenticated) return
        setLoadingRedemptionHistory(true)
        try {
            const response = await fetch('/api/consumer/redemption-history')
            const result = await response.json()

            if (result.success) {
                setRedemptionHistory(result.redemptions || [])
            } else {
                console.error('Error fetching redemption history:', result.error)
                setRedemptionHistory([])
            }
        } catch (error) {
            console.error('Error fetching redemption history:', error)
            setRedemptionHistory([])
        } finally {
            setLoadingRedemptionHistory(false)
        }
    }

    // Fetch points history
    const fetchPointsHistory = async () => {
        if (!isAuthenticated) return
        setLoadingPointsHistory(true)
        try {
            const response = await fetch('/api/consumer/points-history')
            const result = await response.json()

            if (result.success) {
                setPointsHistory(result.transactions || [])
            } else {
                console.error('Error fetching points history:', result.error)
                setPointsHistory([])
            }
        } catch (error) {
            console.error('Error fetching points history:', error)
            setPointsHistory([])
        } finally {
            setLoadingPointsHistory(false)
        }
    }

    // Fetch scanned products
    const fetchScannedProducts = async () => {
        if (!isAuthenticated) return
        setLoadingScannedProducts(true)
        try {
            const response = await fetch('/api/consumer/scanned-products')
            const result = await response.json()

            if (result.success) {
                setScannedProducts(result.scans || [])
            } else {
                console.error('Error fetching scanned products:', result.error)
                setScannedProducts([])
            }
        } catch (error) {
            console.error('Error fetching scanned products:', error)
            setScannedProducts([])
        } finally {
            setLoadingScannedProducts(false)
        }
    }

    // Fetch free gifts for redemption
    const fetchFreeGifts = async () => {
        if (!qrCode) return
        setLoadingFreeGifts(true)
        try {
            const response = await fetch(`/api/consumer/redeem-gifts?qr_code=${encodeURIComponent(qrCode)}`)
            const result = await response.json()

            if (result.success) {
                setFreeGifts(result.gifts || [])
            } else {
                console.error('Error fetching free gifts:', result.error)
                setFreeGifts([])
            }
        } catch (error) {
            console.error('Error fetching free gifts:', error)
            setFreeGifts([])
        } finally {
            setLoadingFreeGifts(false)
        }
    }

    // Check if gift already redeemed for this QR
    const checkGiftRedeemStatus = async () => {
        if (!qrCode) return
        try {
            const response = await fetch(`/api/consumer/check-lucky-draw-status?qr_code=${encodeURIComponent(qrCode)}`)
            const data = await response.json()
            if (data.success && data.is_gift_redeemed) {
                setGiftQrUsed(true)
                setGiftRedeemed(true)
            }
        } catch (error) {
            console.error('Error checking gift redeem status:', error)
        }
    }

    // Handle gift claim
    const handleClaimGift = async () => {
        if (!selectedGift || !qrCode) return

        setClaimingGift(true)
        setGiftError('')

        try {
            const response = await fetch('/api/consumer/claim-gift', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    qr_code: qrCode,
                    gift_id: selectedGift.id,
                    consumer_name: customerName || null,
                    consumer_phone: customerPhone || null,
                    consumer_email: customerEmail || null
                })
            })

            const data = await response.json()

            if (data.success) {
                setClaimedGiftName(selectedGift.gift_name)
                setGiftRedeemed(true)
                setGiftQrUsed(true)
                setShowGiftConfirm(false)
                setShowGiftSuccess(true)
            } else if (data.code === 'ALREADY_REDEEMED') {
                setGiftQrUsed(true)
                setGiftRedeemed(true)
                setGiftError('This QR code has already been used to claim a gift.')
            } else {
                setGiftError(data.error || 'Failed to claim gift')
            }
        } catch (error) {
            console.error('Error claiming gift:', error)
            setGiftError('Network error. Please try again.')
        } finally {
            setClaimingGift(false)
        }
    }

    // Handle login
    const handleLogin = async () => {
        if (!loginEmail || !loginPassword) {
            setLoginError('Please fill in all fields')
            return
        }

        if (isSignUp) {
            if (!signUpName) {
                setLoginError('Please enter your full name')
                return
            }
            if (!signUpConfirmPassword) {
                setLoginError('Please confirm your password')
                return
            }
            if (loginPassword !== signUpConfirmPassword) {
                setLoginError('Passwords do not match')
                return
            }
            // Phone is optional but good to have validation if provided
            if (signUpPhone && !validateMalaysiaPhone(signUpPhone)) {
                setLoginError('Please enter a valid Malaysia phone number')
                return
            }
        }

        // Prevent duplicate submissions
        if (loginLoading) {
            console.log('🔐 Login already in progress, ignoring duplicate request')
            return
        }

        setLoginLoading(true)
        setLoginError('')

        try {
            // Remove all whitespace from email
            let emailToUse = loginEmail.replace(/\s/g, '')

            // Check if input looks like a phone number (doesn't contain @)
            if (!emailToUse.includes('@')) {
                // If signing up, we require a valid email in this field
                if (isSignUp) {
                    setLoginError('Please enter a valid email address')
                    setLoginLoading(false)
                    return
                }

                // Normalize and lookup email by phone
                const normalizedPhone = normalizePhone(emailToUse)

                // Use the RPC function to find the email associated with this phone number
                // Add retry logic for better reliability
                let userEmailData = null
                let lookupError = null

                for (let i = 0; i < 3; i++) {
                    try {
                        const result = await supabase
                            .rpc('get_email_by_phone' as any, { p_phone: normalizedPhone })

                        if (!result.error) {
                            userEmailData = result.data
                            lookupError = null
                            break
                        }
                        lookupError = result.error
                    } catch (err) {
                        lookupError = err as any
                    }
                    if (i < 2) await new Promise(resolve => setTimeout(resolve, 1000))
                }

                if (lookupError) {
                    console.error('Phone lookup error:', lookupError)
                    setLoginError('Error verifying phone number. Please check your connection.')
                    setLoginLoading(false)
                    return
                }

                // Handle different response formats safely
                let userEmail = userEmailData
                if (Array.isArray(userEmailData)) {
                    if (userEmailData.length > 0) {
                        userEmail = userEmailData[0].email || userEmailData[0]
                    } else {
                        userEmail = null
                    }
                } else if (typeof userEmailData === 'object' && userEmailData !== null) {
                    userEmail = (userEmailData as any).email || userEmailData
                }

                if (!userEmail) {
                    setLoginError('Phone number not found. Please check your number or use email to login.')
                    setLoginLoading(false)
                    return
                }

                emailToUse = userEmail as string
            }

            console.log('🔐 Attempting login with email:', emailToUse)

            if (isSignUp) {
                // Validate email format before sending to Supabase
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                if (!emailRegex.test(emailToUse)) {
                    setLoginError(`Invalid email format: "${emailToUse}". Please check for typos.`)
                    setLoginLoading(false)
                    return
                }

                // Use server action to bypass rate limits
                const regResult = await registerConsumer({
                    email: emailToUse,
                    password: loginPassword,
                    full_name: signUpName,
                    phone: signUpPhone || undefined,
                    location: signUpLocation || undefined
                })

                if (!regResult.success) {
                    throw new Error(regResult.error || 'Failed to create account')
                }

                console.log('🔐 Sign up successful via server action')

                // Auto-login after successful registration
                const { data, error } = await supabase.auth.signInWithPassword({
                    email: emailToUse,
                    password: loginPassword
                })

                if (error) throw error
                console.log('🔐 Sign up successful')

                if (data.session && data.user) {
                    console.log('🔐 Auto-logging in after signup...', data.user.id)

                    // Update phone in public.users via API (bypasses RLS)
                    if (signUpPhone) {
                        try {
                            console.log('🔐 Updating phone in public.users via API')
                            const response = await fetch('/api/user/update-phone', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    userId: data.user.id,
                                    phone: signUpPhone
                                })
                            })

                            const result = await response.json()
                            if (result.success) {
                                console.log('🔐 Phone number updated successfully in public.users')
                            } else {
                                console.error('🔐 Error updating phone in public.users:', result.error)
                            }
                        } catch (phoneError) {
                            console.error('🔐 Error updating phone:', phoneError)
                        }
                    }

                    // IMPORTANT: Mark this as an active session so it persists within this browser session
                    sessionStorage.setItem('serapod_active_session', 'logged_in')

                    setShowLoginForm(false)
                    // Clear form after successful login
                    setLoginEmail('')
                    setLoginPassword('')
                    setSignUpName('')
                    setSignUpPhone('')
                    setSignUpConfirmPassword('')

                    // IMPORTANT: Force profile fetch after successful login
                    if (data.user) {
                        console.log('🔐 Forcing profile fetch after signup...')
                        try {
                            const profileData = await checkUserOrganization(data.user.id, true) // Force fetch, bypass duplicate check
                            const { success, isShop, fullName, avatarUrl, orgName, phone, pointsBalance } = profileData

                            if (success) {
                                console.log('🔐 Profile loaded successfully after signup')
                                setIsAuthenticated(true)
                                setUserEmail(data.user.email || '')
                                setUserId(data.user.id)
                                setIsShopUser(isShop)
                                setUserName(fullName || data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || '')
                                setUserAvatarUrl(avatarUrl)
                                setShopName(orgName)
                                setUserPhone(phone)
                                // Set points for all users
                                setUserPoints(pointsBalance)
                            }
                        } catch (profileError) {
                            console.error('🔐 Error fetching profile after signup:', profileError)
                        }
                    }

                    toast({
                        title: "Account Created",
                        description: "Your account has been created and you are now logged in.",
                    })
                } else {
                    setLoginError('')
                    setShowLoginForm(false)
                    // Clear form after successful signup
                    setLoginEmail('')
                    setLoginPassword('')
                    setSignUpName('')
                    setSignUpPhone('')
                    setSignUpConfirmPassword('')

                    toast({
                        title: "Account Created",
                        description: "Your account has been created successfully. Please check your email for confirmation if required.",
                    })
                }
            } else {
                // Add timeout for sign in
                const signInPromise = supabase.auth.signInWithPassword({
                    email: emailToUse,
                    password: loginPassword,
                })
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Login timed out')), 15000)
                )

                const { data, error } = await Promise.race([
                    signInPromise,
                    timeoutPromise
                ]) as any

                if (error) {
                    const message = (error.message || '').toLowerCase()
                    if (message.includes('invalid login credentials')) {
                        setLoginError('Incorrect email/phone or password. Please try again.')
                    } else if (message.includes('timeout')) {
                        setLoginError('Login took too long. Please check your connection and try again.')
                    } else {
                        setLoginError(error.message || 'Login failed. Please try again.')
                    }
                    setLoginLoading(false)
                    return
                }

                console.log('🔐 Sign in successful, user:', data.user?.email)

                // IMPORTANT: Mark this as an active session so it persists within this browser session
                sessionStorage.setItem('serapod_active_session', 'logged_in')

                setShowLoginForm(false)
                // Clear form after successful login
                setLoginEmail('')
                setLoginPassword('')

                // IMPORTANT: Force profile fetch after successful login
                if (data.user) {
                    console.log('🔐 Forcing profile fetch after login...')
                    try {
                        const profileData = await checkUserOrganization(data.user.id, true) // Force fetch, bypass duplicate check
                        const { success, isShop, fullName, avatarUrl, orgName, phone, pointsBalance } = profileData

                        if (success) {
                            console.log('🔐 Profile loaded successfully after login')
                            setIsAuthenticated(true)
                            setUserEmail(data.user.email || '')
                            setUserId(data.user.id)
                            setIsShopUser(isShop)
                            setUserName(fullName || data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || '')
                            setUserAvatarUrl(avatarUrl)
                            setShopName(orgName)
                            setUserPhone(phone)
                            // Set points for all users
                            setUserPoints(pointsBalance)
                        }
                    } catch (profileError) {
                        console.error('🔐 Error fetching profile after login:', profileError)
                    }
                }
            }
        } catch (error: any) {
            console.error('🔐 Login error:', error)
            if (error.message?.includes('Invalid login credentials')) {
                setLoginError('Invalid email/phone or password. Please check your credentials.')
            } else {
                setLoginError(error.message || 'Login failed')
            }
        } finally {
            setLoginLoading(false)
        }
    }

    // Handle logout
    const handleLogout = async () => {
        console.log('🔐 Logging out...')
        try {
            // Clear state first to ensure UI updates immediately
            setIsAuthenticated(false)
            setIsShopUser(false)
            setUserEmail('')
            setUserName('')
            setUserPoints(0)
            setUserAvatarUrl(null)
            setShopName('')
            setUserPhone('')
            setUserId(null)

            // IMPORTANT: Clear login form fields to prevent auto-login on next visit
            setLoginEmail('')
            setLoginPassword('')
            setLoginError('')
            setShowLoginForm(false)

            // Call server action to clear cookies
            await logoutConsumer()

            // Then sign out from Supabase (with timeout)
            const signOutPromise = supabase.auth.signOut()
            const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 2000))
            await Promise.race([signOutPromise, timeoutPromise])

            // Clear any cached session data (both localStorage AND sessionStorage)
            if (typeof window !== 'undefined') {
                // Clear localStorage keys related to Supabase
                const localKeysToRemove = Object.keys(localStorage).filter(key =>
                    key.startsWith('sb-') || key.includes('supabase')
                )
                localKeysToRemove.forEach(key => localStorage.removeItem(key))

                // Also clear sessionStorage to prevent stale session issues
                const sessionKeysToRemove = Object.keys(sessionStorage).filter(key =>
                    key.startsWith('sb-') || key.includes('supabase')
                )
                sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key))

                // IMPORTANT: Remove the active session marker so next QR scan is fresh
                sessionStorage.removeItem('serapod_active_session')
            }

            console.log('🔐 Logged out successfully')

            // Navigate to profile tab after logout
            setActiveTab('profile')

            // Show toast confirmation
            toast({ title: 'Signed Out', description: 'You have been signed out successfully.' })
        } catch (error) {
            console.error('🔐 Logout error:', error)
            // Even if there's an error, state is already cleared
            toast({ title: 'Signed Out', description: 'Session cleared.' })
        }
    }

    // Handle profile update (name and phone)
    const handleSaveProfile = async () => {
        if (!userId) return

        setSavingProfile(true)
        setProfileSaveError('')
        setProfileSaveSuccess(false)

        try {
            // Prepare update data
            const updateData: any = {}

            if (newName !== userName) {
                updateData.full_name = newName.trim()
            }

            if (newPhone !== userPhone) {
                // Validate phone number format (Malaysia/China)
                if (newPhone && newPhone.trim()) {
                    const phoneValidation = validatePhoneNumber(newPhone.trim())
                    if (!phoneValidation.isValid) {
                        setProfileSaveError(phoneValidation.error || 'Invalid phone number format. Use Malaysia (+60) or China (+86) format.')
                        setSavingProfile(false)
                        return
                    }
                }
                updateData.phone = newPhone.trim() || null
            }

            // Add address if changed
            if (newAddress !== userAddress) {
                updateData.address = newAddress.trim() || null
            }

            // Add bank details if shop user or independent consumer
            if (isShopUser || !shopName) {
                // If any bank field is filled, validate all required fields
                if (bankId || bankAccountNumber || bankAccountHolderName) {
                    if (!bankId) {
                        setProfileSaveError('Please select a bank')
                        setSavingProfile(false)
                        return
                    }
                    if (!bankAccountNumber) {
                        setProfileSaveError('Please enter account number')
                        setSavingProfile(false)
                        return
                    }
                    if (!bankAccountHolderName) {
                        setProfileSaveError('Please enter account holder name')
                        setSavingProfile(false)
                        return
                    }

                    const selectedBank = banks.find(b => b.id === bankId)
                    if (selectedBank) {
                        if (selectedBank.is_numeric_only && !/^\d+$/.test(bankAccountNumber)) {
                            setProfileSaveError('Account number must contain digits only')
                            setSavingProfile(false)
                            return
                        }
                        if (bankAccountNumber.length < selectedBank.min_account_length) {
                            setProfileSaveError(`Account number must be at least ${selectedBank.min_account_length} digits`)
                            setSavingProfile(false)
                            return
                        }
                        if (bankAccountNumber.length > selectedBank.max_account_length) {
                            setProfileSaveError(`Account number must be at most ${selectedBank.max_account_length} digits`)
                            setSavingProfile(false)
                            return
                        }
                    }
                }

                // Only send bank fields if user is editing bank info (at least one field has value)
                if (bankId || bankAccountNumber || bankAccountHolderName) {
                    updateData.bank_id = bankId || null
                    updateData.bank_account_number = bankAccountNumber || null
                    updateData.bank_account_holder_name = bankAccountHolderName || null
                }
            }

            if (Object.keys(updateData).length === 0) {
                setProfileSaveError('No changes to save')
                setSavingProfile(false)
                return
            }

            // Call API to update profile (this will sync phone with Supabase Auth)
            const response = await fetch('/api/user/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    ...updateData
                })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Failed to update profile')
            }

            // Update local state
            if (updateData.full_name) {
                setUserName(updateData.full_name)
            }
            if (updateData.phone !== undefined) {
                setUserPhone(updateData.phone || '')
            }
            if (updateData.address !== undefined) {
                setUserAddress(updateData.address || '')
            }

            setProfileSaveSuccess(true)
            setEditingName(false)
            setEditingPhone(false)
            setEditingAddress(false)

            // Clear success message after 3 seconds
            setTimeout(() => setProfileSaveSuccess(false), 3000)

        } catch (error: any) {
            console.error('Error saving profile:', error)
            setProfileSaveError(error.message || 'Failed to save profile')
        } finally {
            setSavingProfile(false)
        }
    }

    // Handle password change
    const handleChangePassword = async () => {
        if (!currentPassword || !newPassword || !confirmPassword) {
            setPasswordError('All fields are required')
            return
        }

        if (newPassword.length < 6) {
            setPasswordError('New password must be at least 6 characters')
            return
        }

        if (newPassword !== confirmPassword) {
            setPasswordError('Passwords do not match')
            return
        }

        setChangingPassword(true)
        setPasswordError('')
        setPasswordSuccess(false)

        try {
            console.log('🔐 Starting password change...')

            // First verify current password by attempting re-auth with timeout
            const signInPromise = supabase.auth.signInWithPassword({
                email: userEmail,
                password: currentPassword
            })

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Password verification timeout')), 10000)
            )

            const { error: signInError } = await Promise.race([signInPromise, timeoutPromise]) as any

            if (signInError) {
                throw new Error('Current password is incorrect')
            }

            console.log('🔐 Current password verified, updating...')

            // Update password with timeout
            const updatePromise = supabase.auth.updateUser({
                password: newPassword
            })

            const updateTimeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Password update timeout')), 10000)
            )

            const { error: updateError } = await Promise.race([updatePromise, updateTimeoutPromise]) as any

            if (updateError) {
                throw new Error(updateError.message)
            }

            console.log('✅ Password changed successfully')
            setPasswordSuccess(true)
            setCurrentPassword('')
            setNewPassword('')
            setConfirmPassword('')
            setShowChangePassword(false)

            // Clear success message after 3 seconds
            setTimeout(() => setPasswordSuccess(false), 3000)

        } catch (error: any) {
            console.error('❌ Error changing password:', error)
            setPasswordError(error.message || 'Failed to change password')
        } finally {
            setChangingPassword(false)
        }
    }

    // Check if security code is required for a specific feature
    const isSecurityCodeRequiredForFeature = (action: string): boolean => {
        // If main security code is OFF, no security code required for anything
        if (!config.require_security_code) return false

        // If already verified, no need to check again
        if (securityVerified) return false

        // Check per-feature bypass settings
        switch (action) {
            case 'collect-points':
                return !config.skip_security_code_for_points
            case 'lucky-draw':
                return !config.skip_security_code_for_lucky_draw
            case 'redeem':
            case 'redemption':
                return !config.skip_security_code_for_redemption
            case 'scratch-card':
            case 'play-scratch-card':
            case 'spin-wheel':
            case 'daily-quiz':
            case 'games':
                return !config.skip_security_code_for_scratch_card
            default:
                return true // Default: require security code
        }
    }

    // Handle security check for protected features
    const handleProtectedAction = (action: string) => {
        if (isSecurityCodeRequiredForFeature(action)) {
            setPendingAction(action)
            setShowSecurityModal(true)
        } else {
            executeAction(action)
        }
    }

    const executeAction = async (action: string) => {
        switch (action) {
            case 'collect-points':
                // If user is authenticated (shop user OR independent consumer), collect points with session
                console.log('🔐 Collect points action - isAuthenticated:', isAuthenticated, 'isShopUser:', isShopUser, 'authLoading:', authLoading)

                // ALWAYS do a direct session check to ensure we don't show login modal unnecessarily
                // This handles cases where isAuthenticated state might be stale or incorrect
                console.log('🔐 Doing direct session check before collect...')
                try {
                    const { data: { user }, error } = await supabase.auth.getUser()
                    console.log('🔐 Direct session check result:', user?.id, user?.email, 'Error:', error?.message)

                    if (user && !error) {
                        console.log('🔐 Valid session found, proceeding to collect points with session')
                        // Update auth state if it was incorrect
                        if (!isAuthenticated) {
                            setIsAuthenticated(true)
                            setUserEmail(user.email || '')
                            setUserId(user.id)
                            sessionStorage.setItem('serapod_active_session', 'logged_in')
                        }
                        handleCollectPointsWithSession()
                        return
                    }
                } catch (e) {
                    console.log('🔐 Session check error:', e)
                }

                // No valid session - show login modal
                console.log('🔐 No valid session, showing login modal')
                setPointsError('')
                setShowPointsLoginModal(true)
                break
            case 'lucky-draw':
                setActiveTab('lucky-draw')
                break
            case 'games':
            case 'scratch-card':
                setActiveTab('games')
                break
            case 'play-scratch-card':
                setActiveTab('play-scratch-card')
                break
            case 'spin-wheel':
                setActiveTab('spin-wheel')
                break
            case 'daily-quiz':
                setActiveTab('daily-quiz')
                break
            case 'redeem':
            case 'redemption':
                // Navigate to free gift selection
                setActiveTab('rewards')
                setShowFreeGifts(true)
                // Show free gift modal section (will be handled in rewards tab)
                break
        }
    }

    // Handle points collection
    const handleCollectPoints = async () => {
        if (!shopId || !shopPassword) {
            setPointsError('Please enter your Shop ID and password')
            return
        }

        if (!qrCode) {
            setPointsError('QR code not available')
            return
        }

        setCollectingPoints(true)
        setPointsError('')

        try {
            console.log('🔐 handleCollectPoints - Starting...')
            let emailToUse = shopId

            // Check if input looks like a phone number (doesn't contain @)
            if (!shopId.includes('@')) {
                console.log('📱 Phone detected, looking up email...')
                // Normalize and lookup email by phone
                const normalizedPhone = normalizePhone(shopId)

                // Use the RPC function to find the email associated with this phone number
                // Add retry logic with timeout
                let userEmailData = null
                let lookupError = null

                for (let i = 0; i < 3; i++) {
                    try {
                        console.log(`📱 Phone lookup attempt ${i + 1}...`)

                        const rpcPromise = supabase
                            .rpc('get_email_by_phone' as any, { p_phone: normalizedPhone })

                        // Increase timeout to 10 seconds (was 5s which is too short)
                        const timeoutPromise = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Phone lookup timed out. Please try again.')), 10000)
                        )

                        const result = await Promise.race([rpcPromise, timeoutPromise]) as any

                        if (!result.error) {
                            userEmailData = result.data
                            lookupError = null
                            console.log('✅ Phone lookup successful')
                            break
                        }

                        lookupError = result.error
                        console.warn(`Phone lookup attempt ${i + 1} failed:`, result.error)
                    } catch (err: any) {
                        console.warn(`Phone lookup attempt ${i + 1} exception:`, err)
                        lookupError = err

                        // If it's a timeout error, show user-friendly message
                        if (err?.message?.includes('timed out')) {
                            // Continue to retry
                        }
                    }

                    // Wait before retry if not the last attempt
                    if (i < 2) await new Promise(resolve => setTimeout(resolve, 1500))
                }

                if (lookupError) {
                    console.error('❌ Phone lookup error after retries:', lookupError)
                    const errorMsg = lookupError?.message?.includes('timed out')
                        ? 'Connection timed out. Please check your internet connection and try again.'
                        : 'Error verifying phone number. Please check your connection and try again.'
                    setPointsError(errorMsg)
                    setCollectingPoints(false)
                    return
                }

                // Handle different response formats safely
                let userEmail = userEmailData
                if (Array.isArray(userEmailData)) {
                    if (userEmailData.length > 0) {
                        userEmail = userEmailData[0].email || userEmailData[0]
                    } else {
                        userEmail = null
                    }
                } else if (typeof userEmailData === 'object' && userEmailData !== null) {
                    userEmail = (userEmailData as any).email || userEmailData
                }

                if (!userEmail) {
                    setPointsError('Phone number not found')
                    setCollectingPoints(false)
                    return
                }

                emailToUse = userEmail
            }

            console.log('📡 Calling collect points API...')
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s timeout

            const response = await fetch('/api/consumer/collect-points', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    qr_code: qrCode,
                    shop_id: emailToUse,
                    password: shopPassword
                }),
                signal: controller.signal
            }).finally(() => clearTimeout(timeoutId))

            const data = await response.json()

            if (!response.ok) {
                if (data.already_collected) {
                    // Points already collected for this QR
                    setPointsEarned(data.points_earned || 0)
                    setPreviousBalance(data.total_balance || 0)
                    setTotalBalance(data.total_balance || 0)
                    setPointsCollected(true)
                    setShowPointsLoginModal(false)
                    setShowPointsSuccessModal(true)
                    setPointsError('')
                } else {
                    throw new Error(data.error || 'Failed to collect points')
                }
                return
            }

            // Success - points collected
            const newBalance = data.new_balance || data.total_balance || 0
            const earnedPoints = data.points_earned || 0
            setPreviousBalance(newBalance - earnedPoints)
            setPointsEarned(earnedPoints)
            setLastEarnedPoints(earnedPoints) // Persist for Recent Activity
            setTotalBalance(newBalance)
            setUserPoints(newBalance)
            setPointsCollected(true)
            setShowPointsLoginModal(false)
            setShowPointsSuccessModal(true)

            // IMPORTANT: Establish client-side session so next time user doesn't need to login again
            if (data.email && shopPassword) {
                console.log('🔐 Establishing persistent session for shop user...')
                try {
                    // Add timeout for session establishment
                    const signInPromise = supabase.auth.signInWithPassword({
                        email: data.email,
                        password: shopPassword
                    })
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Session establishment timed out')), 10000)
                    )

                    const { error: signInError } = await Promise.race([
                        signInPromise,
                        timeoutPromise
                    ]) as any

                    if (!signInError) {
                        console.log('✅ Session established successfully')
                        // Update auth state so next point collection won't require login
                        setIsAuthenticated(true)
                        setIsShopUser(true)
                        setUserEmail(data.email)
                        setShopName(data.shop_name || '')
                        if (data.avatar_url) setUserAvatarUrl(data.avatar_url)
                    } else {
                        console.warn('⚠️ Could not establish session:', signInError.message)
                    }
                } catch (sessionError) {
                    console.warn('⚠️ Error establishing session:', sessionError)
                    // Don't fail the point collection just because session couldn't be established
                }
            }

            // Clear form
            setShopId('')
            setShopPassword('')

        } catch (error: any) {
            console.error('Error collecting points:', error)
            setPointsError(error.message || 'Failed to collect points')
        } finally {
            setCollectingPoints(false)
        }
    }

    // Handle points collection using existing session (for authenticated shop users)
    const handleCollectPointsWithSession = async () => {
        if (!qrCode) {
            setPointsError('QR code not available')
            return
        }

        setCollectingPoints(true)
        setPointsError('')

        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s timeout

            const response = await fetch('/api/consumer/collect-points-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    qr_code: qrCode
                }),
                signal: controller.signal
            }).finally(() => clearTimeout(timeoutId))

            const data = await response.json()

            // If session expired or user is not a shop user, fall back to login modal
            if (data.requiresLogin) {
                setPointsError('')
                setShowPointsLoginModal(true)
                setCollectingPoints(false)
                return
            }

            if (!response.ok) {
                if (data.already_collected) {
                    // Points already collected for this QR
                    setPointsEarned(data.points_earned || 0)
                    setPreviousBalance(data.total_balance || 0)
                    setTotalBalance(data.total_balance || 0)
                    setPointsCollected(true)
                    setShowPointsSuccessModal(true)
                    setPointsError('')
                } else {
                    throw new Error(data.error || 'Failed to collect points')
                }
                return
            }

            // Success - points collected
            const newBalance = data.new_balance || data.total_balance || 0
            const earnedPoints = data.points_earned || 0
            setPreviousBalance(newBalance - earnedPoints)
            setPointsEarned(earnedPoints)
            setLastEarnedPoints(earnedPoints) // Persist for Recent Activity
            setTotalBalance(newBalance)
            setUserPoints(newBalance)
            setPointsCollected(true)
            setShowPointsSuccessModal(true)
            if (data.avatar_url) setUserAvatarUrl(data.avatar_url)

        } catch (error: any) {
            console.error('Error collecting points with session:', error)
            const errorMessage = error.message || 'Failed to collect points'
            setPointsError(errorMessage)
            // Only show login modal if it's an authentication-related error
            // Don't show login modal for QR code errors when user is already authenticated
            if (!isAuthenticated || errorMessage.toLowerCase().includes('not authenticated') || errorMessage.toLowerCase().includes('session expired')) {
                setShowPointsLoginModal(true)
            }
            // Otherwise, just show the error (will be displayed in the UI)
        } finally {
            setCollectingPoints(false)
        }
    }

    const handleSecuritySuccess = () => {
        setSecurityVerified(true)
        setShowSecurityModal(false)
        if (pendingAction) {
            executeAction(pendingAction)
            setPendingAction(null)
        }
    }

    // Malaysia phone number validation
    const validateMalaysiaPhone = (phone: string): boolean => {
        // Remove spaces, dashes, and leading zeros
        const cleaned = phone.replace(/[\s-]/g, '').replace(/^0+/, '')
        // Malaysia mobile: 1X-XXXXXXX (9-10 digits after country code)
        // Formats: 01X-XXXXXXX, +601X-XXXXXXX, 601X-XXXXXXX
        const mobileRegex = /^(60)?1[0-9]{8,9}$/
        // Also accept format starting with 0
        const localRegex = /^01[0-9]{8,9}$/
        return mobileRegex.test(cleaned) || localRegex.test(phone.replace(/[\s-]/g, ''))
    }

    // Email validation
    const validateEmail = (email: string): boolean => {
        if (!email) return true // Email is optional
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        return emailRegex.test(email)
    }

    // Handle phone input change with validation
    const handlePhoneChange = (value: string) => {
        setCustomerPhone(value)
        if (value && !validateMalaysiaPhone(value)) {
            setLuckyDrawPhoneError('Please enter a valid Malaysia phone number (e.g., 0123456789)')
        } else {
            setLuckyDrawPhoneError('')
        }
    }

    // Handle email input change with validation
    const handleEmailChange = (value: string) => {
        setCustomerEmail(value)
        if (value && !validateEmail(value)) {
            setLuckyDrawEmailError('Please enter a valid email address')
        } else {
            setLuckyDrawEmailError('')
        }
    }

    // Submit lucky draw entry
    const handleLuckyDrawSubmit = async () => {
        // BULLETPROOF CHECK 1: If already marked as entered, don't proceed
        if (luckyDrawQrUsed || luckyDrawEntered) {
            setLuckyDrawError('This QR code has already been used for lucky draw entry.')
            return
        }

        // Validate inputs
        if (!customerName || !customerPhone) {
            setLuckyDrawError('Please fill in all required fields')
            return
        }

        if (!validateMalaysiaPhone(customerPhone)) {
            setLuckyDrawPhoneError('Please enter a valid Malaysia phone number')
            return
        }

        if (customerEmail && !validateEmail(customerEmail)) {
            setLuckyDrawEmailError('Please enter a valid email address')
            return
        }

        setIsSubmitting(true)
        setLuckyDrawError('')

        // BULLETPROOF CHECK 2: Pre-submit API verification
        try {
            const preCheckStatus = await checkQrStatusFromApi()
            if (preCheckStatus.isLuckyDrawEntered) {
                setLuckyDrawQrUsed(true)
                setLuckyDrawEntered(true)
                setLuckyDrawError('This QR code has already been used for lucky draw entry.')
                setIsSubmitting(false)
                return
            }
        } catch (error) {
            console.error('Pre-check failed, proceeding with submission:', error)
            // Continue with submission - the API will do final validation
        }

        setLuckyDrawError('')

        try {
            const response = await fetch('/api/consumer/lucky-draw-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    qr_code: qrCode,
                    consumer_name: customerName,
                    consumer_phone: customerPhone,
                    consumer_email: customerEmail || null
                })
            })

            const data = await response.json()

            if (response.ok && data.success) {
                // BULLETPROOF: Always set the flags on success
                setLuckyDrawQrUsed(true)
                setLuckyDrawEntered(true)
                setShowLuckyDrawSuccess(true)
            } else if (data.already_entered) {
                // Already entered - set flags and show success
                setLuckyDrawQrUsed(true)
                setLuckyDrawEntered(true)
                setShowLuckyDrawSuccess(true)
            } else {
                setLuckyDrawError(data.error || 'Failed to submit entry. Please try again.')
            }
        } catch (error) {
            console.error('Error submitting lucky draw:', error)
            setLuckyDrawError('Network error. Please check your connection and try again.')
        } finally {
            setIsSubmitting(false)
        }
    }

    // Handle lucky draw success close
    const handleLuckyDrawSuccessClose = () => {
        setShowLuckyDrawSuccess(false)
        setLuckyDrawEntered(true)
    }

    // Handle reward redemption
    const handleRedeemReward = async (reward: RewardItem) => {
        // Check if user is authenticated
        if (!isAuthenticated) {
            alert('Please log in to redeem rewards')
            setActiveTab('profile')
            return
        }

        // Check if user is a shop user
        // if (!isShopUser) {
        //     alert('Only shop accounts can redeem rewards')
        //     return
        // }

        const pointsNeeded = reward.point_offer || reward.points_required

        // Check if user has enough points
        if (userPoints < pointsNeeded) {
            setInsufficientPointsData({
                needed: pointsNeeded,
                available: userPoints
            })
            setShowInsufficientPoints(true)
            return
        }

        // Show confirmation
        setSelectedReward(reward)
        setShowRedeemConfirm(true)
    }

    // Confirm and process redemption
    const confirmRedemption = async () => {
        if (!selectedReward) return

        setRedeeming(true)
        setRedeemError('')

        try {
            const response = await fetch('/api/consumer/redeem-reward', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reward_id: selectedReward.id
                })
            })

            const data = await response.json()

            if (response.ok && data.success) {
                // Set redemption details for animation
                setRedemptionDetails({
                    rewardName: data.reward_name,
                    pointsDeducted: data.points_deducted,
                    newBalance: data.new_balance,
                    redemptionCode: data.redemption_code
                })

                // Track last redeemed reward for Recent Activity display
                setLastRedeemedReward({
                    rewardName: data.reward_name,
                    pointsDeducted: data.points_deducted
                })

                // Update local points balance
                setUserPoints(data.new_balance)

                // Close confirmation and show success animation
                setShowRedeemConfirm(false)
                setShowRedeemSuccess(true)

                // Refresh rewards list to update stock
                fetchRewards()

                // IMPORTANT: Refresh redemption history to show new redemption
                fetchRedemptionHistory()
            } else {
                setRedeemError(data.error || 'Failed to redeem reward')
            }
        } catch (error) {
            console.error('Error redeeming reward:', error)
            setRedeemError('Network error. Please try again.')
        } finally {
            setRedeeming(false)
        }
    }

    // Handle redemption success close
    const handleRedeemSuccessClose = () => {
        setShowRedeemSuccess(false)
        setSelectedReward(null)
        setRedemptionDetails(null)
    }

    // Handle feedback submission
    const handleSubmitFeedback = async () => {
        if (!feedbackTitle.trim()) {
            setFeedbackError('Please enter a title for your feedback')
            return
        }
        if (!feedbackMessage.trim()) {
            setFeedbackError('Please enter your feedback message')
            return
        }

        setSubmittingFeedback(true)
        setFeedbackError('')

        try {
            const response = await fetch('/api/consumer/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: feedbackTitle.trim(),
                    message: feedbackMessage.trim(),
                    qr_code: qrCode,
                    org_id: orgId,
                    consumer_name: userName || undefined,
                    consumer_phone: userPhone || consumerPhone || undefined,
                    consumer_email: userEmail || undefined,
                    product_name: productInfo?.product_name || undefined,
                    variant_name: productInfo?.variant_name || undefined
                })
            })

            const data = await response.json()

            if (response.ok && data.success) {
                setFeedbackSuccess(true)
                setFeedbackTitle('')
                setFeedbackMessage('')
                // Auto close after 3 seconds
                setTimeout(() => {
                    setShowFeedbackModal(false)
                    setFeedbackSuccess(false)
                }, 3000)
            } else {
                setFeedbackError(data.error || 'Failed to submit feedback. Please try again.')
            }
        } catch (error) {
            console.error('Error submitting feedback:', error)
            setFeedbackError('Network error. Please try again.')
        } finally {
            setSubmittingFeedback(false)
        }
    }

    // Render Home Tab
    // Helper to render banner based on location
    const renderBanner = (location: 'home' | 'rewards' | 'products' | 'profile') => {
        if (!config.banner_config?.enabled || config.banner_config.items.length === 0) return null

        // Filter items by page (defaults to 'home' if page is not set)
        const pageItems = config.banner_config.items.filter(item => (item.page || 'home') === location)

        if (pageItems.length === 0) return null

        return (
            <div className="mt-6">
                <AnnouncementBanner
                    items={pageItems}
                    template={config.banner_config.template}
                    onItemClick={(item) => {
                        if (item.link_to === 'rewards') setActiveTab('rewards')
                        else if (item.link_to === 'products') setActiveTab('products')
                        else if (item.link_to === 'contact-us') setShowFeedbackModal(true)
                        else if (item.link_to === 'no-link') return
                        else if (item.link_to?.startsWith('http')) window.open(item.link_to, '_blank')
                    }}
                />
            </div>
        )
    }

    const renderHomeTab = () => (
        <div className="flex-1 overflow-y-auto pb-20">
            {/* Hero Section */}
            <div
                className="relative px-5 pt-8 pb-12 text-white"
                style={{
                    background: `linear-gradient(135deg, ${config.primary_color} 0%, ${adjustColor(config.primary_color, -30)} 100%)`
                }}
            >
                {/* Decorative circles */}
                <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10 bg-white transform translate-x-10 -translate-y-10" />
                <div className="absolute bottom-0 left-0 w-24 h-24 rounded-full opacity-10 bg-white transform -translate-x-8 translate-y-8" />

                <div className="relative z-10">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            {/* Show product info when scanned, otherwise show welcome */}
                            {productInfo?.product_name ? (
                                <>
                                    <div className="flex items-center gap-2 mb-1">
                                        <Shield className="w-4 h-4 text-green-300" />
                                        <p className="text-green-300 text-sm font-medium">✓ Genuine Product Verified</p>
                                    </div>
                                    <h1 className="text-xl font-bold leading-tight">
                                        {productInfo.product_name}
                                    </h1>
                                    {productInfo.variant_name && (
                                        <p className="text-white/80 text-sm mt-0.5">{productInfo.variant_name}</p>
                                    )}
                                    {productInfo.brand_name && (
                                        <p className="text-white/60 text-xs mt-0.5">by {productInfo.brand_name}</p>
                                    )}
                                </>
                            ) : (
                                <>
                                    <p className="text-white/80 text-sm">Welcome back</p>
                                    <h1 className="text-2xl font-bold">
                                        {isAuthenticated && isShopUser && shopName
                                            ? shopName
                                            : userName || 'Valued Member'} ✨
                                    </h1>
                                    {isAuthenticated && isShopUser && userName && shopName && (
                                        <p className="text-white/70 text-xs mt-1">{userName}</p>
                                    )}
                                </>
                            )}
                        </div>
                        <div
                            className={`w-12 h-12 rounded-full bg-white/20 flex items-center justify-center overflow-hidden relative ${isAuthenticated ? 'cursor-pointer hover:opacity-80' : ''}`}
                            onClick={handleAvatarClick}
                        >
                            {isUploadingAvatar ? (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : null}

                            {userAvatarUrl ? (
                                <img
                                    src={userAvatarUrl}
                                    alt="Profile"
                                    className="object-cover w-full h-full"
                                />
                            ) : (
                                <User className="w-6 h-6" />
                            )}
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleAvatarUpload}
                            />
                        </div>
                    </div>

                    {/* Points Card */}
                    <div className="bg-white/15 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-white/70 text-xs uppercase tracking-wider">Your Points</p>
                                <div className="flex items-baseline gap-2 mt-1">
                                    <span className="text-3xl font-bold tabular-nums">{displayPoints}</span>
                                    <Star className={`w-5 h-5 text-yellow-300 fill-yellow-300 ${showPointsAnimation ? 'animate-bounce' : ''}`} />
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-white/70 text-xs">Next Reward</p>
                                <p className="text-sm font-medium">100 pts away</p>
                            </div>
                        </div>

                        {/* Progress bar */}
                        <div className="mt-4">
                            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-yellow-400 rounded-full transition-all ease-out"
                                    style={{
                                        width: showPointsAnimation ? `${Math.min((userPoints / 50000) * 100, 100)}%` : '0%',
                                        transitionDuration: '2000ms'
                                    }}
                                />
                            </div>
                            <div className="flex justify-between mt-2 text-xs text-white/60">
                                <span>0</span>
                                <span>10,000</span>
                                <span>25,000</span>
                                <span>50,000</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="px-5 -mt-6 relative z-20">
                <div className="bg-white rounded-2xl shadow-lg p-3 flex justify-between gap-2">
                    {config.points_enabled && (
                        <button
                            onClick={() => handleProtectedAction('collect-points')}
                            disabled={collectingPoints || pointsCollected || qrPointsCollected || checkingQrStatus}
                            className={`flex-1 flex flex-col items-center p-2 rounded-xl transition-colors ${(pointsCollected || qrPointsCollected) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
                                }`}
                        >
                            <div
                                className="w-10 h-10 rounded-full flex items-center justify-center mb-1.5"
                                style={{ backgroundColor: (pointsCollected || qrPointsCollected) ? '#dcfce7' : `${config.primary_color}15` }}
                            >
                                {collectingPoints || checkingQrStatus ? (
                                    <Loader2 className="w-5 h-5 animate-spin" style={{ color: config.primary_color }} />
                                ) : (pointsCollected || qrPointsCollected) ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                                ) : (
                                    <Coins className="w-5 h-5" style={{ color: config.primary_color }} />
                                )}
                            </div>
                            <span className="text-[10px] font-medium text-gray-700">
                                {collectingPoints ? 'Collecting...' : checkingQrStatus ? 'Checking...' : (pointsCollected || qrPointsCollected) ? 'Collected' : 'Collect'}
                            </span>
                        </button>
                    )}

                    {config.lucky_draw_enabled && (
                        <button
                            onClick={() => handleProtectedAction('lucky-draw')}
                            disabled={checkingQrStatus || luckyDrawQrUsed || luckyDrawEntered}
                            className={`flex-1 flex flex-col items-center p-2 rounded-xl transition-colors ${(luckyDrawQrUsed || luckyDrawEntered) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
                                }`}
                        >
                            <div
                                className="w-10 h-10 rounded-full flex items-center justify-center mb-1.5"
                                style={{ backgroundColor: (luckyDrawQrUsed || luckyDrawEntered) ? '#dcfce7' : '#fef3c7' }}
                            >
                                {checkingQrStatus ? (
                                    <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
                                ) : (luckyDrawQrUsed || luckyDrawEntered) ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                                ) : (
                                    <Trophy className="w-5 h-5 text-amber-500" />
                                )}
                            </div>
                            <span className="text-[10px] font-medium text-gray-700">
                                {checkingQrStatus ? 'Checking...' : (luckyDrawQrUsed || luckyDrawEntered) ? 'Already In' : 'Lucky Draw'}
                            </span>
                        </button>
                    )}

                    {config.redemption_enabled && (
                        <button
                            onClick={() => {
                                handleProtectedAction('redeem')
                                fetchFreeGifts()
                            }}
                            disabled={checkingQrStatus || giftQrUsed || giftRedeemed}
                            className={`flex-1 flex flex-col items-center p-2 rounded-xl transition-colors ${(giftQrUsed || giftRedeemed) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
                                }`}
                        >
                            <div
                                className="w-10 h-10 rounded-full flex items-center justify-center mb-1.5"
                                style={{ backgroundColor: (giftQrUsed || giftRedeemed) ? '#dcfce7' : '#dcfce7' }}
                            >
                                {checkingQrStatus ? (
                                    <Loader2 className="w-5 h-5 animate-spin text-green-500" />
                                ) : (giftQrUsed || giftRedeemed) ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                                ) : (
                                    <Gift className="w-5 h-5 text-green-500" />
                                )}
                            </div>
                            <span className="text-[10px] font-medium text-gray-700">
                                {checkingQrStatus ? 'Checking...' : (giftQrUsed || giftRedeemed) ? 'Redeemed' : 'Redeem'}
                            </span>
                        </button>
                    )}

                    {config.enable_scratch_card_game && (
                        <button
                            onClick={() => handleProtectedAction('scratch-card')}
                            className="flex-1 flex flex-col items-center p-2 rounded-xl hover:bg-gray-50 transition-colors"
                        >
                            <div
                                className="w-10 h-10 rounded-full flex items-center justify-center mb-1.5"
                                style={{ backgroundColor: '#f3e8ff' }}
                            >
                                <Ticket className="w-5 h-5 text-purple-600" />
                            </div>
                            <span className="text-[10px] font-medium text-gray-700">Games</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Featured Rewards Section */}
            <div className="px-5 mt-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-gray-900">Featured Rewards</h2>
                    <button
                        onClick={() => setActiveTab('rewards')}
                        className="text-sm font-medium flex items-center gap-1"
                        style={{ color: config.primary_color }}
                    >
                        See all <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex gap-3 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide">
                    {/* Show real rewards if available, otherwise show loading/placeholder */}
                    {loadingRewards ? (
                        // Loading state
                        [1, 2, 3].map((i) => (
                            <div key={i} className="flex-shrink-0 w-36 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-pulse">
                                <div className="h-24 bg-gray-200" />
                                <div className="p-3">
                                    <div className="h-3 bg-gray-200 rounded w-20 mb-2" />
                                    <div className="h-3 bg-gray-200 rounded w-14" />
                                </div>
                            </div>
                        ))
                    ) : rewards.length > 0 ? (
                        // Show real rewards (first 5)
                        rewards.slice(0, 5).map((reward) => (
                            <div
                                key={reward.id}
                                className="flex-shrink-0 w-36 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                                onClick={() => setActiveTab('rewards')}
                            >
                                <div className="h-24 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center relative overflow-hidden">
                                    {reward.item_image_url ? (
                                        <Image
                                            src={getStorageUrl(reward.item_image_url) || reward.item_image_url}
                                            alt={reward.item_name}
                                            fill
                                            className="object-cover"
                                        />
                                    ) : (
                                        <Gift className="w-10 h-10 text-gray-400" />
                                    )}
                                    {reward.stock_quantity !== null && reward.stock_quantity <= 5 && reward.stock_quantity > 0 && (
                                        <span className="absolute top-1 right-1 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                                            {reward.stock_quantity} left
                                        </span>
                                    )}
                                </div>
                                <div className="p-3">
                                    <p className="text-xs font-medium text-gray-900 line-clamp-1">{reward.item_name}</p>
                                    <div className="flex items-center gap-1 mt-1">
                                        <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                                        {reward.point_offer ? (
                                            <div className="flex items-center gap-1">
                                                <span className="text-xs text-gray-400 line-through">{reward.points_required}</span>
                                                <span className="text-xs font-bold text-red-500">{reward.point_offer} pts</span>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-gray-600">{reward.points_required} pts</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    ) : (
                        // No rewards available placeholder
                        <div className="flex-1 text-center py-8 text-gray-500">
                            <Gift className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                            <p className="text-sm">No rewards available yet</p>
                            <p className="text-xs">Check back soon!</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Promotions Banner */}
            {renderBanner('home')}

            {/* Recent Activity */}
            <div className="px-5 mt-6 mb-4">
                <h2 className="text-lg font-bold text-gray-900 mb-4">Recent Activity</h2>
                <div className="space-y-3">
                    {pointsCollected && (
                        <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl border border-green-100">
                            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                                <CheckCircle2 className="w-5 h-5 text-green-600" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">Points Collected</p>
                                <p className="text-xs text-gray-500">Just now</p>
                            </div>
                            <span className="text-sm font-bold text-green-600">+{lastEarnedPoints} pts</span>
                        </div>
                    )}

                    {lastRedeemedReward && (
                        <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-xl border border-purple-100">
                            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                                <Gift className="w-5 h-5 text-purple-600" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">Reward Redeemed</p>
                                <p className="text-xs text-gray-500">{lastRedeemedReward.rewardName}</p>
                            </div>
                            <span className="text-sm font-bold text-purple-600">-{lastRedeemedReward.pointsDeducted} pts</span>
                        </div>
                    )}

                    {luckyDrawEntered && (
                        <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
                            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                                <Trophy className="w-5 h-5 text-amber-600" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">Lucky Draw Entry</p>
                                <p className="text-xs text-gray-500">Just now</p>
                            </div>
                            <Badge className="bg-amber-100 text-amber-700">Entered</Badge>
                        </div>
                    )}

                    {!pointsCollected && !luckyDrawEntered && !lastRedeemedReward && (
                        <div className="text-center py-8 text-gray-500">
                            <Zap className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                            <p className="text-sm">No recent activity</p>
                            <p className="text-xs">Start collecting points!</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )

    // Render Rewards Tab
    const renderRewardsTab = () => {
        // Handler for category tab change
        const handleCategoryChange = (cat: RewardCategoryType) => {
            setRewardCategory(cat)
            // Fetch data for the selected tab if authenticated
            if (isAuthenticated) {
                if (cat === 'History') {
                    // Always fetch to ensure latest redemptions are shown
                    fetchRedemptionHistory()
                } else if (cat === 'Point History') {
                    // Always fetch to ensure latest points transactions are shown
                    fetchPointsHistory()
                } else if (cat === 'Scanned' && scannedProducts.length === 0) {
                    fetchScannedProducts()
                }
            }
        }

        // Format date helper
        const formatDate = (dateStr: string) => {
            const date = new Date(dateStr)
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
        }

        // Get status color
        const getStatusColor = (status: string) => {
            switch (status) {
                case 'fulfilled':
                    return { bg: 'bg-green-100', text: 'text-green-700' }
                case 'processing':
                    return { bg: 'bg-blue-100', text: 'text-blue-700' }
                case 'pending':
                default:
                    return { bg: 'bg-amber-100', text: 'text-amber-700' }
            }
        }

        return (
            <div className="flex-1 overflow-y-auto pb-20 bg-gray-50">
                {/* Header */}
                <div
                    className="px-5 pt-6 pb-8 text-white"
                    style={{ backgroundColor: config.primary_color }}
                >
                    <h1 className="text-xl font-bold mb-2">Rewards Catalog</h1>
                    <p className="text-white/80 text-sm">Redeem your points for amazing rewards</p>

                    <div className="mt-4 flex items-center gap-2 bg-white/15 rounded-xl p-3">
                        <Star className="w-5 h-5 text-yellow-300 fill-yellow-300" />
                        <span className="font-bold">{userPoints}</span>
                        <span className="text-white/70 text-sm">points available</span>
                    </div>
                </div>

                {/* Category Tabs - Renamed: All, Scanned, Point History, History */}
                <div className="px-5 -mt-4">
                    <div className="bg-white rounded-xl shadow-sm p-1 flex gap-1">
                        {(['All', 'Scanned', 'Point History', 'History'] as RewardCategoryType[]).map((cat) => (
                            <button
                                key={cat}
                                onClick={() => handleCategoryChange(cat)}
                                className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-colors ${rewardCategory === cat
                                    ? 'text-white'
                                    : 'text-gray-600 hover:bg-gray-50'
                                    }`}
                                style={rewardCategory === cat ? { backgroundColor: config.primary_color } : {}}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Tab Content */}
                <div className="px-5 mt-4">
                    {renderBanner('rewards')}
                    {/* Free Gifts Section - Show when redemption is enabled and there are gifts */}
                    {config.redemption_enabled && showFreeGifts && (
                        <div className="mb-6">
                            <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                <Gift className="w-5 h-5 text-green-500" />
                                Free Gifts Available
                            </h3>
                            {loadingFreeGifts ? (
                                <div className="text-center py-6">
                                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-green-500" />
                                    <p className="text-sm text-gray-500 mt-2">Loading gifts...</p>
                                </div>
                            ) : giftQrUsed || giftRedeemed ? (
                                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                                    <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2" />
                                    <p className="text-sm font-medium text-green-700">You've already claimed a gift with this QR code!</p>
                                    <p className="text-xs text-green-600 mt-1">Scan another product to claim more gifts.</p>
                                </div>
                            ) : freeGifts.length > 0 ? (
                                <div className="grid grid-cols-2 gap-3">
                                    {freeGifts.map((gift) => {
                                        const remaining = gift.total_quantity === 0
                                            ? 'Unlimited'
                                            : gift.total_quantity - gift.claimed_quantity
                                        const isAvailable = gift.total_quantity === 0 || (typeof remaining === 'number' && remaining > 0)

                                        return (
                                            <div key={gift.id} className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
                                                <div className="h-24 bg-gradient-to-br from-green-50 to-green-100 flex items-center justify-center relative overflow-hidden">
                                                    {gift.gift_image_url ? (
                                                        <img
                                                            src={getStorageUrl(gift.gift_image_url) || gift.gift_image_url}
                                                            alt={gift.gift_name}
                                                            className="w-full h-full object-contain p-2"
                                                        />
                                                    ) : (
                                                        <Gift className="w-10 h-10 text-green-400" />
                                                    )}
                                                    {gift.total_quantity > 0 && remaining !== 'Unlimited' && (
                                                        <Badge className="absolute top-1 right-1 bg-green-500 text-white text-[10px]">
                                                            {remaining} left
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="p-3">
                                                    <p className="text-sm font-medium text-gray-900 line-clamp-1">{gift.gift_name}</p>
                                                    <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{gift.gift_description || 'Free gift for you!'}</p>
                                                    <button
                                                        onClick={() => {
                                                            if (isAvailable) {
                                                                setSelectedGift(gift)
                                                                setShowGiftConfirm(true)
                                                            }
                                                        }}
                                                        disabled={!isAvailable}
                                                        className="w-full mt-2 text-xs font-medium px-3 py-2 rounded-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                                        style={{
                                                            backgroundColor: isAvailable ? '#dcfce7' : '#e5e7eb',
                                                            color: isAvailable ? '#16a34a' : '#6b7280'
                                                        }}
                                                    >
                                                        {isAvailable ? 'Claim Free' : 'Out of Stock'}
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            ) : (
                                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                                    <Ghost className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                                    <p className="text-sm text-gray-500">No free gifts available for this product.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ALL - Show rewards grid */}
                    {rewardCategory === 'All' && (
                        <div className="grid grid-cols-2 gap-3">
                            {loadingRewards ? (
                                <div className="col-span-2 text-center py-12">
                                    <div className="w-8 h-8 border-2 border-gray-300 border-t-primary rounded-full animate-spin mx-auto" />
                                </div>
                            ) : rewards.length > 0 ? (
                                rewards.map((reward) => (
                                    <div key={reward.id} className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
                                        <div className="h-28 bg-white flex items-center justify-center relative p-2">
                                            {reward.item_image_url ? (
                                                <Image
                                                    src={getStorageUrl(reward.item_image_url) || reward.item_image_url}
                                                    alt={reward.item_name}
                                                    fill
                                                    className="object-contain"
                                                />
                                            ) : (
                                                <Gift className="w-12 h-12 text-gray-400" />
                                            )}
                                            {reward.stock_quantity !== null && reward.stock_quantity < 10 && (
                                                <Badge className="absolute top-2 right-2 bg-red-500 text-white text-[10px]">
                                                    {reward.stock_quantity} left
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="p-3">
                                            <p className="text-sm font-medium text-gray-900 line-clamp-1">{reward.item_name}</p>
                                            <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{reward.item_description || 'Redeem your points'}</p>
                                            <div className="flex items-center justify-between mt-2">
                                                <div className="flex items-center gap-1">
                                                    <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                                                    {reward.point_offer ? (
                                                        <div className="flex flex-col leading-none">
                                                            <span className="text-[10px] text-gray-400 line-through">{formatNumber(reward.points_required)}</span>
                                                            <span className="text-sm font-bold text-red-500">{formatNumber(reward.point_offer)}</span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-sm font-bold" style={{ color: config.primary_color }}>
                                                            {formatNumber(reward.points_required)}
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        setSelectedRewardForDetail(reward)
                                                        setCurrentRewardImageIndex(0)
                                                        setShowRewardDetailModal(true)
                                                    }}
                                                    className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all hover:scale-105 active:scale-95"
                                                    style={{
                                                        backgroundColor: `${config.button_color}15`,
                                                        color: config.button_color
                                                    }}
                                                >
                                                    View
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="col-span-2 text-center py-12 text-gray-500">
                                    <Gift className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                                    <p className="text-sm">No rewards available</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* SCANNED - Show scanned products */}
                    {rewardCategory === 'Scanned' && (
                        <div className="space-y-3">
                            {!isAuthenticated ? (
                                <div className="text-center py-12 text-gray-500">
                                    <Package className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                                    <p className="text-sm">Please login to view scanned products</p>
                                </div>
                            ) : loadingScannedProducts ? (
                                <div className="text-center py-12">
                                    <div className="w-8 h-8 border-2 border-gray-300 border-t-primary rounded-full animate-spin mx-auto" />
                                </div>
                            ) : scannedProducts.length > 0 ? (
                                <>
                                    {/* View Toggle */}
                                    <div className="flex justify-end gap-2 mb-3">
                                        <button
                                            onClick={() => setScannedViewMode('list')}
                                            className={`p-2 rounded-lg transition-colors ${scannedViewMode === 'list'
                                                ? 'bg-gray-900 text-white'
                                                : 'bg-white text-gray-600 border border-gray-200'
                                                }`}
                                        >
                                            <List className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => setScannedViewMode('grid')}
                                            className={`p-2 rounded-lg transition-colors ${scannedViewMode === 'grid'
                                                ? 'bg-gray-900 text-white'
                                                : 'bg-white text-gray-600 border border-gray-200'
                                                }`}
                                        >
                                            <Grid3x3 className="w-4 h-4" />
                                        </button>
                                    </div>

                                    {/* List View */}
                                    {scannedViewMode === 'list' ? (
                                        <div className="space-y-3">
                                            {scannedProducts.slice((scannedPage - 1) * itemsPerPage, scannedPage * itemsPerPage).map((scan, idx) => (
                                                <div key={`${scan.product_name}-${scan.variant_name}-${idx}`} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
                                                    <div className="flex gap-3">
                                                        <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                                                            {scan.image_url ? (
                                                                <Image
                                                                    src={getStorageUrl(scan.image_url) || scan.image_url}
                                                                    alt={scan.variant_name || 'Product'}
                                                                    width={64}
                                                                    height={64}
                                                                    className="object-cover"
                                                                />
                                                            ) : (
                                                                <Package className="w-8 h-8 text-gray-400" />
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-medium text-gray-900 line-clamp-1">
                                                                {scan.product_name}
                                                            </p>
                                                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                                                                {scan.variant_name}
                                                            </p>
                                                            <div className="flex items-center gap-2 mt-2">
                                                                <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                                                                    {scan.scan_count} {scan.scan_count === 1 ? 'scan' : 'scans'}
                                                                </Badge>
                                                                <span className="text-xs font-semibold text-green-600">
                                                                    +{scan.total_points} pts
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        /* Grid View */
                                        <div className="grid grid-cols-2 gap-3">
                                            {scannedProducts.slice((scannedPage - 1) * itemsPerPage, scannedPage * itemsPerPage).map((scan, idx) => (
                                                <div key={`${scan.product_name}-${scan.variant_name}-${idx}`} className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
                                                    <div className="h-32 bg-gray-100 flex items-center justify-center overflow-hidden">
                                                        {scan.image_url ? (
                                                            <Image
                                                                src={getStorageUrl(scan.image_url) || scan.image_url}
                                                                alt={scan.variant_name || 'Product'}
                                                                width={128}
                                                                height={128}
                                                                className="object-cover w-full h-full"
                                                            />
                                                        ) : (
                                                            <Package className="w-12 h-12 text-gray-400" />
                                                        )}
                                                    </div>
                                                    <div className="p-3">
                                                        <p className="text-sm font-medium text-gray-900 line-clamp-1">
                                                            {scan.product_name}
                                                        </p>
                                                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                                                            {scan.variant_name}
                                                        </p>
                                                        <div className="flex items-center justify-between mt-2">
                                                            <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                                                                {scan.scan_count}x
                                                            </Badge>
                                                            <span className="text-xs font-semibold text-green-600">
                                                                +{scan.total_points}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Pagination */}
                                    {scannedProducts.length > itemsPerPage && (
                                        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                                            <button
                                                onClick={() => setScannedPage(Math.max(1, scannedPage - 1))}
                                                disabled={scannedPage === 1}
                                                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <ChevronLeft className="w-4 h-4" />
                                                Previous
                                            </button>
                                            <span className="text-sm text-gray-600">
                                                Page {scannedPage} of {Math.ceil(scannedProducts.length / itemsPerPage)}
                                            </span>
                                            <button
                                                onClick={() => setScannedPage(Math.min(Math.ceil(scannedProducts.length / itemsPerPage), scannedPage + 1))}
                                                disabled={scannedPage >= Math.ceil(scannedProducts.length / itemsPerPage)}
                                                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Next
                                                <ChevronRight className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="text-center py-12 text-gray-500">
                                    <Package className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                                    <p className="text-sm">No scanned products yet</p>
                                    <p className="text-xs mt-1">Scan QR codes to see them here</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* POINT HISTORY - Show points transactions */}
                    {rewardCategory === 'Point History' && (
                        <div className="space-y-3">
                            {!isAuthenticated ? (
                                <div className="text-center py-12 text-gray-500">
                                    <Star className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                                    <p className="text-sm">Please login to view points history</p>
                                </div>
                            ) : loadingPointsHistory ? (
                                <div className="text-center py-12">
                                    <div className="w-8 h-8 border-2 border-gray-300 border-t-primary rounded-full animate-spin mx-auto" />
                                </div>
                            ) : pointsHistory.length > 0 ? (
                                <>
                                    {pointsHistory.slice((pointsPage - 1) * itemsPerPage, pointsPage * itemsPerPage).map((txn) => (
                                        <div key={txn.id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                                                    {txn.image_url ? (
                                                        <Image
                                                            src={getStorageUrl(txn.image_url) || txn.image_url}
                                                            alt={txn.product_name || 'Transaction'}
                                                            width={48}
                                                            height={48}
                                                            className="object-cover"
                                                        />
                                                    ) : txn.points > 0 ? (
                                                        <TrendingUp className="w-6 h-6 text-green-600" />
                                                    ) : (
                                                        <Gift className="w-6 h-6 text-purple-600" />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-gray-900 line-clamp-1">
                                                        {txn.product_name || txn.description || (txn.points > 0 ? 'Points Earned' : 'Points Redeemed')}
                                                    </p>
                                                    {txn.variant_name && (
                                                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                                                            {txn.variant_name}
                                                        </p>
                                                    )}
                                                    <p className="text-xs text-gray-400 mt-1">
                                                        {formatDate(txn.date)}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className={`text-sm font-bold ${txn.points > 0 ? 'text-green-600' : 'text-purple-600'
                                                        }`}>
                                                        {txn.points > 0 ? '+' : ''}{txn.points} pts
                                                    </p>
                                                    {txn.balance_after !== null && txn.balance_after !== undefined && (
                                                        <p className="text-xs text-gray-400">
                                                            Balance: {txn.balance_after}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Pagination */}
                                    {pointsHistory.length > itemsPerPage && (
                                        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                                            <button
                                                onClick={() => setPointsPage(Math.max(1, pointsPage - 1))}
                                                disabled={pointsPage === 1}
                                                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <ChevronLeft className="w-4 h-4" />
                                                Previous
                                            </button>
                                            <span className="text-sm text-gray-600">
                                                Page {pointsPage} of {Math.ceil(pointsHistory.length / itemsPerPage)}
                                            </span>
                                            <button
                                                onClick={() => setPointsPage(Math.min(Math.ceil(pointsHistory.length / itemsPerPage), pointsPage + 1))}
                                                disabled={pointsPage >= Math.ceil(pointsHistory.length / itemsPerPage)}
                                                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Next
                                                <ChevronRight className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="text-center py-12 text-gray-500">
                                    <Star className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                                    <p className="text-sm">No points history yet</p>
                                    <p className="text-xs mt-1">Collect points to see them here</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* HISTORY - Show redemption history */}
                    {rewardCategory === 'History' && (
                        <div className="space-y-3">
                            {!isAuthenticated ? (
                                <div className="text-center py-12 text-gray-500">
                                    <Gift className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                                    <p className="text-sm">Please login to view redemption history</p>
                                </div>
                            ) : loadingRedemptionHistory ? (
                                <div className="text-center py-12">
                                    <div className="w-8 h-8 border-2 border-gray-300 border-t-primary rounded-full animate-spin mx-auto" />
                                </div>
                            ) : redemptionHistory.length > 0 ? (
                                <>
                                    {redemptionHistory.slice((redemptionPage - 1) * itemsPerPage, redemptionPage * itemsPerPage).map((redemption) => {
                                        const statusColors = getStatusColor(redemption.status)
                                        return (
                                            <div key={redemption.id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
                                                <div className="flex gap-3">
                                                    <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                                                        {redemption.reward?.image_url ? (
                                                            <Image
                                                                src={getStorageUrl(redemption.reward.image_url) || redemption.reward.image_url}
                                                                alt={redemption.reward?.name || 'Reward'}
                                                                width={64}
                                                                height={64}
                                                                className="object-cover"
                                                            />
                                                        ) : (
                                                            <Gift className="w-8 h-8 text-gray-400" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-gray-900 line-clamp-1">
                                                            {redemption.reward?.name || redemption.description || 'Reward Redeemed'}
                                                        </p>
                                                        <p className="text-xs text-gray-500 mt-0.5">
                                                            {formatDate(redemption.date)}
                                                        </p>
                                                        <div className="flex items-center gap-2 mt-2">
                                                            <Badge className={`${statusColors.bg} ${statusColors.text} text-[10px] capitalize`}>
                                                                {redemption.status}
                                                            </Badge>
                                                            {redemption.redemption_code && (
                                                                <span className="text-xs text-gray-500 font-mono">
                                                                    {redemption.redemption_code}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-sm font-bold text-purple-600">
                                                            -{redemption.points_deducted} pts
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}

                                    {/* Pagination */}
                                    {redemptionHistory.length > itemsPerPage && (
                                        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                                            <button
                                                onClick={() => setRedemptionPage(Math.max(1, redemptionPage - 1))}
                                                disabled={redemptionPage === 1}
                                                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <ChevronLeft className="w-4 h-4" />
                                                Previous
                                            </button>
                                            <span className="text-sm text-gray-600">
                                                Page {redemptionPage} of {Math.ceil(redemptionHistory.length / itemsPerPage)}
                                            </span>
                                            <button
                                                onClick={() => setRedemptionPage(Math.min(Math.ceil(redemptionHistory.length / itemsPerPage), redemptionPage + 1))}
                                                disabled={redemptionPage >= Math.ceil(redemptionHistory.length / itemsPerPage)}
                                                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Next
                                                <ChevronRight className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="text-center py-12 text-gray-500">
                                    <Gift className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                                    <p className="text-sm">No redemptions yet</p>
                                    <p className="text-xs mt-1">Redeem rewards to see them here</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    // Render Lucky Draw Tab
    const renderLuckyDrawTab = () => (
        <div className="flex-1 overflow-y-auto pb-20 bg-gray-50">
            {/* Header with animated elements */}
            <div
                className="px-5 pt-6 pb-16 text-white text-center relative overflow-hidden"
                style={{
                    background: `linear-gradient(135deg, #f59e0b 0%, #d97706 100%)`
                }}
            >
                {/* Animated floating circles */}
                <div className="absolute inset-0">
                    <div className="absolute top-4 left-4 w-8 h-8 rounded-full bg-white/20 animate-pulse" />
                    <div className="absolute top-12 right-8 w-4 h-4 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '0.5s' }} />
                    <div className="absolute bottom-8 left-12 w-6 h-6 rounded-full bg-white/20 animate-pulse" style={{ animationDelay: '1s' }} />
                    <div className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-white/15 animate-bounce" style={{ animationDelay: '0.3s' }} />
                    <div className="absolute top-1/2 left-1/4 w-3 h-3 rounded-full bg-yellow-300/40 animate-ping" style={{ animationDelay: '0.7s' }} />
                    <div className="absolute top-1/3 right-1/4 w-2 h-2 rounded-full bg-yellow-200/50 animate-ping" style={{ animationDelay: '1.2s' }} />
                </div>

                <div className="relative z-10">
                    {/* Animated Trophy */}
                    <div className="relative inline-block">
                        <div className="absolute inset-0 bg-yellow-300 rounded-full blur-xl opacity-30 animate-pulse" />
                        <Trophy className="w-16 h-16 mx-auto mb-3 text-yellow-200 relative z-10 drop-shadow-lg" />
                        {/* Sparkle effects */}
                        <Sparkles className="absolute -top-1 -right-1 w-5 h-5 text-yellow-300 animate-bounce" />
                        <Star className="absolute -bottom-1 -left-1 w-4 h-4 text-yellow-200 fill-yellow-200 animate-pulse" />
                    </div>
                    <h1 className="text-2xl font-bold mb-2 drop-shadow-md">Lucky Draw</h1>
                    <p className="text-white/90 text-sm">Enter for a chance to win amazing prizes!</p>
                </div>
            </div>

            {/* Entry Form Card */}
            <div className="px-5 -mt-8 relative z-20">
                {checkingQrStatus ? (
                    // Loading state while checking QR status
                    <div className="bg-white rounded-2xl shadow-lg p-8 text-center border border-amber-100">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center animate-pulse">
                            <Loader2 className="w-8 h-8 text-amber-600 animate-spin" />
                        </div>
                        <p className="text-gray-600 text-sm">Checking entry status...</p>
                    </div>
                ) : luckyDrawEntered || luckyDrawQrUsed ? (
                    // Already entered - show nice animation
                    <div className="bg-white rounded-2xl shadow-lg p-6 text-center border border-amber-100 relative overflow-hidden">
                        {/* Confetti background animation */}
                        <div className="absolute inset-0 overflow-hidden pointer-events-none">
                            <div className="absolute top-0 left-1/4 w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0s', animationDuration: '2s' }} />
                            <div className="absolute top-0 left-1/2 w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s', animationDuration: '2.3s' }} />
                            <div className="absolute top-0 left-3/4 w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.6s', animationDuration: '1.8s' }} />
                            <div className="absolute top-0 left-1/3 w-1 h-1 bg-pink-400 rounded-full animate-bounce" style={{ animationDelay: '0.9s', animationDuration: '2.5s' }} />
                            <div className="absolute top-0 left-2/3 w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '1.2s', animationDuration: '2.1s' }} />
                        </div>

                        {/* Animated success icon */}
                        <div className="relative inline-block mb-4">
                            <div className="absolute inset-0 bg-green-400 rounded-full blur-xl opacity-30 animate-pulse" />
                            <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-lg relative">
                                <CheckCircle2 className="w-10 h-10 text-white drop-shadow-md" />
                                {/* Sparkle effect */}
                                <Sparkles className="absolute -top-1 -right-1 w-5 h-5 text-amber-400 animate-pulse" />
                            </div>
                        </div>

                        <h2 className="text-xl font-bold text-gray-900 mb-2">You're Already In!</h2>
                        <p className="text-gray-600 text-sm mb-4">
                            This QR code has already been used to enter the lucky draw. Good luck!
                        </p>

                        {customerName && (
                            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 text-left border border-amber-200">
                                <p className="text-xs text-amber-700 font-medium mb-2 flex items-center gap-1">
                                    <Gift className="w-3 h-3" />
                                    Entry Details
                                </p>
                                <p className="text-sm font-semibold text-gray-900">{customerName}</p>
                                <p className="text-sm text-gray-600">{customerPhone}</p>
                                {customerEmail && <p className="text-sm text-gray-500">{customerEmail}</p>}
                            </div>
                        )}

                        {!customerName && (
                            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200">
                                <p className="text-sm text-green-700 flex items-center justify-center gap-2">
                                    <Trophy className="w-4 h-4" />
                                    Entry confirmed! Winners will be announced soon.
                                </p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl shadow-lg p-5 border border-gray-100">
                        <h2 className="text-lg font-bold text-gray-900 mb-4">Enter Your Details</h2>

                        {/* Error message */}
                        {luckyDrawError && (
                            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                                <p className="text-sm text-red-600">{luckyDrawError}</p>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Full Name <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    placeholder="Enter your full name"
                                    value={customerName}
                                    onChange={(e) => setCustomerName(e.target.value)}
                                    className="h-11"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Phone Number <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    placeholder="e.g., 0123456789"
                                    value={customerPhone}
                                    onChange={(e) => handlePhoneChange(e.target.value)}
                                    className={`h-11 ${luckyDrawPhoneError ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                />
                                {luckyDrawPhoneError && (
                                    <p className="text-xs text-red-500 mt-1">{luckyDrawPhoneError}</p>
                                )}
                                <p className="text-xs text-gray-400 mt-1">Malaysia mobile number format</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Email <span className="text-gray-400">(Optional)</span>
                                </label>
                                <Input
                                    type="email"
                                    placeholder="example@email.com"
                                    value={customerEmail}
                                    onChange={(e) => handleEmailChange(e.target.value)}
                                    className={`h-11 ${luckyDrawEmailError ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                />
                                {luckyDrawEmailError && (
                                    <p className="text-xs text-red-500 mt-1">{luckyDrawEmailError}</p>
                                )}
                            </div>

                            <Button
                                onClick={handleLuckyDrawSubmit}
                                disabled={!customerName || !customerPhone || isSubmitting || !!luckyDrawPhoneError || !!luckyDrawEmailError}
                                className="w-full h-12 text-base font-semibold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-lg"
                            >
                                {isSubmitting ? (
                                    <span className="flex items-center gap-2">
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Submitting...
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        <Trophy className="w-5 h-5" />
                                        Enter Lucky Draw
                                    </span>
                                )}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Prizes Section */}
            <div className="px-5 mt-6">
                <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Crown className="w-5 h-5 text-amber-500" />
                    Prizes to Win
                </h2>
                <div className="space-y-3">
                    {config.lucky_draw_prizes?.length ? (
                        config.lucky_draw_prizes.map((prize: any, index: number) => (
                            <div key={index} className="bg-white rounded-xl p-4 flex items-center gap-4 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                                <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center overflow-hidden flex-shrink-0 border border-amber-200">
                                    {prize.image_url ? (
                                        <img
                                            src={getStorageUrl(prize.image_url) || prize.image_url}
                                            alt={prize.name || `Prize ${index + 1}`}
                                            className="w-full h-full object-contain p-1"
                                        />
                                    ) : (
                                        <Crown className="w-10 h-10 text-amber-600" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-gray-900 truncate">{prize.name || `Prize ${index + 1}`}</p>
                                    <p className="text-sm text-gray-500 line-clamp-2">{prize.description || 'Amazing prize awaits!'}</p>
                                    {prize.quantity && (
                                        <p className="text-xs text-amber-600 mt-1 font-medium">{prize.quantity} available</p>
                                    )}
                                </div>
                            </div>
                        ))
                    ) : (
                        // Demo prizes
                        ['Grand Prize', '2nd Prize', '3rd Prize'].map((prize, index) => (
                            <div key={index} className="bg-white rounded-xl p-4 flex items-center gap-4 shadow-sm border border-gray-100">
                                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center">
                                    {index === 0 ? (
                                        <Crown className="w-8 h-8 text-amber-600" />
                                    ) : (
                                        <Trophy className="w-8 h-8 text-amber-600" />
                                    )}
                                </div>
                                <div className="flex-1">
                                    <p className="font-semibold text-gray-900">{prize}</p>
                                    <p className="text-sm text-gray-500">Amazing prize awaits!</p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    )

    // Render Games Tab
    const renderGamesTab = () => (
        <div className="flex-1 overflow-y-auto pb-20 bg-gray-50">
            {/* Header */}
            <div
                className="px-5 pt-6 pb-8 text-white"
                style={{
                    background: `linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)`
                }}
            >
                <h1 className="text-xl font-bold mb-2">Games & Activities</h1>
                <p className="text-white/80 text-sm">Play games to earn bonus points!</p>
            </div>

            {/* Games Grid */}
            <div className="px-5 -mt-4 grid gap-4 relative z-10">
                {config.enable_scratch_card_game && activeGames.scratch && (
                    <button
                        onClick={() => handleProtectedAction('play-scratch-card')}
                        className="bg-white rounded-2xl shadow-lg p-5 text-left hover:shadow-xl transition-shadow"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                                <Ticket className="w-8 h-8 text-white" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-gray-900">Scratch & Win</h3>
                                <p className="text-sm text-gray-500">Scratch to reveal your prize!</p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-gray-400" />
                        </div>
                    </button>
                )}

                {/* Spin the Wheel */}
                {activeGames.spin && (
                    <button
                        onClick={() => handleProtectedAction('spin-wheel')}
                        className="bg-white rounded-2xl shadow-lg p-5 text-left hover:shadow-xl transition-shadow"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                                <Gamepad2 className="w-8 h-8 text-white" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-gray-900">Spin the Wheel</h3>
                                <p className="text-sm text-gray-500">Spin to win amazing rewards!</p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-gray-400" />
                        </div>
                    </button>
                )}

                {/* Daily Quiz */}
                {activeGames.quiz && (
                    <button
                        onClick={() => handleProtectedAction('daily-quiz')}
                        className="bg-white rounded-2xl shadow-lg p-5 text-left hover:shadow-xl transition-shadow"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                                <Sparkles className="w-8 h-8 text-white" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-gray-900">Daily Quiz</h3>
                                <p className="text-sm text-gray-500">Answer questions to earn points!</p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-gray-400" />
                        </div>
                    </button>
                )}
            </div>
        </div>
    )

    const handlePlayScratchCard = async () => {
        // Prevent re-scratching
        if (isScratching || scratchResult || scratchCardAlreadyPlayed) return

        setIsScratching(true)
        setScratchError(null)

        try {
            // Get phone from props or authenticated user
            const phone = consumerPhone || userPhone

            if (!phone) {
                // Check if user is authenticated but has no phone
                if (isAuthenticated) {
                    setScratchError('Please update your phone number in your profile to play.')
                } else {
                    setScratchError('Please login to play the scratch card game.')
                }
                setIsScratching(false)
                return
            }

            console.log('Playing scratch card with:', {
                journeyConfigId: config.id,
                phone,
                qrCodeId: qrCodeDbId
            })

            const { data, error } = await supabase.rpc('play_scratch_card_turn' as any, {
                p_journey_config_id: config.id,
                p_consumer_phone: phone,
                p_qr_code_id: qrCodeDbId // Pass the QR code ID for per-QR limit tracking
            }) as { data: any, error: any }

            console.log('Scratch card RPC response:', { data, error })

            if (error) throw error

            // Handle error response from RPC
            if (data?.error) {
                // Check for specific error codes
                if (data.code === 'QR_LIMIT_REACHED') {
                    setScratchCardAlreadyPlayed(true)
                    throw new Error('This QR code has already been used for scratch card.')
                }
                throw new Error(data.error)
            }

            // RPC returns: { success: true, reward: { name, type, value_points, ... }, play_id }
            const isWin = data.success === true || data.status === 'win'
            const rewardName = data.reward?.name || data.reward_name || 'No Prize'
            const points = data.reward?.value_points || data.points_value || 0
            const rewardType = data.reward?.type || data.reward_type || 'no_prize'

            console.log('Scratch card result:', { isWin, rewardName, points, rewardType })

            // Set result - this will trigger UI update
            const result = {
                isWin: isWin && rewardType !== 'no_prize',
                rewardName
            }
            setScratchResult(result)

            // Mark as played so user can't play again
            setScratchCardAlreadyPlayed(true)
            setScratchCardPreviousReward(rewardName)

            // Handle Win
            if (isWin && points > 0) {
                // Play sound
                const audio = new Audio('/sounds/win.mp3')
                audio.play().catch(e => console.log('Audio play failed', e))

                // Show animation for points
                setPreviousBalance(userPoints)
                setTotalBalance(userPoints + points)
                setPointsEarned(points)
                setShowPointsSuccessModal(true)

                // Update local balance immediately for UI
                setUserPoints(prev => prev + points)

                // Also refresh balance from server to ensure sync
                // (The DB function now adds points automatically)
                if (isShopUser && userId) {
                    try {
                        const response = await fetch('/api/user/profile', {
                            credentials: 'include'
                        })
                        const result = await response.json()
                        if (result.success && result.profile?.pointsBalance !== undefined) {
                            console.log('Refreshed points balance from server:', result.profile.pointsBalance)
                            setUserPoints(result.profile.pointsBalance)
                            setTotalBalance(result.profile.pointsBalance)
                        }
                    } catch (refreshErr) {
                        console.error('Error refreshing balance:', refreshErr)
                    }
                }
            }

        } catch (err: any) {
            console.error('Scratch card error:', err)
            setScratchError(err.message || 'Failed to play. Please try again.')
            toast({
                title: "Error",
                description: err.message || "Failed to play scratch card",
                variant: "destructive"
            })
        } finally {
            setIsScratching(false)
        }
    }

    const renderScratchCardTab = () => (
        <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
            <div className="p-4 flex items-center gap-3 bg-white shadow-sm z-10">
                <button onClick={() => setActiveTab('games')} className="p-2 -ml-2">
                    <ArrowLeft className="w-6 h-6 text-gray-600" />
                </button>
                <h1 className="text-lg font-bold">Scratch & Win</h1>
            </div>
            <div className="flex-1 p-6 flex items-center justify-center flex-col gap-4">
                {/* Show "Already Played" message with nice animation */}
                {scratchCardAlreadyPlayed && !scratchResult ? (
                    <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-6 text-center animate-in fade-in zoom-in duration-500">
                        {/* Animated gift box icon */}
                        <div className="mb-4 relative">
                            <div className="w-24 h-24 mx-auto bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg animate-bounce">
                                <Gift className="w-12 h-12 text-white" />
                            </div>
                            {/* Sparkle effects */}
                            <div className="absolute -top-2 -right-2 w-6 h-6 text-yellow-400 animate-ping">✨</div>
                            <div className="absolute -bottom-1 -left-2 w-5 h-5 text-yellow-400 animate-pulse">⭐</div>
                        </div>

                        <h3 className="text-xl font-bold text-gray-900 mb-2">
                            🎉 You've Already Played!
                        </h3>

                        {scratchCardPreviousReward && (
                            <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-4 mb-4">
                                <p className="text-sm text-green-700 mb-1">Your prize:</p>
                                <p className="text-lg font-bold text-green-800">{scratchCardPreviousReward}</p>
                            </div>
                        )}

                        <p className="text-gray-600 mb-4 leading-relaxed">
                            This QR code has already been used for the scratch card game.
                            <br />
                            <span className="text-sm text-gray-500">Scan a new QR code to play again!</span>
                        </p>

                        {/* Fun illustration */}
                        <div className="text-4xl mb-4 animate-pulse">
                            🎁 → 📱 → 🎰
                        </div>

                        <button
                            onClick={() => setActiveTab('home')}
                            className="w-full py-3 px-4 rounded-xl font-semibold text-white transition-all duration-300 hover:scale-105 active:scale-95"
                            style={{ backgroundColor: config.primary_color }}
                        >
                            Back to Home
                        </button>
                    </div>
                ) : (
                    <>
                        {scratchError && (
                            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm text-center w-full max-w-sm">
                                {scratchError}
                                {!isAuthenticated && scratchError.includes('login') && (
                                    <button
                                        onClick={() => setActiveTab('profile')}
                                        className="mt-2 block w-full py-2 px-4 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                                    >
                                        Go to Login
                                    </button>
                                )}
                                {isAuthenticated && scratchError.includes('phone') && (
                                    <button
                                        onClick={() => setActiveTab('account-settings')}
                                        className="mt-2 block w-full py-2 px-4 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                                    >
                                        Update Profile
                                    </button>
                                )}
                            </div>
                        )}
                        <ScratchCard
                            primaryColor={config.primary_color}
                            titleText={config.scratch_card_title || 'Scratch & Win'}
                            successMessage="You won: {{reward_name}}"
                            noPrizeMessage="Better luck next time!"
                            result={scratchResult}
                            isScratching={isScratching}
                            onScratchComplete={handlePlayScratchCard}
                            theme="modern"
                        />
                        {!scratchResult && !isScratching && (
                            <p className="text-sm text-gray-500 text-center animate-pulse">
                                Tap or scratch to play!
                            </p>
                        )}
                    </>
                )}
            </div>
        </div>
    )

    const renderSpinWheelTab = () => (
        <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
            <div className="p-4 flex items-center gap-3 bg-white shadow-sm z-10">
                <button onClick={() => setActiveTab('games')} className="p-2 -ml-2">
                    <ArrowLeft className="w-6 h-6 text-gray-600" />
                </button>
                <h1 className="text-lg font-bold">Spin the Wheel</h1>
            </div>
            <div className="flex-1 p-6 flex items-center justify-center">
                <SpinWheelGame
                    primaryColor={config.primary_color}
                    journeyId={config.id}
                    qrCode={qrCode}
                    onSpinComplete={() => {
                        // Handle completion logic
                    }}
                />
            </div>
        </div>
    )

    const renderDailyQuizTab = () => (
        <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
            <div className="p-4 flex items-center gap-3 bg-white shadow-sm z-10">
                <button onClick={() => setActiveTab('games')} className="p-2 -ml-2">
                    <ArrowLeft className="w-6 h-6 text-gray-600" />
                </button>
                <h1 className="text-lg font-bold">Daily Quiz</h1>
            </div>
            <div className="flex-1 p-6">
                <DailyQuizGame
                    primaryColor={config.primary_color}
                    journeyId={config.id}
                    qrCode={qrCode}
                    onQuizComplete={(score) => {
                        // Handle completion logic
                    }}
                />
            </div>
        </div>
    )

    // Render Products Tab
    const renderProductsTab = () => {
        if (selectedProduct) {
            return (
                <div className="flex-1 overflow-y-auto pb-20 bg-gray-50">
                    {/* Header */}
                    <div
                        className="px-5 pt-6 pb-8 text-white sticky top-0 z-30"
                        style={{
                            background: `linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)`
                        }}
                    >
                        <button
                            onClick={() => setSelectedProduct(null)}
                            className="flex items-center gap-2 text-white/90 hover:text-white mb-4 transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                            <span className="font-medium">Back to Catalog</span>
                        </button>
                        <h1 className="text-xl font-bold mb-1">{selectedProduct.product_name}</h1>
                        <p className="text-white/80 text-sm">{selectedProduct.brand_name}</p>
                    </div>

                    {/* Product Details */}
                    <div className="px-5 -mt-4 relative z-20 space-y-4">
                        {/* Main Product Card */}
                        <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100 p-4">
                            <div className="aspect-video relative rounded-xl overflow-hidden bg-gray-100 mb-4">
                                {selectedProduct.primary_image_url ? (
                                    <Image
                                        src={getStorageUrl(selectedProduct.primary_image_url) || selectedProduct.primary_image_url}
                                        alt={selectedProduct.product_name}
                                        fill
                                        className="object-contain"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Package className="w-12 h-12 text-gray-300" />
                                    </div>
                                )}
                            </div>
                            <p className="text-sm text-gray-600">{selectedProduct.product_description}</p>
                        </div>

                        {/* Variants List */}
                        <h3 className="text-lg font-bold text-gray-900 px-1">
                            Available Variants ({selectedProduct.variants?.length || 0})
                        </h3>

                        <div className="grid grid-cols-2 gap-3">
                            {selectedProduct.variants?.map((variant) => (
                                <div key={variant.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full">
                                    <div className="aspect-square relative bg-gray-50">
                                        {variant.image_url ? (
                                            <Image
                                                src={getStorageUrl(variant.image_url) || variant.image_url}
                                                alt={variant.variant_name}
                                                fill
                                                className="object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <Package className="w-8 h-8 text-gray-300" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-3 flex flex-col flex-1">
                                        <div className="font-medium text-gray-900 text-sm mb-1 flex-1">
                                            {variant.variant_name.includes('[') ? (
                                                <>
                                                    <span className="block">{variant.variant_name.split('[')[0]}</span>
                                                    <span className="block text-xs text-gray-500 mt-0.5">[{variant.variant_name.split('[')[1]}</span>
                                                </>
                                            ) : (
                                                variant.variant_name
                                            )}
                                        </div>
                                        {!selectedProduct.hide_price && (
                                            <div className="mt-auto">
                                                {variant.other_price && variant.other_price > 0 && variant.suggested_retail_price ? (
                                                    <div className="flex flex-col items-start gap-0.5">
                                                        <div className="flex items-center flex-wrap gap-1">
                                                            <span className="text-sm font-bold text-[#FF5722]">
                                                                RM {variant.other_price.toFixed(2)}
                                                            </span>
                                                            <span className="text-[10px] bg-[#FFEEE8] text-[#FF5722] px-1 rounded font-medium">
                                                                -{Math.round(((variant.suggested_retail_price - variant.other_price) / variant.suggested_retail_price) * 100)}%
                                                            </span>
                                                        </div>

                                                        <div className="flex items-center flex-wrap gap-1">
                                                            <span className="text-[10px] text-gray-400 line-through">
                                                                RM {variant.suggested_retail_price.toFixed(2)}
                                                            </span>
                                                            <div className="flex items-center border border-[#FF5722] rounded px-1">
                                                                <span className="text-[9px] text-[#FF5722] font-medium">
                                                                    RM{(variant.suggested_retail_price - variant.other_price).toFixed(0)} off
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    variant.suggested_retail_price && (
                                                        <p className="text-sm font-bold" style={{ color: config.primary_color }}>
                                                            RM {variant.suggested_retail_price.toFixed(2)}
                                                        </p>
                                                    )
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )
        }

        return (
            <div className="flex-1 overflow-y-auto pb-20 bg-gray-50">
                {/* Header */}
                <div
                    className="px-5 pt-6 pb-8 text-white"
                    style={{
                        background: `linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)`
                    }}
                >
                    <h1 className="text-xl font-bold mb-2">Product Catalog</h1>
                    <p className="text-white/80 text-sm">Discover our amazing products</p>
                </div>

                {/* Products Grid */}
                <div className="px-5 -mt-4 relative z-20">
                    {renderBanner('products')}
                    {loadingProducts ? (
                        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
                            <Loader2 className="w-8 h-8 mx-auto animate-spin text-gray-400" />
                            <p className="text-sm text-gray-500 mt-2">Loading products...</p>
                        </div>
                    ) : products.length > 0 ? (
                        <div className="space-y-4">
                            {products.map((product) => (
                                <div
                                    key={product.id}
                                    className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100 active:scale-[0.98] transition-transform cursor-pointer"
                                    onClick={() => setSelectedProduct(product)}
                                >
                                    <div className="flex">
                                        <div className="w-28 h-28 bg-gradient-to-br from-gray-100 to-gray-200 flex-shrink-0 flex items-center justify-center relative">
                                            {product.primary_image_url ? (
                                                <Image
                                                    src={getStorageUrl(product.primary_image_url) || product.primary_image_url}
                                                    alt={product.product_name}
                                                    fill
                                                    className="object-cover"
                                                />
                                            ) : (
                                                <Package className="w-10 h-10 text-gray-400" />
                                            )}
                                        </div>
                                        <div className="flex-1 p-4">
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-bold text-gray-900 line-clamp-1">{product.product_name}</p>
                                                    <p className="text-xs text-gray-500 mt-0.5">{product.brand_name}</p>
                                                </div>
                                                {product.category_name && (
                                                    <Badge variant="secondary" className="text-[10px] flex-shrink-0 ml-2">
                                                        {product.category_name}
                                                    </Badge>
                                                )}
                                            </div>
                                            {product.product_description && (
                                                <p className="text-xs text-gray-600 mt-2 line-clamp-2">{product.product_description}</p>
                                            )}
                                            {product.variants && product.variants.length > 0 && (
                                                <div className="mt-2 flex items-center gap-2">
                                                    <span className="text-xs text-gray-500">{product.variants.length} variant{product.variants.length > 1 ? 's' : ''}</span>
                                                    {product.variants[0].suggested_retail_price && !product.hide_price && (
                                                        <span className="text-sm font-bold" style={{ color: config.primary_color }}>
                                                            RM {product.variants[0].suggested_retail_price.toFixed(2)}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
                            <Package className="w-16 h-16 mx-auto text-gray-300" />
                            <h3 className="text-lg font-bold text-gray-900 mt-4">No Products Available</h3>
                            <p className="text-sm text-gray-500 mt-1">Check back soon for new products!</p>
                        </div>
                    )}
                </div>
            </div>
        )
    }



    // Render Profile Tab
    const renderProfileTab = () => (
        <div className="flex-1 overflow-y-auto pb-20 bg-gray-50">
            <div
                className="px-5 pt-6 pb-16 text-white text-center relative"
                style={{ backgroundColor: config.primary_color }}
            >
                {/* Buttons moved to fixed position outside scroll container */}

                <div className="w-20 h-20 mx-auto mb-3 rounded-full bg-white/20 flex items-center justify-center overflow-hidden relative group">
                    {isAuthenticated && (
                        <>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleAvatarUpload}
                                className="hidden"
                                accept="image/*"
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity z-10"
                                disabled={isUploadingAvatar}
                            >
                                {isUploadingAvatar ? (
                                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                                ) : (
                                    <Camera className="w-6 h-6 text-white" />
                                )}
                            </button>
                        </>
                    )}
                    {isAuthenticated && userAvatarUrl ? (
                        <img
                            src={userAvatarUrl}
                            alt="Profile"
                            className="object-cover w-full h-full"
                            key={userAvatarUrl} // Force re-render when avatar changes
                        />
                    ) : (
                        <User className="w-10 h-10" />
                    )}
                </div>
                <h1 className="text-xl font-bold">
                    {isAuthenticated
                        ? (isShopUser && shopName ? shopName : userName || 'User')
                        : 'Guest User'}
                </h1>
                <p className="text-white/80 text-sm">
                    {isAuthenticated
                        ? (userEmail || 'No email')
                        : 'Sign in to track your rewards'}
                </p>
            </div>

            <div className="px-5 -mt-8 relative z-10 space-y-4">
                {renderBanner('profile')}
                {/* Login/Logout Section */}
                {!isAuthenticated ? (
                    <div className="bg-white rounded-2xl shadow-lg p-5">
                        {showLoginForm ? (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between mb-2">
                                    <h2 className="text-lg font-bold text-gray-900">
                                        {isSignUp ? 'Create Account' : 'Sign In'}
                                    </h2>
                                    <button
                                        onClick={() => {
                                            setShowLoginForm(false)
                                            setLoginError('')
                                            setEmailError('')
                                            setPhoneError('')
                                            // Clear fields when closing form
                                            setLoginEmail('')
                                            setLoginPassword('')
                                            setLoginLoading(false)
                                        }}
                                        className="p-1 rounded-full hover:bg-gray-100"
                                    >
                                        <X className="w-5 h-5 text-gray-500" />
                                    </button>
                                </div>

                                {loginError && (
                                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                        <p className="text-sm text-red-600">{loginError}</p>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        {isSignUp ? 'Email' : 'Email or Phone Number'}
                                    </label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                        <Input
                                            type="text"
                                            placeholder={isSignUp ? "Enter your email address" : "Enter email or phone number"}
                                            value={loginEmail}
                                            onChange={(e) => {
                                                setLoginEmail(e.target.value)
                                                setEmailError('')
                                            }}
                                            onBlur={async (e) => {
                                                if (isSignUp && e.target.value && e.target.value.includes('@')) {
                                                    // Check if email exists
                                                    const { data } = await supabase
                                                        .from('users')
                                                        .select('id')
                                                        .eq('email', e.target.value)
                                                        .single()

                                                    if (data) {
                                                        setEmailError('This email address is already registered. Please use a different email.')
                                                    }
                                                }
                                            }}
                                            className={`h-11 pl-10 ${emailError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                                            autoComplete="off"
                                            autoCorrect="off"
                                            autoCapitalize="off"
                                        />
                                        {emailError && (
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                <AlertCircle className="w-5 h-5 text-red-500" />
                                            </div>
                                        )}
                                    </div>
                                    {emailError && (
                                        <p className="text-xs text-red-500 mt-1">{emailError}</p>
                                    )}
                                    {!isSignUp && <p className="text-xs text-gray-500 mt-1">You can log in using your email or phone number.</p>}
                                </div>

                                {isSignUp && (
                                    <>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Full Name
                                            </label>
                                            <div className="relative">
                                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                                <Input
                                                    type="text"
                                                    placeholder="Enter your full name"
                                                    value={signUpName}
                                                    onChange={(e) => {
                                                        let newValue = e.target.value
                                                        // Auto-capitalize words in Full Name when space is pressed
                                                        if (newValue.endsWith(' ') && newValue.length > 1) {
                                                            const words = newValue.split(' ')
                                                            if (words.length >= 2) {
                                                                const lastWordIndex = words.length - 2
                                                                const lastWord = words[lastWordIndex]
                                                                if (lastWord) {
                                                                    words[lastWordIndex] = lastWord.charAt(0).toUpperCase() + lastWord.slice(1).toLowerCase()
                                                                    newValue = words.join(' ')
                                                                }
                                                            }
                                                        }
                                                        setSignUpName(newValue)
                                                    }}
                                                    className="h-11 pl-10"
                                                    autoComplete="name"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Phone Number
                                            </label>
                                            <div className="relative">
                                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                                <Input
                                                    type="tel"
                                                    placeholder="e.g., 0123456789"
                                                    value={signUpPhone}
                                                    onChange={(e) => {
                                                        setSignUpPhone(e.target.value)
                                                        setPhoneError('')
                                                    }}
                                                    onBlur={async (e) => {
                                                        if (e.target.value) {
                                                            // Check if phone exists
                                                            const { data } = await supabase
                                                                .from('users')
                                                                .select('id')
                                                                .eq('phone', e.target.value)
                                                                .single()

                                                            if (data) {
                                                                setPhoneError('This phone number is already registered to another user.')
                                                            }
                                                        }
                                                    }}
                                                    className={`h-11 pl-10 ${phoneError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                                                    autoComplete="tel"
                                                />
                                                {phoneError && (
                                                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                        <AlertCircle className="w-5 h-5 text-red-500" />
                                                    </div>
                                                )}
                                            </div>
                                            {phoneError && (
                                                <p className="text-xs text-red-500 mt-1">{phoneError}</p>
                                            )}
                                            <p className="text-xs text-gray-500 mt-1">Supported: Malaysia (+60) and China (+86) mobile numbers</p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Location
                                            </label>
                                            <div className="relative">
                                                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                                <select
                                                    value={signUpLocation}
                                                    onChange={(e) => setSignUpLocation(e.target.value)}
                                                    className="h-11 w-full pl-10 pr-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                >
                                                    <option value="" disabled>Select your state</option>
                                                    <option value="Johor">Johor</option>
                                                    <option value="Kedah">Kedah</option>
                                                    <option value="Kelantan">Kelantan</option>
                                                    <option value="Melaka">Melaka</option>
                                                    <option value="Negeri Sembilan">Negeri Sembilan</option>
                                                    <option value="Pahang">Pahang</option>
                                                    <option value="Penang">Penang</option>
                                                    <option value="Perak">Perak</option>
                                                    <option value="Perlis">Perlis</option>
                                                    <option value="Sabah">Sabah</option>
                                                    <option value="Sarawak">Sarawak</option>
                                                    <option value="Selangor">Selangor</option>
                                                    <option value="Terengganu">Terengganu</option>
                                                    <option value="Kuala Lumpur">Kuala Lumpur</option>
                                                    <option value="Labuan">Labuan</option>
                                                    <option value="Putrajaya">Putrajaya</option>
                                                </select>
                                            </div>
                                        </div>
                                    </>
                                )}

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Password
                                    </label>
                                    <div className="relative">
                                        <Input
                                            type={showPassword ? 'text' : 'password'}
                                            placeholder="Enter your password"
                                            value={loginPassword}
                                            onChange={(e) => setLoginPassword(e.target.value)}
                                            className="h-11 pr-10"
                                            autoComplete="new-password"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2"
                                        >
                                            {showPassword ? (
                                                <EyeOff className="w-5 h-5 text-gray-400" />
                                            ) : (
                                                <Eye className="w-5 h-5 text-gray-400" />
                                            )}
                                        </button>
                                    </div>
                                    {isSignUp && <p className="text-xs text-gray-500 mt-1">Minimum 6 characters</p>}
                                </div>

                                {isSignUp && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Confirm Password
                                        </label>
                                        <div className="relative">
                                            <Input
                                                type={showConfirmPassword ? 'text' : 'password'}
                                                placeholder="Re-enter your password"
                                                value={signUpConfirmPassword}
                                                onChange={(e) => setSignUpConfirmPassword(e.target.value)}
                                                className={`h-11 pr-10 ${signUpConfirmPassword && loginPassword === signUpConfirmPassword
                                                    ? 'border-green-500 focus-visible:ring-green-500'
                                                    : ''
                                                    }`}
                                                autoComplete="new-password"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2"
                                            >
                                                {showConfirmPassword ? (
                                                    <EyeOff className="w-5 h-5 text-gray-400" />
                                                ) : (
                                                    <Eye className="w-5 h-5 text-gray-400" />
                                                )}
                                            </button>
                                        </div>
                                        {signUpConfirmPassword && loginPassword === signUpConfirmPassword && (
                                            <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                                                <Check className="w-3 h-3" /> Passwords match
                                            </p>
                                        )}
                                    </div>
                                )}

                                <Button
                                    onClick={handleLogin}
                                    disabled={loginLoading || !loginEmail || !loginPassword}
                                    className="w-full h-11 font-semibold"
                                    style={{ backgroundColor: config.button_color }}
                                >
                                    {loginLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            {isSignUp ? 'Creating Account...' : 'Signing In...'}
                                        </>
                                    ) : (
                                        isSignUp ? 'Create Account' : 'Sign In'
                                    )}
                                </Button>

                                <div className="text-center">
                                    <button
                                        onClick={() => setIsSignUp(!isSignUp)}
                                        className="text-sm font-medium"
                                        style={{ color: config.primary_color }}
                                    >
                                        {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center">
                                <LogIn className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                                <h2 className="text-lg font-bold text-gray-900">Welcome!</h2>
                                <p className="text-sm text-gray-500 mt-1 mb-4">
                                    Sign in to track your points and rewards
                                </p>
                                <Button
                                    onClick={() => setShowLoginForm(true)}
                                    className="w-full h-11 font-semibold"
                                    style={{ backgroundColor: config.button_color }}
                                >
                                    <LogIn className="w-4 h-4 mr-2" />
                                    Sign In / Sign Up
                                </Button>
                            </div>
                        )}
                    </div>
                ) : null}

                {/* Stats Section - Only show when authenticated */}
                {isAuthenticated && (
                    <div className="bg-white rounded-2xl shadow-lg divide-y divide-gray-100">
                        <div className="p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Star className="w-5 h-5 text-amber-500" />
                                <span className="font-medium">Total Points</span>
                            </div>
                            <span className="font-bold" style={{ color: config.primary_color }}>{userPoints}</span>
                        </div>
                    </div>
                )}

            </div>
        </div>
    )

    // Render Account Settings Tab
    const renderAccountSettingsTab = () => (
        <div className="flex-1 overflow-y-auto pb-20 bg-gray-50">
            {/* Header */}
            <div
                className="px-5 pt-6 pb-8 text-white"
                style={{ backgroundColor: config.primary_color }}
            >
                <div className="flex items-center gap-3 mb-4">
                    <button
                        onClick={() => setActiveTab('profile')}
                        className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h1 className="text-xl font-bold">Account Settings</h1>
                </div>
            </div>

            <div className="px-5 -mt-4 relative z-20 space-y-4">
                {/* Success/Error Messages */}
                {profileSaveSuccess && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2">
                        <Check className="w-5 h-5 text-green-500" />
                        <p className="text-sm text-green-700">Profile updated successfully!</p>
                    </div>
                )}
                {passwordSuccess && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2">
                        <Check className="w-5 h-5 text-green-500" />
                        <p className="text-sm text-green-700">Password changed successfully!</p>
                    </div>
                )}

                {/* Account & Security Section */}
                <div className="bg-transparent">
                    {/* Account & Security */}
                    <button
                        onClick={() => setShowChangePassword(!showChangePassword)}
                        className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors bg-white rounded-xl mb-3"
                    >
                        <div className="flex items-center gap-3">
                            <Lock className="w-5 h-5 text-gray-600" />
                            <span className="font-medium text-gray-900">Account & Security</span>
                        </div>
                        <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${showChangePassword ? 'rotate-90' : ''}`} />
                    </button>

                    {/* Expandable Password Change Section */}
                    {showChangePassword && (
                        <div className="p-4 bg-gray-50 rounded-xl space-y-4 mb-3">
                            <h4 className="font-semibold text-gray-900">Change Password</h4>
                            <p className="text-sm text-gray-500">Update your password to keep your account secure</p>

                            {passwordError && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                    <p className="text-sm text-red-600">{passwordError}</p>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Current Password <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Input
                                        type={showCurrentPassword ? 'text' : 'password'}
                                        placeholder="Enter current password"
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                        className="h-11 pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2"
                                    >
                                        {showCurrentPassword ? (
                                            <EyeOff className="w-5 h-5 text-gray-400" />
                                        ) : (
                                            <Eye className="w-5 h-5 text-gray-400" />
                                        )}
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">Enter your current password to verify your identity</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    New Password <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Input
                                        type={showNewPassword ? 'text' : 'password'}
                                        placeholder="Enter new password (min 6 characters)"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="h-11 pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowNewPassword(!showNewPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2"
                                    >
                                        {showNewPassword ? (
                                            <EyeOff className="w-5 h-5 text-gray-400" />
                                        ) : (
                                            <Eye className="w-5 h-5 text-gray-400" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Confirm New Password <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Input
                                        type={showChangeConfirmPassword ? 'text' : 'password'}
                                        placeholder="Confirm new password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="h-11 pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowChangeConfirmPassword(!showChangeConfirmPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2"
                                    >
                                        {showChangeConfirmPassword ? (
                                            <EyeOff className="w-5 h-5 text-gray-400" />
                                        ) : (
                                            <Eye className="w-5 h-5 text-gray-400" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            <Button
                                onClick={handleChangePassword}
                                disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                                className="w-full h-11 font-semibold"
                                style={{ backgroundColor: config.button_color }}
                            >
                                {changingPassword ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Updating...
                                    </>
                                ) : (
                                    'Update Password'
                                )}
                            </Button>
                        </div>
                    )}
                </div>

                {/* Profile Information Section */}
                <div className="bg-transparent">
                    {/* Profile Information Clickable Row */}
                    <button
                        onClick={() => setShowProfileInfo(!showProfileInfo)}
                        className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors bg-white rounded-xl mb-3"
                    >
                        <div className="flex items-center gap-3">
                            <User className="w-5 h-5 text-gray-600" />
                            <span className="font-medium text-gray-900">Profile Information</span>
                        </div>
                        <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${showProfileInfo ? 'rotate-90' : ''}`} />
                    </button>

                    {/* Expandable Profile Info Section */}
                    {showProfileInfo && (
                        <div className="bg-gray-50 rounded-xl mb-3 overflow-hidden">
                            {profileSaveError && (
                                <div className="p-3 mx-4 mt-4 bg-red-50 border border-red-200 rounded-lg">
                                    <p className="text-sm text-red-600">{profileSaveError}</p>
                                </div>
                            )}

                            {/* Name */}
                            <div className="p-4 border-b border-gray-100">
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-medium text-gray-700">Name</label>
                                    {!editingName && (
                                        <button
                                            onClick={() => {
                                                setEditingName(true)
                                                setNewName(userName)
                                            }}
                                            className="text-sm font-medium"
                                            style={{ color: config.primary_color }}
                                        >
                                            Edit
                                        </button>
                                    )}
                                </div>
                                {editingName ? (
                                    <div className="flex gap-2">
                                        <Input
                                            type="text"
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            placeholder="Enter your name"
                                            className="h-10 flex-1"
                                        />
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => {
                                                setEditingName(false)
                                                setNewName(userName)
                                            }}
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <User className="w-4 h-4 text-gray-400" />
                                        <span className="text-gray-900">{userName || 'Not set'}</span>
                                    </div>
                                )}
                            </div>

                            {/* Phone */}
                            <div className="p-4 border-b border-gray-100">
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-medium text-gray-700">Phone Number</label>
                                    {!editingPhone && (
                                        <button
                                            onClick={() => {
                                                setEditingPhone(true)
                                                setNewPhone(userPhone)
                                            }}
                                            className="text-sm font-medium"
                                            style={{ color: config.primary_color }}
                                        >
                                            Edit
                                        </button>
                                    )}
                                </div>
                                {editingPhone ? (
                                    <div className="flex gap-2">
                                        <Input
                                            type="tel"
                                            value={newPhone}
                                            onChange={(e) => setNewPhone(e.target.value)}
                                            placeholder="e.g., +60123456789"
                                            className="h-10 flex-1"
                                        />
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => {
                                                setEditingPhone(false)
                                                setNewPhone(userPhone)
                                            }}
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <Phone className="w-4 h-4 text-gray-400" />
                                        <span className="text-gray-900">{userPhone || 'Not set'}</span>
                                    </div>
                                )}
                            </div>

                            {/* Email (Read-only) */}
                            <div className="p-4 border-b border-gray-100">
                                <label className="text-sm font-medium text-gray-700 block mb-2">Email</label>
                                <div className="flex items-center gap-2">
                                    <Mail className="w-4 h-4 text-gray-400" />
                                    <span className="text-gray-900">{userEmail}</span>
                                </div>
                            </div>

                            {/* Address */}
                            <div className="p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-medium text-gray-700">Address</label>
                                    {!editingAddress && (
                                        <button
                                            onClick={() => {
                                                setEditingAddress(true)
                                                setNewAddress(userAddress)
                                            }}
                                            className="text-sm font-medium"
                                            style={{ color: config.primary_color }}
                                        >
                                            Edit
                                        </button>
                                    )}
                                </div>
                                {editingAddress ? (
                                    <div className="space-y-2">
                                        <textarea
                                            value={newAddress}
                                            onChange={(e) => {
                                                const value = e.target.value
                                                // Convert to title case as user types
                                                const titleCased = value.replace(/\b\w/g, (char) => char.toUpperCase())
                                                if (titleCased.length <= 255) {
                                                    setNewAddress(titleCased)
                                                }
                                            }}
                                            placeholder="Enter your delivery address"
                                            className="w-full h-20 p-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            maxLength={255}
                                        />
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-gray-500">{newAddress.length}/255</span>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => {
                                                    setEditingAddress(false)
                                                    setNewAddress(userAddress)
                                                }}
                                            >
                                                <X className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-start gap-2">
                                        <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                                        <span className="text-gray-900 text-sm">{userAddress || 'Not set'}</span>
                                    </div>
                                )}
                            </div>

                            {/* Save Button */}
                            {(editingName || editingPhone || editingAddress) && (newName !== userName || newPhone !== userPhone || newAddress !== userAddress) && (
                                <div className="p-4 border-t border-gray-100">
                                    <Button
                                        onClick={handleSaveProfile}
                                        disabled={savingProfile}
                                        className="w-full h-11 font-semibold"
                                        style={{ backgroundColor: config.button_color }}
                                    >
                                        {savingProfile ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                Saving...
                                            </>
                                        ) : (
                                            <>
                                                <Save className="w-4 h-4 mr-2" />
                                                Save Changes
                                            </>
                                        )}
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Bank Account Section (All Users) */}
                <div className="bg-transparent">
                    <button
                        onClick={() => setShowBankInfo(!showBankInfo)}
                        className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors bg-white rounded-xl mb-3"
                    >
                        <div className="flex items-center gap-3">
                            <CreditCard className="w-5 h-5 text-gray-600" />
                            <span className="font-medium text-gray-900">Bank Account</span>
                        </div>
                        <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${showBankInfo ? 'rotate-90' : ''}`} />
                    </button>

                    {showBankInfo && (
                        <div className="bg-gray-50 rounded-xl mb-3 overflow-hidden p-4 space-y-4">
                            <p className="text-sm text-gray-500 mb-2">Update your bank account details for payouts.</p>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name (Account Holder)</label>
                                <Input
                                    value={bankAccountHolderName}
                                    onChange={(e) => setBankAccountHolderName(e.target.value)}
                                    placeholder="e.g., ALI BIN ABU"
                                    className="bg-white"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
                                <select
                                    value={bankId}
                                    onChange={(e) => setBankId(e.target.value)}
                                    className="w-full h-10 px-3 rounded-md border border-input bg-white text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                >
                                    <option value="">Select Bank</option>
                                    {banks.map(bank => (
                                        <option key={bank.id} value={bank.id}>{bank.short_name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
                                <Input
                                    value={bankAccountNumber}
                                    onChange={(e) => setBankAccountNumber(e.target.value)}
                                    placeholder="e.g., 1234567890"
                                    className="bg-white"
                                />
                            </div>

                            {profileSaveError && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                                    <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                                    <p className="text-sm text-red-600">{profileSaveError}</p>
                                </div>
                            )}

                            {profileSaveSuccess && (
                                <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2">
                                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                                    <p className="text-sm text-green-600">Bank details saved successfully!</p>
                                </div>
                            )}

                            <Button
                                onClick={handleSaveProfile}
                                disabled={savingProfile}
                                className="w-full h-11 font-semibold mt-2"
                                style={{ backgroundColor: config.button_color }}
                            >
                                {savingProfile ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <Save className="w-4 h-4 mr-2" />
                                        Save Bank Details
                                    </>
                                )}
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )

    // Render content based on active tab
    const renderContent = () => {
        switch (activeTab) {
            case 'home':
                return renderHomeTab()
            case 'rewards':
                return renderRewardsTab()
            case 'lucky-draw':
                return renderLuckyDrawTab()
            case 'products':
                return renderProductsTab()
            case 'games':
                return renderGamesTab()
            case 'play-scratch-card':
                return renderScratchCardTab()
            case 'spin-wheel':
                return renderSpinWheelTab()
            case 'daily-quiz':
                return renderDailyQuizTab()
            case 'profile':
                return renderProfileTab()
            case 'account-settings':
                return renderAccountSettingsTab()
            default:
                return renderHomeTab()
        }
    }

    return (
        <div className="h-screen overflow-hidden bg-gray-50 flex flex-col">
            {/* Profile Header Buttons - Fixed position outside scroll container */}
            {activeTab === 'profile' && isAuthenticated && (
                <div
                    className="fixed top-3 right-3 flex items-center gap-1 z-[9998]"
                    style={{ pointerEvents: 'auto' }}
                >
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            console.log('Settings button clicked (fixed)')
                            setActiveTab('account-settings')
                        }}
                        className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors active:bg-white/40 cursor-pointer touch-manipulation select-none"
                        style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                        title="Account Settings"
                        aria-label="Account Settings"
                    >
                        <Settings className="w-4 h-4 text-white pointer-events-none" />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            console.log('Feedback button clicked (fixed)')
                            setShowFeedbackModal(true)
                            setFeedbackError('')
                            setFeedbackSuccess(false)
                        }}
                        className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors active:bg-white/40 cursor-pointer touch-manipulation select-none"
                        style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                        title="Send Feedback"
                        aria-label="Send Feedback"
                    >
                        <MessageSquare className="w-4 h-4 text-white pointer-events-none" />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            console.log('Logout button clicked (fixed)')
                            handleLogout()
                        }}
                        className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors active:bg-white/40 cursor-pointer touch-manipulation select-none"
                        style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                        title="Sign Out"
                        aria-label="Sign Out"
                    >
                        <LogOut className="w-4 h-4 text-white pointer-events-none" />
                    </button>
                </div>
            )}

            {/* Main Content */}
            {renderContent()}

            {/* Bottom Navigation */}
            <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-2 py-1 safe-area-bottom z-50">
                <div className="flex items-center justify-around max-w-md mx-auto">
                    {[
                        { id: 'home' as TabType, icon: Home, label: 'Home' },
                        { id: 'rewards' as TabType, icon: Gift, label: 'Rewards' },
                        { id: 'products' as TabType, icon: Package, label: 'Product' },
                        { id: 'profile' as TabType, icon: User, label: 'Profile' },
                    ].map((tab) => {
                        const Icon = tab.icon
                        const isActive = activeTab === tab.id

                        return (
                            <button
                                key={tab.id}
                                onClick={() => {
                                    setActiveTab(tab.id)
                                    if (tab.id === 'rewards') {
                                        setShowFreeGifts(false)
                                    }
                                }}
                                className={`flex flex-col items-center py-2 px-3 rounded-lg transition-colors ${isActive ? 'text-white' : 'text-gray-500'
                                    }`}
                                style={isActive ? { backgroundColor: config.primary_color } : {}}
                            >
                                <Icon className="w-5 h-5" />
                                <span className="text-[10px] mt-1 font-medium">{tab.label}</span>
                            </button>
                        )
                    })}
                </div>
            </nav>

            {/* Security Code Modal */}
            {qrCode && (
                <SecurityCodeModal
                    isOpen={showSecurityModal}
                    onClose={() => {
                        setShowSecurityModal(false)
                        setPendingAction(null)
                    }}
                    onSuccess={handleSecuritySuccess}
                    publicToken={extractTokenFromQRCode(qrCode)}
                />
            )}

            {/* Error Modal for authenticated users - shows QR code errors without login form */}
            {pointsError && isAuthenticated && !showPointsLoginModal && !showPointsSuccessModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
                        <div className="text-center">
                            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center bg-red-100">
                                <XCircle className="w-8 h-8 text-red-500" />
                            </div>
                            <h3 className="text-xl font-bold text-gray-900">Unable to Collect Points</h3>
                            <p className="text-sm text-gray-500 mt-1">There was a problem processing your request</p>
                        </div>

                        <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                            <p className="text-sm text-red-600 text-center">{pointsError}</p>
                        </div>

                        <button
                            onClick={() => setPointsError('')}
                            className="w-full py-3 px-4 rounded-xl font-medium text-white transition-colors"
                            style={{ backgroundColor: config.primary_color }}
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}

            {/* Collect Points Login Modal */}
            {showPointsLoginModal && !showPointsSuccessModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
                        <div className="text-center">
                            <div
                                className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
                                style={{ backgroundColor: `${config.primary_color}15` }}
                            >
                                <Gift className="w-8 h-8" style={{ color: config.primary_color }} />
                            </div>
                            <h3 className="text-xl font-bold text-gray-900">Collect Points</h3>
                            <p className="text-sm text-gray-500 mt-1">Enter your credentials to collect points</p>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Email or Phone</label>
                                <input
                                    type="text"
                                    value={shopId}
                                    onChange={(e) => setShopId(e.target.value)}
                                    placeholder="Enter your email or phone"
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2"
                                    style={{ '--tw-ring-color': config.primary_color } as any}
                                    disabled={collectingPoints}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                                <div className="relative">
                                    <input
                                        type={showShopPassword ? 'text' : 'password'}
                                        value={shopPassword}
                                        onChange={(e) => setShopPassword(e.target.value)}
                                        placeholder="Enter your password"
                                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 pr-10"
                                        style={{ '--tw-ring-color': config.primary_color } as any}
                                        disabled={collectingPoints}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowShopPassword(!showShopPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2"
                                    >
                                        {showShopPassword ? (
                                            <EyeOff className="w-5 h-5 text-gray-400" />
                                        ) : (
                                            <Eye className="w-5 h-5 text-gray-400" />
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {pointsError && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                                <p className="text-sm text-red-600 text-center">{pointsError}</p>
                            </div>
                        )}

                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => {
                                    setShowPointsLoginModal(false)
                                    setPointsError('')
                                    setShopId('')
                                    setShopPassword('')
                                    setCollectingPoints(false)
                                }}
                                className="flex-1 py-3 px-4 border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                            // Allow cancelling even during collection
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCollectPoints}
                                disabled={collectingPoints || !shopId.trim() || !shopPassword.trim()}
                                className="flex-1 py-3 px-4 rounded-xl font-medium text-white transition-colors disabled:opacity-50"
                                style={{ backgroundColor: config.button_color }}
                            >
                                {collectingPoints ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Collecting...
                                    </span>
                                ) : (
                                    'Collect Points'
                                )}
                            </button>
                        </div>

                        <div className="text-center mt-2">
                            <button
                                onClick={() => {
                                    setShowPointsLoginModal(false)
                                    setActiveTab('profile')
                                    setShowLoginForm(true)
                                    setIsSignUp(true)
                                }}
                                className="text-sm font-medium hover:underline"
                                style={{ color: config.primary_color }}
                            >
                                Do not have account? Register here
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Collect Points Success Animation */}
            <PointEarnedAnimation
                isOpen={showPointsSuccessModal}
                pointsEarned={pointsEarned}
                totalBalance={totalBalance}
                previousBalance={previousBalance}
                primaryColor={config.button_color}
                autoCloseDelay={3500}
                onClose={() => {
                    setShowPointsSuccessModal(false)
                    setShowPointsLoginModal(false)
                    setPointsEarned(0)
                    setShopId('')
                    setShopPassword('')
                }}
            />

            {/* Lucky Draw Success Animation */}
            <LuckyDrawSuccessAnimation
                isOpen={showLuckyDrawSuccess}
                customerName={customerName}
                customerPhone={customerPhone}
                autoCloseDelay={3500}
                onClose={handleLuckyDrawSuccessClose}
            />

            {/* Genuine Product Verified Animation */}
            <GenuineProductAnimation
                isVisible={showGenuineVerified}
                productInfo={productInfo}
                onClose={() => {
                    setShowGenuineVerified(false)
                    setShowPointsAnimation(true)
                }}
            />

            {/* Redeem Confirmation Modal */}
            {showRedeemConfirm && selectedReward && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
                        <div className="text-center">
                            {/* Animated Gift Icon */}
                            <div className="relative w-20 h-20 mx-auto mb-4">
                                <div className="absolute inset-0 animate-ping rounded-full opacity-20" style={{ backgroundColor: config.primary_color }} />
                                <div
                                    className="relative w-20 h-20 rounded-full flex items-center justify-center animate-bounce"
                                    style={{ backgroundColor: `${config.primary_color}15` }}
                                >
                                    <Gift className="w-10 h-10 animate-pulse" style={{ color: config.primary_color }} />
                                </div>
                            </div>
                            <h3 className="text-xl font-bold text-gray-900">Confirm Redemption</h3>
                            <p className="text-sm text-gray-500 mt-2">Are you sure you want to redeem this reward?</p>
                        </div>

                        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                            {/* Reward Image & Name */}
                            <div className="flex items-center gap-3">
                                {selectedReward.item_image_url ? (
                                    <img
                                        src={getStorageUrl(selectedReward.item_image_url) || selectedReward.item_image_url}
                                        alt={selectedReward.item_name}
                                        className="w-16 h-16 object-cover rounded-lg"
                                    />
                                ) : (
                                    <div className="w-16 h-16 bg-gray-200 rounded-lg flex items-center justify-center">
                                        <Gift className="w-8 h-8 text-gray-400" />
                                    </div>
                                )}
                                <div className="flex-1">
                                    <p className="font-semibold text-gray-900">{selectedReward.item_name}</p>
                                    {selectedReward.item_description && (
                                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{selectedReward.item_description}</p>
                                    )}
                                </div>
                            </div>

                            {/* Points Info */}
                            <div className="pt-3 border-t border-gray-200">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-600">Points Required:</span>
                                    <span className="font-bold text-red-600">
                                        -{selectedReward.point_offer || selectedReward.points_required}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-sm mt-1">
                                    <span className="text-gray-600">New Balance:</span>
                                    <span className="font-bold text-green-600">
                                        {userPoints - (selectedReward.point_offer || selectedReward.points_required)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Cashback Bank Info Warning */}
                        {selectedReward.item_code.toLowerCase().includes('cashback') && (!bankId || !bankAccountNumber || !bankAccountHolderName) && (
                            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-amber-900">Bank Details Required</p>
                                        <p className="text-xs text-amber-700 leading-relaxed">
                                            To ensure smooth processing of your cashback claim, please update your bank account information. Missing details may cause delays.
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full bg-white border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                                    onClick={() => {
                                        setShowRedeemConfirm(false)
                                        setActiveTab('account-settings')
                                    }}
                                >
                                    Update Bank Details
                                </Button>
                            </div>
                        )}

                        {/* Address Required for Physical Rewards (non-Cashback) */}
                        {!selectedReward.item_code.toLowerCase().includes('cashback') && !userAddress && (
                            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
                                <div className="flex items-start gap-3">
                                    <MapPin className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-blue-900">Delivery Address Required</p>
                                        <p className="text-xs text-blue-700 leading-relaxed">
                                            Please update your delivery address to ensure we can ship your reward. Missing address may cause delays in delivery.
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full bg-white border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                                    onClick={() => {
                                        setShowRedeemConfirm(false)
                                        setActiveTab('account-settings')
                                        setShowProfileInfo(true)
                                    }}
                                >
                                    Update Address
                                </Button>
                            </div>
                        )}

                        {redeemError && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                                <p className="text-sm text-red-600 text-center">{redeemError}</p>
                            </div>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setShowRedeemConfirm(false)
                                    setSelectedReward(null)
                                    setRedeemError('')
                                }}
                                disabled={redeeming}
                                className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmRedemption}
                                disabled={redeeming}
                                className="flex-1 px-4 py-3 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                style={{ backgroundColor: config.button_color }}
                            >
                                {redeeming ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    'Confirm'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Insufficient Points Animation Modal */}
            <InsufficientPointsAnimation
                isOpen={showInsufficientPoints && insufficientPointsData !== null}
                pointsNeeded={insufficientPointsData?.needed || 0}
                pointsAvailable={insufficientPointsData?.available || 0}
                onClose={() => setShowInsufficientPoints(false)}
                primaryColor={config.button_color}
            />

            {/* Reward Redemption Success Animation */}
            {redemptionDetails && (
                <RewardRedemptionAnimation
                    isOpen={showRedeemSuccess}
                    rewardName={redemptionDetails.rewardName}
                    pointsDeducted={redemptionDetails.pointsDeducted}
                    newBalance={redemptionDetails.newBalance}
                    redemptionCode={redemptionDetails.redemptionCode}
                    onClose={handleRedeemSuccessClose}
                    isCashback={selectedReward?.item_code?.toLowerCase().includes('cashback') || false}
                    deliveryAddress={userAddress || undefined}
                    bankName={banks.find(b => b.id === bankId)?.short_name}
                    bankAccount={bankAccountNumber || undefined}
                    bankHolder={bankAccountHolderName || undefined}
                />
            )}

            {/* Free Gift Confirmation Modal */}
            {showGiftConfirm && selectedGift && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
                        <div className="text-center">
                            <div className="relative w-20 h-20 mx-auto mb-4">
                                <div className="absolute inset-0 animate-ping rounded-full bg-green-200 opacity-30" />
                                <div className="relative w-20 h-20 rounded-full flex items-center justify-center bg-green-100 animate-bounce">
                                    <Gift className="w-10 h-10 text-green-500 animate-pulse" />
                                </div>
                            </div>
                            <h3 className="text-xl font-bold text-gray-900">Claim Free Gift</h3>
                            <p className="text-sm text-gray-500 mt-2">Are you sure you want to claim this gift?</p>
                        </div>

                        <div className="bg-gray-50 rounded-xl p-4">
                            <div className="flex items-center gap-3">
                                {selectedGift.gift_image_url ? (
                                    <img
                                        src={getStorageUrl(selectedGift.gift_image_url) || selectedGift.gift_image_url}
                                        alt={selectedGift.gift_name}
                                        className="w-16 h-16 object-contain rounded-lg bg-white p-1"
                                    />
                                ) : (
                                    <div className="w-16 h-16 bg-green-100 rounded-lg flex items-center justify-center">
                                        <Gift className="w-8 h-8 text-green-400" />
                                    </div>
                                )}
                                <div className="flex-1">
                                    <p className="font-semibold text-gray-900">{selectedGift.gift_name}</p>
                                    {selectedGift.gift_description && (
                                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{selectedGift.gift_description}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                            <p className="text-xs text-amber-700 text-center">
                                ⚠️ This QR code can only be used once to claim a free gift.
                            </p>
                        </div>

                        {giftError && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                                <p className="text-sm text-red-600 text-center">{giftError}</p>
                            </div>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setShowGiftConfirm(false)
                                    setSelectedGift(null)
                                    setGiftError('')
                                }}
                                disabled={claimingGift}
                                className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleClaimGift}
                                disabled={claimingGift}
                                className="flex-1 px-4 py-3 text-white font-semibold rounded-xl bg-green-500 hover:bg-green-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {claimingGift ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Claiming...
                                    </>
                                ) : (
                                    'Claim Gift'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Free Gift Success Modal */}
            <GiftClaimedAnimation
                isVisible={showGiftSuccess}
                giftName={claimedGiftName}
                onClose={() => {
                    setShowGiftSuccess(false)
                    setSelectedGift(null)
                }}
            />

            {/* Support Chat Modal */}
            {showFeedbackModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 sm:p-4">
                    <div className="bg-white w-full h-full sm:h-[600px] sm:max-w-md sm:rounded-2xl shadow-xl overflow-hidden flex flex-col">
                        <SupportChatWidget onClose={() => setShowFeedbackModal(false)} />
                    </div>
                </div>
            )}
            {/* Reward Detail Modal */}
            <Dialog open={showRewardDetailModal} onOpenChange={setShowRewardDetailModal}>
                <DialogContent className="max-w-[90vw] w-full rounded-2xl p-0 overflow-hidden bg-white">
                    <DialogTitle className="sr-only">
                        {selectedRewardForDetail?.item_name || 'Reward Details'}
                    </DialogTitle>
                    {(() => {
                        const images = (selectedRewardForDetail?.additional_images && selectedRewardForDetail.additional_images.length > 0)
                            ? selectedRewardForDetail.additional_images
                            : [selectedRewardForDetail?.item_image_url].filter(Boolean) as string[]

                        return (
                            <div className="relative h-64 w-full bg-white overflow-hidden">
                                <button
                                    onClick={() => setShowRewardDetailModal(false)}
                                    className="absolute top-4 right-4 z-20 p-2 bg-black/10 hover:bg-black/20 rounded-full transition-colors"
                                >
                                    <X className="w-5 h-5 text-gray-600" />
                                </button>

                                {images.length > 0 ? (
                                    <motion.div
                                        className="flex h-full"
                                        style={{ width: `${images.length * 100}%` }}
                                        animate={{ x: `-${currentRewardImageIndex * (100 / images.length)}%` }}
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                        drag={images.length > 1 ? "x" : false}
                                        dragElastic={0.2}
                                        onDragEnd={(e, { offset, velocity }) => {
                                            const swipe = offset.x
                                            const swipeThreshold = 50

                                            if (swipe < -swipeThreshold && currentRewardImageIndex < images.length - 1) {
                                                setCurrentRewardImageIndex(currentRewardImageIndex + 1)
                                            } else if (swipe > swipeThreshold && currentRewardImageIndex > 0) {
                                                setCurrentRewardImageIndex(currentRewardImageIndex - 1)
                                            }
                                        }}
                                    >
                                        {images.map((img, idx) => (
                                            <div
                                                key={idx}
                                                className="relative h-full"
                                                style={{ width: `${100 / images.length}%` }}
                                            >
                                                <Image
                                                    src={getStorageUrl(img) || img}
                                                    alt={selectedRewardForDetail?.item_name || 'Reward'}
                                                    fill
                                                    className="object-contain p-4"
                                                    priority={idx === currentRewardImageIndex}
                                                    draggable={false}
                                                />
                                            </div>
                                        ))}
                                    </motion.div>
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Gift className="w-20 h-20 text-gray-300" />
                                    </div>
                                )}
                            </div>
                        )
                    })()}

                    <div className="p-6 space-y-4">
                        <div>
                            <h3 className="text-xl font-bold text-gray-900">{selectedRewardForDetail?.item_name}</h3>
                            <p className="text-sm text-gray-500 mt-1">{selectedRewardForDetail?.item_description || 'No description available'}</p>
                        </div>

                        <div className="flex items-center justify-between py-4 border-t border-b border-gray-100">
                            <div className="space-y-1">
                                <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Points Required</p>
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 bg-amber-100 rounded-full">
                                        <Star className="w-4 h-4 text-amber-600 fill-amber-600" />
                                    </div>
                                    <span className="text-2xl font-bold text-gray-900">
                                        {formatNumber(selectedRewardForDetail?.point_offer || selectedRewardForDetail?.points_required)}
                                    </span>
                                </div>
                            </div>
                            <div className="space-y-1 text-right">
                                <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Stock</p>
                                <p className="text-lg font-semibold text-gray-900">
                                    {selectedRewardForDetail?.stock_quantity === null ? 'Unlimited' : selectedRewardForDetail?.stock_quantity}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-3 pt-2">
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                                <span>Staff verification not required</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                                <span>No per-consumer limit set</span>
                            </div>
                        </div>

                        <div className="pt-4 flex gap-3">
                            <Button
                                variant="outline"
                                className="flex-1 h-12 rounded-xl border-gray-200"
                                onClick={() => setShowRewardDetailModal(false)}
                            >
                                Close
                            </Button>
                            {selectedRewardForDetail && (
                                userPoints < (selectedRewardForDetail.point_offer || selectedRewardForDetail.points_required) ? (
                                    <Button
                                        className="flex-1 h-12 rounded-xl bg-blue-100 text-blue-600 hover:bg-blue-200 border-none shadow-none"
                                        onClick={() => {
                                            setShowRewardDetailModal(false)
                                            setInsufficientPointsData({
                                                needed: selectedRewardForDetail.point_offer || selectedRewardForDetail.points_required,
                                                available: userPoints
                                            })
                                            setShowInsufficientPoints(true)
                                        }}
                                    >
                                        <Coins className="w-4 h-4 mr-2" />
                                        Need more points
                                    </Button>
                                ) : (
                                    <Button
                                        className="flex-1 h-12 rounded-xl text-white shadow-lg shadow-blue-500/20"
                                        style={{ backgroundColor: config.button_color }}
                                        onClick={() => {
                                            setShowRewardDetailModal(false)
                                            handleRedeemReward(selectedRewardForDetail)
                                        }}
                                        disabled={!isAuthenticated}
                                    >
                                        Redeem Now
                                    </Button>
                                )
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// Utility function to adjust color brightness
function adjustColor(color: string, amount: number): string {
    const hex = color.replace('#', '')
    const num = parseInt(hex, 16)
    const r = Math.max(0, Math.min(255, (num >> 16) + amount))
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amount))
    const b = Math.max(0, Math.min(255, (num & 0x0000ff) + amount))
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
