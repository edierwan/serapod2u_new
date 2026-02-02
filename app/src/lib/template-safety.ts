'use strict';

import crypto from 'crypto';

// ============================================
// TYPES AND INTERFACES
// ============================================

export interface TemplateSafetyResult {
    isValid: boolean;
    riskScore: number;  // 0-100
    riskFlags: RiskFlag[];
    errors: ValidationError[];
    warnings: ValidationWarning[];
    metadata: TemplateMetadata;
}

export interface RiskFlag {
    code: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    suggestion?: string;
}

export interface ValidationError {
    code: string;
    message: string;
    position?: { start: number; end: number };
}

export interface ValidationWarning {
    code: string;
    message: string;
    suggestion?: string;
}

export interface TemplateMetadata {
    linkCount: number;
    linkDomains: string[];
    extractedVariables: string[];
    personalizationTokens: string[];
    characterCount: number;
    emojiCount: number;
    uppercasePercentage: number;
    promoWordCount: number;
    contentHash: string;
    normalizedContentHash: string;
}

export interface TemplateSafetyConfig {
    maxLinks: number;
    maxEmojis: number;
    maxUppercasePercentage: number;
    minPersonalizationTokens: number;
    requiresPersonalization: boolean;
    allowShorteners: boolean;
    allowedDomains: string[];
    strictMode: boolean;  // If true, warnings become errors
    promoWordThreshold: number;  // Max promo words before warning
}

export interface VariationConfig {
    enabled: boolean;
    greetingVariants: string[];
    closingVariants: string[];
    softenerLine?: string;
}

// ============================================
// CONSTANTS
// ============================================

// Supported template variables
export const SUPPORTED_VARIABLES = ['name', 'city', 'points_balance', 'short_link'];

// Personalization variables (subset that indicates personalized content)
export const PERSONALIZATION_VARIABLES = ['name', 'city'];

// Known URL shortener domains to flag
export const SHORTENER_DOMAINS = [
    'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'is.gd', 'goo.gl',
    'ow.ly', 'buff.ly', 'rebrand.ly', 'bl.ink', 'short.io', 'cutt.ly',
    'rb.gy', 'shorturl.at', 'tiny.cc', 'v.gd', 'clck.ru', 'tr.im'
];

// Promotional/spam-like keywords (Malay + English)
export const PROMO_KEYWORDS = [
    // English
    'free', 'discount', 'sale', 'limited', 'offer', 'promo', 'promotion',
    'exclusive', 'urgent', 'hurry', 'act now', 'click now', 'buy now',
    'deal', 'special', 'bonus', 'reward', 'win', 'winner', 'prize',
    'cash', 'money', 'earn', 'income', 'guaranteed', '100%', 'cheap',
    // Malay
    'murah', 'percuma', 'diskaun', 'terhad', 'promosi', 'tawaran',
    'eksklusif', 'segera', 'cepat', 'hadiah', 'menang', 'wang',
    'pendapatan', 'jaminan', 'istimewa', 'bonus'
];

// Default configuration
export const DEFAULT_SAFETY_CONFIG: TemplateSafetyConfig = {
    maxLinks: 1,
    maxEmojis: 8,
    maxUppercasePercentage: 30,
    minPersonalizationTokens: 1,
    requiresPersonalization: true,
    allowShorteners: false,
    allowedDomains: [],
    strictMode: false,
    promoWordThreshold: 3
};

