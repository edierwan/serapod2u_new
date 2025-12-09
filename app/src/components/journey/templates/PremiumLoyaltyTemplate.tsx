'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { 
    Home, 
    Gift, 
    Star, 
    Gamepad2, 
    User,
    ChevronRight,
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
    Send
} from 'lucide-react'
import { SecurityCodeModal } from '../SecurityCodeModal'
import { extractTokenFromQRCode } from '@/utils/qrSecurity'
import { PointEarnedAnimation } from '@/components/animations/PointEarnedAnimation'
import { LuckyDrawSuccessAnimation } from '@/components/animations/LuckyDrawSuccessAnimation'
import { GenuineProductAnimation } from '@/components/animations/GenuineProductAnimation'
import { RewardRedemptionAnimation } from '@/components/animations/RewardRedemptionAnimation'
import { validatePhoneNumber, normalizePhone } from '@/lib/utils'

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
}

interface RewardItem {
    id: string
    item_name: string
    item_description: string | null
    points_required: number
    item_image_url: string | null
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
    primary_image_url?: string | null
    variants?: {
        id: string
        variant_name: string
        suggested_retail_price: number | null
        image_url?: string | null
    }[]
}

type TabType = 'home' | 'rewards' | 'products' | 'games' | 'profile' | 'account-settings' | 'lucky-draw'

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
    const [activeTab, setActiveTab] = useState<TabType>('home')
    const [userPoints, setUserPoints] = useState(0)
    const [userName, setUserName] = useState('')
    const [userEmail, setUserEmail] = useState('')
    const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null)
    const [shopName, setShopName] = useState('')
    const [rewards, setRewards] = useState<RewardItem[]>([])
    const [products, setProducts] = useState<ProductItem[]>([])
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
    
    // Points collection modal states
    const [showPointsLoginModal, setShowPointsLoginModal] = useState(false)
    const [shopId, setShopId] = useState('')
    const [shopPassword, setShopPassword] = useState('')
    const [showShopPassword, setShowShopPassword] = useState(false)
    const [collectingPoints, setCollectingPoints] = useState(false)
    const [pointsError, setPointsError] = useState('')
    const [showPointsSuccessModal, setShowPointsSuccessModal] = useState(false)
    
    // Auth states (for profile login)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [isShopUser, setIsShopUser] = useState(false)
    const [authLoading, setAuthLoading] = useState(true)
    const [showLoginForm, setShowLoginForm] = useState(false)
    const [loginEmail, setLoginEmail] = useState('')
    const [loginPassword, setLoginPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loginLoading, setLoginLoading] = useState(false)
    const [loginError, setLoginError] = useState('')
    const [isSignUp, setIsSignUp] = useState(false)
    
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
    const [phoneError, setPhoneError] = useState('')
    const [emailError, setEmailError] = useState('')

    // Account settings states
    const [userPhone, setUserPhone] = useState('')
    const [userId, setUserId] = useState<string | null>(null)
    const [editingName, setEditingName] = useState(false)
    const [editingPhone, setEditingPhone] = useState(false)
    const [newName, setNewName] = useState('')
    const [newPhone, setNewPhone] = useState('')
    const [savingProfile, setSavingProfile] = useState(false)
    const [profileSaveError, setProfileSaveError] = useState('')
    const [profileSaveSuccess, setProfileSaveSuccess] = useState(false)
    // Password change states
    const [showChangePassword, setShowChangePassword] = useState(false)
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [showCurrentPassword, setShowCurrentPassword] = useState(false)
    const [showNewPassword, setShowNewPassword] = useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = useState(false)
    const [changingPassword, setChangingPassword] = useState(false)
    const [passwordError, setPasswordError] = useState('')
    const [passwordSuccess, setPasswordSuccess] = useState(false)
    const [showProfileInfo, setShowProfileInfo] = useState(false)
    
    // Genuine product verified animation state
    const [showGenuineVerified, setShowGenuineVerified] = useState(false)
    
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

    // Feedback states
    const [showFeedbackModal, setShowFeedbackModal] = useState(false)
    const [feedbackTitle, setFeedbackTitle] = useState('')
    const [feedbackMessage, setFeedbackMessage] = useState('')
    const [submittingFeedback, setSubmittingFeedback] = useState(false)
    const [feedbackError, setFeedbackError] = useState('')
    const [feedbackSuccess, setFeedbackSuccess] = useState(false)

    // Helper function to check if user is from SHOP organization (uses API to bypass RLS)
    const checkUserOrganization = async (userId: string) => {
        try {
            // Use API endpoint to fetch profile (bypasses RLS issues)
            const response = await fetch('/api/user/profile')
            const result = await response.json()
            
            if (!result.success || !result.profile) {
                console.error('Error fetching user profile via API:', result.error)
                return { isShop: false, fullName: '', organizationId: null, avatarUrl: null, orgName: '', phone: '', pointsBalance: 0 }
            }
            
            const profile = result.profile
            console.log('User profile fetched via API:', { 
                fullName: profile.fullName, 
                avatarUrl: profile.avatarUrl,
                phone: profile.phone,
                organizationId: profile.organizationId,
                isShop: profile.isShop,
                orgName: profile.orgName,
                pointsBalance: profile.pointsBalance
            })
            
            return { 
                isShop: profile.isShop, 
                fullName: profile.fullName || '',
                organizationId: profile.organizationId,
                avatarUrl: profile.avatarUrl,
                orgName: profile.orgName || '',
                phone: profile.phone || '',
                pointsBalance: profile.pointsBalance || 0
            }
        } catch (error) {
            console.error('Error checking user organization:', error)
            return { isShop: false, fullName: '', organizationId: null, avatarUrl: null, orgName: '', phone: '', pointsBalance: 0 }
        }
    }

    // Check auth status on mount
    useEffect(() => {
        const checkAuth = async () => {
            try {
                console.log('Checking auth status...')
                const { data: { user } } = await supabase.auth.getUser()
                console.log('Auth user:', user?.id, user?.email)
                
                if (user) {
                    setIsAuthenticated(true)
                    setUserEmail(user.email || '')
                    setUserId(user.id)
                    
                    // Check if user is from SHOP organization
                    const { isShop, fullName, organizationId, avatarUrl, orgName, phone, pointsBalance } = await checkUserOrganization(user.id)
                    console.log('Profile data:', { isShop, fullName, avatarUrl, orgName, phone, pointsBalance })
                    
                    setIsShopUser(isShop)
                    setUserName(fullName || user.user_metadata?.full_name || user.email?.split('@')[0] || '')
                    setUserAvatarUrl(avatarUrl)
                    setShopName(orgName)
                    setUserPhone(phone)
                    setNewName(fullName || user.user_metadata?.full_name || user.email?.split('@')[0] || '')
                    setNewPhone(phone)
                    
                    // Set points balance from API (already fetched for shop users)
                    if (isShop) {
                        setUserPoints(pointsBalance)
                    }
                } else {
                    console.log('No authenticated user found')
                }
            } catch (error) {
                console.error('Auth check error:', error)
            } finally {
                setAuthLoading(false)
            }
        }
        checkAuth()
        
        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (session?.user) {
                setIsAuthenticated(true)
                setUserEmail(session.user.email || '')
                setUserId(session.user.id)
                
                // Check if user is from SHOP organization
                const { isShop, fullName, organizationId, avatarUrl, orgName, phone, pointsBalance } = await checkUserOrganization(session.user.id)
                setIsShopUser(isShop)
                setUserName(fullName || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '')
                setUserAvatarUrl(avatarUrl)
                setShopName(orgName)
                setUserPhone(phone)
                setNewName(fullName || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '')
                setNewPhone(phone)
                
                // Set points balance from API (already fetched for shop users)
                if (isShop) {
                    setUserPoints(pointsBalance)
                }
            } else {
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
        
        return () => subscription.unsubscribe()
    }, [supabase])

    // Show genuine product verified animation on page load
    useEffect(() => {
        if (isLive && productInfo?.product_name) {
            // Show animation after a brief delay
            const timer = setTimeout(() => {
                setShowGenuineVerified(true)
                // Auto-hide after 4 seconds
                setTimeout(() => setShowGenuineVerified(false), 4000)
            }, 500)
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

    // Fetch products from API when products tab is active
    useEffect(() => {
        if (activeTab === 'products' && isLive && orgId) {
            fetchProducts()
        }
    }, [activeTab, isLive, orgId])

    // Check QR status on mount - this prevents button clicks if already used
    useEffect(() => {
        const checkQrStatus = async () => {
            if (!qrCode) return
            
            setCheckingQrStatus(true)
            try {
                const response = await fetch(`/api/consumer/check-lucky-draw-status?qr_code=${encodeURIComponent(qrCode)}`)
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
                }
            } catch (error) {
                console.error('Error checking QR status:', error)
            } finally {
                setCheckingQrStatus(false)
            }
        }

        // Check on mount - always check QR status for returning visitors
        if (isLive && qrCode) {
            checkQrStatus()
        }
    }, [isLive, qrCode]) // Only run on mount and when qrCode changes

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

    // Handle login
    const handleLogin = async () => {
        if (!loginEmail || !loginPassword) {
            setLoginError('Please fill in all fields')
            return
        }
        
        setLoginLoading(true)
        setLoginError('')
        
        try {
            let emailToUse = loginEmail
            
            // Check if input looks like a phone number (doesn't contain @)
            if (!loginEmail.includes('@')) {
                // Normalize and lookup email by phone
                const normalizedPhone = normalizePhone(loginEmail)
                
                const { data: userEmail, error: lookupError } = await supabase
                    .rpc('get_email_by_phone', { p_phone: normalizedPhone })
                
                if (lookupError) {
                    console.error('Phone lookup error:', lookupError)
                    setLoginError('Error verifying phone number. Please try again.')
                    setLoginLoading(false)
                    return
                }
                
                if (!userEmail) {
                    setLoginError('Phone number not found. Please check your number or use email to login.')
                    setLoginLoading(false)
                    return
                }
                
                emailToUse = userEmail
            }
            
            if (isSignUp) {
                const { error } = await supabase.auth.signUp({
                    email: emailToUse,
                    password: loginPassword,
                })
                if (error) throw error
                setLoginError('')
                setShowLoginForm(false)
            } else {
                const { error } = await supabase.auth.signInWithPassword({
                    email: emailToUse,
                    password: loginPassword,
                })
                if (error) throw error
                setShowLoginForm(false)
            }
        } catch (error: any) {
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
        console.log('Logging out...')
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
        // Navigate to profile tab after logout
        setActiveTab('profile')
        console.log('Logged out successfully')
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
            
            setProfileSaveSuccess(true)
            setEditingName(false)
            setEditingPhone(false)
            
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
            // First verify current password by attempting re-auth
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: userEmail,
                password: currentPassword
            })
            
            if (signInError) {
                throw new Error('Current password is incorrect')
            }
            
            // Update password
            const { error: updateError } = await supabase.auth.updateUser({
                password: newPassword
            })
            
            if (updateError) {
                throw new Error(updateError.message)
            }
            
            setPasswordSuccess(true)
            setCurrentPassword('')
            setNewPassword('')
            setConfirmPassword('')
            setShowChangePassword(false)
            
            // Clear success message after 3 seconds
            setTimeout(() => setPasswordSuccess(false), 3000)
            
        } catch (error: any) {
            console.error('Error changing password:', error)
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

    const executeAction = (action: string) => {
        switch (action) {
            case 'collect-points':
                // If user is already authenticated, try to collect points with session
                // The API will validate if they're a shop user and return requiresLogin if not
                if (isAuthenticated) {
                    console.log('🔐 User authenticated, attempting session-based points collection', { isShopUser })
                    handleCollectPointsWithSession()
                } else {
                    // Not authenticated - show shop login modal for points collection
                    console.log('🔐 User not authenticated, showing shop login modal')
                    setPointsError('')
                    setShowPointsLoginModal(true)
                }
                break
            case 'lucky-draw':
                setActiveTab('lucky-draw')
                break
            case 'games':
            case 'scratch-card':
                setActiveTab('games')
                break
            case 'redeem':
            case 'redemption':
                // Handle redemption
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
            const response = await fetch('/api/consumer/collect-points', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    qr_code: qrCode,
                    shop_id: shopId,
                    password: shopPassword
                })
            })

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
            const response = await fetch('/api/consumer/collect-points-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    qr_code: qrCode
                })
            })

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
            setPhoneError('Please enter a valid Malaysia phone number (e.g., 0123456789)')
        } else {
            setPhoneError('')
        }
    }

    // Handle email input change with validation
    const handleEmailChange = (value: string) => {
        setCustomerEmail(value)
        if (value && !validateEmail(value)) {
            setEmailError('Please enter a valid email address')
        } else {
            setEmailError('')
        }
    }

    // Submit lucky draw entry
    const handleLuckyDrawSubmit = async () => {
        // Validate inputs
        if (!customerName || !customerPhone) {
            setLuckyDrawError('Please fill in all required fields')
            return
        }
        
        if (!validateMalaysiaPhone(customerPhone)) {
            setPhoneError('Please enter a valid Malaysia phone number')
            return
        }
        
        if (customerEmail && !validateEmail(customerEmail)) {
            setEmailError('Please enter a valid email address')
            return
        }
        
        setIsSubmitting(true)
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
                setShowLuckyDrawSuccess(true)
            } else if (data.already_entered) {
                // Already entered - still show success
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
        if (!isShopUser) {
            alert('Only shop accounts can redeem rewards')
            return
        }

        // Check if user has enough points
        if (userPoints < reward.points_required) {
            alert(`You need ${reward.points_required} points but have ${userPoints}. Collect more points to redeem this reward!`)
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

                // Update local points balance
                setUserPoints(data.new_balance)

                // Close confirmation and show success animation
                setShowRedeemConfirm(false)
                setShowRedeemSuccess(true)

                // Refresh rewards list to update stock
                fetchRewards()
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
                        <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center overflow-hidden">
                            {userAvatarUrl ? (
                                <Image 
                                    src={userAvatarUrl} 
                                    alt="Profile" 
                                    width={48} 
                                    height={48} 
                                    className="object-cover w-full h-full"
                                />
                            ) : (
                                <User className="w-6 h-6" />
                            )}
                        </div>
                    </div>
                    
                    {/* Points Card */}
                    <div className="bg-white/15 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-white/70 text-xs uppercase tracking-wider">Your Points</p>
                                <div className="flex items-baseline gap-2 mt-1">
                                    <span className="text-3xl font-bold">{userPoints}</span>
                                    <Star className="w-5 h-5 text-yellow-300 fill-yellow-300" />
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
                                    className="h-full bg-yellow-400 rounded-full transition-all duration-500"
                                    style={{ width: `${Math.min((userPoints / 500) * 100, 100)}%` }}
                                />
                            </div>
                            <div className="flex justify-between mt-2 text-xs text-white/60">
                                <span>0</span>
                                <span>100</span>
                                <span>250</span>
                                <span>500</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="px-5 -mt-6 relative z-20">
                <div className="bg-white rounded-2xl shadow-lg p-4 grid grid-cols-3 gap-3">
                    {config.points_enabled && (
                        <button 
                            onClick={() => handleProtectedAction('collect-points')}
                            disabled={collectingPoints || pointsCollected || qrPointsCollected || checkingQrStatus}
                            className={`flex flex-col items-center p-3 rounded-xl transition-colors ${
                                (pointsCollected || qrPointsCollected) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
                            }`}
                        >
                            <div 
                                className="w-12 h-12 rounded-full flex items-center justify-center mb-2"
                                style={{ backgroundColor: (pointsCollected || qrPointsCollected) ? '#dcfce7' : `${config.primary_color}15` }}
                            >
                                {collectingPoints || checkingQrStatus ? (
                                    <Loader2 className="w-6 h-6 animate-spin" style={{ color: config.primary_color }} />
                                ) : (pointsCollected || qrPointsCollected) ? (
                                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                                ) : (
                                    <Coins className="w-6 h-6" style={{ color: config.primary_color }} />
                                )}
                            </div>
                            <span className="text-xs font-medium text-gray-700">
                                {collectingPoints ? 'Collecting...' : checkingQrStatus ? 'Checking...' : (pointsCollected || qrPointsCollected) ? 'Collected' : 'Collect'}
                            </span>
                        </button>
                    )}
                    
                    {config.lucky_draw_enabled && (
                        <button 
                            onClick={() => handleProtectedAction('lucky-draw')}
                            disabled={checkingQrStatus || luckyDrawQrUsed || luckyDrawEntered}
                            className={`flex flex-col items-center p-3 rounded-xl transition-colors ${
                                (luckyDrawQrUsed || luckyDrawEntered) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
                            }`}
                        >
                            <div 
                                className="w-12 h-12 rounded-full flex items-center justify-center mb-2"
                                style={{ backgroundColor: (luckyDrawQrUsed || luckyDrawEntered) ? '#dcfce7' : '#fef3c7' }}
                            >
                                {checkingQrStatus ? (
                                    <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                                ) : (luckyDrawQrUsed || luckyDrawEntered) ? (
                                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                                ) : (
                                    <Trophy className="w-6 h-6 text-amber-500" />
                                )}
                            </div>
                            <span className="text-xs font-medium text-gray-700">
                                {checkingQrStatus ? 'Checking...' : (luckyDrawQrUsed || luckyDrawEntered) ? 'Already In' : 'Lucky Draw'}
                            </span>
                        </button>
                    )}
                    
                    {config.redemption_enabled && (
                        <button 
                            onClick={() => setActiveTab('rewards')}
                            className="flex flex-col items-center p-3 rounded-xl hover:bg-gray-50 transition-colors"
                        >
                            <div 
                                className="w-12 h-12 rounded-full flex items-center justify-center mb-2"
                                style={{ backgroundColor: '#dcfce7' }}
                            >
                                <Gift className="w-6 h-6 text-green-500" />
                            </div>
                            <span className="text-xs font-medium text-gray-700">Redeem</span>
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
                                            src={reward.item_image_url} 
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
                                        <span className="text-xs text-gray-600">{reward.points_required} pts</span>
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
            <div className="px-5 mt-6">
                <div 
                    className="rounded-2xl p-5 text-white relative overflow-hidden"
                    style={{ 
                        background: `linear-gradient(135deg, ${config.button_color} 0%, ${adjustColor(config.button_color, -20)} 100%)`
                    }}
                >
                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-white/10 transform translate-x-8 -translate-y-8" />
                    <Sparkles className="w-8 h-8 mb-2 text-yellow-300" />
                    <h3 className="text-lg font-bold mb-1">Double Points Week!</h3>
                    <p className="text-sm text-white/80">Earn 2x points on all scans this week</p>
                    <button className="mt-3 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                        Learn More
                    </button>
                </div>
            </div>

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
                    
                    {!pointsCollected && !luckyDrawEntered && (
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
    const renderRewardsTab = () => (
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

            {/* Category Tabs */}
            <div className="px-5 -mt-4">
                <div className="bg-white rounded-xl shadow-sm p-1 flex gap-1">
                    {['All', 'Vouchers', 'Products', 'Experiences'].map((cat) => (
                        <button 
                            key={cat}
                            className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                                cat === 'All' 
                                    ? 'text-white' 
                                    : 'text-gray-600 hover:bg-gray-50'
                            }`}
                            style={cat === 'All' ? { backgroundColor: config.primary_color } : {}}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>

            {/* Rewards Grid */}
            <div className="px-5 mt-4 grid grid-cols-2 gap-3">
                {loadingRewards ? (
                    <div className="col-span-2 text-center py-12">
                        <div className="w-8 h-8 border-2 border-gray-300 border-t-primary rounded-full animate-spin mx-auto" />
                    </div>
                ) : rewards.length > 0 ? (
                    rewards.map((reward) => (
                        <div key={reward.id} className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
                            <div className="h-28 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center relative">
                                {reward.item_image_url ? (
                                    <Image 
                                        src={reward.item_image_url} 
                                        alt={reward.item_name}
                                        fill
                                        className="object-cover"
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
                                        <span className="text-sm font-bold" style={{ color: config.primary_color }}>
                                            {reward.points_required}
                                        </span>
                                    </div>
                                    <button 
                                        onClick={() => handleRedeemReward(reward)}
                                        disabled={!isAuthenticated || !isShopUser || userPoints < reward.points_required}
                                        className="text-xs font-medium px-2 py-1 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                        style={{ 
                                            backgroundColor: `${config.button_color}15`,
                                            color: config.button_color
                                        }}
                                    >
                                        {userPoints < reward.points_required ? 'Need more' : 'Redeem'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    // Demo rewards when no real data
                    [1, 2, 3, 4].map((i) => (
                        <div key={i} className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
                            <div className="h-28 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                                <Gift className="w-12 h-12 text-gray-400" />
                            </div>
                            <div className="p-3">
                                <p className="text-sm font-medium text-gray-900">Reward Item {i}</p>
                                <p className="text-xs text-gray-500 mt-0.5">Amazing reward</p>
                                <div className="flex items-center justify-between mt-2">
                                    <div className="flex items-center gap-1">
                                        <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                                        <span className="text-sm font-bold" style={{ color: config.primary_color }}>
                                            {100 * i}
                                        </span>
                                    </div>
                                    <button 
                                        className="text-xs font-medium px-2 py-1 rounded-lg"
                                        style={{ 
                                            backgroundColor: `${config.button_color}15`,
                                            color: config.button_color
                                        }}
                                    >
                                        Redeem
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    )

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
                                    className={`h-11 ${phoneError ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                />
                                {phoneError && (
                                    <p className="text-xs text-red-500 mt-1">{phoneError}</p>
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
                                    className={`h-11 ${emailError ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                />
                                {emailError && (
                                    <p className="text-xs text-red-500 mt-1">{emailError}</p>
                                )}
                            </div>

                            <Button 
                                onClick={handleLuckyDrawSubmit}
                                disabled={!customerName || !customerPhone || isSubmitting || !!phoneError || !!emailError}
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
                                            src={prize.image_url} 
                                            alt={prize.name || `Prize ${index + 1}`}
                                            className="w-full h-full object-cover"
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
            <div className="px-5 -mt-4 grid gap-4">
                {config.enable_scratch_card_game && (
                    <button 
                        onClick={() => handleProtectedAction('scratch-card')}
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

                {/* Coming Soon Games */}
                <div className="bg-white rounded-2xl shadow-sm p-5 opacity-60">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-xl bg-gray-200 flex items-center justify-center">
                            <Gamepad2 className="w-8 h-8 text-gray-400" />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-gray-900">Spin the Wheel</h3>
                                <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
                            </div>
                            <p className="text-sm text-gray-500">Spin to win amazing rewards!</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm p-5 opacity-60">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-xl bg-gray-200 flex items-center justify-center">
                            <Sparkles className="w-8 h-8 text-gray-400" />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-gray-900">Daily Quiz</h3>
                                <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
                            </div>
                            <p className="text-sm text-gray-500">Answer questions to earn points!</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )

    // Render Products Tab
    const renderProductsTab = () => (
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
                {loadingProducts ? (
                    <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
                        <Loader2 className="w-8 h-8 mx-auto animate-spin text-gray-400" />
                        <p className="text-sm text-gray-500 mt-2">Loading products...</p>
                    </div>
                ) : products.length > 0 ? (
                    <div className="space-y-4">
                        {products.map((product) => (
                            <div key={product.id} className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
                                <div className="flex">
                                    <div className="w-28 h-28 bg-gradient-to-br from-gray-100 to-gray-200 flex-shrink-0 flex items-center justify-center relative">
                                        {product.primary_image_url ? (
                                            <Image 
                                                src={product.primary_image_url} 
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
                                                {product.variants[0].suggested_retail_price && (
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

    // Render Profile Tab
    const renderProfileTab = () => (
        <div className="flex-1 overflow-y-auto pb-20 bg-gray-50">
            <div 
                className="px-5 pt-6 pb-16 text-white text-center relative"
                style={{ backgroundColor: config.primary_color }}
            >
                {/* Settings Icon Button */}
                {isAuthenticated && (
                    <div className="absolute top-4 right-4 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setActiveTab('account-settings')
                            }}
                            className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                            title="Account Settings"
                        >
                            <Settings className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                handleLogout()
                            }}
                            className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                            title="Sign Out"
                        >
                            <LogOut className="w-4 h-4" />
                        </button>
                    </div>
                )}
                
                <div className="w-20 h-20 mx-auto mb-3 rounded-full bg-white/20 flex items-center justify-center overflow-hidden">
                    {userAvatarUrl ? (
                        <Image 
                            src={userAvatarUrl} 
                            alt="Profile" 
                            width={80} 
                            height={80} 
                            className="object-cover w-full h-full"
                        />
                    ) : (
                        <User className="w-10 h-10" />
                    )}
                </div>
                <h1 className="text-xl font-bold">
                    {isAuthenticated 
                        ? (isShopUser && shopName ? shopName : userName) 
                        : 'Guest User'}
                </h1>
                <p className="text-white/80 text-sm">
                    {isAuthenticated 
                        ? userEmail
                        : 'Sign in to track your rewards'}
                </p>
            </div>

            <div className="px-5 -mt-8 relative z-20 space-y-4">
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
                                        Email or Phone Number
                                    </label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                        <Input 
                                            type="text"
                                            placeholder="Enter email or phone number"
                                            value={loginEmail}
                                            onChange={(e) => setLoginEmail(e.target.value)}
                                            className="h-11 pl-10"
                                        />
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">You can log in using your email or phone number.</p>
                                </div>
                                
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
                                </div>

                                <Button 
                                    onClick={handleLogin}
                                    disabled={loginLoading}
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

                {/* Stats Section */}
                <div className="bg-white rounded-2xl shadow-lg divide-y divide-gray-100">
                    <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Star className="w-5 h-5 text-amber-500" />
                            <span className="font-medium">Total Points</span>
                        </div>
                        <span className="font-bold" style={{ color: config.primary_color }}>{userPoints}</span>
                    </div>
                    <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Gift className="w-5 h-5 text-green-500" />
                            <span className="font-medium">Rewards Redeemed</span>
                        </div>
                        <span className="font-bold">0</span>
                    </div>
                    <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Trophy className="w-5 h-5 text-purple-500" />
                            <span className="font-medium">Lucky Draws Entered</span>
                        </div>
                        <span className="font-bold">{luckyDrawEntered ? 1 : 0}</span>
                    </div>
                </div>

                {/* Feedback Section */}
                <div className="bg-white rounded-2xl shadow-lg p-4">
                    <button 
                        onClick={() => {
                            setShowFeedbackModal(true)
                            setFeedbackError('')
                            setFeedbackSuccess(false)
                        }}
                        className="w-full flex items-center justify-between"
                    >
                        <div className="flex items-center gap-3">
                            <MessageSquare className="w-5 h-5 text-blue-500" />
                            <div className="text-left">
                                <span className="font-medium block">Send Feedback</span>
                                <span className="text-xs text-gray-500">Share your thoughts with us</span>
                            </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                    </button>
                </div>
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
                <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
                    {/* Account & Security */}
                    <button
                        onClick={() => setShowChangePassword(!showChangePassword)}
                        className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100"
                    >
                        <div className="flex items-center gap-3">
                            <Lock className="w-5 h-5 text-gray-600" />
                            <span className="font-medium text-gray-900">Account & Security</span>
                        </div>
                        <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${showChangePassword ? 'rotate-90' : ''}`} />
                    </button>

                    {/* Expandable Password Change Section */}
                    {showChangePassword && (
                        <div className="p-4 bg-gray-50 space-y-4">
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
                                        type={showConfirmPassword ? 'text' : 'password'}
                                        placeholder="Confirm new password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="h-11 pr-10"
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
                <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
                    {/* Profile Information Clickable Row */}
                    <button
                        onClick={() => setShowProfileInfo(!showProfileInfo)}
                        className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100"
                    >
                        <div className="flex items-center gap-3">
                            <User className="w-5 h-5 text-gray-600" />
                            <span className="font-medium text-gray-900">Profile Information</span>
                        </div>
                        <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${showProfileInfo ? 'rotate-90' : ''}`} />
                    </button>

                    {/* Expandable Profile Info Section */}
                    {showProfileInfo && (
                        <div className="bg-gray-50">
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
                            <div className="p-4">
                                <label className="text-sm font-medium text-gray-700 block mb-2">Email</label>
                                <div className="flex items-center gap-2">
                                    <Mail className="w-4 h-4 text-gray-400" />
                                    <span className="text-gray-900">{userEmail}</span>
                                </div>
                            </div>

                            {/* Save Button */}
                            {(editingName || editingPhone) && (newName !== userName || newPhone !== userPhone) && (
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
            case 'profile':
                return renderProfileTab()
            case 'account-settings':
                return renderAccountSettingsTab()
            default:
                return renderHomeTab()
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Main Content */}
            {renderContent()}

            {/* Bottom Navigation */}
            <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-2 py-1 safe-area-bottom z-50">
                <div className="flex items-center justify-around max-w-md mx-auto">
                    {[                        
                        { id: 'home' as TabType, icon: Home, label: 'Home' },
                        { id: 'rewards' as TabType, icon: Gift, label: 'Rewards' },
                        { id: 'products' as TabType, icon: Package, label: 'Shop' },
                        { id: 'profile' as TabType, icon: User, label: 'Profile' },
                    ].map((tab) => {
                        const Icon = tab.icon
                        const isActive = activeTab === tab.id
                        
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex flex-col items-center py-2 px-3 rounded-lg transition-colors ${
                                    isActive ? 'text-white' : 'text-gray-500'
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
                            <p className="text-sm text-gray-500 mt-1">Enter your shop credentials to collect points</p>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Shop ID (Email or Phone)</label>
                                <input
                                    type="text"
                                    value={shopId}
                                    onChange={(e) => setShopId(e.target.value)}
                                    placeholder="Enter your shop ID"
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2"
                                    style={{ '--tw-ring-color': config.primary_color } as any}
                                    disabled={collectingPoints}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                                <input
                                    type="password"
                                    value={shopPassword}
                                    onChange={(e) => setShopPassword(e.target.value)}
                                    placeholder="Enter your password"
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2"
                                    style={{ '--tw-ring-color': config.primary_color } as any}
                                    disabled={collectingPoints}
                                />
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
                                }}
                                className="flex-1 py-3 px-4 border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                                disabled={collectingPoints}
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
                onClose={() => setShowGenuineVerified(false)}
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
                                        src={selectedReward.item_image_url} 
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
                                    <span className="font-bold text-red-600">-{selectedReward.points_required}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm mt-1">
                                    <span className="text-gray-600">New Balance:</span>
                                    <span className="font-bold text-green-600">{userPoints - selectedReward.points_required}</span>
                                </div>
                            </div>
                        </div>

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

            {/* Reward Redemption Success Animation */}
            {redemptionDetails && (
                <RewardRedemptionAnimation
                    isOpen={showRedeemSuccess}
                    rewardName={redemptionDetails.rewardName}
                    pointsDeducted={redemptionDetails.pointsDeducted}
                    newBalance={redemptionDetails.newBalance}
                    redemptionCode={redemptionDetails.redemptionCode}
                    onClose={handleRedeemSuccessClose}
                />
            )}

            {/* Feedback Modal */}
            {showFeedbackModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
                    <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <MessageSquare className="w-5 h-5" style={{ color: config.primary_color }} />
                                <h3 className="text-lg font-bold text-gray-900">Send Feedback</h3>
                            </div>
                            <button 
                                onClick={() => {
                                    setShowFeedbackModal(false)
                                    setFeedbackTitle('')
                                    setFeedbackMessage('')
                                    setFeedbackError('')
                                    setFeedbackSuccess(false)
                                }}
                                className="p-1 rounded-full hover:bg-gray-100"
                            >
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>

                        {feedbackSuccess ? (
                            <div className="text-center py-6">
                                <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: `${config.primary_color}15` }}>
                                    <CheckCircle2 className="w-8 h-8" style={{ color: config.primary_color }} />
                                </div>
                                <h4 className="text-lg font-bold text-gray-900 mb-2">Thank You!</h4>
                                <p className="text-sm text-gray-500">We appreciate you taking the time to share your thoughts with us.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-sm text-gray-500">
                                    We value your feedback! Let us know what you think about our product.
                                </p>

                                {feedbackError && (
                                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                        <p className="text-sm text-red-600">{feedbackError}</p>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Title <span className="text-red-500">*</span>
                                    </label>
                                    <Input 
                                        placeholder="e.g. Great product quality!"
                                        value={feedbackTitle}
                                        onChange={(e) => setFeedbackTitle(e.target.value)}
                                        className="h-11"
                                        maxLength={100}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Message <span className="text-red-500">*</span>
                                    </label>
                                    <textarea
                                        placeholder="Share your experience or suggestions..."
                                        value={feedbackMessage}
                                        onChange={(e) => setFeedbackMessage(e.target.value)}
                                        className="w-full min-h-[120px] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                                        maxLength={1000}
                                    />
                                    <p className="text-xs text-gray-400 text-right mt-1">{feedbackMessage.length}/1000</p>
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={() => {
                                            setShowFeedbackModal(false)
                                            setFeedbackTitle('')
                                            setFeedbackMessage('')
                                            setFeedbackError('')
                                        }}
                                        disabled={submittingFeedback}
                                        className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSubmitFeedback}
                                        disabled={submittingFeedback || !feedbackTitle.trim() || !feedbackMessage.trim()}
                                        className="flex-1 px-4 py-3 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                        style={{ backgroundColor: config.button_color }}
                                    >
                                        {submittingFeedback ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Sending...
                                            </>
                                        ) : (
                                            <>
                                                <Send className="w-4 h-4" />
                                                Send
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
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
