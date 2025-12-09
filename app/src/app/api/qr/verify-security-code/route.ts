import { NextRequest, NextResponse } from "next/server";
import { readSecurityMappingCookie } from "@/utils/qrSecurity";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/qr/verify-security-code
 * Verifies the 2-digit security code entered by user
 * 
 * Body: { publicToken: string, code: string }
 * Returns: { ok: boolean, error?: string }
 * 
 * Handles two scenarios:
 * 1. Short token (middleware stripped last 2 chars): Look up in cookie or DB
 * 2. Full token (middleware didn't strip): Last 2 chars of token IS the secret code
 */
export async function POST(request: NextRequest) {
  try {
    const { publicToken, code } = await request.json();

    if (!publicToken || !code) {
      return NextResponse.json(
        { ok: false, error: "Missing data" }, 
        { status: 400 }
      );
    }

    // Validate code format (must be 2 characters)
    if (code.length !== 2) {
      return NextResponse.json(
        { ok: false, error: "Security code must be 2 digits" }, 
        { status: 400 }
      );
    }

    // 1) Try cookie mapping first (for short tokens where middleware stripped the code)
    const mapping = readSecurityMappingCookie(request);
    const entry = mapping[publicToken];

    let expectedCode = entry?.secretCode;

    // 2) Fallback: derive from DB if cookie missing
    if (!expectedCode) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      // First try: Pattern match for short token (token + 2 more chars at end)
      // Example: if publicToken is "07844050a7", find code ending with "07844050a7??"
      const { data: qrRow } = await supabase
        .from("qr_codes")
        .select("code")
        .like("code", `%-${publicToken}__`)
        .maybeSingle();

      if (qrRow?.code) {
        // Extract last segment (token) and get last 2 chars
        const parts = qrRow.code.split("-");
        const fullToken = parts[parts.length - 1];
        expectedCode = fullToken.slice(-2);
      }

      // Second try: Full token scenario - URL has full token (middleware didn't strip)
      // The secret code is simply the last 2 chars of the token itself
      if (!expectedCode) {
        // Check if the publicToken itself is the full token by looking for exact match
        const { data: fullTokenRow } = await supabase
          .from("qr_codes")
          .select("code")
          .like("code", `%-${publicToken}`)
          .maybeSingle();

        if (fullTokenRow?.code) {
          // The publicToken is already the full token
          // Secret code is the last 2 characters
          expectedCode = publicToken.slice(-2);
        }
      }
    }

    if (!expectedCode) {
      return NextResponse.json(
        { ok: false, error: "Security code not available" }, 
        { status: 400 }
      );
    }

    // 3) Verify the code (case-insensitive comparison)
    if (expectedCode.toUpperCase() !== code.toUpperCase()) {
      return NextResponse.json(
        { ok: false, error: "Invalid security code" }, 
        { status: 401 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error verifying security code:", error);
    return NextResponse.json(
      { ok: false, error: "Server error" }, 
      { status: 500 }
    );
  }
}