// Default variation config
export const DEFAULT_VARIATION_CONFIG: VariationConfig = {
    enabled: true,
    greetingVariants: [
        'Hi {name},',
        'Hello {name},',
        'Salam {name},',
        'Hey {name},'
    ],
    closingVariants: [
        'Terima kasih.',
        'Thanks!',
        'Thank you.',
        'Appreciate you.'
    ],
    softenerLine: 'Jika tak berminat, reply STOP.'
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Extract all variables from template body
 */
export function extractVariables(body: string): string[] {
    const regex = /\{([a-zA-Z0-9_]+)\}/g;
    const matches: string[] = [];
    let match;
    while ((match = regex.exec(body)) !== null) {
        matches.push(match[1]);
    }
    return [...new Set(matches)];
}

/**
 * Extract all URLs from template body
 */
export function extractUrls(body: string): string[] {
    // Match URLs including those with variable placeholders
    const urlRegex = /https?:\/\/[^\s<>"{}]+/gi;
    const urls = body.match(urlRegex) || [];
    return urls;
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.toLowerCase();
    } catch {
        // Try to extract domain without protocol
        const match = url.match(/(?:https?:\/\/)?([^\/\s]+)/);
        return match ? match[1].toLowerCase() : '';
    }
}

/**
 * Check if URL is an IP address
 */
export function isIpAddress(domain: string): boolean {
    // IPv4
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    // IPv6
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    return ipv4Regex.test(domain) || ipv6Regex.test(domain) || domain === 'localhost';
}

/**
 * Check if domain is a known shortener
 */
export function isShortenerDomain(domain: string): boolean {
    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
    return SHORTENER_DOMAINS.some(shortener => 
        normalizedDomain === shortener || normalizedDomain.endsWith('.' + shortener)
    );
}

/**
 * Count emojis in text
 */
export function countEmojis(text: string): number {
    // Emoji regex pattern
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu;
    const matches = text.match(emojiRegex);
    return matches ? matches.length : 0;
}

/**
 * Calculate uppercase percentage
 */
export function calculateUppercasePercentage(text: string): number {
    const letters = text.match(/[a-zA-Z]/g);
    if (!letters || letters.length === 0) return 0;
    const uppercase = letters.filter(c => c === c.toUpperCase());
    return Math.round((uppercase.length / letters.length) * 100);
}

/**
 * Count promotional keywords
 */
export function countPromoWords(text: string): number {
    const normalizedText = text.toLowerCase();
    let count = 0;
    for (const keyword of PROMO_KEYWORDS) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        const matches = normalizedText.match(regex);
        if (matches) count += matches.length;
    }
    return count;
}

/**
 * Normalize text for comparison (for duplicate detection)
 */
export function normalizeText(text: string): string {
    return text
        .toLowerCase()
        // Remove variables
        .replace(/\{[a-zA-Z0-9_]+\}/g, '')
        // Remove punctuation
        .replace(/[^\w\s]/g, '')
        // Collapse whitespace
        .replace(/\s+/g, ' ')
        // Remove emojis
        .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu, '')
        .trim();
}

/**
 * Compute hash of normalized text
 */
export function computeContentHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Calculate Jaccard similarity between two texts
 */
export function calculateJaccardSimilarity(text1: string, text2: string): number {
    const tokens1 = new Set(normalizeText(text1).split(' ').filter(t => t.length > 2));
    const tokens2 = new Set(normalizeText(text2).split(' ').filter(t => t.length > 2));
    
    if (tokens1.size === 0 && tokens2.size === 0) return 1;
    if (tokens1.size === 0 || tokens2.size === 0) return 0;
    
    const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
    const union = new Set([...tokens1, ...tokens2]);
    
    return intersection.size / union.size;
}

/**
 * Detect repeated phrases/lines
 */
export function detectRepeatedPhrases(text: string): string[] {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 10);
    const seen = new Map<string, number>();
    const repeated: string[] = [];
    
    for (const line of lines) {
        const normalized = line.toLowerCase();
        const count = (seen.get(normalized) || 0) + 1;
        seen.set(normalized, count);
        if (count === 2) {
            repeated.push(line);
        }
    }
    
    return repeated;
}

// ============================================
// MAIN VALIDATION FUNCTION
// ============================================

/**
 * Validate a template and compute safety metrics
 */
