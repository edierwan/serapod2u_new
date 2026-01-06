import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import Papa from "papaparse";

// Configure route to be dynamic
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Increase max duration for large file processing (10 minutes for 1.2K+ records)
export const maxDuration = 600;

// Batch processing configuration
const BATCH_SIZE = 10; // Process 10 records in parallel
const PROGRESS_UPDATE_INTERVAL = 10; // Update progress every 10 records
const KEEP_ALIVE_INTERVAL = 15000; // Send keep-alive ping every 15 seconds
const MAX_RETRIES = 3; // Retry failed operations up to 3 times
const RETRY_DELAY = 1000; // Wait 1 second between retries

/**
 * Normalize full name to Title Case
 */
function normalizeFullName(name: string): string {
    if (!name) return "";
    return String(name)
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizePhone(phone: string): string {
    let cleaned = String(phone).replace(/[^0-9+]/g, "");

    if (cleaned.startsWith("0")) {
        cleaned = "+60" + cleaned.substring(1);
    } else if (cleaned.startsWith("60")) {
        cleaned = "+" + cleaned;
    } else if (!cleaned.startsWith("+")) {
        cleaned = "+60" + cleaned;
    }

    if (cleaned.startsWith("+60")) {
        if (cleaned.length < 12 || cleaned.length > 13) {
            throw new Error(`Invalid Malaysian phone number length: ${cleaned}`);
        }
    }

    return cleaned;
}

function parseDate(dateStr: any): string {
    if (!dateStr) return new Date().toISOString();

    if (dateStr instanceof Date) {
        return dateStr.toISOString();
    }

    const str = String(dateStr).trim();

    if (str.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
        const [day, month, year] = str.split("/").map(Number);
        const date = new Date(year, month - 1, day);
        if (!isNaN(date.getTime())) {
            return date.toISOString();
        }
    }

    if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const date = new Date(str);
        if (!isNaN(date.getTime())) {
            return date.toISOString();
        }
    }

    const date = new Date(str);
    if (!isNaN(date.getTime())) {
        return date.toISOString();
    }

    return new Date().toISOString();
}

function validateEmail(email: string | undefined | null): string | null {
    if (!email || email.trim() === "") {
        return "Email is required. Please provide a valid email address.";
    }

    const trimmedEmail = email.trim();

    if (!trimmedEmail.includes("@")) {
        return "Invalid email format. Email must contain '@' symbol.";
    }

    const parts = trimmedEmail.split("@");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return "Invalid email format. Please check the email address.";
    }

    const domain = parts[1];

    if (!domain.includes(".")) {
        return "Invalid email format. Domain must include extension (e.g., .com, .my).";
    }

    const domainParts = domain.split(".");
    const extension = domainParts[domainParts.length - 1];

    if (extension.length < 2) {
        return "Invalid email format. Please check the domain extension.";
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
        return "Invalid email format. Please enter a valid email address.";
    }

    return null;
}

function validateRow(row: any, passwordMode: string): string | null {
    if (!row.name || row.name.trim() === "") {
        return "Name is required. Please provide the user's name.";
    }

    if (!row.phone || String(row.phone).trim() === "") {
        return "Phone number is required. Please provide a valid phone number.";
    }

    const emailError = validateEmail(row.email);
    if (emailError) {
        return emailError;
    }

    if (passwordMode === "file" && (!row.password || row.password.trim() === "")) {
        return "Password is required when using file mode. Please fill in Column G (Password).";
    }

    if (row.points !== undefined && row.points !== null && row.points !== "") {
        const pointsNum = Number(row.points);
        if (isNaN(pointsNum)) {
            return "Invalid points value. Points must be a valid number.";
        }
        if (pointsNum < 0) {
            return "Invalid points value. Points cannot be negative.";
        }
    }

    return null;
}

/**
 * Retry wrapper for database operations
 */
async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = MAX_RETRIES,
    delay: number = RETRY_DELAY
): Promise<T> {
    let lastError: Error;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;
            // Don't retry validation errors or user errors
            if (error.message?.includes("required") || 
                error.message?.includes("Invalid") ||
                error.message?.includes("conflict") ||
                error.message?.includes("already registered")) {
                throw error;
            }
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    }
    throw lastError!;
}

async function processRow(
    row: any,
    supabaseAdmin: any,
    passwordMode: string,
    defaultPassword: string
): Promise<any> {
    // Validate all fields first
    const validationError = validateRow(row, passwordMode);
    if (validationError) {
        throw new Error(validationError);
    }

    // Validate Phone
    let normalizedPhone: string;
    try {
        normalizedPhone = normalizePhone(row.phone);
    } catch (e: any) {
        throw new Error(e.message);
    }

    // Determine password
    let userPassword: string | null = null;
    if (passwordMode === "file") {
        userPassword = row.password;
    } else {
        userPassword = defaultPassword;
    }

    // Find user by phone OR email
    const { data: phoneUsers } = await supabaseAdmin
        .from("users")
        .select("id, email, phone, full_name, location, last_migration_point_value")
        .eq("phone", normalizedPhone);

    let emailUser = null;
    if (row.email) {
        const { data: emailUsers } = await supabaseAdmin
            .from("users")
            .select("id, email, phone, full_name, location, last_migration_point_value")
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
            last_migration_point_value: 0,
        };
    }

    // Update User Details
    const updates: any = {
        full_name: row.name,
        location: row.location,
    };

    if (row.email) updates.email = row.email.trim();
    if (normalizedPhone) updates.phone = normalizedPhone;
    if (row.joinedDate) updates.created_at = parseDate(row.joinedDate);

    // Calculate Points
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

    return {
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
    };
}

