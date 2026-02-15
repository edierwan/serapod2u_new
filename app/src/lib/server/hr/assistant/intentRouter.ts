/**
 * HR Assistant — Intent Router + Language Detection
 *
 * Takes a raw user message (BM or EN) and returns:
 *   - The most likely intent (maps to a tool or action)
 *   - Detected language (ms | en)
 *   - Extracted parameters
 */
import 'server-only'
import { type ToolName } from './tools'

// ─── Types ─────────────────────────────────────────────────────────

export type Lang = 'ms' | 'en'

export interface IntentResult {
  lang: Lang
  intent: ToolName | 'general' | 'casual'
  confidence: 'high' | 'medium' | 'low'
  /** Optional parameter extracted from message */
  params?: Record<string, string>
}

// ─── Malay Indicators ──────────────────────────────────────────────

/** Words/phrases that strongly indicate Malay input */
const BM_INDICATORS = [
  'senarai',
  'berapa',
  'tiada',
  'mana',
  'macam',
  'boleh',
  'tak',
  'tidak',
  'tolong',
  'nak',
  'kena',
  'semua',
  'siapa',
  'kenapa',
  'bagaimana',
  'pekerja',
  'jabatan',
  'gaji',
  'cuti',
  'kehadiran',
  'jawatan',
  'pengurus',
  'syarikat',
  'jumlah',
  'setup',
  'tetapan',
  'masalah',
  'audit',
  'laporkan',
  'laporan',
  'belum',
  'ada',
  'banyak',
  'dalam',
  'untuk',
  'dengan',
  'dan',
  'atau',
  'yang',
  'ini',
  'itu',
  'ke',
  'di',
  'dari',
]

// ─── Language Detection ────────────────────────────────────────────

export function detectLang(text: string): Lang {
  const lower = text.toLowerCase()
  const words = lower.split(/\s+/)

  let bmScore = 0
  for (const word of words) {
    if (BM_INDICATORS.includes(word)) bmScore++
  }

  // If > 20% of words are clearly Malay, classify as BM
  return bmScore / Math.max(words.length, 1) > 0.15 ? 'ms' : 'en'
}

// ─── Intent Patterns ───────────────────────────────────────────────

interface IntentPattern {
  tool: ToolName | 'general' | 'casual'
  /** Keywords/phrases to match (BM + EN). Any match triggers. */
  patterns: RegExp[]
  /** Higher = preferred if multiple patterns match */
  priority: number
}