export function validateTemplate(
    body: string,
    config: Partial<TemplateSafetyConfig> = {}
): TemplateSafetyResult {
    const cfg = { ...DEFAULT_SAFETY_CONFIG, ...config };
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const riskFlags: RiskFlag[] = [];
    let riskScore = 0;
    
    // Extract metadata
    const extractedVariables = extractVariables(body);
    const urls = extractUrls(body);
    const linkDomains = urls.map(extractDomain).filter(Boolean);
    const personalizationTokens = extractedVariables.filter(v => 
        PERSONALIZATION_VARIABLES.includes(v)
    );
    
    // Count {short_link} as a link
    const hasShortLink = extractedVariables.includes('short_link');
    const totalLinkCount = urls.length + (hasShortLink ? 1 : 0);
    
    const emojiCount = countEmojis(body);
    const uppercasePercentage = calculateUppercasePercentage(body);
    const promoWordCount = countPromoWords(body);
    const normalizedText = normalizeText(body);
    const contentHash = computeContentHash(body);
    const normalizedContentHash = computeContentHash(normalizedText);
    const repeatedPhrases = detectRepeatedPhrases(body);
    
    // ============================================
    // VALIDATION CHECKS
    // ============================================
    
    // 1. Variable validation - check for unsupported variables
    const unsupportedVars = extractedVariables.filter(v => !SUPPORTED_VARIABLES.includes(v));
    if (unsupportedVars.length > 0) {
        errors.push({
            code: 'UNSUPPORTED_VARIABLE',
            message: `Unsupported variable(s): {${unsupportedVars.join('}, {')}}. Supported: {${SUPPORTED_VARIABLES.join('}, {')}}`
        });
        riskFlags.push({
            code: 'UNSUPPORTED_VARIABLE',
            severity: 'error',
            message: `Unknown variables detected`,
            suggestion: `Use only supported variables: ${SUPPORTED_VARIABLES.join(', ')}`
        });
        riskScore += 30;
    }
    
    // 2. Personalization check
    if (cfg.requiresPersonalization && personalizationTokens.length < cfg.minPersonalizationTokens) {
        const flag: RiskFlag = {
            code: 'NO_PERSONALIZATION',
            severity: cfg.strictMode ? 'error' : 'warning',
            message: `Missing personalization (requires at least ${cfg.minPersonalizationTokens} of: {name}, {city})`,
            suggestion: 'Add {name} or {city} to make message feel personal'
        };
        riskFlags.push(flag);
        
        if (cfg.strictMode) {
            errors.push({
                code: 'NO_PERSONALIZATION',
                message: flag.message
            });
            riskScore += 25;
        } else {
            warnings.push({
                code: 'NO_PERSONALIZATION',
                message: flag.message,
                suggestion: flag.suggestion
            });
            riskScore += 15;
        }
    }
    
    // 3. Link count check
    if (totalLinkCount > cfg.maxLinks) {
        errors.push({
            code: 'TOO_MANY_LINKS',
            message: `Too many links: ${totalLinkCount} (max: ${cfg.maxLinks})`
        });
        riskFlags.push({
            code: 'TOO_MANY_LINKS',
            severity: 'error',
            message: `${totalLinkCount} links detected (max ${cfg.maxLinks})`,
            suggestion: 'Reduce the number of links to avoid spam filters'
        });
        riskScore += 25;
    }
    
    // 4. Domain reputation checks
    for (const url of urls) {
        const domain = extractDomain(url);
        
        // Check for IP address
        if (isIpAddress(domain)) {
            riskFlags.push({
                code: 'IP_ADDRESS_URL',
                severity: 'error',
                message: `URL uses IP address instead of domain: ${domain}`,
                suggestion: 'Use a proper domain name instead of IP address'
            });
            riskScore += 20;
        }
        
        // Check for shortener
        if (!cfg.allowShorteners && isShortenerDomain(domain)) {
            riskFlags.push({
                code: 'SHORTENER_DOMAIN',
                severity: cfg.strictMode ? 'error' : 'warning',
                message: `URL shortener detected: ${domain}`,
                suggestion: 'Use your own domain instead of URL shorteners'
            });
            if (cfg.strictMode) {
                errors.push({
                    code: 'SHORTENER_DOMAIN',
                    message: `URL shortener not allowed: ${domain}`
                });
            }
            riskScore += 15;
        }
        
        // Check allowlist
        if (cfg.allowedDomains.length > 0) {
            const isAllowed = cfg.allowedDomains.some(allowed => 
                domain === allowed || domain.endsWith('.' + allowed)
            );
            if (!isAllowed) {
                riskFlags.push({
                    code: 'DOMAIN_NOT_ALLOWED',
                    severity: cfg.strictMode ? 'error' : 'warning',
                    message: `Domain not in allowlist: ${domain}`,
                    suggestion: `Add ${domain} to allowed domains or use an approved domain`
                });
                if (cfg.strictMode) {
                    errors.push({
                        code: 'DOMAIN_NOT_ALLOWED',
                        message: `Domain ${domain} is not in the allowed list`
                    });
                }
                riskScore += 10;
            }
        }
        
        // Check for HTTP (not HTTPS)
        if (url.toLowerCase().startsWith('http://')) {
            warnings.push({
                code: 'INSECURE_URL',
                message: `URL uses http:// instead of https://`,
                suggestion: 'Use https:// for secure links'
            });
            riskFlags.push({
                code: 'INSECURE_URL',
                severity: 'warning',
                message: 'Insecure HTTP URL detected',
                suggestion: 'Change to HTTPS for better security'
            });
            riskScore += 5;
        }
    }
    
    // 5. Spam fingerprint signals
    if (emojiCount > cfg.maxEmojis) {
        riskFlags.push({
            code: 'TOO_MANY_EMOJIS',
            severity: 'warning',
            message: `${emojiCount} emojis detected (recommended max: ${cfg.maxEmojis})`,
            suggestion: 'Reduce emoji usage to appear more professional'
        });
        warnings.push({
            code: 'TOO_MANY_EMOJIS',
            message: `Too many emojis: ${emojiCount}`,
            suggestion: `Use fewer than ${cfg.maxEmojis} emojis`
        });
        riskScore += 10;
    }
    
    if (uppercasePercentage > cfg.maxUppercasePercentage) {
        riskFlags.push({
            code: 'ALL_CAPS_HEAVY',
            severity: 'warning',
            message: `${uppercasePercentage}% uppercase (max: ${cfg.maxUppercasePercentage}%)`,
            suggestion: 'Avoid excessive caps - it looks like shouting'
        });
        warnings.push({
            code: 'ALL_CAPS_HEAVY',
            message: `Too much uppercase: ${uppercasePercentage}%`,
            suggestion: 'Use proper capitalization'
        });
        riskScore += 10;
    }
    
    if (promoWordCount > cfg.promoWordThreshold) {
        riskFlags.push({
            code: 'HIGH_PROMO_WORDS',
            severity: 'warning',
            message: `${promoWordCount} promotional keywords detected`,
            suggestion: 'Reduce promotional language to avoid spam filters'
        });
        warnings.push({
            code: 'HIGH_PROMO_WORDS',
            message: `High promotional word count: ${promoWordCount}`,
            suggestion: 'Use less promotional language'
        });
        riskScore += Math.min(15, promoWordCount * 3);
    }
    
    if (repeatedPhrases.length > 0) {
        riskFlags.push({
            code: 'REPEATED_PHRASES',
            severity: 'warning',
            message: `${repeatedPhrases.length} repeated phrase(s) detected`,
            suggestion: 'Avoid repeating the same text'
        });
        warnings.push({
            code: 'REPEATED_PHRASES',
            message: `Repeated phrases: "${repeatedPhrases[0]}"...`,
            suggestion: 'Remove duplicate content'
        });
        riskScore += 5 * repeatedPhrases.length;
    }
    
    // Cap risk score at 100
    riskScore = Math.min(100, riskScore);
    
    // Determine validity
    const isValid = errors.length === 0;
    
    return {
        isValid,
        riskScore,
        riskFlags,
        errors,
        warnings,
        metadata: {
            linkCount: totalLinkCount,
            linkDomains: [...new Set(linkDomains)],
            extractedVariables,
            personalizationTokens,
            characterCount: body.length,
            emojiCount,
            uppercasePercentage,
            promoWordCount,
            contentHash,
            normalizedContentHash
        }
    };
}

