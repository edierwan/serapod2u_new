// WhatsApp Broadcast Safety - Internationalization (EN/BM)

export type SafetyLanguage = 'en' | 'ms';

export interface SafetyTranslations {
  // Page header
  pageTitle: string;
  pageSubtitle: string;
  
  // Presets section
  presets: {
    title: string;
    selectLabel: string;
    systemBadge: string;
    customBadge: string;
    lockedTooltip: string;
    appliedToast: string;
    saveAsPreset: string;
    managePresets: string;
    customChanges: string;
    saveChanges: string;
  };
  
  // Preset names and descriptions
  presetLabels: {
    safeWarmup: string;
    safeWarmupDesc: string;
    balanced: string;
    balancedDesc: string;
    highVolume: string;
    highVolumeDesc: string;
  };
  
  // Info box
  antiBanGuardrails: {
    title: string;
    description: string;
    tips: string[];
  };
  
  // Warm-up mode
  warmUpMode: {
    title: string;
    description: string;
    enabled: string;
    disabled: string;
  };
  
  // Volume caps
  volumeCaps: {
    title: string;
    dailyCap: string;
    dailyCapDesc: string;
    rolling24h: string;
    rolling24hDesc: string;
    perDay: string;
    per24h: string;
  };
  
  // Session cooling
  sessionCooling: {
    title: string;
    burstSize: string;
    burstSizeDesc: string;
    cooldown: string;
    cooldownDesc: string;
    maxRuntime: string;
    maxRuntimeDesc: string;
    restAfter: string;
    minutes: string;
  };
  
  // Delivery speed
  deliverySpeed: {
    title: string;
    throttle: string;
    throttleDesc: string;
    jitter: string;
    jitterDesc: string;
    msgsPerMin: string;
    seconds: string;
    to: string;
  };
  
  // Engagement guard
  engagementGuard: {
    title: string;
    minReplyRate: string;
    minReplyRateDesc: string;
    optOutSpike: string;
    optOutSpikeDesc: string;
    pauseIfBelow: string;
    pauseIfAbove: string;
  };
  
  // Content fingerprint
  contentFingerprint: {
    title: string;
    blockShorteners: string;
    blockShortenersDesc: string;
    requirePersonalization: string;
    requirePersonalizationDesc: string;
    maxEmojis: string;
    maxCaps: string;
    maxLinks: string;
  };
  
  // Global enforcements
  globalEnforcements: {
    title: string;
    quietHours: string;
    quietHoursDesc: string;
    quietHoursTime: string;
    strictOptOut: string;
    strictOptOutDesc: string;
    failureAutoPause: string;
    failureAutoPauseDesc: string;
    alwaysOn: string;
  };
  
  // Number health
  numberHealth: {
    title: string;
    riskScore: string;
    uptime: string;
    disconnects: string;
    successRate: string;
    lastIssue: string;
    healthy: string;
    warning: string;
    critical: string;
  };
  
  // Advisor
  advisor: {
    title: string;
    recommendation: string;
    recommendedPreset: string;
    applyRecommended: string;
    viewWhy: string;
    estimatedRuntime: string;
    warnings: string;
    basedOnHealth: string;
    basedOnList: string;
  };
  
  // Save preset modal
  savePresetModal: {
    title: string;
    nameLabel: string;
    namePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    setAsDefault: string;
    setAsDefaultDesc: string;
    save: string;
    cancel: string;
    saving: string;
  };
  
  // Manage presets modal
  managePresetsModal: {
    title: string;
    systemPresets: string;
    customPresets: string;
    noCustomPresets: string;
    edit: string;
    delete: string;
    deleteConfirm: string;
    close: string;
  };
  
  // Common actions
  actions: {
    save: string;
    saving: string;
    cancel: string;
    apply: string;
    edit: string;
    delete: string;
    close: string;
    reset: string;
  };
  
