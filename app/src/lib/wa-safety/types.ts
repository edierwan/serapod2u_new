// WhatsApp Broadcast Safety Presets - Types & Interfaces

export type PresetType = 'system' | 'custom';

export interface ContentFingerprintSettings {
  blockShorteners: boolean;
  requirePersonalization: boolean;
  maxEmojis: number;
  maxCapsPct: number;
  maxLinks: number;
}

export interface SafetyPresetSettings {
  // Warm-Up
  warmUpMode: boolean;
  
  // Volume Caps
  dailyCap: number;
  rolling24hCap: number;
  
  // Delivery Speed
  throttle: number; // msg/min
  jitterMin: number; // seconds
  jitterMax: number; // seconds
  
  // Session Cooling
  burstSize: number;
  cooldownMin: number;
  maxRuntimeMin: number;
  
  // Engagement Guard
  failureAutoPause: number; // percentage
  minReplyRate: number; // percentage
  optOutSpike: number; // percentage in 30m
  
  // Content Fingerprint
  contentFingerprint: ContentFingerprintSettings;
  
  // Global Enforcements
  quietHours: boolean;
  strictOptOut: boolean;
}

export interface SafetyPreset {
  id: string;
  name: string;
  nameMs?: string; // Malay translation
  description: string;
  descriptionMs?: string; // Malay translation
  type: PresetType;
  locked: boolean;
  settings: SafetyPresetSettings;
  // For custom presets
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  isDefault?: boolean;
}

export interface NumberHealth {
  riskScore: number; // 0-100
  uptime24h: number; // percentage
  disconnects24h: number;
  successRate: number; // percentage
  lastIssueRecency?: string;
  numberAgeDays?: number;
}

export interface PresetRecommendation {
  presetId: string;
  presetName: string;
  reason: string;
  reasonMs?: string; // Malay translation
  warnings: string[];
  warningsMs?: string[]; // Malay translation
  estimatedRuntimeMinutes: number;
}

// Validation constraints (server-side enforcement)
export const SAFETY_CONSTRAINTS = {
  throttle: { min: 1, max: 30 },
  jitter: { min: 0, max: 15 },
  dailyCap: { min: 10, max: 2000 },
  rollingCap: { min: 10, max: 2000 },
  burstSize: { min: 10, max: 100 },
  cooldown: { min: 1, max: 30 },
  maxRuntime: { min: 15, max: 180 },
  maxLinks: { min: 0, max: 3 },
  maxEmojis: { min: 0, max: 20 },
  maxCapsPct: { min: 0, max: 100 },
  failureAutoPause: { min: 5, max: 50 },
  minReplyRate: { min: 0, max: 10 },
  optOutSpike: { min: 0.1, max: 5 },
} as const;

// API Response types
export interface GetPresetsResponse {
  presets: SafetyPreset[];
  activePresetId?: string;
}

export interface CreatePresetRequest {
  name: string;
  description?: string;
  settings: SafetyPresetSettings;
  isDefault?: boolean;
}

export interface UpdatePresetRequest {
  name?: string;
  description?: string;
  settings?: SafetyPresetSettings;
  isDefault?: boolean;
}

export interface ApplySettingsRequest {
  presetId?: string;
  settings: SafetyPresetSettings;
}