/**
 * Check if two templates are duplicates or highly similar
 */
export function checkTemplateSimilarity(
    body1: string,
    body2: string
): { isDuplicate: boolean; similarity: number } {
    const hash1 = computeContentHash(normalizeText(body1));
    const hash2 = computeContentHash(normalizeText(body2));
    
    if (hash1 === hash2) {
        return { isDuplicate: true, similarity: 1.0 };
    }
    
    const similarity = calculateJaccardSimilarity(body1, body2);
    return {
        isDuplicate: similarity > 0.95,
        similarity
    };
}

// ============================================
// VARIATION ENGINE
// ============================================

/**
 * Seeded random number generator for deterministic variations
 */
function seededRandom(seed: string): () => number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        const char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    
    return function() {
        const x = Math.sin(hash++) * 10000;
        return x - Math.floor(x);
    };
}

/**
 * Apply variations to a template for a specific recipient
 */
export function applyVariation(
    body: string,
    templateId: string,
    recipientId: string,
    config: Partial<VariationConfig> = {}
): { message: string; variationId: string } {
    const cfg = { ...DEFAULT_VARIATION_CONFIG, ...config };
    
    if (!cfg.enabled) {
        return { message: body, variationId: 'none' };
    }
    
    const seed = `${templateId}-${recipientId}`;
    const random = seededRandom(seed);
    
    let result = body;
    const appliedVariations: string[] = [];
    
    // Check if message starts with a greeting pattern
    const greetingPatterns = [
        /^(Hi|Hello|Salam|Hey)\s*\{name\}\s*[,!]?\s*/i,
        /^(Hi|Hello|Salam|Hey)\s*[,!]?\s*/i
    ];
    
    let hasGreeting = false;
    for (const pattern of greetingPatterns) {
        if (pattern.test(result)) {
            hasGreeting = true;
            // Replace with random greeting variant
            const variantIndex = Math.floor(random() * cfg.greetingVariants.length);
            const variant = cfg.greetingVariants[variantIndex];
            result = result.replace(pattern, variant + '\n');
            appliedVariations.push(`greeting:${variantIndex}`);
            break;
        }
    }
    
    // If no greeting, optionally add one at the start
    if (!hasGreeting && result.includes('{name}')) {
        // 50% chance to add greeting
        if (random() > 0.5) {
            const variantIndex = Math.floor(random() * cfg.greetingVariants.length);
            const variant = cfg.greetingVariants[variantIndex];
            result = variant + '\n' + result;
            appliedVariations.push(`greeting-add:${variantIndex}`);
        }
    }
    
    // Check if message ends with common closing patterns
    const closingPatterns = [
        /(Terima kasih|Thanks|Thank you|Appreciate)[.!]?\s*$/i
    ];
    
    let hasClosing = false;
    for (const pattern of closingPatterns) {
        if (pattern.test(result)) {
            hasClosing = true;
            // Replace with random closing variant
            const variantIndex = Math.floor(random() * cfg.closingVariants.length);
            const variant = cfg.closingVariants[variantIndex];
            result = result.replace(pattern, variant);
            appliedVariations.push(`closing:${variantIndex}`);
            break;
        }
    }
    
    // Add softener line with some probability (30%)
    if (cfg.softenerLine && random() > 0.7) {
        result = result.trim() + '\n\n' + cfg.softenerLine;
        appliedVariations.push('softener:added');
    }
    
    // Generate variation ID
    const variationId = appliedVariations.length > 0 
        ? appliedVariations.join('|')
        : 'base';
    
    return { message: result, variationId };
}

