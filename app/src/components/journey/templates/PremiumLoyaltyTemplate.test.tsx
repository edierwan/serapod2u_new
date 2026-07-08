// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import PremiumLoyaltyTemplate from "./PremiumLoyaltyTemplate"

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }), getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) }, from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [], error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), single: vi.fn().mockResolvedValue({ data: null, error: null }) })) }) }))
vi.mock('framer-motion', () => ({ motion: { div: 'div', span: 'span', p: 'p' }, AnimatePresence: ({ children }: any) => children }))
vi.mock('next/image', () => ({ __esModule: true, default: (props: any) => { const { fill, ...rest } = props; return <img {...rest} data-fill={fill ? 'true' : undefined} /> } }))
vi.mock('next/dynamic', () => ({ __esModule: true, default: () => <div data-testid="dynamic-mock" /> }))
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }))
vi.mock('@/components/ui/input', () => ({ Input: (props: any) => <input {...props} /> }))
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: ({ children }: any) => <div data-testid="dialog">{children}</div>, DialogContent: ({ children }: any) => <div>{children}</div>, DialogHeader: ({ children }: any) => <div>{children}</div>, DialogTitle: ({ children }: any) => <div>{children}</div>, DialogDescription: ({ children }: any) => <div>{children}</div>, DialogFooter: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/ui/reference-picker', () => ({ ReferencePicker: () => <div /> }))
vi.mock('@/components/ui/shop-picker', () => ({ ShopPicker: () => <div /> }))
vi.mock('@/components/shop-requests/CreateShopDialog', () => ({ CreateShopDialog: () => <div /> }))
vi.mock('@/components/support/SupportChatWidgetV2', () => ({ SupportChatWidgetV2: () => <div /> }))
vi.mock('@/components/shared/SafeImage', () => ({ __esModule: true, default: (props: any) => <img {...props} /> }))
vi.mock('@/components/AnnouncementBanner', () => ({ AnnouncementBanner: () => <div /> }))
vi.mock('@/components/ScratchCard', () => ({ __esModule: true, default: () => <div /> }))
vi.mock('@/components/SpinWheelGame', () => ({ __esModule: true, default: () => <div /> }))
vi.mock('@/components/DailyQuizGame', () => ({ __esModule: true, default: () => <div /> }))
vi.mock('@/components/scanner/QrScanner', () => ({ __esModule: true, default: () => <div /> }))
vi.mock('@/components/journey/ForgotPasswordModal', () => ({ __esModule: true, default: () => <div /> }))
vi.mock('@/components/journey/SecurityCodeModal', () => ({ SecurityCodeModal: () => <div /> }))
vi.mock('@/app/actions/consumer', () => ({ logoutConsumer: vi.fn() }))
vi.mock('@/lib/actions', () => ({ registerConsumer: vi.fn() }))
vi.mock('@/lib/roadtour/location-client', () => ({ captureRoadtourGeolocation: vi.fn() }))
vi.mock('@/lib/engagement/profile-completion', () => ({ hasValidLinkedShop: vi.fn(), hasValidReferenceLink: vi.fn(), resolveCollectProfileCompletion: vi.fn() }))
vi.mock('@/lib/utils', () => ({ validatePhoneNumber: vi.fn(() => true), normalizePhone: vi.fn((p: string) => p), getStorageUrl: vi.fn((url: string) => url), toTitleCaseWords: vi.fn((s: string) => s) }))
vi.mock('@/lib/utils/formatters', () => ({ formatNumber: vi.fn((n: number) => String(n)) }))
vi.mock('@/utils/qrSecurity', () => ({ extractTokenFromQRCode: vi.fn() }))
vi.mock('@/lib/engagement/registration-link-selection', () => ({ validateRegistrationLinkSelections: vi.fn(), validateRegistrationPasswordFields: vi.fn() }))
vi.mock('@/lib/roadtour/survey', () => ({ getRoadtourShopSurveyField: vi.fn(), getRoadtourShopSurveyPrefillValues: vi.fn() }))
vi.mock('@/components/animations/PointEarnedAnimation', () => ({ PointEarnedAnimation: () => <div /> }))
vi.mock('@/components/animations/LuckyDrawSuccessAnimation', () => ({ LuckyDrawSuccessAnimation: () => <div /> }))
vi.mock('@/components/animations/GenuineProductAnimation', () => ({ GenuineProductAnimation: () => <div /> }))
vi.mock('@/components/animations/RewardRedemptionAnimation', () => ({ RewardRedemptionAnimation: () => <div /> }))
vi.mock('@/components/animations/GiftClaimedAnimation', () => ({ GiftClaimedAnimation: () => <div /> }))
vi.mock('@/components/animations/InsufficientPointsAnimation', () => ({ InsufficientPointsAnimation: () => <div /> }))
vi.mock('@/components/animations/RegistrationCelebrationAnimation', () => ({ RegistrationCelebrationAnimation: () => <div /> }))
vi.mock('@/components/animations/ShopLinkCelebrationAnimation', () => ({ ShopLinkCelebrationAnimation: () => <div /> }))

