// WhatsApp Broadcast Safety - Advisor / Recommendation Engine

import { NumberHealth, PresetRecommendation, SafetyPresetSettings } from './types';
import { SAFE_WARMUP_PRESET, BALANCED_PRESET, HIGH_VOLUME_PRESET } from './presets';

interface RecommendInput {
  recipientCount: number;
  health: NumberHealth;
}

/**
 * Calculate estimated runtime in minutes based on settings and recipient count
 */
export function calculateEstimatedRuntime(
  recipientCount: number,
  settings: SafetyPresetSettings
): number {
  const { throttle, burstSize, cooldownMin } = settings;
  
  // Time to send all messages at throttle rate (minutes)
  const sendingTime = recipientCount / throttle;
  
  // Number of cooldown breaks needed
  const cooldownBlocks = Math.floor(recipientCount / burstSize);
  const totalCooldownTime = cooldownBlocks * cooldownMin;
  
  // Total estimated runtime
  const totalMinutes = Math.ceil(sendingTime + totalCooldownTime);
  
  return totalMinutes;
}

/**
 * Format runtime for display
 */
export function formatRuntime(minutes: number): string {
  if (minutes < 60) {
    return `~${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) {
    return `~${hours}h`;
  }
  return `~${hours}h ${remainingMins}m`;
}

export function formatRuntimeMs(minutes: number): string {
  if (minutes < 60) {
    return `~${minutes} minit`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) {
    return `~${hours} jam`;
  }
  return `~${hours} jam ${remainingMins} minit`;
}

/**
 * Main recommendation engine
 * Recommends the best preset based on recipient count and number health
 */
export function recommendPreset(input: RecommendInput): PresetRecommendation {
  const { recipientCount, health } = input;
  const warnings: string[] = [];
  const warningsMs: string[] = [];
  
  // Rule 1: If health is poor, always recommend Safe Warm-Up
  if (health.riskScore > 40 || health.disconnects24h >= 5 || health.uptime24h < 97) {
    const runtime = calculateEstimatedRuntime(recipientCount, SAFE_WARMUP_PRESET.settings);
    
    const healthIssues: string[] = [];
    const healthIssuesMs: string[] = [];
    
    if (health.riskScore > 40) {
      healthIssues.push('high risk score');
      healthIssuesMs.push('skor risiko tinggi');
    }
    if (health.disconnects24h >= 5) {
      healthIssues.push('frequent disconnections');
      healthIssuesMs.push('pemutusan kerap');
    }
    if (health.uptime24h < 97) {
      healthIssues.push('low uptime');
      healthIssuesMs.push('uptime rendah');
    }
    
    return {
      presetId: SAFE_WARMUP_PRESET.id,
      presetName: SAFE_WARMUP_PRESET.name,
      reason: `Your number shows ${healthIssues.join(', ')}. Safe Warm-Up protects against bans while your number recovers.`,
      reasonMs: `Nombor anda menunjukkan ${healthIssuesMs.join(', ')}. Pemanasan Selamat melindungi daripada sekatan semasa nombor anda pulih.`,
      warnings: ['Consider reducing recipient count or waiting for number health to improve'],
      warningsMs: ['Pertimbangkan untuk mengurangkan bilangan penerima atau tunggu kesihatan nombor bertambah baik'],
      estimatedRuntimeMinutes: runtime,
    };
  }
  
  // Rule 2: Small lists (≤300) → Balanced
  if (recipientCount <= 300) {
    const runtime = calculateEstimatedRuntime(recipientCount, BALANCED_PRESET.settings);
    return {
      presetId: BALANCED_PRESET.id,
      presetName: BALANCED_PRESET.name,
      reason: 'Your list size is manageable and number health is good. Balanced settings provide reliable delivery.',
      reasonMs: 'Saiz senarai anda boleh diuruskan dan kesihatan nombor baik. Tetapan Seimbang memberikan penghantaran yang boleh dipercayai.',
      warnings: [],
      warningsMs: [],
      estimatedRuntimeMinutes: runtime,
    };
  }
  
  // Rule 3: Medium lists (301-800) → Balanced with note
  if (recipientCount > 300 && recipientCount <= 800) {
    const runtime = calculateEstimatedRuntime(recipientCount, BALANCED_PRESET.settings);
    return {
      presetId: BALANCED_PRESET.id,
      presetName: BALANCED_PRESET.name,
      reason: 'Your list is medium-sized. Balanced settings will deliver safely.',
      reasonMs: 'Senarai anda bersaiz sederhana. Tetapan Seimbang akan menghantar dengan selamat.',
      warnings: recipientCount > 500 
        ? ['Consider splitting into 2 sends if delivery issues occur']
        : [],
      warningsMs: recipientCount > 500 
        ? ['Pertimbangkan untuk membahagikan kepada 2 penghantaran jika berlaku masalah']
        : [],
      estimatedRuntimeMinutes: runtime,
    };
  }
  
  // Rule 4: Large lists (>800)
  // Check if number is healthy enough for High Volume
  const canUseHighVolume = 
    health.riskScore <= 20 && 
    health.uptime24h >= 98 && 
    health.disconnects24h <= 2;
  
  if (canUseHighVolume) {
    const runtime = calculateEstimatedRuntime(recipientCount, HIGH_VOLUME_PRESET.settings);
    return {
      presetId: HIGH_VOLUME_PRESET.id,
      presetName: HIGH_VOLUME_PRESET.name,
      reason: 'Your number is very healthy and can handle high volume. This preset maximizes throughput safely.',
      reasonMs: 'Nombor anda sangat sihat dan boleh mengendalikan volum tinggi. Pratetap ini memaksimumkan penghantaran dengan selamat.',
      warnings: recipientCount > 1500 
        ? ['Very large list - monitor delivery closely and pause if issues arise']
        : [],
      warningsMs: recipientCount > 1500 
        ? ['Senarai sangat besar - pantau penghantaran dengan teliti dan jeda jika berlaku masalah']
        : [],
      estimatedRuntimeMinutes: runtime,
    };
  }
  
  // Large list but number not healthy enough for High Volume
  const runtime = calculateEstimatedRuntime(recipientCount, BALANCED_PRESET.settings);
  return {
    presetId: BALANCED_PRESET.id,
    presetName: BALANCED_PRESET.name,
    reason: 'Your list is large but number health isn\'t optimal for High Volume. Balanced settings are safer.',
    reasonMs: 'Senarai anda besar tetapi kesihatan nombor tidak optimum untuk Volum Tinggi. Tetapan Seimbang lebih selamat.',
    warnings: [
      'Large list on medium health - consider splitting into multiple broadcasts',
      'Improve number health before using High Volume preset'
    ],
    warningsMs: [
      'Senarai besar dengan kesihatan sederhana - pertimbangkan untuk membahagikan kepada beberapa siaran',
      'Tingkatkan kesihatan nombor sebelum menggunakan pratetap Volum Tinggi'
    ],
    estimatedRuntimeMinutes: runtime,
  };
}

/**
 * Get recommendation for Safety page (no recipient count needed)
 * Based purely on number health
 */
export function recommendPresetForSafety(health: NumberHealth): {
  presetId: string;
  presetName: string;
  reason: string;
  reasonMs: string;
} {
  if (health.riskScore > 40 || health.disconnects24h >= 5 || health.uptime24h < 97) {
    return {
      presetId: SAFE_WARMUP_PRESET.id,
      presetName: SAFE_WARMUP_PRESET.name,
      reason: 'Your number shows signs of stress. Use Safe Warm-Up to protect your account.',
      reasonMs: 'Nombor anda menunjukkan tanda-tanda tekanan. Gunakan Pemanasan Selamat untuk melindungi akaun anda.',
    };
  }
  
  if (health.riskScore <= 20 && health.uptime24h >= 98 && health.disconnects24h <= 2) {
    return {
      presetId: HIGH_VOLUME_PRESET.id,
      presetName: HIGH_VOLUME_PRESET.name,
      reason: 'Your number is very healthy. High Volume is available for large campaigns.',
      reasonMs: 'Nombor anda sangat sihat. Volum Tinggi tersedia untuk kempen besar.',
    };
  }
  
  return {
    presetId: BALANCED_PRESET.id,
    presetName: BALANCED_PRESET.name,
    reason: 'Your number health is stable. Balanced settings are recommended for most campaigns.',
    reasonMs: 'Kesihatan nombor anda stabil. Tetapan Seimbang disyorkan untuk kebanyakan kempen.',
  };
}