const INTENT_PATTERNS: IntentPattern[] = [
  // ── Casual / Chitchat / Greetings ─────────────────────────────
  {
    tool: 'casual',
    patterns: [
      // Greetings
      /^\s*(hi|hello|hey|helo|hye|assalamualaikum|salam|morning|pagi|petang|malam|good\s*(morning|afternoon|evening))\s*[!?.]*\s*$/i,
      // "Can I ask?" openers
      /^\s*(boleh\s*(tanya|tanye)|nak\s*tanya|can\s*i\s*ask|may\s*i\s*ask)\s*(tak|x|ke|kah)?\s*[?!.]*\s*$/i,
      // Short casual (2 words or less, no HR keywords)
      /^\s*(thanks|terima\s*kasih|tq|ok|okay|okla|baik|noted|faham|understood|bye|selamat\s*tinggal)\s*[!?.]*\s*$/i,
      // "How are you" type
      /^\s*(apa\s*khabar|how\s*are\s*you|macam\s*mana|sihat\s*tak|how's\s*it\s*going)\s*[?!.]*\s*$/i,
      // "What can you do" type
      /^\s*(apa\s*(awak|kau|you)\s*boleh\s*(buat|tolong)|what\s*can\s*you\s*do|what\s*are\s*you|awak\s*ni\s*apa)\s*[?!.]*\s*$/i,
      // Confirmations / acknowledgments
      /^\s*(ya|yes|yep|yup|ha'?ah|betul|correct|right|sure|boleh)\s*[!?.]*\s*$/i,
      // Meta questions about the bot / status
      /^\s*(kenapa|why|apasal)\s*(offline|down|tak\s*(boleh|dapat|jalan)|error|rosak)\s*[?!.]*\s*$/i,
      // General non-HR small talk (short messages with no HR keywords)
      /^\s*(test|testing|hello\s*there|anybody\s*there|ada\s*orang\s*(tak|x)?|sesiapa|hoi)\s*[?!.]*\s*$/i,
      // General about topics (pasal hal, about something non-HR)
      /^\s*(pasal|about|tentang)\s+(hal|benda|perkara|thing|stuff|dunia|world)\s*/i,
    ],
    priority: 15, // Higher than all HR intents so greetings always win
  },

  // Missing Manager
  {
    tool: 'employeesMissingManager',
    patterns: [
      /\b(missing|tiada|takde|tak\s*ada|belum)\b.*\b(manager|pengurus|ketua)\b/i,
      /\b(manager|pengurus|ketua)\b.*\b(missing|tiada|takde|tak\s*ada|belum|kosong)\b/i,
      /\b(no|tanpa)\s+(manager|pengurus)\b/i,
      /\b(siapa|sapa)\b.*\btak.*manager\b/i,
      /\bpekerja.*tanpa.*pengurus\b/i,
      /\b(siapa|sapa|who)\b.*\b(takde|tiada|tak\s*ada|belum\s*ada|no|without)\b.*\b(manager|pengurus|ketua)\b/i,
      /\bstaff\b.*\b(takde|tiada|belum|no|missing)\b.*\b(manager|pengurus|ketua)\b/i,
    ],
    priority: 10,
  },

  // Missing Position
  {
    tool: 'employeesMissingPosition',
    patterns: [
      /\b(missing|tiada|takde|tak\s*ada|belum)\b.*\b(position|jawatan|title)\b/i,
      /\b(position|jawatan|title)\b.*\b(missing|tiada|takde|tak\s*ada|belum|kosong)\b/i,
      /\b(no|tanpa)\s+(position|jawatan)\b/i,
      /\b(siapa|sapa|who)\b.*\b(takde|tiada|tak\s*ada|belum\s*ada|no|without)\b.*\b(position|jawatan)\b/i,
      /\b(check|cek|boleh\s*tahu)\b.*\b(position|jawatan)\b.*\b(tiada|takde|belum|missing|kosong)\b/i,
      /\bstaff\b.*\b(takde|tiada|belum|no|missing)\b.*\b(position|jawatan)\b/i,
    ],
    priority: 10,
  },

  // Departments Missing Manager
  {
    tool: 'departmentsMissingManager',
    patterns: [
      /\b(department|jabatan)\b.*\b(missing|tiada|takde|tak\s*ada|belum)\b.*\b(manager|pengurus|ketua)\b/i,
      /\b(department|jabatan)\b.*\b(no|tanpa)\s+(manager|pengurus)\b/i,
      /\bjabatan.*takde.*pengurus\b/i,
    ],
    priority: 12,
  },

  // List Departments
  {
    tool: 'listDepartments',
    patterns: [
      /\b(list|senarai|show|tunjuk)\b.*\b(department|jabatan)\b/i,
      /\b(all|semua)\b.*\b(department|jabatan)\b/i,
      /\bjabatan\s*(apa|mana)\b/i,
      /\bberapa\b.*\bjabatan\b/i,
    ],
    priority: 5,
  },

  // List Positions
  {
    tool: 'listPositions',
    patterns: [
      /\b(list|senarai|show|tunjuk)\b.*\b(position|jawatan|title|job)\b/i,
      /\b(all|semua)\b.*\b(position|jawatan)\b/i,
      /\bjawatan\s*(apa|mana)\b/i,
    ],
    priority: 5,
  },

  // Org Summary
  {
    tool: 'orgSummary',
    patterns: [
      /\b(org(anization)?|syarikat|company)\s+(summary|overview|ringkasan)\b/i,
      /\b(headcount|jumlah\s+pekerja|berapa\s+(ramai|orang|pekerja))\b/i,
      /\b(how\s+many|berapa)\s+(employee|staff|pekerja|worker)\b/i,
      /\b(total)\s+(employee|staff|pekerja)\b/i,
    ],
    priority: 5,
  },

  // HR Config Audit
  {
    tool: 'hrConfigAudit',
    patterns: [
      /\b(audit|semak|check)\s+(hr|config|setup|configuration|tetapan)\b/i,
      /\b(hr)\s+(audit|readiness|status|health|setting|settings|configuration|config)\b/i,
      /\b(config(uration)?|tetapan)\s+(audit|semak|check|status)\b/i,
      /\b(what.*missing|apa.*belum|apa.*kurang)\b.*\b(hr|setup|config)\b/i,
      /\b(hr|config|setup|setting)\b.*\b(complet|ready|siap|done|lengkap)\b/i,
      /\b(setting|settings|tetapan)\b.*\b(hr|pekerja)\b/i,
      /\b(check|semak)\b.*\b(setting|config|setup)\b/i,
      /\b(is|does|adakah)\b.*\b(setting|configuration|setup|hr)\b.*\b(complet|ready|done|ok)\b/i,
      /\bcritical\s*(issue|masalah)\b/i,
      /\bshow\b.*\b(all|semua)\b.*\b(issue|masalah|problem|missing)\b/i,
      /\bmissing\b.*\b(config|setup|setting|before|payroll)\b/i,
    ],
    priority: 8,
  },

  // Payroll Setup
  {
    tool: 'payrollSetupStatus',
    patterns: [
      /\b(payroll|gaji)\s+(setup|status|semak|check|readiness)\b/i,
      /\b(setup|status)\s+(payroll|gaji)\b/i,
      /\b(payroll|gaji)\b.*\b(ok|ready|siap|configured)\b/i,
      /\b(salary\s+band|elaun|potongan|allowance|deduction)\s+(status|setup)\b/i,
    ],
    priority: 8,
  },

  // Salary Info (gated)
  {
    tool: 'salaryInfo',
    patterns: [
      /\b(salary|gaji|compensation|pendapatan)\b.*\b(info|detail|senarai|list|data|maklumat)\b/i,
      /\b(berapa|how\s+much)\b.*\b(gaji|salary)\b/i,
      /\b(gaji|salary)\b.*\b(siapa|who|semua|all)\b/i,
    ],
    priority: 12,
  },

  // Leave Types
  {
    tool: 'leaveTypesSummary',
    patterns: [
      /\b(leave|cuti)\s+(type|jenis|senarai|list|setup)\b/i,
      /\b(jenis|type)\s+(cuti|leave)\b/i,
      /\b(senarai|list)\s+(cuti|leave)\b/i,
      /\bcuti\s*(apa|berapa)\b/i,
    ],
    priority: 6,
  },

  // Attendance
  {
    tool: 'attendanceSummary',
    patterns: [
      /\b(attendance|kehadiran)\s+(setup|status|summary|ringkasan|semak)\b/i,
      /\b(shift|syif)\s+(setup|status|senarai)\b/i,
      /\b(overtime|lebih\s*masa|OT)\s+(polic|setup|status)\b/i,
    ],
    priority: 6,
  },

  // Leave Balance
  {
    tool: 'leaveBalance',
    patterns: [
      /\b(baki|balance|remaining|sisa)\s*(cuti|leave)\b/i,
      /\b(cuti|leave)\s*(baki|balance|remaining|tinggal|left)\b/i,
      /\b(berapa|how\s*(many|much))\s*(hari|day)?\s*(cuti|leave)\s*(lagi|left|tinggal|ada|remaining)?\b/i,
      /\b(cuti|leave)\b.*\b(berapa|how\s*many)\s*(hari|day)?\s*(lagi|left|ada)?\b/i,
      /\b(entitlement|kelayakan)\s*(cuti|leave)\b/i,
    ],
    priority: 10,
  },

  // My Leave Requests
  {
    tool: 'myLeaveRequests',
    patterns: [
      /\b(my|saya|aku)\s*(leave|cuti)\s*(request|permohonan|application|status)\b/i,
      /\b(permohonan|request|application)\s*(cuti|leave)\s*(saya|aku|my)?\b/i,
      /\b(status|check|semak)\s*(cuti|leave)\s*(saya|aku|my)?\b/i,
      /\b(pending|menunggu)\s*(cuti|leave|approval|kelulusan)\b/i,
      /\b(senarai|list)\s*(permohonan|request)\s*(cuti|leave)\b/i,
    ],
    priority: 9,
  },

  // Public Holidays
  {
    tool: 'publicHolidays',
    patterns: [
      /\b(cuti|holiday)\s*(umum|public|am)\b/i,
      /\b(public)\s*(holiday)\b/i,
      /\b(hari|day)\s*(kelepasan|cuti)\s*(umum|am|public)\b/i,
      /\b(bila|when|tarikh|date)\s*(cuti|holiday)\s*(umum|public|seterusnya|next|akan\s*datang|upcoming)?\b/i,
      /\b(cuti|holiday)\s*(akan\s*datang|upcoming|next|seterusnya)\b/i,
      /\b(long\s*weekend|hujung\s*minggu\s*panjang)\b/i,
    ],
    priority: 8,
  },

  // Payroll Date / Salary Date
  {
    tool: 'payrollDateInfo',
    patterns: [
      /\b(bila|when|tarikh|date)\s*(gaji|salary|payroll|pay)\s*(masuk|in|keluar|out|next)?\b/i,
      /\b(gaji|salary|pay)\s*(bila|when|tarikh|date)\s*(masuk|keluar|next)?\b/i,
      /\b(payroll)\s*(run|date|jadual|schedule|status)\b/i,
      /\b(gaji)\s*(masuk|dah|sudah|belum)\b/i,
      /\b(pay\s*day|hari\s*gaji)\b/i,
      /\b(dah|sudah|already)\s*(bayar|process|proses)\s*(gaji|payroll|salary)?\b/i,
    ],
    priority: 10,
  },

  // Apply Leave
  {
    tool: 'applyLeave',
    patterns: [
      /\b(apply|mohon|nak\s*mohon|nak\s*apply|minta)\s*(cuti|leave)\b/i,
      /\b(cuti|leave)\s*(apply|mohon|application|permohonan)\b/i,
      /\b(nak|mahu|want)\s*(ambil|take)\s*(cuti|leave|off|day\s*off)\b/i,
      /\b(macam\s*mana|how)\s*(nak|to)\s*(mohon|apply|ambil|take)\s*(cuti|leave)\b/i,
      /\b(boleh|can)\s*(mohon|apply|ambil|take)\s*(cuti|leave)\b/i,
    ],
    priority: 9,
  },

  // Employee Search (by name)
  {
    tool: 'employeeSearch',
    patterns: [
      /\b(cari|search|find)\s*(pekerja|employee|staff|orang)\b/i,
      /\b(siapa|who)\s*(nama|name)?\s*(pekerja|employee|staff)?\b.*\b(tiada|missing|takde|tak\s*ada)\b/i,
    ],
    priority: 7,
  },
]

// ─── Route Intent ──────────────────────────────────────────────────

export function routeIntent(text: string): IntentResult {
  const lang = detectLang(text)

  const matches: Array<{ tool: ToolName | 'general' | 'casual'; priority: number }> = []
  for (const pattern of INTENT_PATTERNS) {
    if (pattern.patterns.some((p) => p.test(text))) {
      matches.push({ tool: pattern.tool, priority: pattern.priority })
    }
  }

  // Sort by priority (descending) and pick the best
  matches.sort((a, b) => b.priority - a.priority)

  if (matches.length === 0) {
    return { lang, intent: 'general', confidence: 'low' }
  }

  const best = matches[0]
  const confidence: IntentResult['confidence'] =
    matches.length === 1
      ? 'high'
      : best.priority > matches[1].priority
        ? 'high'
        : 'medium'

  return { lang, intent: best.tool, confidence }
}

// ─── Casual Response Templates ─────────────────────────────────────

interface CasualTemplate {
  patterns: RegExp[]
  ms: string[]
  en: string[]
}

const CASUAL_TEMPLATES: CasualTemplate[] = [
  {
    patterns: [/boleh\s*(tanya|tanye)/i, /nak\s*tanya/i, /can\s*i\s*ask/i, /may\s*i\s*ask/i],
    ms: [
      'Boleh, tanya je. Nak tanya pasal apa? 😊',
      'Boleh boleh! Nak tahu pasal apa? Saya sedia membantu.',
      'Mestilah boleh! Tanya apa-apa je — saya cuba bantu.',
    ],
    en: [
      'Sure, go ahead! What would you like to know? 😊',
      'Of course! Ask me anything — I\'ll do my best to help.',
      'Absolutely! What\'s on your mind?',
    ],
  },
  {
    patterns: [/^\s*(hi|hello|hey|helo|hye)\s*[!?.]*\s*$/i],
    ms: [
      'Hi! 👋 Ada apa-apa saya boleh bantu pasal HR?',
      'Hello! Nak tanya pasal pekerja, gaji, cuti, atau HR setting?',
      'Hey! Saya HR Assistant awak. Tanya je apa-apa.',
    ],
    en: [
      'Hi there! 👋 How can I help you with HR today?',
      'Hello! Need help with employees, payroll, leave, or HR settings?',
      'Hey! I\'m your HR Assistant. Ask me anything.',
    ],
  },
  {
    patterns: [/assalamualaikum/i, /salam/i],
    ms: [
      'Waalaikumussalam! 🌙 Ada apa saya boleh bantu?',
      'Waalaikumussalam. Nak tanya pasal HR ke?',
    ],
    en: [
      'Waalaikumussalam! 🌙 How can I help you?',
      'Waalaikumussalam. What would you like to know?',
    ],
  },
  {
    patterns: [/morning|pagi/i],
    ms: ['Selamat pagi! ☀️ Ada apa boleh dibantu hari ni?'],
    en: ['Good morning! ☀️ What can I help you with today?'],
  },
  {
    patterns: [/petang/i, /afternoon/i],
    ms: ['Selamat petang! Ada soalan pasal HR?'],
    en: ['Good afternoon! Any HR questions?'],
  },
  {
    patterns: [/malam/i, /evening/i],
    ms: ['Selamat malam! 🌙 Nak tanya apa?'],
    en: ['Good evening! 🌙 What would you like to know?'],
  },
  {
    patterns: [/apa\s*khabar/i, /how\s*are\s*you/i, /macam\s*mana/i, /sihat/i],
    ms: [
      'Alhamdulillah, saya okay! 😄 Ada apa boleh dibantu?',
      'Khabar baik! Saya sentiasa ready nak bantu. Nak tanya apa?',
    ],
    en: [
      'I\'m doing great, thanks for asking! 😄 How can I help?',
      'All good here! Always ready to help. What do you need?',
    ],
  },
  {
    patterns: [/apa\s*(awak|kau|you)\s*boleh/i, /what\s*can\s*you/i, /awak\s*ni\s*apa/i],
    ms: [
      'Saya HR Assistant! Saya boleh bantu pasal:\n• 👥 Pekerja & jabatan\n• 💰 Gaji & payroll\n• 🏖️ Cuti & kehadiran\n• ⚙️ HR settings & audit\n\nTanya je apa-apa!',
    ],
    en: [
      'I\'m your HR Assistant! I can help with:\n• 👥 Employees & departments\n• 💰 Salary & payroll\n• 🏖️ Leave & attendance\n• ⚙️ HR settings & audit\n\nJust ask!',
    ],
  },
  {
    patterns: [/thanks|terima\s*kasih|tq/i],
    ms: [
      'Sama-sama! 😊 Kalau ada soalan lain, tanya je.',
      'No problem! Kalau perlu apa-apa lagi, saya di sini.',
    ],
    en: [
      'You\'re welcome! 😊 Let me know if you need anything else.',
      'Happy to help! I\'m here if you have more questions.',
    ],
  },
  {
    patterns: [/^\s*(ok|okay|okla|baik|noted|faham|understood)\s*[!?.]*$/i],
    ms: [
      'Okay! Kalau ada apa-apa lagi, tanya je. 👍',
      'Baik, kalau perlu bantuan lain saya di sini.',
    ],
    en: [
      'Got it! Let me know if there\'s anything else. 👍',
      'Okay, I\'m here whenever you need help.',
    ],
  },
  {
    patterns: [/^\s*(ya|yes|yep|yup|ha'?ah|betul|correct|right|sure|boleh)\s*[!?.]*$/i],
    ms: [
      'Okay! Teruskan — nak tanya apa? 😊',
      'Baik! Saya sedia. Tanya je.',
    ],
    en: [
      'Alright! Go ahead — what\'s your question? 😊',
      'Sure thing! I\'m ready. Ask away.',
    ],
  },
  {
    patterns: [/bye|selamat\s*tinggal/i],
    ms: ['Selamat tinggal! Kalau ada soalan nanti, datang je lagi. 👋'],
    en: ['Goodbye! Come back anytime you need help. 👋'],
  },
  {
    patterns: [/^\s*(kenapa|why|apasal)\s*(offline|down|tak\s*(boleh|dapat|jalan)|error|rosak)/i],
    ms: [
      'Saya sebenarnya online je! 😊 Mungkin tadi ada gangguan connection sekejap. Cuba tanya soalan HR — contohnya "berapa ramai pekerja?" atau "status payroll".',
      'Eh, saya ada je ni! 🙋 Mungkin lepas connection kejap tadi. Tanya je apa-apa pasal HR, saya cuba bantu.',
    ],
    en: [
      'I\'m actually online! 😊 There might have been a brief connection hiccup. Try asking an HR question — like "how many employees?" or "payroll status".',
      'I\'m right here! 🙋 Might have been a brief glitch. Go ahead and ask me any HR question.',
    ],
  },
  {
    patterns: [/^\s*(pasal|about|tentang)\s+(hal|benda|perkara|thing|stuff|dunia)/i],
    ms: [
      'Hehe, saya ni pakar HR je, bukan pakar hal dunia. 😄 Tapi kalau nak tanya pasal pekerja, gaji, cuti, atau apa-apa HR — memang bidang saya tu!',
      'Wah, hal dunia tu besar sangat untuk saya. 😅 Saya lebih mahir bab HR — gaji, cuti, kehadiran, jabatan. Nak tanya pasal tu?',
    ],
    en: [
      'Haha, I\'m an HR specialist, not a world affairs expert! 😄 But if you need help with employees, salary, leave, or anything HR — that\'s my thing!',
      'That\'s a bit outside my expertise! 😅 I\'m best with HR topics — salary, leave, attendance, departments. Want to ask about those?',
    ],
  },
  {
    patterns: [/^\s*(test|testing|hello\s*there|anybody|ada\s*orang|sesiapa|hoi)\s*[?!.]*$/i],
    ms: [
      'Ada! Saya di sini. 👋 Nak tanya apa?',
      'Saya ada! Test berjaya. 😄 Tanya je soalan HR.',
    ],
    en: [
      'I\'m here! 👋 What would you like to know?',
      'Test successful! 😄 Go ahead and ask your HR question.',
    ],
  },
]

/**
 * Pick a random casual response matching the user message.
 * Returns null if no template matches (shouldn't happen if intent=casual).
 */
export function getCasualResponse(text: string, lang: Lang): string {
  for (const tmpl of CASUAL_TEMPLATES) {
    if (tmpl.patterns.some((p) => p.test(text))) {
      const pool = lang === 'ms' ? tmpl.ms : tmpl.en
      return pool[Math.floor(Math.random() * pool.length)]
    }
  }
  // Fallback
  return lang === 'ms'
    ? 'Boleh! Nak tanya pasal apa? Saya boleh bantu pasal HR. 😊'
    : 'Sure! What would you like to know? I can help with HR topics. 😊'
}
