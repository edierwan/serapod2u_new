export type ParsedPhone = {
    input: unknown;
    digits: string;
    e164: string | null;
    provider: string | null;
    valid: boolean;
    reason: string | null;
};

export declare const E164_REGEX: RegExp;
export declare function stripToDigits(value: unknown): string;
export declare function parsePhone(input: unknown, options?: { defaultCountryCode?: string; throwOnInvalid?: boolean }): ParsedPhone;
export declare function normalizePhoneToE164(input: unknown, options?: { defaultCountryCode?: string; throwOnInvalid?: boolean }): string | null;
export declare function isValidE164Phone(input: unknown): boolean;
export declare function toProviderPhone(input: unknown, options?: { defaultCountryCode?: string; throwOnInvalid?: boolean }): string | null;
export declare function samePhone(left: unknown, right: unknown, options?: { defaultCountryCode?: string }): boolean;
export declare function formatPhoneDisplay(input: unknown, options?: { defaultCountryCode?: string }): string;
export declare function jidToPhone(jid: unknown, options?: { defaultCountryCode?: string }): string | null;
export declare function phoneToJid(input: unknown, options?: { defaultCountryCode?: string; throwOnInvalid?: boolean }): string;
export declare function maskPhone(input: unknown, options?: { defaultCountryCode?: string }): string;