export async function POST(request: NextRequest) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const sendEvent = (type: string, data: any) => {
                const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
                controller.enqueue(encoder.encode(message));
            };

            try {
                const supabaseAdmin = createClient(
                    process.env.NEXT_PUBLIC_SUPABASE_URL!,
                    process.env.SUPABASE_SERVICE_ROLE_KEY!,
                );

                const formData = await request.formData();
                const file = formData.get("file") as File;
                const passwordMode = (formData.get("passwordMode") as string) || "default";
                const defaultPassword = formData.get("defaultPassword") as string;

                if (!file) {
                    sendEvent("error", { message: "No file uploaded" });
                    controller.close();
                    return;
                }

                // Send initial status
                sendEvent("status", { message: "Reading file..." });

                const buffer = await file.arrayBuffer();
                const rows: any[] = [];

                if (file.name.toLowerCase().endsWith(".csv")) {
                    const text = new TextDecoder().decode(buffer);
                    const { data: csvRows } = Papa.parse(text, {
                        header: false,
                        skipEmptyLines: true,
                    }) as any;

                    csvRows.forEach((row: any[], index: number) => {
                        if (index === 0) return;

                        const rawPhone = row[2];
                        if (rawPhone) {
                            rows.push({
                                rowNumber: index + 1,
                                joinedDate: row[0],
                                name: normalizeFullName(row[1]),
                                phone: rawPhone,
                                email: row[3]?.trim(),
                                location: row[4],
                                points: Number(row[5]) || 0,
                                password: row[6]?.trim() || "",
                            });
                        }
                    });
                } else {
                    const workbook = new ExcelJS.Workbook();
                    await workbook.xlsx.load(buffer);

                    const worksheet = workbook.getWorksheet(1);
                    if (!worksheet) {
                        sendEvent("error", { message: "Invalid Excel file" });
                        controller.close();
                        return;
                    }

                    worksheet.eachRow((row, rowNumber) => {
                        if (rowNumber === 1) return;

                        const joinedDate = row.getCell(1).value;
                        const name = normalizeFullName(row.getCell(2).text);
                        const rawPhone = row.getCell(3).text;
                        const email = row.getCell(4).text;
                        const location = row.getCell(5).text;
                        const points = row.getCell(6).value;
                        const password = row.getCell(7).text;

                        if (rawPhone) {
                            rows.push({
                                rowNumber,
                                joinedDate,
                                name,
                                phone: rawPhone,
                                email: email?.trim(),
                                location,
                                points: Number(points) || 0,
                                password: password?.trim() || "",
                            });
                        }
                    });
                }

                const totalRows = rows.length;
                sendEvent("init", { total: totalRows, message: `Found ${totalRows} records to process` });

                const allResults: any[] = [];
                let successCount = 0;
                let errorCount = 0;
                let lastProgressUpdate = Date.now();
                let lastKeepAlive = Date.now();

                // Keep-alive ping function
                const sendKeepAlive = () => {
                    const now = Date.now();
                    if (now - lastKeepAlive >= KEEP_ALIVE_INTERVAL) {
                        sendEvent("ping", { timestamp: now });
                        lastKeepAlive = now;
                    }
                };

                // Process a single row with retry
                const processRowWithRetry = async (row: any) => {
                    return withRetry(async () => {
                        return await processRow(row, supabaseAdmin, passwordMode, defaultPassword);
                    });
                };

                // Process rows in parallel batches for better performance
                for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                    // Send keep-alive ping before processing each batch
                    sendKeepAlive();

                    const batch = rows.slice(i, Math.min(i + BATCH_SIZE, rows.length));
                    
                    // Process batch in parallel
                    const batchPromises = batch.map(async (row) => {
                        try {
                            const result = await processRowWithRetry(row);
                            return { ...result, _success: true };
                        } catch (err: any) {
                            return {
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
                                _success: false,
                            };
                        }
                    });

                    const batchResults = await Promise.all(batchPromises);
                    
                    // Count results and add to allResults
                    for (const result of batchResults) {
                        const { _success, ...cleanResult } = result;
                        allResults.push(cleanResult);
                        if (_success) {
                            successCount++;
                        } else {
                            errorCount++;
                        }
                    }

                    const currentProcessed = Math.min(i + BATCH_SIZE, rows.length);
                    const now = Date.now();

                    // Send progress update every PROGRESS_UPDATE_INTERVAL records or after 2 seconds
                    if (currentProcessed % PROGRESS_UPDATE_INTERVAL === 0 || 
                        currentProcessed === rows.length || 
                        now - lastProgressUpdate >= 2000) {
                        const progress = Math.round((currentProcessed / totalRows) * 100);
                        sendEvent("progress", {
                            current: currentProcessed,
                            total: totalRows,
                            progress,
                            success: successCount,
                            errors: errorCount,
                            message: `Processing ${currentProcessed} of ${totalRows} records (${progress}%)`
                        });
                        lastProgressUpdate = now;
                    }

                    // Small delay between batches to prevent overwhelming the database
                    if (i + BATCH_SIZE < rows.length) {
                        await new Promise((resolve) => setTimeout(resolve, 100));
                    }
                }

                // Send final keep-alive before completion
                sendKeepAlive();

                // Send completion with all results
                sendEvent("complete", {
                    success: true,
                    summary: {
                        total: totalRows,
                        success: successCount,
                        error: errorCount,
                    },
                    results: allResults,
                });

                controller.close();
            } catch (error: any) {
                console.error("Point migration error:", error);
                sendEvent("error", { message: error.message || "Processing failed" });
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no", // Disable nginx buffering
        },
    });
}
