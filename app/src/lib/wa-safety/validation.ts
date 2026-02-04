// WhatsApp Broadcast Safety - Validation & Guardrails

import { SafetyPresetSettings, SAFETY_CONSTRAINTS } from './types';

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitized: SafetyPresetSettings;
}

/**
 * Clamp a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Validate and sanitize safety settings
 * Enforces hard limits and required flags
 */
export function validateSettings(settings: SafetyPresetSettings): ValidationResult {
  const errors: string[] = [];
  
  // Create sanitized copy with clamped values
  const sanitized: SafetyPresetSettings = {
    warmUpMode: Boolean(settings.warmUpMode),
    
    dailyCap: clamp(
      settings.dailyCap,
      SAFETY_CONSTRAINTS.dailyCap.min,
      SAFETY_CONSTRAINTS.dailyCap.max
    ),
    rolling24hCap: clamp(
      settings.rolling24hCap,
      SAFETY_CONSTRAINTS.rollingCap.min,
      SAFETY_CONSTRAINTS.rollingCap.max
    ),
    
    throttle: clamp(
      settings.throttle,
      SAFETY_CONSTRAINTS.throttle.min,
      SAFETY_CONSTRAINTS.throttle.max
    ),
    jitterMin: clamp(
      settings.jitterMin,
      SAFETY_CONSTRAINTS.jitter.min,
      SAFETY_CONSTRAINTS.jitter.max
    ),
    jitterMax: clamp(
      settings.jitterMax,
      SAFETY_CONSTRAINTS.jitter.min,
      SAFETY_CONSTRAINTS.jitter.max
    ),
    
    burstSize: clamp(
      settings.burstSize,
      SAFETY_CONSTRAINTS.burstSize.min,
      SAFETY_CONSTRAINTS.burstSize.max
    ),
    cooldownMin: clamp(
      settings.cooldownMin,
      SAFETY_CONSTRAINTS.cooldown.min,
      SAFETY_CONSTRAINTS.cooldown.max
    ),
    maxRuntimeMin: clamp(
      settings.maxRuntimeMin,
      SAFETY_CONSTRAINTS.maxRuntime.min,
      SAFETY_CONSTRAINTS.maxRuntime.max
    ),
    
    failureAutoPause: clamp(
      settings.failureAutoPause,
      SAFETY_CONSTRAINTS.failureAutoPause.min,
      SAFETY_CONSTRAINTS.failureAutoPause.max
    ),
    minReplyRate: clamp(
      settings.minReplyRate,
      SAFETY_CONSTRAINTS.minReplyRate.min,
      SAFETY_CONSTRAINTS.minReplyRate.max
    ),
    optOutSpike: clamp(
      settings.optOutSpike,
      SAFETY_CONSTRAINTS.optOutSpike.min,
      SAFETY_CONSTRAINTS.optOutSpike.max
    ),
    
    contentFingerprint: {
      blockShorteners: Boolean(settings.contentFingerprint?.blockShorteners ?? true),
      requirePersonalization: Boolean(settings.contentFingerprint?.requirePersonalization ?? true),
      maxEmojis: clamp(
        settings.contentFingerprint?.maxEmojis ?? 8,
        SAFETY_CONSTRAINTS.maxEmojis.min,
        SAFETY_CONSTRAINTS.maxEmojis.max
      ),
      maxCapsPct: clamp(
        settings.contentFingerprint?.maxCapsPct ?? 30,
        SAFETY_CONSTRAINTS.maxCapsPct.min,
        SAFETY_CONSTRAINTS.maxCapsPct.max
      ),
      maxLinks: clamp(
        settings.contentFingerprint?.maxLinks ?? 1,
        SAFETY_CONSTRAINTS.maxLinks.min,
        SAFETY_CONSTRAINTS.maxLinks.max
      ),
    },
    
    // Forced values - these cannot be disabled
    quietHours: true, // Always ON
    strictOptOut: true, // Always ON - critical for compliance
  };
  
  // Validate jitter range
  if (sanitized.jitterMin > sanitized.jitterMax) {
    errors.push('Jitter minimum cannot exceed jitter maximum');
    sanitized.jitterMin = sanitized.jitterMax;
  }
  
  // Log validation adjustments
  if (settings.throttle > SAFETY_CONSTRAINTS.throttle.max) {
    errors.push(`Throttle capped at ${SAFETY_CONSTRAINTS.throttle.max} msg/min for safety`);
  }
  
  if (settings.dailyCap > SAFETY_CONSTRAINTS.dailyCap.max) {
    errors.push(`Daily cap capped at ${SAFETY_CONSTRAINTS.dailyCap.max} for safety`);
  }
  
  if (settings.strictOptOut === false) {
    errors.push('Strict opt-out cannot be disabled (forced ON for compliance)');
  }
  
  if (settings.quietHours === false) {
    errors.push('Quiet hours cannot be disabled (forced ON for compliance)');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    sanitized,
  };
}

/**
 * Check if settings were modified from original preset
 */
export function hasChangesFromPreset(
  current: SafetyPresetSettings,
  original: SafetyPresetSettings
): boolean {
  return JSON.stringify(current) !== JSON.stringify(original);
}

/**
 * Merge settings with enforced defaults
 */
export function mergeWithEnforcedDefaults(
  settings: Partial<SafetyPresetSettings>
): SafetyPresetSettings {
  const validated = validateSettings(settings as SafetyPresetSettings);
  return validated.sanitized;
}
