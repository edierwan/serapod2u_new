// WhatsApp Broadcast Safety - System Presets
// These presets are locked and cannot be edited or deleted

import { SafetyPreset, SafetyPresetSettings } from './types';

// Preset A — Safe Warm-Up (New / Risky Number)
// Use when: Number paired < 14 days OR risk score > 40 OR disconnects recently high
export const SAFE_WARMUP_PRESET: SafetyPreset = {
  id: 'system-safe-warmup',
  name: 'Safe Warm-Up',
  nameMs: 'Pemanasan Selamat',
  description: 'Lowest risk, slow and steady. Ideal for new numbers or when account health is concerning.',
  descriptionMs: 'Risiko paling rendah, perlahan dan stabil. Sesuai untuk nombor baharu atau apabila kesihatan akaun membimbangkan.',
  type: 'system',
  locked: true,
  settings: {
    warmUpMode: true,
    dailyCap: 200,
    rolling24hCap: 200,
    throttle: 10,
    jitterMin: 3,
    jitterMax: 7,
    burstSize: 25,
    cooldownMin: 12,
    maxRuntimeMin: 45,
    failureAutoPause: 10,
    minReplyRate: 2,
    optOutSpike: 0.3,
    contentFingerprint: {
      blockShorteners: true,
      requirePersonalization: true,
      maxEmojis: 6,
      maxCapsPct: 25,
      maxLinks: 1,
    },
    quietHours: true,
    strictOptOut: true,
  },
};

// Preset B — Balanced (Recommended Default)
// Use when: risk score <= 40 and number stable
export const BALANCED_PRESET: SafetyPreset = {
  id: 'system-balanced',
  name: 'Balanced',
  nameMs: 'Seimbang',
  description: 'Best for most campaigns. Good balance between delivery speed and safety.',
  descriptionMs: 'Terbaik untuk kebanyakan kempen. Keseimbangan yang baik antara kelajuan penghantaran dan keselamatan.',
  type: 'system',
  locked: true,
  settings: {
    warmUpMode: false,
    dailyCap: 500,
    rolling24hCap: 500,
    throttle: 20,
    jitterMin: 2,
    jitterMax: 4,
    burstSize: 40,
    cooldownMin: 8,
    maxRuntimeMin: 60,
    failureAutoPause: 15,
    minReplyRate: 2,
    optOutSpike: 0.5,
    contentFingerprint: {
      blockShorteners: true,
      requirePersonalization: true,
      maxEmojis: 8,
      maxCapsPct: 30,
      maxLinks: 1,
    },
    quietHours: true,
    strictOptOut: true,
  },
};

// Preset C — High Volume (Stable Number Only)
// Use when: risk score <= 20 AND uptime >= 98% AND disconnects low
export const HIGH_VOLUME_PRESET: SafetyPreset = {
  id: 'system-high-volume',
  name: 'High Volume',
  nameMs: 'Volum Tinggi',
  description: 'For big lists — only when number is healthy. Faster delivery with slightly relaxed limits.',
  descriptionMs: 'Untuk senarai besar — hanya apabila nombor sihat. Penghantaran lebih pantas dengan had yang sedikit longgar.',
  type: 'system',
  locked: true,
  settings: {
    warmUpMode: false,
    dailyCap: 1000,
    rolling24hCap: 1000,
    throttle: 25,
    jitterMin: 1,
    jitterMax: 3,
    burstSize: 60,
    cooldownMin: 6,
    maxRuntimeMin: 75,
    failureAutoPause: 12,
    minReplyRate: 1.5,
    optOutSpike: 0.6,
    contentFingerprint: {
      blockShorteners: true,
      requirePersonalization: true,
      maxEmojis: 10,
      maxCapsPct: 35,
      maxLinks: 1,
    },
    quietHours: true,
    strictOptOut: true,
  },
};

// All system presets in array
export const SYSTEM_PRESETS: SafetyPreset[] = [
  SAFE_WARMUP_PRESET,
  BALANCED_PRESET,
  HIGH_VOLUME_PRESET,
];

// Get system preset by ID
export function getSystemPreset(id: string): SafetyPreset | undefined {
  return SYSTEM_PRESETS.find(p => p.id === id);
}

// Default preset for new organizations
export const DEFAULT_PRESET_ID = 'system-balanced';

// Get default settings (balanced preset settings)
export function getDefaultSettings(): SafetyPresetSettings {
  return { ...BALANCED_PRESET.settings };
}
