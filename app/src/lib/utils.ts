import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizePhone(phone: string): string {
  if (!phone) return ''
  
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '')
  
  // If it starts with '0', replace with '60'
  if (cleaned.startsWith('0')) {
    cleaned = '60' + cleaned.substring(1)
  }
  
  return cleaned
}