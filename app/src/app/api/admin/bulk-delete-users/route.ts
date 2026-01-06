import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

// Configure route to be dynamic
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Increase max duration for large bulk deletions (10 minutes)
export const maxDuration = 600;

// Batch processing configuration
const BATCH_SIZE = 10; // Process 10 users in parallel
const PROGRESS_UPDATE_INTERVAL = 10; // Update progress every 10 users
const KEEP_ALIVE_INTERVAL = 15000; // Send keep-alive ping every 15 seconds
const MAX_RETRIES = 2; // Retry failed deletions up to 2 times

/**
 * Delete a single user with all related data
 */
async function deleteUserWithData(
    userId: string,
    supabaseAdmin: any
): Promise<{ success: boolean; error?: string }> {
    try {
        // Get user's email and phone for related data cleanup
        const { data: targetUser } = await supabaseAdmin
            .from("users")
            .select("email, phone")
            .eq("id", userId)
            .single();

        // Delete audit_logs
        await supabaseAdmin
            .from("audit_logs")
            .delete()
            .eq("user_id", userId);

        // Delete points_transactions
        await supabaseAdmin
            .from("points_transactions")
            .delete()
            .eq("user_id", userId);

        // Delete consumer_activations by email
        if (targetUser?.email) {
            await supabaseAdmin
                .from("consumer_activations")
                .delete()
                .eq("consumer_email", targetUser.email);
        }

        // Delete consumer_activations by phone
        if (targetUser?.phone) {
            await supabaseAdmin
                .from("consumer_activations")
                .delete()
                .eq("consumer_phone", targetUser.phone);
        }

        // Set null on consumer_qr_scans
        await supabaseAdmin
            .from("consumer_qr_scans")
            .update({ consumer_id: null })
            .eq("consumer_id", userId);

        // Delete from users table
        const { error: dbError } = await supabaseAdmin
            .from("users")
            .delete()
            .eq("id", userId);

        if (dbError) {
            return { success: false, error: `DB delete failed: ${dbError.message}` };
        }

        // Delete from Supabase Auth
        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);

        if (authError) {
            // User deleted from DB but auth failed - still consider success
            return { success: true, error: "Auth deletion failed but user removed from database" };
        }

        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message || "Unknown error" };
    }
}

/**
 * Retry wrapper for deletions
 */
async function deleteWithRetry(
    userId: string,
    supabaseAdmin: any,
    maxRetries: number = MAX_RETRIES
): Promise<{ success: boolean; error?: string }> {
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = await deleteUserWithData(userId, supabaseAdmin);
        if (result.success) {
            return result;
        }
        lastError = result.error;
        
        // Wait before retry
        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
    }

    return { success: false, error: lastError };
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

                const body = await request.json();
                const { userIds, callerId, callerRoleCode } = body;

                if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
                    sendEvent("error", { message: "No user IDs provided" });
                    controller.close();
                    return;
                }

                // Verify caller has permission
                if (!callerId) {
                    sendEvent("error", { message: "Caller ID required" });
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
                    controller.close();
                    return;
                }

                const roleLevel = (callerProfile.roles as any)?.role_level;
                if (roleLevel !== 1 && roleLevel !== 10) {
                    sendEvent("error", { message: "Unauthorized: Only administrators can delete users" });
                    controller.close();
                    return;
                }

                // Filter out the caller's own ID
                const usersToDelete = userIds.filter((id: string) => id !== callerId);

                if (usersToDelete.length === 0) {
                    sendEvent("error", { message: "No users to delete (cannot delete yourself)" });
                    controller.close();
                    return;
                }

                const totalUsers = usersToDelete.length;
                sendEvent("init", { total: totalUsers, message: `Starting deletion of ${totalUsers} users...` });

                let successCount = 0;
                let errorCount = 0;
                let lastProgressUpdate = Date.now();
                let lastKeepAlive = Date.now();
                const errors: Array<{ userId: string; error: string }> = [];

                // Keep-alive ping function
                const sendKeepAlive = () => {
                    const now = Date.now();
                    if (now - lastKeepAlive >= KEEP_ALIVE_INTERVAL) {
                        sendEvent("ping", { timestamp: now });
                        lastKeepAlive = now;
                    }
                };

                // Process users in parallel batches
                for (let i = 0; i < usersToDelete.length; i += BATCH_SIZE) {
                    sendKeepAlive();

                    const batch = usersToDelete.slice(i, Math.min(i + BATCH_SIZE, usersToDelete.length));

                    // Process batch in parallel
                    const batchPromises = batch.map(async (userId: string) => {
                        const result = await deleteWithRetry(userId, supabaseAdmin);
                        return { userId, ...result };
                    });

                    const batchResults = await Promise.all(batchPromises);

                    // Count results
                    for (const result of batchResults) {
                        if (result.success) {
                            successCount++;
                        } else {
                            errorCount++;
                            if (result.error) {
                                errors.push({ userId: result.userId, error: result.error });
                            }
                        }
                    }

                    const currentProcessed = Math.min(i + BATCH_SIZE, usersToDelete.length);
                    const now = Date.now();

                    // Send progress update
                    if (currentProcessed % PROGRESS_UPDATE_INTERVAL === 0 ||
                        currentProcessed === usersToDelete.length ||
                        now - lastProgressUpdate >= 2000) {
                        const progress = Math.round((currentProcessed / totalUsers) * 100);
                        sendEvent("progress", {
                            current: currentProcessed,
                            total: totalUsers,
                            progress,
                            success: successCount,
                            errors: errorCount,
                            message: `Deleting ${currentProcessed} of ${totalUsers} users (${progress}%)`
                        });
                        lastProgressUpdate = now;
                    }

                    // Small delay between batches
                    if (i + BATCH_SIZE < usersToDelete.length) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }

                // Send final keep-alive
                sendKeepAlive();

                // Send completion
                sendEvent("complete", {
                    success: true,
                    summary: {
                        total: totalUsers,
                        success: successCount,
                        error: errorCount,
                    },
                    errors: errors.slice(0, 10), // Only send first 10 errors
                });

                controller.close();
            } catch (error: any) {
                console.error("Bulk delete error:", error);
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
