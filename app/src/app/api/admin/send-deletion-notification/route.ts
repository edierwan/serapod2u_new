import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { envGuard } from '@/lib/env-guard'

/**
 * POST /api/admin/send-deletion-notification
 * Send email notification after deletion operations
 * SUPER ADMIN ONLY (role_level = 1)
 *
 * SAFETY: Blocked in development unless DEV_MESSAGING_ENABLED=true
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Development messaging safety check
    if (!envGuard.messagingEnabled()) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'Messaging disabled in development'
      })
    }

    const supabase = await createClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if user is Super Admin
    const { data: profile } = await supabase
      .from('users')
      .select('role_code, roles(role_level)')
      .eq('id', user.id)
      .single()

    if (!profile || !(profile as any).roles || (profile as any).roles.role_level !== 1) {
      return NextResponse.json(
        { error: 'Access denied. Super Admin only.' },
        { status: 403 }
      )
    }

    // Get request body
    const body = await request.json()
    const { deletionType, deletedCount } = body

    if (!deletionType || !deletedCount) {
      return NextResponse.json(
        { error: 'Missing required fields: deletionType, deletedCount' },
        { status: 400 }
      )
    }

    console.log('📧 Sending deletion notification...')
    console.log('Type:', deletionType)
    console.log('Count:', deletedCount)
    console.log('Recipient:', user.email)

    // ========================================
    // PREPARE EMAIL CONTENT
    // ========================================
    const timestamp = new Date().toLocaleString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      dateStyle: 'full',
      timeStyle: 'long'
    })

    let emailSubject = ''
    let emailBody = ''

    if (deletionType === 'transactions') {
      emailSubject = '⚠️ Serapod2U - Transaction Data Deleted'
      emailBody = `
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #f97316; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
              .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; }
              .alert-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 15px 0; }
              .stats { background: white; padding: 15px; border-radius: 6px; margin: 15px 0; }
              .footer { color: #6b7280; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">⚠️ Transaction Data Deletion Notice</h1>
              </div>
              <div class="content">
                <div class="alert-box">
                  <strong>⚠️ Important Notice:</strong><br>
                  Transaction data has been deleted from the Serapod2U system.
                </div>

                <h2>Deletion Summary</h2>
                <div class="stats">
                  <p><strong>Deletion Type:</strong> Transactions Only</p>
                  <p><strong>Records Deleted:</strong> ${deletedCount.toLocaleString()}</p>
                  <p><strong>Performed By:</strong> ${user.email}</p>
                  <p><strong>Timestamp:</strong> ${timestamp}</p>
                </div>

                <h3>What was deleted:</h3>
                <ul>
                  <li>All orders and order items</li>
                  <li>All QR codes (batches, master codes, individual codes)</li>
                  <li>All invoices and payments</li>
                  <li>All shipments</li>
                  <li>All document workflows</li>
                  <li>Related storage files (QR Excel files, documents)</li>
                </ul>

                <h3>What was preserved:</h3>
                <ul>
                  <li>✅ All user accounts</li>
                  <li>✅ All organizations</li>
                  <li>✅ All products and variants</li>
                  <li>✅ All brands and categories</li>
                  <li>✅ All master data</li>
                </ul>

                <p style="margin-top: 20px; color: #059669; font-weight: bold;">
                  ℹ️ Master data remains intact. You can continue creating new transactions.
                </p>

                <div class="footer">
                  <p><strong>Serapod2U Supply Chain Management System</strong></p>
                  <p>This is an automated notification. Do not reply to this email.</p>
                  <p>If you did not perform this action, please contact your system administrator immediately.</p>
                </div>
              </div>
            </div>
          </body>
        </html>
      `
    } else if (deletionType === 'all') {
      emailSubject = '🚨 Serapod2U - Complete System Reset Performed'
      emailBody = `
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #dc2626; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
              .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; }
              .alert-box { background: #fee2e2; border-left: 4px solid #dc2626; padding: 15px; margin: 15px 0; }
              .stats { background: white; padding: 15px; border-radius: 6px; margin: 15px 0; }
              .preserved { background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; margin: 15px 0; }
              .footer { color: #6b7280; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">🚨 Complete System Reset</h1>
              </div>
              <div class="content">
                <div class="alert-box">
                  <strong>🚨 CRITICAL NOTICE:</strong><br>
                  A complete system reset has been performed. All data has been deleted from the Serapod2U system.
                </div>

                <h2>Deletion Summary</h2>
                <div class="stats">
                  <p><strong>Deletion Type:</strong> Complete System Reset</p>
                  <p><strong>Total Deleted:</strong> ${deletedCount.toLocaleString()} (records + files)</p>
                  <p><strong>Performed By:</strong> ${user.email}</p>
                  <p><strong>Timestamp:</strong> ${timestamp}</p>
                </div>

                <h3>Phase 1: Transaction Data</h3>
                <ul>
                  <li>Orders and order items</li>
                  <li>QR codes (batches, master codes, individual codes)</li>
                  <li>Invoices and payments</li>
                  <li>Shipments</li>
                  <li>Document workflows</li>
                  <li>Related storage files</li>
                </ul>

                <h3>Phase 2: Master Data</h3>
                <ul>
                  <li>All products and variants</li>
                  <li>All brands and categories</li>
                  <li>All organizations</li>
                  <li>All shop-distributor relationships</li>
                  <li>All user accounts (except Super Admin)</li>
                </ul>

                <h3>Phase 3: Storage Files</h3>
                <ul>
                  <li>All QR Excel files</li>
                  <li>All documents (invoices, payment proofs)</li>
                  <li>All organization logos</li>
                  <li>All product images</li>
                  <li>All user avatars (except Super Admin)</li>
                </ul>

                <div class="preserved">
                  <strong>✅ Preserved:</strong><br>
                  Your Super Admin account (${user.email}) and its avatar have been preserved.
                </div>

                <p style="margin-top: 20px; color: #dc2626; font-weight: bold;">
                  ⚠️ The system is now in a clean state. You will need to re-create all organizations, users, and products.
                </p>

                <div class="footer">
                  <p><strong>Serapod2U Supply Chain Management System</strong></p>
                  <p>This is an automated notification. Do not reply to this email.</p>
                  <p>If you did not perform this action, please contact your system administrator immediately.</p>
                </div>
              </div>
            </div>
          </body>
        </html>
      `
    } else {
      return NextResponse.json(
        { error: 'Invalid deletion type. Must be "transactions" or "all"' },
        { status: 400 }
      )
    }

    // ========================================
    // SEND EMAIL VIA CONFIGURED PROVIDER
    // ========================================
    
    // Use the new email API to send via configured provider
    const emailResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/email/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': request.headers.get('cookie') || '' // Forward auth cookies
      },
      body: JSON.stringify({
        to: user.email,
        subject: emailSubject,
        html: emailBody,
        from_name: 'Serapod2U System'
      })
    })

    const emailResult = await emailResponse.json()

    if (!emailResponse.ok) {
      console.error('Email send failed:', emailResult)
      return NextResponse.json(
        { 
          error: 'Failed to send notification email', 
          details: emailResult.error,
          note: 'Please configure an email provider in Settings → Notifications → Providers'
        },
        { status: 500 }
      )
    }

    console.log('✅ Email sent successfully via', emailResult.provider)
    console.log('   Message ID:', emailResult.message_id)
    if (emailResult.usage) {
      console.log('   Daily usage:', `${emailResult.usage.today_count}/${emailResult.usage.limit || 'unlimited'}`)
    }

    // ========================================
    // RETURN SUCCESS
    // ========================================
    return NextResponse.json({
      success: true,
      message: 'Deletion notification sent successfully',
      recipient: user.email,
      deletionType,
      deletedCount,
      provider: emailResult.provider,
      message_id: emailResult.message_id,
      usage: emailResult.usage
    })

  } catch (error: any) {
    console.error('❌ Notification error:', error)
    return NextResponse.json(
      { error: 'Failed to send notification', details: error.message },
      { status: 500 }
    )
  }
}
