// QR Security Code Utilities
// Handles token splitting and cookie management for anti-fraud security feature

import type { NextRequest, NextResponse } from "next/server";

/**
 * Split a full token into public token (visible in URL) and secret code (hidden)
 * @param fullToken - The complete token from QR code
 * @returns Object with publicToken (minus last 2 chars), secretCode (last 2 chars), and flag
 */
export function splitSecurityToken(fullToken: string): {
  publicToken: string;
  secretCode: string;
  hasSecurityCode: boolean;
} {
  if (!fullToken || fullToken.length < 3) {
    return { publicToken: fullToken, secretCode: "", hasSecurityCode: false };
  }

  const publicToken = fullToken.slice(0, -2); // everything except last 2 chars
  const secretCode = fullToken.slice(-2);     // last 2 chars

  return {
    publicToken,
    secretCode,
    hasSecurityCode: true,
  };
}

/**
 * Type for storing security code mappings in cookie
 * Key = publicToken, Value = { secretCode, expiresAt }
 */
export type QRSecurityMapping = Record<
  string,
  { secretCode: string; expiresAt: number }
>;

const COOKIE_NAME = "qr_security_mapping";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Read security code mappings from cookie
 * @param request - Next.js request object
 * @returns Mapping object or empty object if not found
 */
export function readSecurityMappingCookie(request: NextRequest): QRSecurityMapping {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as QRSecurityMapping;
  } catch {
    return {};
  }
}

/**
 * Write security code mapping to cookie
 * @param request - Next.js request object
 * @param response - Next.js response object
 * @param publicToken - The token visible in URL (without last 2 digits)
 * @param secretCode - The 2-digit security code
 */
export function writeSecurityMappingCookie(
  request: NextRequest,
  response: NextResponse,
  publicToken: string,
  secretCode: string
) {
  const mapping = readSecurityMappingCookie(request);

  mapping[publicToken] = {
    secretCode,
    expiresAt: Date.now() + ONE_DAY_MS,
  };

  const serialized = JSON.stringify(mapping);

  response.cookies.set(COOKIE_NAME, serialized, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24, // 1 day
  });
}

/**
 * Extract QR code from pathname
 * @param pathname - Request pathname
 * @returns QR code or null if not a QR route
 */
export function extractQRCodeFromPath(pathname: string): string | null {
  const QR_TRACK_PREFIX = "/track/product/";
  if (!pathname.startsWith(QR_TRACK_PREFIX)) return null;
  const qrCode = decodeURIComponent(pathname.slice(QR_TRACK_PREFIX.length));
  return qrCode || null;
}

/**
 * Extract token from QR code (last segment after final hyphen)
 * @param qrCode - Full QR code string
 * @returns Token string (last segment)
 */
export function extractTokenFromQRCode(qrCode: string): string {
  const parts = qrCode.split("-");
  return parts[parts.length - 1]; // last segment, e.g. "2f2042312440"
}

/**
 * Replace token in QR code with new token
 * @param qrCode - Full QR code string
 * @param newToken - New token to replace the last segment
 * @returns Modified QR code
 */
export function replaceTokenInQRCode(qrCode: string, newToken: string): string {
  const parts = qrCode.split("-");
  parts[parts.length - 1] = newToken;
  return parts.join("-");
}
