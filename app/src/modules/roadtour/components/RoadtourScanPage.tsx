'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PointEarnedAnimation } from '@/components/animations/PointEarnedAnimation'
import {
    AlertCircle, CheckCircle2, Eye, EyeOff, Gift, Loader2, Map, MapPin,
    QrCode, Star, XCircle
} from 'lucide-react'

type ScanStep = 'loading' | 'invalid' | 'expired' | 'ready' | 'shop-select' | 'survey' | 'done' | 'duplicate'

interface QrValidation {
    qr_code_id: string
    campaign_id: string
    campaign_name: string
    account_manager_user_id: string
    account_manager_name: string
    default_points: number
    reward_mode: string
    survey_template_id: string | null
    require_login: boolean
    require_shop_context: boolean
    require_geolocation: boolean
    duplicate_rule_reward: string
    org_id: string
    shop_id: string | null
}

interface SurveyField {
    id: string
    field_key: string
    label: string
    field_type: string
    options: string[] | null
    is_required: boolean
    sort_order: number
}

export default function RoadtourScanPage() {
    const searchParams = useSearchParams()
    const token = searchParams.get('rt')
    const supabase = createClient()

    const [step, setStep] = useState<ScanStep>('loading')
    const [qr, setQr] = useState<QrValidation | null>(null)
    const [errorMsg, setErrorMsg] = useState('')

    // Auth state
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [userId, setUserId] = useState<string | null>(null)

    // Login modal
    const [showLoginModal, setShowLoginModal] = useState(false)
    const [loginEmail, setLoginEmail] = useState('')
    const [loginPassword, setLoginPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loginError, setLoginError] = useState('')
    const [loginLoading, setLoginLoading] = useState(false)

    // Registration redirect
    const [showRegisterInfo, setShowRegisterInfo] = useState(false)

    // Forgot password
    const [showForgotPassword, setShowForgotPassword] = useState(false)
    const [forgotEmail, setForgotEmail] = useState('')
    const [forgotSending, setForgotSending] = useState(false)
    const [forgotSent, setForgotSent] = useState(false)

    // Shop selection
    const [shops, setShops] = useState<{ id: string; name: string }[]>([])
    const [selectedShopId, setSelectedShopId] = useState('')
    const [shopSearch, setShopSearch] = useState('')

    // Survey
    const [surveyFields, setSurveyFields] = useState<SurveyField[]>([])
    const [surveyAnswers, setSurveyAnswers] = useState<Record<string, string>>({})

    // Reward
    const [processing, setProcessing] = useState(false)
    const [rewardPoints, setRewardPoints] = useState(0)
    const [totalBalance, setTotalBalance] = useState(0)
    const [showSuccessAnimation, setShowSuccessAnimation] = useState(false)

    // Geolocation
    const [geolocation, setGeolocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
    const geoRequested = useRef(false)

    // Capture geolocation
    const requestGeolocation = useCallback(() => {
        if (geoRequested.current) return
        geoRequested.current = true
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    setGeolocation({
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        accuracy: pos.coords.accuracy,
                    })
                },
                () => { /* user denied or unavailable — continue without geo */ },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
            )
        }
    }, [])

    // 1. Validate token on mount
    useEffect(() => {
        if (!token) { setStep('invalid'); setErrorMsg('No QR token provided.'); return }

        ;(async () => {
            try {
                const { data: rawData, error } = await (supabase as any).rpc('validate_roadtour_qr_token', { p_token: token })
                if (error) throw error
                const data = rawData as any

                if (!data || data.valid === false) {
                    const err = data?.error || 'invalid'
                    if (err === 'expired') { setStep('expired'); setErrorMsg('This QR code has expired.'); return }
                    setStep('invalid')
                    setErrorMsg(data?.message || 'Invalid QR code.')
                    return
                }

                setQr(data)

                // Check existing session
                const { data: { user } } = await supabase.auth.getUser()
                if (user) {
                    setIsAuthenticated(true)
                    setUserId(user.id)
                }

                // Request geolocation if enabled
                if (data.require_geolocation) {
                    requestGeolocation()
                }

                setStep('ready')
            } catch (err: any) {
                setStep('invalid')
                setErrorMsg(err.message || 'Failed to validate QR code.')
            }
        })()
    }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

    // Load shops for shop-select step
    const loadShops = async () => {
        const { data } = await supabase
            .from('organizations')
            .select('id, name:org_name')
            .eq('org_type_code', 'SHOP')
            .eq('is_active', true)
            .order('org_name')
            .limit(500)
        setShops((data || []).map((s: any) => ({ id: s.id, name: s.name })))
    }

    // Load survey fields
    const loadSurvey = async (templateId: string) => {
        const { data } = await (supabase as any)
            .from('roadtour_survey_template_fields')
            .select('*')
            .eq('template_id', templateId)
            .order('sort_order')
        setSurveyFields(data || [])
    }

    // Handle "RoadTour Rewards" button click
    const handleRewardsClick = async () => {
        // If require_login and not authenticated → show login modal
        if (qr?.require_login && !isAuthenticated) {
            // Check session one more time
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (user) {
                    setIsAuthenticated(true)
                    setUserId(user.id)
                    proceedAfterAuth()
                    return
                }
            } catch { /* no session */ }

            setLoginError('')
            setShowLoginModal(true)
            return
        }

        proceedAfterAuth()
    }

    // After authentication, proceed to next step or claim directly
    const proceedAfterAuth = async () => {
        if (!qr) return

        if (qr.require_shop_context) {
            await loadShops()
            setStep('shop-select')
        } else if (qr.reward_mode === 'survey_submit' && qr.survey_template_id) {
            await loadSurvey(qr.survey_template_id)
            setStep('survey')
        } else {
            // Direct claim
            await claimReward()
        }
    }

    // Handle login submission
    const handleLogin = async () => {
        if (!loginEmail.trim() || !loginPassword.trim()) return
        setLoginLoading(true)
        setLoginError('')

        try {
            // Determine if input is email or phone
            const isPhone = /^[0-9+]/.test(loginEmail.trim())
            let email = loginEmail.trim()

            if (isPhone) {
                // Look up email by phone number
                const phoneDigits = email.replace(/\D/g, '')
                const phoneLookups = [phoneDigits]
                if (phoneDigits.startsWith('0')) phoneLookups.push('6' + phoneDigits)
                if (phoneDigits.startsWith('60')) phoneLookups.push(phoneDigits.slice(1))

                const { data: userRow } = await (supabase as any)
                    .from('users')
                    .select('email')
                    .or(phoneLookups.map(p => `phone.eq.${p}`).join(','))
                    .limit(1)
                    .maybeSingle()

                if (!userRow?.email) {
                    setLoginError('No account found with this phone number.')
                    setLoginLoading(false)
                    return
                }
                email = userRow.email
            }

            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password: loginPassword,
            })

            if (authError) {
                setLoginError(authError.message || 'Invalid credentials.')
                setLoginLoading(false)
                return
            }

            if (authData?.user) {
                setIsAuthenticated(true)
                setUserId(authData.user.id)
                setShowLoginModal(false)
                proceedAfterAuth()
            }
        } catch (err: any) {
            setLoginError(err.message || 'Login failed.')
        } finally {
            setLoginLoading(false)
        }
    }

    // Handle forgot password
    const handleForgotPassword = async () => {
        if (!forgotEmail.trim()) return
        setForgotSending(true)
        try {
            await supabase.auth.resetPasswordForEmail(forgotEmail.trim())
            setForgotSent(true)
        } catch { /* ignore errors */ }
        setForgotSending(false)
    }

    // Handle shop selected → next step
    const handleShopSelected = async () => {
        if (!selectedShopId) return
        if (qr?.reward_mode === 'survey_submit' && qr?.survey_template_id) {
            await loadSurvey(qr.survey_template_id)
            setStep('survey')
        } else {
            await claimReward()
        }
    }

    // Claim reward
    const claimReward = async () => {
        if (processing || !qr) return
        setProcessing(true)
        setErrorMsg('')

        try {
            // Validate survey if applicable
            if (qr.reward_mode === 'survey_submit' && surveyFields.length > 0) {
                const missing = surveyFields.filter(f => f.is_required && !surveyAnswers[f.field_key]?.trim())
                if (missing.length > 0) {
                    setErrorMsg(`Please fill in: ${missing.map(f => f.label).join(', ')}`)
                    setProcessing(false)
                    return
                }
            }

            const resp = await fetch('/api/roadtour/claim-reward', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    token,
                    shop_id: selectedShopId || null,
                    consumer_phone: null,
                    consumer_name: null,
                    survey_answers: Object.keys(surveyAnswers).length > 0 ? surveyAnswers : null,
                    geolocation: geolocation || null,
                }),
            })

            const result = await resp.json()

            if (!resp.ok) {
                if (result.code === 'DUPLICATE') {
                    setStep('duplicate')
                    setErrorMsg(result.message || 'You have already claimed this reward.')
                } else {
                    setErrorMsg(result.message || 'Failed to claim reward.')
                }
                setProcessing(false)
                return
            }

            setRewardPoints(result.points_awarded || qr.default_points || 0)
            setTotalBalance(result.balance_after || result.points_awarded || 0)
            setShowSuccessAnimation(true)
            setStep('done')
        } catch (err: any) {
            setErrorMsg(err.message || 'An error occurred.')
        } finally {
            setProcessing(false)
        }
    }

    const filteredShops = shops.filter(s => !shopSearch || s.name.toLowerCase().includes(shopSearch.toLowerCase()))

    // Primary color for the branded theme
    const primaryColor = '#e97b2d'

    return (
        <div className="min-h-screen bg-gray-50">
            {/* ======================== BRANDED HEADER ======================== */}
            <div
                className="relative w-full overflow-hidden"
                style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, #c9631e 100%)` }}
            >
                <div className="px-4 pt-6 pb-10 text-center text-white relative z-10">
                    <div className="flex items-center justify-center gap-2 mb-2">
                        <Map className="h-7 w-7" />
                        <h1 className="text-2xl font-bold tracking-tight">RoadTour</h1>
                    </div>
                    {qr && (
                        <div className="space-y-0.5">
                            <p className="text-sm opacity-90">Campaign: <span className="font-semibold">{qr.campaign_name}</span></p>
                            <p className="text-sm opacity-90">Account Manager: <span className="font-semibold">{qr.account_manager_name}</span></p>
                        </div>
                    )}
                </div>
                {/* Decorative wave */}
                <svg className="absolute bottom-0 left-0 w-full" viewBox="0 0 1440 60" fill="none">
                    <path d="M0 30 Q 360 60 720 30 Q 1080 0 1440 30 L1440 60 L0 60Z" fill="#f9fafb" />
                </svg>
            </div>

            {/* ======================== CONTENT ======================== */}
            <div className="px-4 -mt-2 pb-8 max-w-md mx-auto space-y-4">

                {/* Loading */}
                {step === 'loading' && (
                    <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
                        <Loader2 className="h-8 w-8 animate-spin mx-auto" style={{ color: primaryColor }} />
                        <p className="text-sm text-gray-500 mt-3">Validating QR code...</p>
                    </div>
                )}

                {/* Invalid */}
                {step === 'invalid' && (
                    <div className="bg-white rounded-2xl shadow-sm p-8 text-center border border-red-100">
                        <XCircle className="h-12 w-12 text-red-500 mx-auto" />
                        <h2 className="text-lg font-semibold mt-3">Invalid QR Code</h2>
                        <p className="text-sm text-gray-500 mt-1">{errorMsg}</p>
                    </div>
                )}

                {/* Expired */}
                {step === 'expired' && (
                    <div className="bg-white rounded-2xl shadow-sm p-8 text-center border border-amber-100">
                        <AlertCircle className="h-12 w-12 text-amber-500 mx-auto" />
                        <h2 className="text-lg font-semibold mt-3">QR Code Expired</h2>
                        <p className="text-sm text-gray-500 mt-1">{errorMsg}</p>
                    </div>
                )}

                {/* ======================== READY — Main reward card ======================== */}
                {step === 'ready' && qr && (
                    <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
                        <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center"
                            style={{ backgroundColor: `${primaryColor}15` }}>
                            <Gift className="h-7 w-7" style={{ color: primaryColor }} />
                        </div>
                        <h2 className="text-xl font-bold text-gray-800">RoadTour Rewards</h2>
                        <p className="text-sm text-gray-500 mt-1 mb-4">Claim your bonus points from this visit</p>

                        <div className="py-3 mb-4">
                            <p className="text-4xl font-bold" style={{ color: primaryColor }}>{qr.default_points}</p>
                            <p className="text-sm text-gray-500 mt-0.5">bonus points</p>
                        </div>

                        {errorMsg && (
                            <p className="text-sm text-red-600 mb-3">{errorMsg}</p>
                        )}

                        <button
                            onClick={handleRewardsClick}
                            disabled={processing}
                            className="w-full py-3.5 rounded-xl text-white font-semibold text-base shadow-sm transition-all active:scale-[0.98] disabled:opacity-60"
                            style={{ backgroundColor: primaryColor }}
                        >
                            {processing ? (
                                <span className="flex items-center justify-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Processing...
                                </span>
                            ) : (
                                <span className="flex items-center justify-center gap-2">
                                    <Gift className="h-5 w-5" /> RoadTour Rewards
                                </span>
                            )}
                        </button>
                    </div>
                )}

                {/* ======================== SHOP SELECT ======================== */}
                {step === 'shop-select' && (
                    <div className="bg-white rounded-2xl shadow-sm p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <MapPin className="h-5 w-5" style={{ color: primaryColor }} />
                            <h2 className="text-lg font-semibold">Select Shop</h2>
                        </div>
                        <p className="text-sm text-gray-500 mb-3">Please select the shop you are visiting.</p>
                        <input
                            type="text"
                            placeholder="Search shops..."
                            value={shopSearch}
                            onChange={(e) => setShopSearch(e.target.value)}
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-orange-300"
                        />
                        <div className="max-h-60 overflow-y-auto space-y-1 mb-4">
                            {filteredShops.slice(0, 50).map((s) => (
                                <button key={s.id} onClick={() => setSelectedShopId(s.id)}
                                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${selectedShopId === s.id ? 'bg-orange-50 text-orange-800 font-medium border border-orange-300' : 'hover:bg-gray-50 border border-transparent'}`}>
                                    {s.name}
                                </button>
                            ))}
                            {filteredShops.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No shops found.</p>}
                        </div>
                        <button
                            onClick={handleShopSelected}
                            disabled={!selectedShopId || processing}
                            className="w-full py-3 rounded-xl text-white font-semibold disabled:opacity-50"
                            style={{ backgroundColor: primaryColor }}
                        >
                            {processing ? 'Processing...' : 'Continue'}
                        </button>
                    </div>
                )}

                {/* ======================== SURVEY ======================== */}
                {step === 'survey' && (
                    <div className="bg-white rounded-2xl shadow-sm p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <QrCode className="h-5 w-5" style={{ color: primaryColor }} />
                            <h2 className="text-lg font-semibold">Quick Survey</h2>
                        </div>
                        <p className="text-sm text-gray-500 mb-4">Please complete this short survey to claim your reward.</p>
                        {errorMsg && <p className="text-sm text-red-600 mb-3">{errorMsg}</p>}

                        {surveyFields.map((f) => (
                            <div key={f.id} className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {f.label} {f.is_required && <span className="text-red-500">*</span>}
                                </label>
                                {f.field_type === 'text' && (
                                    <input type="text" value={surveyAnswers[f.field_key] || ''}
                                        onChange={(e) => setSurveyAnswers({ ...surveyAnswers, [f.field_key]: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
                                )}
                                {f.field_type === 'textarea' && (
                                    <textarea value={surveyAnswers[f.field_key] || ''} rows={3}
                                        onChange={(e) => setSurveyAnswers({ ...surveyAnswers, [f.field_key]: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
                                )}
                                {f.field_type === 'yes_no' && (
                                    <div className="flex gap-3">
                                        {['yes', 'no'].map(v => (
                                            <button key={v} onClick={() => setSurveyAnswers({ ...surveyAnswers, [f.field_key]: v })}
                                                className={`px-4 py-2 rounded-lg text-sm font-medium border ${surveyAnswers[f.field_key] === v ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-gray-200 hover:bg-gray-50'}`}>
                                                {v === 'yes' ? 'Yes' : 'No'}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {(f.field_type === 'single_select' || f.field_type === 'radio') && f.options && (
                                    <select value={surveyAnswers[f.field_key] || ''}
                                        onChange={(e) => setSurveyAnswers({ ...surveyAnswers, [f.field_key]: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300">
                                        <option value="">Select...</option>
                                        {f.options.map(opt => <option key={String(opt)} value={String(opt)}>{String(opt)}</option>)}
                                    </select>
                                )}
                                {f.field_type === 'multi_select' && f.options && (
                                    <div className="flex flex-wrap gap-2">
                                        {f.options.map(opt => {
                                            const sel = (surveyAnswers[f.field_key] || '').split(',').filter(Boolean)
                                            const active = sel.includes(String(opt))
                                            return (
                                                <button key={String(opt)} onClick={() => {
                                                    const next = active ? sel.filter(s => s !== String(opt)) : [...sel, String(opt)]
                                                    setSurveyAnswers({ ...surveyAnswers, [f.field_key]: next.join(',') })
                                                }}
                                                    className={`px-3 py-1.5 rounded-full text-xs font-medium border ${active ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-gray-200 hover:bg-gray-50'}`}>
                                                    {String(opt)}
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                                {f.field_type === 'number' && (
                                    <input type="number" value={surveyAnswers[f.field_key] || ''}
                                        onChange={(e) => setSurveyAnswers({ ...surveyAnswers, [f.field_key]: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
                                )}
                                {f.field_type === 'phone' && (
                                    <input type="tel" value={surveyAnswers[f.field_key] || ''}
                                        onChange={(e) => setSurveyAnswers({ ...surveyAnswers, [f.field_key]: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
                                )}
                                {f.field_type === 'checkbox' && (
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" checked={surveyAnswers[f.field_key] === 'true'}
                                            onChange={(e) => setSurveyAnswers({ ...surveyAnswers, [f.field_key]: e.target.checked ? 'true' : 'false' })}
                                            className="w-4 h-4 rounded text-orange-500 focus:ring-orange-300" />
                                        <span className="text-sm">{surveyAnswers[f.field_key] === 'true' ? 'Yes' : 'No'}</span>
                                    </label>
                                )}
                            </div>
                        ))}

                        <button
                            onClick={claimReward}
                            disabled={processing}
                            className="w-full py-3 rounded-xl text-white font-semibold disabled:opacity-50 mt-2"
                            style={{ backgroundColor: primaryColor }}
                        >
                            {processing ? (
                                <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</span>
                            ) : (
                                <span className="flex items-center justify-center gap-2"><Gift className="h-4 w-4" /> Submit & Claim Reward</span>
                            )}
                        </button>
                    </div>
                )}

                {/* ======================== SUCCESS (after animation closes) ======================== */}
                {step === 'done' && !showSuccessAnimation && (
                    <div className="bg-white rounded-2xl shadow-sm p-8 text-center border border-emerald-100">
                        <CheckCircle2 className="h-16 w-16 text-emerald-500 mx-auto" />
                        <h2 className="text-xl font-bold mt-3">Reward Claimed!</h2>
                        <p className="text-3xl font-bold text-emerald-600 mt-2">+{rewardPoints} points</p>
                        <p className="text-sm text-gray-500 mt-2">Thank you for participating in our RoadTour campaign. Your bonus points have been credited.</p>
                    </div>
                )}

                {/* Duplicate */}
                {step === 'duplicate' && (
                    <div className="bg-white rounded-2xl shadow-sm p-8 text-center border border-amber-100">
                        <AlertCircle className="h-12 w-12 text-amber-500 mx-auto" />
                        <h2 className="text-lg font-semibold mt-3">Already Claimed</h2>
                        <p className="text-sm text-gray-500 mt-1">{errorMsg}</p>
                    </div>
                )}

                {/* Geolocation indicator */}
                {qr?.require_geolocation && step === 'ready' && (
                    <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400">
                        <MapPin className="h-3 w-3" />
                        {geolocation ? 'Location captured' : 'Acquiring location...'}
                    </div>
                )}
            </div>

            {/* ======================== LOGIN MODAL ======================== */}
            {showLoginModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4 relative">
                        {/* Close button */}
                        <button onClick={() => setShowLoginModal(false)}
                            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>

                        <div className="text-center">
                            <div className="w-14 h-14 rounded-full mx-auto mb-2 flex items-center justify-center"
                                style={{ backgroundColor: `${primaryColor}10` }}>
                                <Gift className="h-6 w-6" style={{ color: primaryColor }} />
                            </div>
                            <h3 className="text-lg font-bold text-gray-800">Collect Points</h3>
                            <p className="text-sm text-gray-500">Enter your credentials to collect points</p>
                        </div>

                        {loginError && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                                <p className="text-sm text-red-700">{loginError}</p>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Email or Phone</label>
                            <input
                                type="text"
                                value={loginEmail}
                                onChange={(e) => setLoginEmail(e.target.value)}
                                placeholder="Enter your email or phone"
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                                disabled={loginLoading}
                                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={loginPassword}
                                    onChange={(e) => setLoginPassword(e.target.value)}
                                    placeholder="Enter your password"
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-orange-300"
                                    disabled={loginLoading}
                                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                                />
                                <button type="button" onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowLoginModal(false)}
                                className="flex-1 py-3 rounded-xl text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50"
                                disabled={loginLoading}
                            >
                                Back
                            </button>
                            <button
                                onClick={handleLogin}
                                disabled={loginLoading || !loginEmail.trim() || !loginPassword.trim()}
                                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                                style={{ backgroundColor: primaryColor }}
                            >
                                {loginLoading ? 'Collecting...' : 'Collect Points'}
                            </button>
                        </div>

                        <div className="text-center space-y-1">
                            <button
                                onClick={() => { setShowLoginModal(false); setShowForgotPassword(true); setForgotEmail(loginEmail); }}
                                className="text-sm font-medium hover:underline"
                                style={{ color: primaryColor }}
                            >
                                Forgot Password?
                            </button>
                            <br />
                            <button
                                onClick={() => { setShowLoginModal(false); setShowRegisterInfo(true); }}
                                className="text-sm font-medium hover:underline"
                                style={{ color: primaryColor }}
                            >
                                Do not have account? Register here
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ======================== REGISTRATION INFO MODAL ======================== */}
            {showRegisterInfo && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4 relative">
                        <button onClick={() => setShowRegisterInfo(false)}
                            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>

                        <div className="text-center">
                            <h3 className="text-lg font-bold text-gray-800">Create Account</h3>
                            <p className="text-sm text-gray-500 mt-2">
                                To register, please visit our main site and scan any product QR code, then tap &quot;Register&quot; on the product page.
                            </p>
                            <p className="text-sm text-gray-500 mt-2">
                                Once registered, come back here to claim your RoadTour bonus points!
                            </p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => { setShowRegisterInfo(false); setShowLoginModal(true); }}
                                className="flex-1 py-3 rounded-xl text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50"
                            >
                                Back to Login
                            </button>
                            <a
                                href="https://serapod2u.com"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white text-center"
                                style={{ backgroundColor: primaryColor }}
                            >
                                Go to Serapod2U
                            </a>
                        </div>
                    </div>
                </div>
            )}

            {/* ======================== FORGOT PASSWORD MODAL ======================== */}
            {showForgotPassword && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4 relative">
                        <button onClick={() => setShowForgotPassword(false)}
                            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>

                        <h3 className="text-lg font-bold text-gray-800 text-center">Reset Password</h3>

                        {forgotSent ? (
                            <div className="text-center space-y-2">
                                <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
                                <p className="text-sm text-gray-600">Password reset email sent! Check your inbox.</p>
                                <button
                                    onClick={() => { setShowForgotPassword(false); setForgotSent(false); setShowLoginModal(true); }}
                                    className="text-sm font-medium hover:underline"
                                    style={{ color: primaryColor }}
                                >
                                    Back to Login
                                </button>
                            </div>
                        ) : (
                            <>
                                <p className="text-sm text-gray-500 text-center">Enter your email to receive a password reset link.</p>
                                <input
                                    type="email"
                                    value={forgotEmail}
                                    onChange={(e) => setForgotEmail(e.target.value)}
                                    placeholder="Enter your email"
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                                />
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => { setShowForgotPassword(false); setShowLoginModal(true); }}
                                        className="flex-1 py-3 rounded-xl text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50"
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleForgotPassword}
                                        disabled={forgotSending || !forgotEmail.trim()}
                                        className="flex-1 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                                        style={{ backgroundColor: primaryColor }}
                                    >
                                        {forgotSending ? 'Sending...' : 'Send Reset Link'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ======================== SUCCESS ANIMATION ======================== */}
            <PointEarnedAnimation
                isOpen={showSuccessAnimation}
                pointsEarned={rewardPoints}
                totalBalance={totalBalance}
                previousBalance={totalBalance - rewardPoints}
                primaryColor={primaryColor}
                autoCloseDelay={3500}
                onClose={() => setShowSuccessAnimation(false)}
            />
        </div>
    )
}