  // Status messages
  messages: {
    settingsSaved: string;
    settingsSavedDesc: string;
    presetApplied: string;
    presetCreated: string;
    presetUpdated: string;
    presetDeleted: string;
    error: string;
    errorSaving: string;
  };

  // Language switcher
  language: {
    label: string;
    en: string;
    ms: string;
  };
}

export const translations: Record<SafetyLanguage, SafetyTranslations> = {
  en: {
    pageTitle: 'Safety Settings',
    pageSubtitle: 'Configure anti-ban guardrails to protect your WhatsApp number. These presets reduce ban risk on Baileys gateway.',
    
    presets: {
      title: 'Safety Presets',
      selectLabel: 'Select a preset',
      systemBadge: 'System',
      customBadge: 'Custom',
      lockedTooltip: 'System presets cannot be modified',
      appliedToast: 'Preset applied',
      saveAsPreset: 'Save as Preset',
      managePresets: 'Manage Presets',
      customChanges: 'Custom changes (unsaved)',
      saveChanges: 'Save as new preset',
    },
    
    presetLabels: {
      safeWarmup: 'Safe Warm-Up',
      safeWarmupDesc: 'Lowest risk, slow and steady. For new numbers or when health is concerning.',
      balanced: 'Balanced',
      balancedDesc: 'Best for most campaigns. Good balance between speed and safety.',
      highVolume: 'High Volume',
      highVolumeDesc: 'For big lists — only when number is very healthy.',
    },
    
    antiBanGuardrails: {
      title: 'Baileys Anti-Ban Guardrails',
      description: 'WhatsApp Baileys gateway simulates a real phone. Unlike Cloud API, it requires strict "human behavior" patterns to avoid bans.',
      tips: [
        'Never send thousands of messages instantly. Use Warm-Up Mode for new numbers.',
        'Ensure Session Cooling is active to let the phone "rest".',
        'High opt-outs or low reply rates are dangerous signals.',
      ],
    },
    
    warmUpMode: {
      title: 'Warm-Up Mode (Auto Profiles)',
      description: 'Automatically sets safe limits for numbers based on their maturity age. Recommended for numbers paired less than 14 days ago.',
      enabled: 'Enabled',
      disabled: 'Disabled',
    },
    
    volumeCaps: {
      title: 'Volume Caps',
      dailyCap: 'Daily Send Cap',
      dailyCapDesc: 'Maximum messages per day',
      rolling24h: 'Rolling 24h Cap',
      rolling24hDesc: 'Maximum messages in any 24-hour window',
      perDay: '/ day',
      per24h: '/ 24h',
    },
    
    sessionCooling: {
      title: 'Session Cooling',
      burstSize: 'Burst Size',
      burstSizeDesc: 'Send this many, then rest',
      cooldown: 'Cooldown',
      cooldownDesc: 'Rest period between bursts',
      maxRuntime: 'Max Runtime',
      maxRuntimeDesc: 'Maximum continuous sending time',
      restAfter: 'Rest after',
      minutes: 'min',
    },
    
    deliverySpeed: {
      title: 'Delivery Speed',
      throttle: 'Throttle',
      throttleDesc: 'Messages per minute',
      jitter: 'Random Jitter Delay',
      jitterDesc: 'Adds random delay between messages to behave more human-like',
      msgsPerMin: '/ min',
      seconds: 's',
      to: 'to',
    },
    
    engagementGuard: {
      title: 'Engagement Guard',
      minReplyRate: 'Min Reply Rate',
      minReplyRateDesc: 'Pause campaign if replies drop below this',
      optOutSpike: 'Opt-out Spike',
      optOutSpikeDesc: 'Pause if opt-outs exceed this in 30 minutes',
      pauseIfBelow: 'Pause if below',
      pauseIfAbove: 'Pause if above',
    },
    
    contentFingerprint: {
      title: 'Content Fingerprint',
      blockShorteners: 'Block URL Shorteners',
      blockShortenersDesc: 'Prevent bit.ly, tinyurl, etc. (spam signal)',
      requirePersonalization: 'Require Personalization',
      requirePersonalizationDesc: 'Messages must include recipient name or variable',
      maxEmojis: 'Max Emojis',
      maxCaps: 'Max CAPS %',
      maxLinks: 'Max Links',
    },
    
    globalEnforcements: {
      title: 'Global Enforcements',
      quietHours: 'Quiet Hours',
      quietHoursDesc: 'No sending during rest hours',
      quietHoursTime: '10 PM - 9 AM',
      strictOptOut: 'Strict Opt-Out',
      strictOptOutDesc: 'Auto-block if recipient says "STOP"',
      failureAutoPause: 'Failure Auto-Pause',
      failureAutoPauseDesc: 'Pause campaign if failure rate exceeds this',
      alwaysOn: 'Always ON',
    },
    
    numberHealth: {
      title: 'Number Health',
      riskScore: 'Risk Score',
      uptime: 'Uptime (24h)',
      disconnects: 'Disconnects',
      successRate: 'Success Rate',
      lastIssue: 'Last Issue',
      healthy: 'Healthy',
      warning: 'Warning',
      critical: 'Critical',
    },
    
    advisor: {
      title: 'Safety Advisor',
      recommendation: 'Recommendation',
      recommendedPreset: 'Recommended Preset',
      applyRecommended: 'Apply Recommended',
      viewWhy: 'Why?',
      estimatedRuntime: 'Estimated Runtime',
      warnings: 'Things to consider',
      basedOnHealth: 'Based on your number health',
      basedOnList: 'Based on your list size and number health',
    },
    
    savePresetModal: {
      title: 'Save as Custom Preset',
      nameLabel: 'Preset Name',
      namePlaceholder: 'e.g., My Campaign Settings',
      descriptionLabel: 'Description (optional)',
      descriptionPlaceholder: 'Describe when to use this preset',
      setAsDefault: 'Set as default preset',
      setAsDefaultDesc: 'New campaigns will use this preset by default',
      save: 'Save Preset',
      cancel: 'Cancel',
      saving: 'Saving...',
    },
    
    managePresetsModal: {
      title: 'Manage Presets',
      systemPresets: 'System Presets',
      customPresets: 'Your Custom Presets',
      noCustomPresets: 'No custom presets yet. Save your settings as a preset to see it here.',
      edit: 'Edit',
      delete: 'Delete',
      deleteConfirm: 'Are you sure you want to delete this preset?',
      close: 'Close',
    },
    
    actions: {
      save: 'Save',
      saving: 'Saving...',
      cancel: 'Cancel',
      apply: 'Apply',
      edit: 'Edit',
      delete: 'Delete',
      close: 'Close',
      reset: 'Reset',
    },
    
    messages: {
      settingsSaved: 'Settings Saved',
      settingsSavedDesc: 'Safety settings have been applied to all active campaigns.',
      presetApplied: 'Preset applied successfully',
      presetCreated: 'Custom preset created',
      presetUpdated: 'Preset updated',
      presetDeleted: 'Preset deleted',
      error: 'Error',
      errorSaving: 'Failed to save settings',
    },

    language: {
      label: 'Language',
      en: 'English',
      ms: 'Bahasa Malaysia',
    },
  },
  
  ms: {
    pageTitle: 'Tetapan Keselamatan',
    pageSubtitle: 'Konfigurasikan perlindungan anti-sekatan untuk melindungi nombor WhatsApp anda. Pratetap ini mengurangkan risiko sekatan pada gateway Baileys.',
    
    presets: {
      title: 'Pratetap Keselamatan',
      selectLabel: 'Pilih pratetap',
      systemBadge: 'Sistem',
      customBadge: 'Tersuai',
      lockedTooltip: 'Pratetap sistem tidak boleh diubah',
      appliedToast: 'Pratetap digunakan',
      saveAsPreset: 'Simpan sebagai Pratetap',
      managePresets: 'Urus Pratetap',
      customChanges: 'Perubahan tersuai (belum disimpan)',
      saveChanges: 'Simpan sebagai pratetap baharu',
    },
    
    presetLabels: {
      safeWarmup: 'Pemanasan Selamat',
      safeWarmupDesc: 'Risiko paling rendah, perlahan dan stabil. Untuk nombor baharu atau apabila kesihatan membimbangkan.',
      balanced: 'Seimbang',
      balancedDesc: 'Terbaik untuk kebanyakan kempen. Keseimbangan baik antara kelajuan dan keselamatan.',
      highVolume: 'Volum Tinggi',
      highVolumeDesc: 'Untuk senarai besar — hanya apabila nombor sangat sihat.',
    },
    
    antiBanGuardrails: {
      title: 'Perlindungan Anti-Sekatan Baileys',
      description: 'Gateway WhatsApp Baileys mensimulasikan telefon sebenar. Tidak seperti Cloud API, ia memerlukan corak "tingkah laku manusia" yang ketat untuk mengelakkan sekatan.',
      tips: [
        'Jangan hantar beribu-ribu mesej sekaligus. Gunakan Mod Pemanasan untuk nombor baharu.',
        'Pastikan Penyejukan Sesi aktif untuk membiarkan telefon "berehat".',
        'Kadar keluar atau kadar balasan rendah adalah isyarat berbahaya.',
      ],
    },
    
    warmUpMode: {
      title: 'Mod Pemanasan (Profil Auto)',
      description: 'Menetapkan had selamat secara automatik berdasarkan usia kematangan nombor. Disyorkan untuk nombor yang dipasangkan kurang dari 14 hari.',
      enabled: 'Diaktifkan',
      disabled: 'Dinyahaktifkan',
    },
    
    volumeCaps: {
      title: 'Had Volum',
      dailyCap: 'Had Harian',
      dailyCapDesc: 'Maksimum mesej sehari',
      rolling24h: 'Had 24 Jam Bergolek',
      rolling24hDesc: 'Maksimum mesej dalam mana-mana tempoh 24 jam',
      perDay: '/ hari',
      per24h: '/ 24j',
    },
    
    sessionCooling: {
      title: 'Penyejukan Sesi',
      burstSize: 'Saiz Ledakan',
      burstSizeDesc: 'Hantar sebanyak ini, kemudian berehat',
      cooldown: 'Penyejukan',
      cooldownDesc: 'Tempoh rehat antara ledakan',
      maxRuntime: 'Masa Maksimum',
      maxRuntimeDesc: 'Masa penghantaran berterusan maksimum',
      restAfter: 'Rehat selepas',
      minutes: 'min',
    },
    
    deliverySpeed: {
      title: 'Kelajuan Penghantaran',
      throttle: 'Pendikit',
      throttleDesc: 'Mesej seminit',
      jitter: 'Kelewatan Rawak',
      jitterDesc: 'Menambah kelewatan rawak antara mesej untuk berkelakuan lebih seperti manusia',
      msgsPerMin: '/ min',
      seconds: 's',
      to: 'hingga',
    },
    
    engagementGuard: {
      title: 'Pengawal Penglibatan',
      minReplyRate: 'Kadar Balasan Min',
      minReplyRateDesc: 'Jeda kempen jika balasan jatuh di bawah ini',
      optOutSpike: 'Lonjakan Keluar',
      optOutSpikeDesc: 'Jeda jika keluar melebihi ini dalam 30 minit',
      pauseIfBelow: 'Jeda jika bawah',
      pauseIfAbove: 'Jeda jika atas',
    },
    
    contentFingerprint: {
      title: 'Cap Jari Kandungan',
      blockShorteners: 'Sekat Pemendek URL',
      blockShortenersDesc: 'Halang bit.ly, tinyurl, dll. (isyarat spam)',
      requirePersonalization: 'Perlu Pemperibadian',
      requirePersonalizationDesc: 'Mesej mesti termasuk nama penerima atau pemboleh ubah',
      maxEmojis: 'Emoji Maks',
      maxCaps: 'HURUF BESAR Maks %',
      maxLinks: 'Pautan Maks',
    },
    
    globalEnforcements: {
      title: 'Penguatkuasaan Global',
      quietHours: 'Waktu Senyap',
      quietHoursDesc: 'Tiada penghantaran semasa waktu rehat',
      quietHoursTime: '10 MLM - 9 PG',
      strictOptOut: 'Keluar Ketat',
      strictOptOutDesc: 'Auto-sekat jika penerima kata "STOP"',
      failureAutoPause: 'Jeda Auto Kegagalan',
      failureAutoPauseDesc: 'Jeda kempen jika kadar kegagalan melebihi ini',
      alwaysOn: 'Sentiasa AKTIF',
    },
    
    numberHealth: {
      title: 'Kesihatan Nombor',
      riskScore: 'Skor Risiko',
      uptime: 'Uptime (24j)',
      disconnects: 'Pemutusan',
      successRate: 'Kadar Kejayaan',
      lastIssue: 'Isu Terakhir',
      healthy: 'Sihat',
      warning: 'Amaran',
      critical: 'Kritikal',
    },
    
    advisor: {
      title: 'Penasihat Keselamatan',
      recommendation: 'Cadangan',
      recommendedPreset: 'Pratetap Disyorkan',
      applyRecommended: 'Guna Cadangan',
      viewWhy: 'Kenapa?',
      estimatedRuntime: 'Anggaran Masa',
      warnings: 'Perkara untuk dipertimbangkan',
      basedOnHealth: 'Berdasarkan kesihatan nombor anda',
      basedOnList: 'Berdasarkan saiz senarai dan kesihatan nombor anda',
    },
    
    savePresetModal: {
      title: 'Simpan sebagai Pratetap Tersuai',
      nameLabel: 'Nama Pratetap',
      namePlaceholder: 'cth., Tetapan Kempen Saya',
      descriptionLabel: 'Penerangan (pilihan)',
      descriptionPlaceholder: 'Terangkan bila untuk menggunakan pratetap ini',
      setAsDefault: 'Tetapkan sebagai pratetap lalai',
      setAsDefaultDesc: 'Kempen baharu akan menggunakan pratetap ini secara lalai',
      save: 'Simpan Pratetap',
      cancel: 'Batal',
      saving: 'Menyimpan...',
    },
    
    managePresetsModal: {
      title: 'Urus Pratetap',
      systemPresets: 'Pratetap Sistem',
      customPresets: 'Pratetap Tersuai Anda',
      noCustomPresets: 'Tiada pratetap tersuai lagi. Simpan tetapan anda sebagai pratetap untuk melihatnya di sini.',
      edit: 'Edit',
      delete: 'Padam',
      deleteConfirm: 'Adakah anda pasti mahu memadam pratetap ini?',
      close: 'Tutup',
    },
    
    actions: {
      save: 'Simpan',
      saving: 'Menyimpan...',
      cancel: 'Batal',
      apply: 'Guna',
      edit: 'Edit',
      delete: 'Padam',
      close: 'Tutup',
      reset: 'Set Semula',
    },
    
    messages: {
      settingsSaved: 'Tetapan Disimpan',
      settingsSavedDesc: 'Tetapan keselamatan telah digunakan pada semua kempen aktif.',
      presetApplied: 'Pratetap berjaya digunakan',
      presetCreated: 'Pratetap tersuai dicipta',
      presetUpdated: 'Pratetap dikemas kini',
      presetDeleted: 'Pratetap dipadam',
      error: 'Ralat',
      errorSaving: 'Gagal menyimpan tetapan',
    },

    language: {
      label: 'Bahasa',
      en: 'English',
      ms: 'Bahasa Malaysia',
    },
  },
};

// Get translation by language
export function getTranslations(lang: SafetyLanguage): SafetyTranslations {
  return translations[lang] || translations.en;
}
