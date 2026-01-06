import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import Papa from "papaparse";

// Configure route to be dynamic
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Increase max duration for large file processing (5 minutes)
export const maxDuration = 300;

/**
 * Normalize full name to Title Case
 * - Trims whitespace
 * - Collapses multiple spaces to single space
 * - Converts to Title Case (first letter of each word capitalized)
 * Example: "ABDUL HAKIM" → "Abdul Hakim"
 */
function normalizeFullName(name: string): string {
  if (!name) return "";

  return String(name)
    .trim()
    .replace(/\s+/g, " ") // Collapse multiple spaces to single space
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase()); // Capitalize first letter of each word
}

function normalizePhone(phone: string): string {
  let cleaned = String(phone).replace(/[^0-9+]/g, "");

  // If starts with 0, replace with +60 (Malaysia default)
  if (cleaned.startsWith("0")) {
    cleaned = "+60" + cleaned.substring(1);
  }
  // If starts with 60, add +
  else if (cleaned.startsWith("60")) {
    cleaned = "+" + cleaned;
  }
  // If no country code (e.g. 123456789), assume +60
  else if (!cleaned.startsWith("+")) {
    cleaned = "+60" + cleaned;
  }

  // Validation for Malaysia numbers
  // Must start with +60
  // Length must be 12 or 13 digits (including +)
  // e.g. +60123456789 (12) or +601112345678 (13)
  if (cleaned.startsWith("+60")) {
    if (cleaned.length < 12 || cleaned.length > 13) {
      throw new Error(`Invalid Malaysian phone number length: ${cleaned}`);
    }
  }

  return cleaned;
}

function parseDate(dateStr: any): string {
  if (!dateStr) return new Date().toISOString();

  // If it's already a Date object (from ExcelJS)
  if (dateStr instanceof Date) {
    return dateStr.toISOString();
  }

  const str = String(dateStr).trim();

  // Handle DD/MM/YYYY format (e.g. 11/01/2025)
  if (str.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
    const [day, month, year] = str.split("/").map(Number);
    // Note: Month is 0-indexed in JS Date
    const date = new Date(year, month - 1, day);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // Handle YYYY-MM-DD format
  if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // Try standard parsing
  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }

  // Fallback to now if invalid
  console.warn(`Invalid date format: ${str}, using current time`);
  return new Date().toISOString();
}

/**
 * Validate email format
 * Returns null if valid, error message if invalid
 */
function validateEmail(email: string | undefined | null): string | null {
  if (!email || email.trim() === "") {
    return "Email is required. Please provide a valid email address.";
  }

  const trimmedEmail = email.trim();

  // Basic email format validation
  // Must have @ symbol
  if (!trimmedEmail.includes("@")) {
    return "Invalid email format. Email must contain '@' symbol.";
  }

  // Must have domain after @
  const parts = trimmedEmail.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return "Invalid email format. Please check the email address.";
  }

  const domain = parts[1];

  // Domain must have at least one dot and valid extension
  if (!domain.includes(".")) {
    return "Invalid email format. Domain must include extension (e.g., .com, .my).";
  }

  // Check for valid domain structure
  const domainParts = domain.split(".");
  const extension = domainParts[domainParts.length - 1];

  if (extension.length < 2) {
    return "Invalid email format. Please check the domain extension.";
  }

  // More comprehensive email regex check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    return "Invalid email format. Please enter a valid email address.";
  }

  return null; // Valid
}

/**
 * Validate required fields and return specific error messages
 */
function validateRow(row: any, passwordMode: string): string | null {
  // Validate Name
  if (!row.name || row.name.trim() === "") {
    return "Name is required. Please provide the user's name.";
  }

  // Validate Phone
  if (!row.phone || String(row.phone).trim() === "") {
    return "Phone number is required. Please provide a valid phone number.";
  }

  // Validate Email
  const emailError = validateEmail(row.email);
  if (emailError) {
    return emailError;
  }

  // Validate Password (only for file mode)
  if (passwordMode === "file" && (!row.password || row.password.trim() === "")) {
    return "Password is required when using file mode. Please fill in Column G (Password).";
  }

  // Validate Points (should be a valid number)
  if (row.points !== undefined && row.points !== null && row.points !== "") {
    const pointsNum = Number(row.points);
    if (isNaN(pointsNum)) {
      return "Invalid points value. Points must be a valid number.";
    }
    if (pointsNum < 0) {
      return "Invalid points value. Points cannot be negative.";
    }
  }

  return null; // All validations passed
}

