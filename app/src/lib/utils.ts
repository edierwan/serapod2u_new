import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizePhone(phone: string): string {
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');

    // Check if it starts with '60' or '01'
    if (cleaned.startsWith('60')) {
        // Already has country code, just ensure it's not double prefixed? 
        // Actually usually we just want 60 + number.
        return cleaned; 
    } else if (cleaned.startsWith('0')) {
        // Replace leading '0' with '60'
        return '60' + cleaned.substring(1);
    } else {
        // Doesn't start with 60 or 0, might be a number without prefix. 
        // Assume default Malaysia 60 if it looks like a mobile number? 
        // SAFEST: prepend 60 if length suggests it (e.g. 9-10 digits).
        // For now, if no clear indicator, prepend 60
        return '60' + cleaned;
    }
}

export function getStorageUrl(path: string | null) {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    const bucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'avatars'; // Default bucket
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

