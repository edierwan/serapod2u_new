import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import Papa from "papaparse";

// Configure route to be dynamic
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Increase max duration for large file processing (10 minutes for 1.2K+ records)
export const maxDuration = 600;

// OPTIMIZED Batch processing configuration
const BATCH_SIZE = 25; // Process 25 records in parallel
const PROGRESS_UPDATE_INTERVAL = 25; // Update progress every 25 records
const KEEP_ALIVE_INTERVAL = 8000; // Send keep-alive ping every 8 seconds

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

// Pre-fetch users cache for batch processing
interface UserCache {
    byPhone: Map<string, any>;
    byEmail: Map<string, any>;
}

/**
 * OPTIMIZED: Pre-fetch all users that might match the batch
 */
async function prefetchUsersForBatch(
    rows: any[],
    supabaseAdmin: any
): Promise<UserCache> {
    const phones: string[] = [];
    const emails: string[] = [];

    for (const row of rows) {
        try {
            const normalizedPhone = normalizePhone(row.phone);
            phones.push(normalizedPhone);
        } catch {
            // Skip invalid phones
        }
        if (row.email) {
            emails.push(row.email.trim().toLowerCase());
        }
    }

    const cache: UserCache = {
        byPhone: new Map(),
        byEmail: new Map(),
    };

    // Fetch users by phone and email in parallel
    const [phoneResult, emailResult] = await Promise.all([
        phones.length > 0 
            ? supabaseAdmin
                .from("users")
                .select("id, email, phone, full_name, location, last_migration_point_value, role_code")
                .in("phone", phones)
            : Promise.resolve({ data: [] }),
        emails.length > 0 
            ? supabaseAdmin
                .from("users")
                .select("id, email, phone, full_name, location, last_migration_point_value, role_code")
                .in("email", emails)
            : Promise.resolve({ data: [] }),
    ]);

    for (const user of phoneResult.data || []) {
        if (user.phone) {
            cache.byPhone.set(user.phone, user);
        }
    }

    for (const user of emailResult.data || []) {
        if (user.email) {
            cache.byEmail.set(user.email.toLowerCase(), user);
        }
    }

    return cache;
}

/**
 * OPTIMIZED: Pre-fetch points balances for all users in batch
 */
async function prefetchPointsBalances(
    userIds: string[],
    supabaseAdmin: any
): Promise<Map<string, number>> {
    const balanceMap = new Map<string, number>();

    if (userIds.length === 0) return balanceMap;

    const { data: balances } = await supabaseAdmin
        .from("v_consumer_points_balance")
        .select("user_id, current_balance")
        .in("user_id", userIds);

    for (const balance of balances || []) {
        balanceMap.set(balance.user_id, balance.current_balance || 0);
    }

    return balanceMap;
}

/**
 * OPTIMIZED: Process a single row using cached data
 */
async function processRowOptimized(
    row: any,
    supabaseAdmin: any,
    passwordMode: string,
    defaultPassword: string,
    userCache: UserCache,
    balanceCache: Map<string, number>
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

    // Use cached user lookups instead of DB queries
    let user = userCache.byPhone.get(normalizedPhone);
    const emailUser = row.email ? userCache.byEmail.get(row.email.trim().toLowerCase()) : null;

    // Conflict Check
    if (user && emailUser && user.id !== emailUser.id) {
        throw new Error(
            `Data conflict: This phone number is already registered to a different user than this email.`
        );
    }

    if (!user && emailUser) {
        user = emailUser;
    }

    let isNewUser = false;

    // If user not found, create new user
    if (!user) {
        isNewUser = true;

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
            role_code: "GUEST",
            organization_id: null,
            last_migration_point_value: 0,
        };

        // Add to cache for potential subsequent lookups
        userCache.byPhone.set(normalizedPhone, user);
        if (row.email) {
            userCache.byEmail.set(row.email.trim().toLowerCase(), user);
        }
    }

    // Use cached balance
    const realCurrentBalance = balanceCache.get(user.id) || 0;
    const lastMigrationValue = user.last_migration_point_value || 0;
    const newMigrationValue = row.points;
    const delta = newMigrationValue - lastMigrationValue;

    // Prepare updates
    const updates: any = {
        full_name: row.name,
        location: row.location,
    };

    if (row.email) updates.email = row.email.trim();
    if (normalizedPhone) updates.phone = normalizedPhone;
    if (row.joinedDate) updates.created_at = parseDate(row.joinedDate);
    
    // Ensure role_code and organization_id are set for independent consumers
    if (!user.role_code) updates.role_code = "GUEST";
    if (user.organization_id === undefined) updates.organization_id = null;

    if (delta !== 0) {
        updates.last_migration_point_value = newMigrationValue;
    }

    return {
        userId: user.id,
        normalizedPhone,
        email: row.email || user.email,
        delta,
        realCurrentBalance,
        newMigrationValue,
        lastMigrationValue,
        updates,
        row,
        isNewUser,
        userRole: user.role_code
    };
}