/**
 * Render a template with variables
 */
export function renderTemplate(
    body: string,
    variables: Record<string, string | number>
): string {
    let result = body;
    
    for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        result = result.replace(regex, String(value));
    }
    
    return result;
}

/**
 * Full render pipeline: apply variations then render variables
 */
export function renderWithVariation(
    body: string,
    variables: Record<string, string | number>,
    templateId: string,
    recipientId: string,
    variationConfig: Partial<VariationConfig> = {}
): { message: string; variationId: string } {
    // First apply variations
    const { message: variedMessage, variationId } = applyVariation(
        body,
        templateId,
        recipientId,
        variationConfig
    );
    
    // Then render variables
    const renderedMessage = renderTemplate(variedMessage, variables);
    
    return { message: renderedMessage, variationId };
}

// ============================================
// RISK BADGE HELPERS
// ============================================

export type RiskLevel = 'safe' | 'warning' | 'blocked';

export function getRiskLevel(score: number): RiskLevel {
    if (score >= 80) return 'blocked';
    if (score >= 50) return 'warning';
    return 'safe';
}

export function getRiskBadgeColor(level: RiskLevel): string {
    switch (level) {
        case 'safe': return 'bg-green-100 text-green-700 border-green-200';
        case 'warning': return 'bg-amber-100 text-amber-700 border-amber-200';
        case 'blocked': return 'bg-red-100 text-red-700 border-red-200';
    }
}

export function getRiskBadgeLabel(level: RiskLevel): string {
    switch (level) {
        case 'safe': return 'Safe';
        case 'warning': return 'Review';
        case 'blocked': return 'Blocked';
    }
}
