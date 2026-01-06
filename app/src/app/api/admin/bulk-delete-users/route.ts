import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

// Configure route to be dynamic
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Increase max duration for large bulk deletions (10 minutes)
export const maxDuration = 600;

// Batch processing configuration - OPTIMIZED for speed
const BATCH_SIZE = 50; // Process 50 users in parallel for faster deletion
const PROGRESS_UPDATE_INTERVAL = 25; // Update progress every 25 users
const KEEP_ALIVE_INTERVAL = 10000; // Send keep-alive ping every 10 seconds

/**
 * Fast batch delete - delete all related data for multiple users at once
 */
async function batchDeleteRelatedData(
    userIds: string[],
    supabaseAdmin: any
): Promise<void> {
    // Get all user emails and phones in one query
    const { data: users } = await supabaseAdmin
        .from("users")
        .select("id, email, phone")
        .in("id", userIds);

    const emails = users?.filter((u: any) => u.email).map((u: any) => u.email) || [];
    const phones = users?.filter((u: any) => u.phone).map((u: any) => u.phone) || [];

    // Delete all related data in parallel for maximum speed
    await Promise.all([
        // Delete audit_logs for all users in batch
        supabaseAdmin.from("audit_logs").delete().in("user_id", userIds),
        
        // Delete points_transactions for all users in batch
        supabaseAdmin.from("points_transactions").delete().in("user_id", userIds),
        
        // Delete consumer_activations by email (batch)
        emails.length > 0 
            ? supabaseAdmin.from("consumer_activations").delete().in("consumer_email", emails)
            : Promise.resolve(),
        
        // Delete consumer_activations by phone (batch)
        phones.length > 0 
            ? supabaseAdmin.from("consumer_activations").delete().in("consumer_phone", phones)
            : Promise.resolve(),
        
        // Set null on consumer_qr_scans (batch)
        supabaseAdmin.from("consumer_qr_scans").update({ consumer_id: null }).in("consumer_id", userIds),
    ]);
}

/**
 * Fast delete users from database in batch
 */
async function batchDeleteUsersFromDB(
    userIds: string[],
    supabaseAdmin: any
): Promise<{ deleted: string[]; failed: string[] }> {
    const deleted: string[] = [];
    const failed: string[] = [];

    // Delete all users in a single query
    const { error } = await supabaseAdmin
        .from("users")
        .delete()
        .in("id", userIds);

    if (error) {
        // If batch fails, all users failed
        failed.push(...userIds);
    } else {
        deleted.push(...userIds);
    }

    return { deleted, failed };
}

/**
 * Delete users from Supabase Auth in parallel batches
 */
async function batchDeleteUsersFromAuth(
    userIds: string[],
    supabaseAdmin: any
): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    // Delete auth users in parallel (smaller batches for auth API)
    const AUTH_BATCH_SIZE = 20;
    for (let i = 0; i < userIds.length; i += AUTH_BATCH_SIZE) {
        const batch = userIds.slice(i, i + AUTH_BATCH_SIZE);
        
        const results = await Promise.allSettled(
            batch.map(userId => supabaseAdmin.auth.admin.deleteUser(userId))
        );

        for (const result of results) {
            if (result.status === "fulfilled" && !result.value.error) {
                success++;
            } else {
                failed++;
            }
        }
    }

    return { success, failed };
}

