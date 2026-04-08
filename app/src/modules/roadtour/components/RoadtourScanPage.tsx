'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
    AlertCircle, CheckCircle2, Gift, Loader2, Map, MapPin, QrCode, Star, XCircle
} from 'lucide-react'

type ScanStep = 'loading' | 'invalid' | 'expired' | 'login' | 'shop-select' | 'survey' | 'reward' | 'done' | 'duplicate'

interface QrValidationResult {
    campaign_id: string
    campaign_name: string
    am_user_id: string
    am_name: string
    default_points: number
    reward_mode: string
    survey_template_id: string | null
    require_login: boolean
    require_shop_context: boolean
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
    const [qrResult, setQrResult] = useState<QrValidationResult | null>(null)
    const [qrId, setQrId] = useState<string | null>(null)
    const [errorMsg, setErrorMsg] = useState('')

    // Auth
    const [userId, setUserId] = useState<string | null>(null)
    const [userPhone, setUserPhone] = useState('')
    const [userName, setUserName] = useState('')
    const [isLoggedIn, setIsLoggedIn] = useState(false)

    // Shop selection
    const [shops, setShops] = useState<{ id: string; name: string }[]>([])
    const [selectedShopId, setSelectedShopId] = useState('')
    const [shopSearch, setShopSearch] = useState('')

    // Survey
    const [surveyFields, setSurveyFields] = useState<SurveyField[]>([])
    const [surveyAnswers, setSurveyAnswers] = useState<Record<string, string>>({})

    // Reward
    const [rewardPoints, setRewardPoints] = useState(0)
    const [processing, setProcessing] = useState(false)

