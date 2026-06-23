'use client'

const ICON_ROOT = '/images/ellbow_icons_pack'

interface EllbowHomePreviewProps {
    config?: {
        points_per_scan?: number
        variant_image_url?: string | null
    }
}

const benefits = [
    { label: 'Urinary Health', icon: '12-ellbow-urinary-health-icon.png' },
    { label: 'Sterilised Support', icon: '13-ellbow-protection-shield-icon.png' },
    { label: 'Kidney Care', icon: '14-ellbow-kidney-care-icon.png' },
]

const navItems = [
    { label: 'Home', icon: '05-ellbow-home-icon.png', active: true },
    { label: 'Rewards', icon: '06-ellbow-rewards-gift-icon.png' },
    { label: 'Scan', icon: '07-ellbow-scan-icon.png', scan: true },
    { label: 'Products', icon: '08-ellbow-product-pack-icon.png' },
    { label: 'Profile', icon: '09-ellbow-profile-avatar-icon.png' },
]

function EllbowAsset({ file, alt, className = '' }: { file: string; alt: string; className?: string }) {
    return (
        <img
            src={`${ICON_ROOT}/${file}`}
            alt={alt}
            className={`object-contain mix-blend-multiply ${className}`}
        />
    )
}

/**
 * Home/verification visual used by Journey Builder while the Ellbow pages are
 * being migrated one at a time. It intentionally owns no loyalty state and
 * cannot award points in admin preview mode.
 */
