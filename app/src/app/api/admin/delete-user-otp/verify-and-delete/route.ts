import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashOtp, logNotificationEvent } from '@/server/auth/passwordResetService'

const PURPOSE = 'user_deletion'

/**
 * POST /api/admin/delete-user-otp/verify-and-delete
 * 
 * Step 2: Verify OTP and execute deletion.
 * 
 * Body: { targetUserId: string, code: string, codeId: string }
 * 
 * Security:
 * - Must be authenticated Super Admin (role_level === 1)
 * - OTP must match (hashed comparison)
 * - OTP must not be expired, used, or invalidated
 * - Max 5 attempts per OTP
 * - Target user must match the one in the OTP request
 * - Full audit trail + cascading cleanup before deletion
 */
export async function POST(request: NextRequest) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

    try {
        const supabase = await createClient()
        const admin = createAdminClient()
        // Untyped alias for tables not in generated Database types
        const db: any = admin

        // --- Auth + Super Admin check ---
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: profile } = await supabase
            .from('users')
            .select('role_code, roles(role_level)')
            .eq('id', user.id)
            .single()

        const roleLevel = (profile as any)?.roles?.role_level
        if (roleLevel !== 1) {
            return NextResponse.json({ error: 'Access denied. Super Admin only.' }, { status: 403 })
        }

        const { targetUserId, code, codeId } = await request.json()
        if (!targetUserId || !code || !codeId) {
            return NextResponse.json({ error: 'targetUserId, code, and codeId are required' }, { status: 400 })
        }

        // Cannot delete yourself
        if (targetUserId === user.id) {
            return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
        }

        // --- Find and validate OTP ---
        const { data: codeRow } = await db
            .from('auth_verification_codes')
            .select('*')
            .eq('id', codeId)
            .eq('purpose', PURPOSE)
            .is('invalidated_at', null)
            .is('used_at', null)
            .single()

        if (!codeRow) {
            return NextResponse.json({ error: 'Invalid or expired verification code. Please request a new one.' }, { status: 400 })
        }

        // Check expiry
        if (new Date(codeRow.expires_at) < new Date()) {
            return NextResponse.json({ error: 'Verification code expired. Please request a new one.' }, { status: 400 })
        }

        // Check attempts
        if (codeRow.attempt_count >= codeRow.max_attempts) {
            // Invalidate the code
            await db
                .from('auth_verification_codes')
                .update({ invalidated_at: new Date().toISOString() })
                .eq('id', codeId)

            return NextResponse.json({ error: 'Too many incorrect attempts. Please request a new code.' }, { status: 400 })
        }

        // Increment attempt
        await db
            .from('auth_verification_codes')
            .update({ attempt_count: (codeRow.attempt_count || 0) + 1 })
            .eq('id', codeId)

        // Verify code hash
        const inputHash = hashOtp(code)
        if (inputHash !== codeRow.code_hash) {
            const remaining = codeRow.max_attempts - (codeRow.attempt_count || 0) - 1
            return NextResponse.json(
                { error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` },
                { status: 400 }
            )
        }

        // Verify target user matches
        const meta = codeRow.meta || {}
        if (meta.target_user_id && meta.target_user_id !== targetUserId) {
            return NextResponse.json({ error: 'Target user mismatch. Please request a new code.' }, { status: 400 })
        }

        // Verify requester matches
        if (codeRow.user_id && codeRow.user_id !== user.id) {
            return NextResponse.json({ error: 'This code was requested by a different admin.' }, { status: 403 })
        }

        // --- OTP verified — proceed with deletion ---
        // Mark code as used
        await db
            .from('auth_verification_codes')
            .update({ used_at: new Date().toISOString(), verified_at: new Date().toISOString() })
            .eq('id', codeId)

        // Get target user info
        const { data: targetUser } = await admin
            .from('users')
            .select('email, phone, full_name')
            .eq('id', targetUserId)
            .single()

        if (!targetUser) {
            return NextResponse.json({ error: 'Target user not found' }, { status: 404 })
        }

        // --- Cascading cleanup (same as deleteUserWithAuth but more thorough) ---
        const cleanupErrors: string[] = []

        // Delete audit_logs
        const { error: e1 } = await admin.from('audit_logs').delete().eq('user_id', targetUserId)
        if (e1) cleanupErrors.push(`audit_logs: ${e1.message}`)

        // Delete points_transactions
        const { error: e2 } = await admin.from('points_transactions').delete().eq('user_id', targetUserId)
        if (e2) cleanupErrors.push(`points_transactions: ${e2.message}`)

        // Delete consumer_activations by email
        if (targetUser.email) {
            const { error: e3 } = await admin.from('consumer_activations').delete().eq('consumer_email', targetUser.email)
            if (e3) cleanupErrors.push(`consumer_activations(email): ${e3.message}`)
        }

        // Delete consumer_activations by phone
        if (targetUser.phone) {
            const { error: e4 } = await admin.from('consumer_activations').delete().eq('consumer_phone', targetUser.phone)
            if (e4) cleanupErrors.push(`consumer_activations(phone): ${e4.message}`)
        }

        // Nullify consumer_qr_scans
        const { error: e5 } = await admin.from('consumer_qr_scans').update({ consumer_id: null }).eq('consumer_id', targetUserId)
        if (e5) cleanupErrors.push(`consumer_qr_scans: ${e5.message}`)

        // Nullify documents.created_by (the FK that was causing the original error)
        const { error: e6 } = await db.from('documents').update({ created_by: null }).eq('created_by', targetUserId)
        if (e6) cleanupErrors.push(`documents: ${e6.message}`)

        // Nullify reference_assignments
        await admin.from('reference_assignments').update({ reference_user_id: null }).eq('reference_user_id', targetUserId)
        await admin.from('reference_assignments').delete().eq('user_id', targetUserId)

        // Delete notification_events for this user
        await db.from('notification_events').delete().eq('user_id', targetUserId)

        // Delete support_conversations
        await db.from('support_conversations').delete().eq('consumer_id', targetUserId)

        // --- Delete from public.users ---
        const { error: dbError } = await admin.from('users').delete().eq('id', targetUserId)

        if (dbError) {
            console.error('❌ User deletion failed after OTP verification:', dbError)

            await logDeletionAudit(admin, {
                operation: 'delete_user_execute',
                userId: user.id,
                userEmail: user.email || null,
                allowed: true,
                reason: `DB delete failed: ${dbError.message} | Target: ${targetUser.full_name || targetUser.email}`,
                ip,
            })

            return NextResponse.json(
                { error: `Deletion failed: ${dbError.message}. Cleanup errors: ${cleanupErrors.join('; ') || 'none'}` },
                { status: 500 }
            )
        }

        // --- Delete from Supabase Auth ---
        const { error: authError } = await admin.auth.admin.deleteUser(targetUserId)

        // --- Audit ---
        await logDeletionAudit(admin, {
            operation: 'delete_user_execute',
            userId: user.id,
            userEmail: user.email || null,
            allowed: true,
            reason: `User deleted: ${targetUser.full_name || targetUser.email} (${targetUser.email}). Auth cleanup: ${authError ? 'failed' : 'ok'}`,
            ip,
        })

        await logNotificationEvent(admin, {
            eventType: 'delete_user_completed',
            phone: codeRow?.phone_normalized,
            userId: user.id,
            status: 'completed',
            meta: {
                target_user_id: targetUserId,
                target_user_name: targetUser.full_name,
                target_user_email: targetUser.email,
                cleanup_errors: cleanupErrors,
            },
            ip,
        })

        return NextResponse.json({
            success: true,
            message: `${targetUser.full_name || targetUser.email} deleted successfully`,
            warning: authError ? 'User records deleted but auth cleanup failed' : undefined,
            cleanupErrors: cleanupErrors.length > 0 ? cleanupErrors : undefined,
        })
    } catch (err: any) {
        console.error('Delete user verify error:', err)
        return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
    }
}

async function logDeletionAudit(
    admin: any,
    entry: { operation: string; userId: string; userEmail: string | null; allowed: boolean; reason: string; ip: string | null }
) {
    const prefix = entry.allowed ? '✅ DELETE-OP' : '🚫 DELETE-OP BLOCKED'
    console.log(`${prefix} | op=${entry.operation} | user=${entry.userEmail ?? entry.userId} | reason=${entry.reason}`)

    try {
        await admin.from('destructive_ops_audit_log').insert({
            operation: entry.operation,
            user_id: entry.userId,
            user_email: entry.userEmail,
            allowed: entry.allowed,
            reason: entry.reason,
            ip_address: entry.ip,
            created_at: new Date().toISOString(),
        })
    } catch { /* best effort */ }
}