export async function POST(request: NextRequest) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const sendEvent = (type: string, data: any) => {
                const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
                controller.enqueue(encoder.encode(message));
            };

            let keepAliveInterval: NodeJS.Timeout | null = null;

            try {
                // Start keep-alive interval immediately
                keepAliveInterval = setInterval(() => {
                    sendEvent("ping", { timestamp: Date.now() });
                }, KEEP_ALIVE_INTERVAL);

                const supabaseAdmin = createClient(
                    process.env.NEXT_PUBLIC_SUPABASE_URL!,
                    process.env.SUPABASE_SERVICE_ROLE_KEY!,
                );

                const body = await request.json();
                const { userIds, callerId } = body;

                if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
                    sendEvent("error", { message: "No user IDs provided" });
                    if (keepAliveInterval) clearInterval(keepAliveInterval);
                    controller.close();
                    return;
                }

                // Verify caller has permission
                if (!callerId) {
                    sendEvent("error", { message: "Caller ID required" });
                    if (keepAliveInterval) clearInterval(keepAliveInterval);
                    controller.close();
                    return;
                }

                const { data: callerProfile } = await supabaseAdmin
                    .from("users")
                    .select("id, role_code, roles(role_level)")
                    .eq("id", callerId)
                    .single();

                if (!callerProfile) {
                    sendEvent("error", { message: "Caller not found" });
                    if (keepAliveInterval) clearInterval(keepAliveInterval);
                    controller.close();
                    return;
                }

                const roleLevel = (callerProfile.roles as any)?.role_level;
                if (roleLevel !== 1 && roleLevel !== 10) {
                    sendEvent("error", { message: "Unauthorized: Only administrators can delete users" });
                    if (keepAliveInterval) clearInterval(keepAliveInterval);
                    controller.close();
                    return;
                }

                // Filter out the caller's own ID
                const usersToDelete = userIds.filter((id: string) => id !== callerId);

                if (usersToDelete.length === 0) {
                    sendEvent("error", { message: "No users to delete (cannot delete yourself)" });
                    if (keepAliveInterval) clearInterval(keepAliveInterval);
                    controller.close();
                    return;
                }

                const totalUsers = usersToDelete.length;
                sendEvent("init", { total: totalUsers, message: `Starting fast deletion of ${totalUsers} users...` });

                let dbDeletedCount = 0;
                let authDeletedCount = 0;
                let errorCount = 0;

                // PHASE 1: Delete related data in large batches (very fast)
                sendEvent("progress", {
                    current: 0,
                    total: totalUsers,
                    progress: 5,
                    success: 0,
                    errors: 0,
                    message: "Phase 1: Cleaning up related data..."
                });

                // Process related data cleanup in batches of 100
                const RELATED_DATA_BATCH_SIZE = 100;
                for (let i = 0; i < usersToDelete.length; i += RELATED_DATA_BATCH_SIZE) {
                    const batch = usersToDelete.slice(i, i + RELATED_DATA_BATCH_SIZE);
                    await batchDeleteRelatedData(batch, supabaseAdmin);
                    
                    const progress = Math.round(5 + ((i + batch.length) / usersToDelete.length) * 25);
                    sendEvent("progress", {
                        current: i + batch.length,
                        total: totalUsers,
                        progress,
                        success: 0,
                        errors: 0,
                        message: `Phase 1: Cleaned related data for ${i + batch.length}/${totalUsers} users...`
                    });
                }

                // PHASE 2: Delete users from database in batches (fast)
                sendEvent("progress", {
                    current: 0,
                    total: totalUsers,
                    progress: 35,
                    success: 0,
                    errors: 0,
                    message: "Phase 2: Removing users from database..."
                });

                const DB_BATCH_SIZE = 100;
                for (let i = 0; i < usersToDelete.length; i += DB_BATCH_SIZE) {
                    const batch = usersToDelete.slice(i, i + DB_BATCH_SIZE);
                    const { deleted, failed } = await batchDeleteUsersFromDB(batch, supabaseAdmin);
                    dbDeletedCount += deleted.length;
                    errorCount += failed.length;

                    const progress = Math.round(35 + ((i + batch.length) / usersToDelete.length) * 30);
                    sendEvent("progress", {
                        current: i + batch.length,
                        total: totalUsers,
                        progress,
                        success: dbDeletedCount,
                        errors: errorCount,
                        message: `Phase 2: Removed ${dbDeletedCount}/${totalUsers} users from database...`
                    });
                }

                // PHASE 3: Delete from Supabase Auth (slower due to API limits)
                sendEvent("progress", {
                    current: dbDeletedCount,
                    total: totalUsers,
                    progress: 70,
                    success: dbDeletedCount,
                    errors: errorCount,
                    message: "Phase 3: Removing authentication records..."
                });

                // Process auth deletions in smaller batches
                const AUTH_BATCH_SIZE = 25;
                for (let i = 0; i < usersToDelete.length; i += AUTH_BATCH_SIZE) {
                    const batch = usersToDelete.slice(i, i + AUTH_BATCH_SIZE);
                    const { success, failed } = await batchDeleteUsersFromAuth(batch, supabaseAdmin);
                    authDeletedCount += success;

                    const progress = Math.round(70 + ((i + batch.length) / usersToDelete.length) * 30);
                    sendEvent("progress", {
                        current: i + batch.length,
                        total: totalUsers,
                        progress: Math.min(progress, 99),
                        success: dbDeletedCount,
                        errors: errorCount,
                        message: `Phase 3: Removed ${authDeletedCount}/${totalUsers} auth records...`
                    });
                }

                // Clear keep-alive interval
                if (keepAliveInterval) clearInterval(keepAliveInterval);

                // Send completion
                sendEvent("complete", {
                    success: true,
                    summary: {
                        total: totalUsers,
                        success: dbDeletedCount,
                        error: errorCount,
                    },
                });

                controller.close();
            } catch (error: any) {
                console.error("Bulk delete error:", error);
                if (keepAliveInterval) clearInterval(keepAliveInterval);
                sendEvent("error", { message: error.message || "Bulk deletion failed" });
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