const MINIMAL_CONFIG = { welcome_title: 'Test', welcome_message: 'Welcome', thank_you_message: 'Thanks', primary_color: '#e97b2d', button_color: '#e97b2d', points_enabled: true, lucky_draw_enabled: false, redemption_enabled: false, require_security_code: false }
const ORG_ID = 'test-org-123'
function rtCtx() { return { token: 'test-rt-token-abc123', campaign_name: 'Test', account_manager_name: 'Edi', default_points: 100, org_id: ORG_ID } }
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('PremiumLoyaltyTemplate endpoint selection', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url)
      if (u.includes('/api/consumer/rewards') || u.includes('/api/engagement/catalog/ellbow/public-rewards')) return new Response(JSON.stringify({ success: true, rewards: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (u.includes('/api/consumer/products') || u.includes('/api/roadtour/products')) return new Response(JSON.stringify({ success: true, products: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (u.includes('/api/master-banner')) return new Response(JSON.stringify({ success: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({}), { status: 200 })
    })
  })
  it('calls /api/consumer/products for Vape/Cellera (non-Pet-Food)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    render(<PremiumLoyaltyTemplate config={MINIMAL_CONFIG} orgId={ORG_ID} isLive={true} experienceTheme="premium" />)
    await waitFor(() => { const b = screen.getAllByText('Product'); if (b.length > 0) b[0].click() })
    await waitFor(() => {
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/consumer/products')).length).toBeGreaterThanOrEqual(1)
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/roadtour/products')).length).toBe(0)
    }, { timeout: 5000 })
  }, 10000)
  it('calls /api/roadtour/products for Pet Food/Ellbow', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    render(<PremiumLoyaltyTemplate config={MINIMAL_CONFIG} orgId={ORG_ID} isLive={true} experienceTheme="pet_food" roadtourContext={rtCtx()} />)
    await waitFor(() => { const b = screen.getAllByText('Product'); if (b.length > 0) b[0].click() })
    await waitFor(() => {
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/roadtour/products')).length).toBeGreaterThanOrEqual(1)
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/consumer/products')).length).toBe(0)
    }, { timeout: 5000 })
  }, 10000)

  it('calls /api/consumer/rewards for Vape/Cellera (non-Pet-Food)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    render(<PremiumLoyaltyTemplate config={MINIMAL_CONFIG} orgId={ORG_ID} isLive={true} experienceTheme="premium" />)
    await waitFor(() => { const b = screen.getAllByText('Rewards'); if (b.length > 0) b[0].click() })
    await waitFor(() => {
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/consumer/rewards')).length).toBeGreaterThanOrEqual(1)
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/engagement/catalog/ellbow/public-rewards')).length).toBe(0)
    }, { timeout: 5000 })
  }, 10000)
  it('calls /api/engagement/catalog/ellbow/public-rewards for Pet Food/Ellbow', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    render(<PremiumLoyaltyTemplate config={MINIMAL_CONFIG} orgId={ORG_ID} isLive={true} experienceTheme="pet_food" roadtourContext={rtCtx()} />)
    await waitFor(() => { const b = screen.getAllByText('Rewards'); if (b.length > 0) b[0].click() })
    await waitFor(() => {
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/engagement/catalog/ellbow/public-rewards')).length).toBeGreaterThanOrEqual(1)
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/consumer/rewards')).length).toBe(0)
    }, { timeout: 5000 })
  }, 10000)
  it('does not fall back to Cellera rewards when Ellbow returns empty', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (url: any) => {
      const u = String(url)
      if (u.includes('/api/engagement/catalog/ellbow/public-rewards')) return new Response(JSON.stringify({ success: true, rewards: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (u.includes('/api/consumer/rewards')) return new Response(JSON.stringify({ success: true, rewards: [{ id: 'cellera', item_name: 'Cellera Reward', points_required: 100 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (u.includes('/api/roadtour/products') || u.includes('/api/consumer/products')) return new Response(JSON.stringify({ success: true, products: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (u.includes('/api/master-banner')) return new Response(JSON.stringify({ success: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({}), { status: 200 })
    })
    const spy = vi.spyOn(globalThis, 'fetch')
    render(<PremiumLoyaltyTemplate config={MINIMAL_CONFIG} orgId={ORG_ID} isLive={true} experienceTheme="pet_food" roadtourContext={rtCtx()} />)
    await waitFor(() => {
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/engagement/catalog/ellbow/public-rewards')).length).toBeGreaterThanOrEqual(1)
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/consumer/rewards')).length).toBe(0)
    }, { timeout: 5000 })
  }, 10000)
  it('Vape/Cellera still uses legacy consumer endpoints', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    render(<PremiumLoyaltyTemplate config={MINIMAL_CONFIG} orgId={ORG_ID} isLive={true} experienceTheme="premium" />)
    await waitFor(() => { const b = screen.getAllByText('Product'); if (b.length > 0) b[0].click() })
    await waitFor(() => { const b = screen.getAllByText('Rewards'); if (b.length > 0) b[0].click() })
    await waitFor(() => {
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/consumer/products')).length).toBeGreaterThanOrEqual(1)
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/consumer/rewards')).length).toBeGreaterThanOrEqual(1)
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/roadtour/products')).length).toBe(0)
      expect(spy.mock.calls.filter(([u]: any) => String(u).includes('/api/engagement/catalog/ellbow/public-rewards')).length).toBe(0)
    }, { timeout: 5000 })
  }, 10000)
})