export async function POST(request: NextRequest) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            let keepAliveInterval: NodeJS.Timeout | null = null;

            const sendEvent = (type: string, data: any) => {
                const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
                controller.enqueue(encoder.encode(message));
            };

            try {
                // Start keep-alive interval immediately
                keepAliveInterval = setInterval(() => {
                    sendEvent("ping", { timestamp: Date.now() });
                }, KEEP_ALIVE_INTERVAL);

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
                    if (keepAliveInterval) clearInterval(keepAliveInterval);
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
                        if (keepAliveInterval) clearInterval(keepAliveInterval);
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

                // Process rows in optimized batches
                for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                    const batch = rows.slice(i, Math.min(i + BATCH_SIZE, rows.length));

                    // PHASE 1: Pre-fetch all users for this batch (2 queries instead of 2*N)
                    const userCache = await prefetchUsersForBatch(batch, supabaseAdmin);

                    // Collect user IDs from cache for balance prefetch
                    const userIdsForBalance: string[] = [];
                    for (const row of batch) {
                        try {
                            const phone = normalizePhone(row.phone);
                            const user = userCache.byPhone.get(phone) || 
                                (row.email ? userCache.byEmail.get(row.email.trim().toLowerCase()) : null);
                            if (user) {
                                userIdsForBalance.push(user.id);
                            }
                        } catch {
                            // Skip invalid rows
                        }
                    }

                    // PHASE 2: Pre-fetch all balances for existing users (1 query instead of N)
                    const balanceCache = await prefetchPointsBalances(userIdsForBalance, supabaseAdmin);

                    // PHASE 3: Process each row using cached data
                    const processedRows: any[] = [];

                    const batchPromises = batch.map(async (row) => {
                        try {
                            const result = await processRowOptimized(
                                row,
                                supabaseAdmin,
                                passwordMode,
                                defaultPassword,
                                userCache,
                                balanceCache
                            );
                            return { success: true, result };
                        } catch (err: any) {
                            return {
                                success: false,
                                error: {
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
                                },
                            };
                        }
                    });

                    const batchResults = await Promise.all(batchPromises);

                    // Separate successes and errors
                    for (const result of batchResults) {
                        if (result.success) {
                            processedRows.push(result.result);
                        } else {
                            allResults.push(result.error);
                            errorCount++;
                        }
                    }

                    // PHASE 4: Batch insert transactions for all successful rows
                    const transactions = processedRows
                        .filter((r) => r.delta !== 0)
                        .map((r) => ({
                            user_id: r.userId,
                            company_id: null,
                            consumer_phone: r.normalizedPhone,
                            consumer_email: r.email,
                            transaction_type: "MIGRATION",
                            points_amount: r.delta,
                            balance_after: r.realCurrentBalance + r.delta,
                            description: `Migration: ${r.newMigrationValue} (Prev: ${r.lastMigrationValue})`,
                            transaction_date: new Date().toISOString(),
                        }));

                    if (transactions.length > 0) {
                        await supabaseAdmin.from("points_transactions").insert(transactions);
                    }

                    // PHASE 5: Batch update users
                    const userUpdates = processedRows.map((r) => ({
                        id: r.userId,
                        data: r.updates,
                    }));

                    // Update in parallel (smaller sub-batches)
                    const UPDATE_SUB_BATCH = 10;
                    for (let j = 0; j < userUpdates.length; j += UPDATE_SUB_BATCH) {
                        const updateBatch = userUpdates.slice(j, j + UPDATE_SUB_BATCH);
                        await Promise.all(
                            updateBatch.map(({ id, data }) =>
                                supabaseAdmin.from("users").update(data).eq("id", id)
                            )
                        );
                    }

                    // Add successful results
                    for (const r of processedRows) {
                        let message = `Delta: ${r.delta}`;
                        
                        // Add context about user status
                        if (r.isNewUser) {
                             message = `New User Created. ${message}`;
                        } else {
                             const roleInfo = r.userRole && r.userRole !== 'GUEST' ? ` (${r.userRole})` : '';
                             message = `Existing User Updated${roleInfo}. ${message}`;
                        }

                        allResults.push({
                            rowNumber: r.row.rowNumber,
                            joinedDate: r.row.joinedDate,
                            name: r.row.name,
                            phone: r.row.phone,
                            email: r.row.email,
                            location: r.row.location,
                            points: r.row.points,
                            password: r.row.password,
                            status: "Success",
                            message: message,
                            isNewUser: r.isNewUser,
                            userRole: r.userRole
                        });
                        successCount++;
                    }

                    // Send progress update
                    const currentProcessed = Math.min(i + BATCH_SIZE, rows.length);
                    const progress = Math.round((currentProcessed / totalRows) * 100);
                    sendEvent("progress", {
                        current: currentProcessed,
                        total: totalRows,
                        progress,
                        success: successCount,
                        errors: errorCount,
                        message: `Processing ${currentProcessed} of ${totalRows} records (${progress}%)`
                    });
                }

                // Clear keep-alive interval
                if (keepAliveInterval) clearInterval(keepAliveInterval);

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
                if (keepAliveInterval) clearInterval(keepAliveInterval);
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
            "X-Accel-Buffering": "no",
        },
    });
}