// Process records in batches to handle large files
const BATCH_SIZE = 50;

async function processBatch(
  rows: any[],
  supabaseAdmin: any,
  passwordMode: string,
  defaultPassword: string
): Promise<any[]> {
  const results: any[] = [];

  for (const row of rows) {
    try {
      // 0. Validate all fields first with specific error messages
      const validationError = validateRow(row, passwordMode);
      if (validationError) {
        throw new Error(validationError);
      }

      // 1. Validate Phone (Strict)
      let normalizedPhone: string;
      try {
        normalizedPhone = normalizePhone(row.phone);
      } catch (e: any) {
        throw new Error(e.message);
      }

      // Determine password for this row
      let userPassword: string | null = null;
      if (passwordMode === "file") {
        userPassword = row.password;
      } else {
        userPassword = defaultPassword;
      }

      // 2. Find user by phone OR email separately to handle conflicts
      const { data: phoneUsers } = await supabaseAdmin
        .from("users")
        .select("*")
        .eq("phone", normalizedPhone);

      let emailUser = null;
      if (row.email) {
        const { data: emailUsers } = await supabaseAdmin
          .from("users")
          .select("*")
          .eq("email", row.email.trim());
        emailUser = emailUsers?.[0];
      }

      let user = phoneUsers?.[0];

      // Conflict Check
      if (user && emailUser && user.id !== emailUser.id) {
        throw new Error(
          `Data conflict: This phone number is already registered to a different user than this email.`
        );
      }

      if (!user && emailUser) {
        user = emailUser;
      }

      // If user not found, create new user
      if (!user) {
        if (!userPassword) {
          throw new Error("New user requires a password. Please provide a password.");
        }

        const { data: authUser, error: authError } =
          await supabaseAdmin.auth.admin.createUser({
            email: row.email.trim(),
            password: userPassword,
            phone: normalizedPhone,
            email_confirm: true,
            phone_confirm: true,
            user_metadata: {
              full_name: row.name,
              location: row.location,
            },
          });

        if (authError) {
          // Parse auth error for user-friendly message
          let friendlyError = authError.message;
          if (authError.message.includes("already been registered")) {
            friendlyError = "This email or phone is already registered in the system.";
          } else if (authError.message.includes("invalid")) {
            friendlyError = "Invalid data provided. Please check email and phone format.";
          }
          throw new Error(friendlyError);
        }

        if (!authUser.user) throw new Error("Failed to create user account.");

        user = {
          id: authUser.user.id,
          email: row.email.trim(),
          phone: normalizedPhone,
          full_name: row.name,
          location: row.location,
          role_code: "GUEST",
          organization_id: null,
          created_at: parseDate(row.joinedDate),
          last_migration_point_value: 0,
        };
      }

      // 3. Update User Details
      const updates: any = {
        full_name: row.name,
        location: row.location,
      };

      if (row.email) updates.email = row.email.trim();
      if (normalizedPhone) updates.phone = normalizedPhone;
      if (row.joinedDate) updates.created_at = parseDate(row.joinedDate);

      // 4. Calculate Points
      const { data: balanceData } = await supabaseAdmin
        .from("v_consumer_points_balance")
        .select("current_balance")
        .eq("user_id", user.id)
        .single();

      const realCurrentBalance = balanceData?.current_balance || 0;
      const lastMigrationValue = user.last_migration_point_value || 0;
      const newMigrationValue = row.points;
      const delta = newMigrationValue - lastMigrationValue;

      if (delta !== 0) {
        const { error: transactionError } = await supabaseAdmin
          .from("points_transactions")
          .insert({
            user_id: user.id,
            company_id: null,
            consumer_phone: normalizedPhone,
            consumer_email: row.email || user.email,
            transaction_type: "MIGRATION",
            points_amount: delta,
            balance_after: realCurrentBalance + delta,
            description: `Migration: ${newMigrationValue} (Prev: ${lastMigrationValue})`,
            transaction_date: new Date().toISOString(),
          });

        if (transactionError) {
          throw new Error(`Failed to record points transaction. Please try again.`);
        }

        updates.last_migration_point_value = newMigrationValue;
      }

      // Update User
      const { error: updateError } = await supabaseAdmin
        .from("users")
        .update(updates)
        .eq("id", user.id);

      if (updateError) {
        throw new Error(`Failed to update user details. Please try again.`);
      }

      results.push({
        rowNumber: row.rowNumber,
        joinedDate: row.joinedDate,
        name: row.name,
        phone: row.phone,
        email: row.email,
        location: row.location,
        points: row.points,
        password: row.password,
        status: "Success",
        message: `Delta: ${delta}`,
      });
    } catch (err: any) {
      console.error(err);
      results.push({
        rowNumber: row.rowNumber,
        joinedDate: row.joinedDate,
        name: row.name,
        phone: row.phone,
        email: row.email,
        location: row.location,
        points: row.points,
        password: row.password,
        status: "Error",
        message: err.message,
      });
    }
  }

  return results;
}

