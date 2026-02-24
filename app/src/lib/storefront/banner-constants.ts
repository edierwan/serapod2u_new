// ═══════════════════════════════════════════════════════════════════
// Banner size constants, animation types, and validation helpers
// ═══════════════════════════════════════════════════════════════════

// ── Animation Types ────────────────────────────────────────────────

export type AnimationStyle = 'none' | 'kenburns' | 'floatGlow' | 'parallax'
export type AnimationIntensity = 'low' | 'medium' | 'high'

export const ANIMATION_STYLES: { value: AnimationStyle; label: string; description: string }[] = [
    { value: 'none', label: 'None', description: 'No animation — static image' },
    { value: 'kenburns', label: 'Ken Burns', description: 'Subtle zoom & pan — cinematic feel' },
    { value: 'floatGlow', label: 'Float Glow', description: 'Soft glowing light blobs — premium feel' },
    { value: 'parallax', label: 'Parallax', description: 'Slight depth on scroll — desktop only' },
]

export const ANIMATION_INTENSITIES: { value: AnimationIntensity; label: string }[] = [
    { value: 'low', label: 'Low (subtle)' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High (cinematic)' },
]

export interface BannerAnimationConfig {
    animation_enabled: boolean
    animation_style: AnimationStyle
    animation_intensity: AnimationIntensity
}

export const DEFAULT_ANIMATION_CONFIG: BannerAnimationConfig = {
    animation_enabled: false,
    animation_style: 'none',
    animation_intensity: 'low',
}

// ── Banner Size Standards ──────────────────────────────────────────

export const LANDING_BANNER_SIZE = {
    recommended: { width: 2400, height: 1000 },
    minimum: { width: 1600, height: 600 },
    alt: { width: 1920, height: 800 },
    aspectRatio: { min: 2.0, ideal: 2.4, max: 3.2 },
    label: '2400 × 1000 px',
    altLabel: '1920 × 800 px',
    aspectLabel: '~2.4:1 to 3:1',
}

export const LOGIN_BANNER_SIZE = {
    recommended: { width: 1440, height: 1800 },
    minimum: { width: 1000, height: 1200 },
    alt: { width: 1200, height: 1600 },
    aspectRatio: { min: 0.6, ideal: 0.8, max: 1.0 },
    label: '1440 × 1800 px',
    altLabel: '1200 × 1600 px',
    aspectLabel: '~4:5 (portrait)',
}

// ── Validation ─────────────────────────────────────────────────────

export interface BannerValidationResult {
    valid: boolean
    warnings: string[]
    errors: string[]
    dimensions?: { width: number; height: number; aspectRatio: number }
}

export function validateBannerImage(
    width: number,
    height: number,
    context: 'landing' | 'login'
): BannerValidationResult {
    const spec = context === 'landing' ? LANDING_BANNER_SIZE : LOGIN_BANNER_SIZE
    const aspectRatio = width / height
    const warnings: string[] = []
    const errors: string[] = []

    // Check minimum size
    if (width < spec.minimum.width) {
        errors.push(`Width ${width}px is below minimum ${spec.minimum.width}px`)
    }
    if (height < spec.minimum.height) {
        errors.push(`Height ${height}px is below minimum ${spec.minimum.height}px`)
    }

    // Check aspect ratio (±15% tolerance)
    const tolerance = 0.15
    const minAR = spec.aspectRatio.min * (1 - tolerance)
    const maxAR = spec.aspectRatio.max * (1 + tolerance)
    if (aspectRatio < minAR || aspectRatio > maxAR) {
        warnings.push(
            `Aspect ratio ${aspectRatio.toFixed(2)}:1 is outside recommended range (${spec.aspectRatio.min}:1 – ${spec.aspectRatio.max}:1). Image may be cropped.`
        )
    }

    // Size recommendation
    if (width < spec.recommended.width || height < spec.recommended.height) {
        warnings.push(
            `For best quality, use at least ${spec.recommended.width} × ${spec.recommended.height}px`
        )
    }

    return {
        valid: errors.length === 0,
        warnings,
        errors,
        dimensions: { width, height, aspectRatio },
    }
}

/**
 * Read image dimensions from a File in the browser.
 */
export function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const img = new window.Image()
        img.onload = () => {
            resolve({ width: img.naturalWidth, height: img.naturalHeight })
            URL.revokeObjectURL(url)
        }
        img.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error('Failed to read image dimensions'))
        }
        img.src = url
    })
}
