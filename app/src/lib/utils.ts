import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { normalizePhoneE164 } from '@/utils/phone'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizePhone(phone: string): string {
  return normalizePhoneE164(phone)
}

export function toTitleCaseWords(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[\p{L}\p{N}]/gu, (char) => char.toUpperCase())
}

export function getStorageUrl(path: string | null) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  const bucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'avatars'; // Default bucket
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

export type PhoneValidationResult = {
  isValid: boolean;
  formatted?: string;
  error?: string;
}

export function validatePhoneNumber(phone: string): PhoneValidationResult {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { isValid: false, error: 'Phone number is required' };
  }
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return { isValid: false, error: 'Invalid phone number format' };
  }
  return { isValid: true, formatted: normalized };
}