export default function EllbowHomePreview({ config }: EllbowHomePreviewProps) {
    const earnedPoints = config?.points_per_scan || 100

    return (
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#fbfaf9] text-[#173146]">
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <header className="flex h-[58px] items-center justify-between px-1">
                    <div className="w-9" aria-hidden="true" />
                    <div className="flex items-center text-[27px] font-black leading-none tracking-[0.02em]" aria-label="Ellbow">
                        <span className="text-[#389b9d]">ELL</span>
                        <span className="text-[#d44368]">B</span>
                        <span className="relative inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[#fff2f5]">
                            <EllbowAsset file="03-ellbow-cat-face-icon.png" alt="" className="h-11 w-11 max-w-none" />
                        </span>
                        <span className="text-[#d44368]">W</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="relative h-8 w-8 overflow-hidden rounded-full bg-white shadow-[0_2px_10px_rgba(23,49,70,0.12)]">
                            <EllbowAsset file="10-ellbow-notification-bell-icon.png" alt="Notifications" className="h-full w-full" />
                            <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-[#d44368] ring-1 ring-white" />
                        </div>
                        <div className="h-8 w-8 overflow-hidden rounded-full bg-white shadow-[0_2px_10px_rgba(23,49,70,0.12)]">
                            <EllbowAsset file="09-ellbow-profile-avatar-icon.png" alt="Profile" className="h-full w-full" />
                        </div>
                    </div>
                </header>

                <section className="relative overflow-hidden rounded-[22px] bg-gradient-to-b from-[#73d5cf] via-[#43b7b2] to-[#228f94] px-3 pb-3 pt-2 text-center text-white shadow-[0_8px_24px_rgba(31,143,148,0.22)]">
                    <span className="absolute left-4 top-10 text-xl text-white/25">🐾</span>
                    <span className="absolute right-5 top-20 text-base text-white/25">🐾</span>
                    <span className="absolute left-9 top-4 text-[10px] text-[#ffe27d]">◆</span>
                    <span className="absolute right-10 top-5 text-[9px] text-[#ff90ae]">◆</span>

                    <div className="relative mx-auto h-[104px] w-[112px] overflow-hidden rounded-[38px] bg-white/90 shadow-[0_8px_18px_rgba(8,85,88,0.25)]">
                        <EllbowAsset file="04-ellbow-verified-shield-cat.png" alt="Verified Ellbow product" className="h-full w-full scale-[1.24]" />
                    </div>
                    <h1 className="mt-1 text-[20px] font-extrabold leading-[1.02] drop-shadow-sm">
                        Genuine Product
                        <span className="block text-[28px]">Verified!</span>
                    </h1>
                    <p className="mt-1 text-[11px] font-medium text-white/90">This ELLBOW product is authentic.</p>

                    <div className="mt-3 flex min-h-[88px] items-center rounded-[18px] bg-white p-2.5 text-left text-[#173146] shadow-[0_5px_16px_rgba(18,73,78,0.2)]">
                        <div className="h-[68px] w-[115px] shrink-0 overflow-hidden rounded-xl bg-[#f5fbfa]">
                            <img
                                src={config?.variant_image_url || `${ICON_ROOT}/08-ellbow-product-pack-icon.png`}
                                alt="Daily Cat Treats"
                                className="h-full w-full object-contain mix-blend-multiply"
                            />
                        </div>
                        <div className="min-w-0 pl-2">
                            <h2 className="text-[14px] font-extrabold leading-tight">Daily Cat Treats</h2>
                            <p className="mt-1 text-[11px] font-bold text-[#d44368]">Chicken Cranberry</p>
                            <p className="mt-1 text-[10px] font-medium">16g Sachet · 50 pcs</p>
                        </div>
                    </div>
                </section>

                <section className="mt-2.5 grid grid-cols-3 rounded-[18px] bg-white px-1 py-2 shadow-[0_5px_18px_rgba(23,49,70,0.09)]">
                    {benefits.map((benefit, index) => (
                        <div key={benefit.label} className={`flex min-w-0 flex-col items-center px-1 text-center ${index ? 'border-l border-[#e8ecec]' : ''}`}>
                            <div className="h-11 w-11 overflow-hidden rounded-full bg-[#fbfbfa]">
                                <EllbowAsset file={benefit.icon} alt="" className="h-full w-full scale-110" />
                            </div>
                            <span className="mt-1 text-[8px] font-bold leading-tight">{benefit.label}</span>
                        </div>
                    ))}
                </section>

                <section className="relative mt-2.5 overflow-hidden rounded-[18px] border border-[#f7dce3] bg-gradient-to-r from-[#fff3f5] to-white p-3 shadow-[0_5px_18px_rgba(23,49,70,0.08)]">
                    <div className="flex items-center gap-2">
                        <div className="h-12 w-12 overflow-hidden rounded-full bg-[#fff0d8]">
                            <EllbowAsset file="11-ellbow-points-reward-icon.png" alt="Points reward" className="h-full w-full scale-125" />
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold">You earned</p>
                            <p className="text-[24px] font-black leading-none text-[#cf3f64]">+{earnedPoints} <span className="text-[18px]">pts</span></p>
                            <p className="mt-1 text-[9px] font-medium">Keep collecting for more treats!</p>
                        </div>
                    </div>
                    <EllbowAsset file="11-ellbow-points-reward-icon.png" alt="" className="absolute -right-3 -top-2 h-[86px] w-[86px] opacity-95" />
                    <div className="relative mt-2 space-y-1.5">
                        <button type="button" className="flex w-full items-center justify-center gap-2 rounded-full bg-[#34999d] py-2 text-[12px] font-extrabold text-white shadow-[0_4px_10px_rgba(52,153,157,0.28)]">
                            <span className="text-sm">✥</span> Collect Points
                        </button>
                        <button type="button" className="w-full rounded-full border border-[#34999d] bg-white py-2 text-[12px] font-extrabold text-[#34999d]">
                            View Rewards
                        </button>
                    </div>
                </section>
            </div>

            <nav className="absolute inset-x-0 bottom-0 z-20 grid h-[72px] grid-cols-5 items-end border-t border-[#e7e7e5] bg-white/95 px-1 pb-2 shadow-[0_-7px_20px_rgba(23,49,70,0.1)] backdrop-blur">
                {navItems.map((item) => (
                    <button key={item.label} type="button" className={`relative flex h-full flex-col items-center justify-end text-[8px] font-bold ${item.active ? 'text-[#2f9296]' : item.scan ? 'text-[#c93d62]' : 'text-[#52606b]'}`}>
                        <span className={item.scan ? 'absolute -top-5 flex h-[54px] w-[54px] items-center justify-center overflow-hidden rounded-full bg-gradient-to-b from-[#ed6686] to-[#c83b61] shadow-[0_5px_13px_rgba(200,59,97,0.35)] ring-4 ring-white' : 'mb-0.5 h-7 w-7 overflow-hidden'}>
                            <EllbowAsset file={item.icon} alt="" className={item.scan ? 'h-12 w-12 brightness-0 invert mix-blend-normal' : 'h-full w-full'} />
                        </span>
                        <span className={item.scan ? 'mt-auto' : ''}>{item.label}</span>
                    </button>
                ))}
            </nav>
        </div>
    )
}