    // 1. Validate token
    useEffect(() => {
        if (!token) { setStep('invalid'); setErrorMsg('No QR token provided.'); return }

        ; (async () => {
            try {
                // Call the validate function (cast to bypass type generation lag)
                const { data: rawData, error } = await (supabase as any).rpc('validate_roadtour_qr_token', { p_token: token })
                if (error) throw error
                const data = rawData as any

                if (!data || data.status === 'error') {
                    const reason = data?.reason || 'invalid'
                    if (reason === 'expired') { setStep('expired'); setErrorMsg('This QR code has expired.'); return }
                    setStep('invalid')
                    setErrorMsg(data?.message || 'Invalid QR code.')
                    return
                }

                setQrResult(data)
                setQrId(data.qr_id)

                // Check if user is logged in
                const { data: { user } } = await supabase.auth.getUser()
                if (user) {
                    setUserId(user.id)
                    setIsLoggedIn(true)
                    const { data: profile } = await supabase.from('users').select('full_name, phone').eq('id', user.id).single()
                    if (profile) {
                        setUserName(profile.full_name || '')
                        setUserPhone(profile.phone || '')
                    }
                }

                // Determine next step
                if (data.require_login && !user) {
                    setStep('login')
                } else if (data.require_shop_context) {
                    await loadShops(data.campaign_id)
                    setStep('shop-select')
                } else if (data.reward_mode === 'survey_submit' && data.survey_template_id) {
                    await loadSurvey(data.survey_template_id)
                    setStep('survey')
                } else {
                    setStep('reward')
                }
            } catch (err: any) {
                setStep('invalid')
                setErrorMsg(err.message || 'Failed to validate QR code.')
            }
        })()
    }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

    const loadShops = async (campaignId: string) => {
        // Get shops — all active shops for now
        const { data } = await supabase
            .from('organizations')
            .select('id, name:org_name')
            .eq('org_type_code', 'SHOP')
            .eq('is_active', true)
            .order('org_name')
            .limit(500)
        setShops((data || []).map((s: any) => ({ id: s.id, name: s.name })))
    }

    const loadSurvey = async (templateId: string) => {
        const { data } = await (supabase as any)
            .from('roadtour_survey_template_fields')
            .select('*')
            .eq('template_id', templateId)
            .order('sort_order')
        setSurveyFields(data || [])
    }

    // Handle shop selection → next step
    const handleShopSelected = async () => {
        if (!selectedShopId) return
        if (qrResult?.reward_mode === 'survey_submit' && qrResult?.survey_template_id) {
            await loadSurvey(qrResult.survey_template_id)
            setStep('survey')
        } else {
            setStep('reward')
        }
    }

    // Handle survey answer changes
    const updateAnswer = (fieldKey: string, value: string) => {
        setSurveyAnswers((prev) => ({ ...prev, [fieldKey]: value }))
    }

    // Submit survey and claim reward
    const handleClaimReward = async () => {
        if (processing) return
        setProcessing(true)

        try {
            // If survey mode, validate required fields
            if (qrResult?.reward_mode === 'survey_submit' && surveyFields.length > 0) {
                const missing = surveyFields.filter((f) => f.is_required && !surveyAnswers[f.field_key]?.trim())
                if (missing.length > 0) {
                    setErrorMsg(`Please fill in: ${missing.map((f) => f.label).join(', ')}`)
                    setProcessing(false)
                    return
                }
            }

            // Call the reward API
            const resp = await fetch('/api/roadtour/claim-reward', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    shop_id: selectedShopId || null,
                    consumer_phone: userPhone || null,
                    consumer_name: userName || null,
                    survey_answers: Object.keys(surveyAnswers).length > 0 ? surveyAnswers : null,
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

            setRewardPoints(result.points_awarded || qrResult?.default_points || 0)
            setStep('done')
        } catch (err: any) {
            setErrorMsg(err.message || 'An error occurred.')
        } finally {
            setProcessing(false)
        }
    }

    // Login step (simplified — prompt for phone)
    const handleLoginContinue = async () => {
        if (!userPhone.trim()) return
        // For now, continue without auth — phone is collected
        if (qrResult?.require_shop_context) {
            await loadShops(qrResult.campaign_id)
            setStep('shop-select')
        } else if (qrResult?.reward_mode === 'survey_submit' && qrResult?.survey_template_id) {
            await loadSurvey(qrResult.survey_template_id)
            setStep('survey')
        } else {
            setStep('reward')
        }
    }

    const filteredShops = shops.filter((s) => !shopSearch || s.name.toLowerCase().includes(shopSearch.toLowerCase()))

    return (
        <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-blue-950 dark:to-background flex items-start justify-center p-4 pt-8">
            <div className="w-full max-w-md space-y-4">
                {/* Header */}
                <div className="text-center space-y-2">
                    <div className="flex items-center justify-center gap-2">
                        <Map className="h-8 w-8 text-blue-600" />
                        <h1 className="text-2xl font-bold text-blue-700 dark:text-blue-300">RoadTour</h1>
                    </div>
                    {qrResult && (
                        <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">Campaign: <span className="font-medium text-foreground">{qrResult.campaign_name}</span></p>
                            <p className="text-sm text-muted-foreground">Account Manager: <span className="font-medium text-foreground">{qrResult.am_name}</span></p>
                        </div>
                    )}
                </div>

                {/* Loading */}
                {step === 'loading' && (
                    <Card><CardContent className="py-12 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" /><p className="text-sm text-muted-foreground mt-3">Validating QR code...</p></CardContent></Card>
                )}

                {/* Invalid */}
                {step === 'invalid' && (
                    <Card className="border-red-200"><CardContent className="py-8 text-center">
                        <XCircle className="h-12 w-12 text-red-500 mx-auto" />
                        <h2 className="text-lg font-semibold mt-3">Invalid QR Code</h2>
                        <p className="text-sm text-muted-foreground mt-1">{errorMsg}</p>
                    </CardContent></Card>
                )}

                {/* Expired */}
                {step === 'expired' && (
                    <Card className="border-amber-200"><CardContent className="py-8 text-center">
                        <AlertCircle className="h-12 w-12 text-amber-500 mx-auto" />
                        <h2 className="text-lg font-semibold mt-3">QR Code Expired</h2>
                        <p className="text-sm text-muted-foreground mt-1">{errorMsg}</p>
                    </CardContent></Card>
                )}

                {/* Login / Identify */}
                {step === 'login' && (
                    <Card>
                        <CardHeader><CardTitle className="text-center">Identify Yourself</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-muted-foreground text-center">Please enter your details to claim your reward.</p>
                            <div className="space-y-2"><Label>Your Name</Label><Input value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Enter your name" /></div>
                            <div className="space-y-2"><Label>Phone Number *</Label><Input value={userPhone} onChange={(e) => setUserPhone(e.target.value)} placeholder="e.g. 0123456789" /></div>
                            <Button className="w-full" onClick={handleLoginContinue} disabled={!userPhone.trim()}>Continue</Button>
                        </CardContent>
                    </Card>
                )}

                {/* Shop Selection */}
                {step === 'shop-select' && (
                    <Card>
                        <CardHeader><CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" />Select Shop</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-muted-foreground">Please select the shop you are visiting.</p>
                            <Input placeholder="Search shops..." value={shopSearch} onChange={(e) => setShopSearch(e.target.value)} />
                            <div className="max-h-60 overflow-y-auto space-y-1">
                                {filteredShops.slice(0, 50).map((s) => (
                                    <button key={s.id} onClick={() => setSelectedShopId(s.id)}
                                        className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${selectedShopId === s.id ? 'bg-blue-100 text-blue-800 font-medium border border-blue-300' : 'hover:bg-muted border border-transparent'}`}>
                                        {s.name}
                                    </button>
                                ))}
                                {filteredShops.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No shops found.</p>}
                            </div>
                            <Button className="w-full" onClick={handleShopSelected} disabled={!selectedShopId}>Continue</Button>
                        </CardContent>
                    </Card>
                )}

                {/* Survey */}
                {step === 'survey' && (
                    <Card>
                        <CardHeader><CardTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" />Quick Survey</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-muted-foreground">Please complete this short survey to claim your reward.</p>
                            {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
                            {surveyFields.map((f) => (
                                <div key={f.id} className="space-y-1.5">
                                    <Label>{f.label} {f.is_required && <span className="text-red-500">*</span>}</Label>
                                    {f.field_type === 'text' && (
                                        <Input value={surveyAnswers[f.field_key] || ''} onChange={(e) => updateAnswer(f.field_key, e.target.value)} />
                                    )}
                                    {f.field_type === 'textarea' && (
                                        <Textarea value={surveyAnswers[f.field_key] || ''} onChange={(e) => updateAnswer(f.field_key, e.target.value)} rows={3} />
                                    )}
                                    {f.field_type === 'number' && (
                                        <Input type="number" value={surveyAnswers[f.field_key] || ''} onChange={(e) => updateAnswer(f.field_key, e.target.value)} />
                                    )}
                                    {f.field_type === 'phone' && (
                                        <Input type="tel" value={surveyAnswers[f.field_key] || ''} onChange={(e) => updateAnswer(f.field_key, e.target.value)} />
                                    )}
                                    {f.field_type === 'yes_no' && (
                                        <div className="flex gap-3">
                                            <Button variant={surveyAnswers[f.field_key] === 'yes' ? 'default' : 'outline'} size="sm" onClick={() => updateAnswer(f.field_key, 'yes')}>Yes</Button>
                                            <Button variant={surveyAnswers[f.field_key] === 'no' ? 'default' : 'outline'} size="sm" onClick={() => updateAnswer(f.field_key, 'no')}>No</Button>
                                        </div>
                                    )}
                                    {(f.field_type === 'single_select' || f.field_type === 'radio') && f.options && (
                                        <Select value={surveyAnswers[f.field_key] || ''} onValueChange={(v) => updateAnswer(f.field_key, v)}>
                                            <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                                            <SelectContent>{f.options.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent>
                                        </Select>
                                    )}
                                    {f.field_type === 'multi_select' && f.options && (
                                        <div className="flex flex-wrap gap-2">
                                            {f.options.map((opt) => {
                                                const selected = (surveyAnswers[f.field_key] || '').split(',').filter(Boolean)
                                                const isSelected = selected.includes(opt)
                                                return (
                                                    <Badge key={opt} variant={isSelected ? 'default' : 'outline'} className="cursor-pointer"
                                                        onClick={() => updateAnswer(f.field_key, isSelected ? selected.filter((s) => s !== opt).join(',') : [...selected, opt].join(','))}>
                                                        {opt}
                                                    </Badge>
                                                )
                                            })}
                                        </div>
                                    )}
                                    {f.field_type === 'checkbox' && (
                                        <div className="flex items-center gap-2">
                                            <Switch checked={surveyAnswers[f.field_key] === 'true'} onCheckedChange={(v) => updateAnswer(f.field_key, v ? 'true' : 'false')} />
                                            <span className="text-sm">{surveyAnswers[f.field_key] === 'true' ? 'Yes' : 'No'}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                            <Button className="w-full gap-2" onClick={handleClaimReward} disabled={processing}>
                                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
                                Submit & Claim Reward
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {/* Direct Reward */}
                {step === 'reward' && (
                    <Card>
                        <CardHeader><CardTitle className="text-center flex items-center justify-center gap-2"><Star className="h-5 w-5 text-amber-500" />Claim Your Reward</CardTitle></CardHeader>
                        <CardContent className="space-y-4 text-center">
                            <div className="py-4">
                                <p className="text-4xl font-bold text-blue-600">{qrResult?.default_points || 0}</p>
                                <p className="text-sm text-muted-foreground mt-1">bonus points</p>
                            </div>
                            {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
                            <Button className="w-full gap-2" onClick={handleClaimReward} disabled={processing}>
                                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
                                Claim Points
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {/* Success */}
                {step === 'done' && (
                    <Card className="border-emerald-200">
                        <CardContent className="py-8 text-center space-y-3">
                            <CheckCircle2 className="h-16 w-16 text-emerald-500 mx-auto" />
                            <h2 className="text-xl font-bold">Reward Claimed!</h2>
                            <p className="text-3xl font-bold text-emerald-600">+{rewardPoints} points</p>
                            <p className="text-sm text-muted-foreground">Thank you for participating in our RoadTour campaign. Your bonus points have been credited.</p>
                        </CardContent>
                    </Card>
                )}

                {/* Duplicate */}
                {step === 'duplicate' && (
                    <Card className="border-amber-200">
                        <CardContent className="py-8 text-center space-y-3">
                            <AlertCircle className="h-12 w-12 text-amber-500 mx-auto" />
                            <h2 className="text-lg font-semibold">Already Claimed</h2>
                            <p className="text-sm text-muted-foreground">{errorMsg}</p>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    )
}