export async function POST(request: NextRequest) {
  try {
    // Initialize Supabase Admin Client inside the handler
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const passwordMode = (formData.get("passwordMode") as string) || "default";
    const defaultPassword = formData.get("defaultPassword") as string;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const rows: any[] = [];

    if (file.name.toLowerCase().endsWith(".csv")) {
      const text = new TextDecoder().decode(buffer);
      const { data: csvRows } = Papa.parse(text, {
        header: false,
        skipEmptyLines: true,
      }) as any;

      csvRows.forEach((row: any[], index: number) => {
        if (index === 0) return; // Skip header

        const rawPhone = row[2];
        if (rawPhone) {
          rows.push({
            rowNumber: index + 1,
            joinedDate: row[0],
            name: normalizeFullName(row[1]), // Normalize to Title Case
            phone: rawPhone, // Store raw phone, validate later
            email: row[3]?.trim(),
            location: row[4],
            points: Number(row[5]) || 0,
            password: row[6]?.trim() || "", // Column G - Password
          });
        }
      });
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      const worksheet = workbook.getWorksheet(1);
      if (!worksheet) {
        return NextResponse.json(
          { error: "Invalid Excel file" },
          { status: 400 },
        );
      }

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header

        // Columns: A=Joined Date, B=Name, C=Phone, D=Email, E=Location, F=Points, G=Password
        const joinedDate = row.getCell(1).value;
        const name = normalizeFullName(row.getCell(2).text); // Normalize to Title Case
        const rawPhone = row.getCell(3).text;
        const email = row.getCell(4).text;
        const location = row.getCell(5).text;
        const points = row.getCell(6).value;
        const password = row.getCell(7).text; // Column G - Password

        if (rawPhone) {
          rows.push({
            rowNumber,
            joinedDate,
            name,
            phone: rawPhone, // Store raw phone, validate later
            email: email?.trim(),
            location,
            points: Number(points) || 0,
            password: password?.trim() || "",
          });
        }
      });
    }

    // Process rows in batches to handle large files
    const allResults: any[] = [];

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const batchResults = await processBatch(
        batch,
        supabaseAdmin,
        passwordMode,
        defaultPassword
      );
      allResults.push(...batchResults);

      // Small delay between batches to prevent overwhelming the database
      if (i + BATCH_SIZE < rows.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Return JSON response with results
    const successCount = allResults.filter((r) => r.status === "Success").length;
    const errorCount = allResults.filter((r) => r.status === "Error").length;

    return NextResponse.json({
      success: true,
      summary: {
        total: allResults.length,
        success: successCount,
        error: errorCount,
      },
      results: allResults,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
