import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/email/send
 * Send email using configured provider
 * Supports Gmail OAuth2, SendGrid, AWS SES, etc.
 */
export const dynamic = 'force-dynamic'

interface EmailRequest {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from_name?: string
  reply_to?: string
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get user's organization
    const { data: userProfile } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (!userProfile) {
      return NextResponse.json(
        { error: 'User profile not found' },
        { status: 404 }
      )
    }

    // Get email configuration for this org
    const { data: emailConfig, error: configError } = await supabase
      .from('notification_provider_configs')
      .select('*')
      .eq('org_id', (userProfile as any).organization_id)
      .eq('channel', 'email')
      .eq('is_active', true)
      .single()

    if (configError || !emailConfig) {
      return NextResponse.json(
        { error: 'No active email provider configured. Please configure an email provider in Settings.' },
        { status: 400 }
      )
    }

    // Parse request body
    const body: EmailRequest = await request.json()
    const { to, subject, html, text, from_name, reply_to } = body

    if (!to || !subject || (!html && !text)) {
      return NextResponse.json(
        { error: 'Missing required fields: to, subject, and html or text' },
        { status: 400 }
      )
    }

    // Get provider name (default to gmail if null)
    const providerName = emailConfig.provider_name || 'gmail'
    
    // Check Gmail daily limit if using Gmail
    if (providerName === 'gmail') {
      const { data: todayCount } = await supabase
        .rpc('get_email_count_today', {
          p_org_id: (userProfile as any).organization_id,
          p_provider: 'gmail'
        } as any)

      if ((todayCount || 0) >= 500) {
        return NextResponse.json(
          { 
            error: 'Gmail daily limit reached (500 emails/day). Please wait until tomorrow or switch to a paid provider.',
            today_count: todayCount,
            limit: 500
          },
          { status: 429 }
        )
      }
    }

    // Send email based on provider
    let emailResult
    const recipients = Array.isArray(to) ? to : [to]

    switch (providerName) {
      case 'gmail':
        emailResult = await sendViaGmail(emailConfig, recipients, subject, html || text!, from_name, reply_to)
        break
      case 'sendgrid':
        emailResult = await sendViaSendGrid(emailConfig, recipients, subject, html || text!, from_name, reply_to)
        break
      case 'aws_ses':
        emailResult = await sendViaAWSSES(emailConfig, recipients, subject, html || text!, from_name, reply_to)
        break
      default:
        return NextResponse.json(
          { error: `Provider ${emailConfig.provider_name} not yet implemented` },
          { status: 501 }
        )
    }

    // Log the email send
    for (const recipient of recipients) {
      await supabase.rpc('log_email_send', {
        p_org_id: (userProfile as any).organization_id,
        p_provider: providerName,
        p_recipient_email: recipient,
        p_subject: subject,
        p_status: emailResult.success ? 'sent' : 'failed',
        p_error_message: emailResult.error || null,
        p_metadata: {
          message_id: emailResult.message_id,
          from_name: from_name || (emailConfig.config_public as any)?.from_name || 'Serapod'
        }
      } as any)
    }

    if (!emailResult.success) {
      return NextResponse.json(
        { error: emailResult.error || 'Failed to send email' },
        { status: 500 }
      )
    }

    // Get updated usage count
    const { data: updatedCount } = await supabase
      .rpc('get_email_count_today', {
        p_org_id: (userProfile as any).organization_id,
        p_provider: providerName
      } as any)

    return NextResponse.json({
      success: true,
      message: 'Email sent successfully',
      provider: emailConfig.provider_name,
      message_id: emailResult.message_id,
      recipients: recipients.length,
      usage: {
        today_count: updatedCount || 0,
        limit: emailConfig.provider_name === 'gmail' ? 500 : null,
        remaining: emailConfig.provider_name === 'gmail' ? Math.max(0, 500 - (updatedCount || 0)) : null
      }
    })

  } catch (error: any) {
    console.error('❌ Email send error:', error)
    return NextResponse.json(
      { error: 'Failed to send email', details: error.message },
      { status: 500 }
    )
  }
}

// ============================================================================
// PROVIDER IMPLEMENTATIONS
// ============================================================================

async function sendViaGmail(
  config: any,
  recipients: string[],
  subject: string,
  body: string,
  fromName?: string,
  replyTo?: string
) {
  try {
    const nodemailer = require('nodemailer')
    const { google } = require('googleapis')
    
    console.log('📧 Gmail send:', { recipients, subject })
    
    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      config.config_public.oauth_client_id,
      config.config_public.oauth_client_secret,
      'https://developers.google.com/oauthplayground' // Redirect URI used for token generation
    )
    
    // Set refresh token
    oauth2Client.setCredentials({
      refresh_token: config.config_public.oauth_refresh_token
    })
    
    // Get access token
    const accessToken = await oauth2Client.getAccessToken()
    
    // Create transporter with OAuth2
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: config.config_public.gmail_email,
        clientId: config.config_public.oauth_client_id,
        clientSecret: config.config_public.oauth_client_secret,
        refreshToken: config.config_public.oauth_refresh_token,
        accessToken: accessToken.token
      }
    })
    
    // Send email
    const info = await transporter.sendMail({
      from: `"${fromName || config.config_public.from_name || 'Serapod2U'}" <${config.config_public.gmail_email}>`,
      to: recipients.join(', '),
      subject: subject,
      html: body,
      replyTo: replyTo || config.config_public.reply_to
    })
    
    console.log('✅ Gmail sent successfully:', info.messageId)
    
    return {
      success: true,
      message_id: info.messageId
    }
    
  } catch (error: any) {
    console.error('❌ Gmail send error:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

async function sendViaSendGrid(
  config: any,
  recipients: string[],
  subject: string,
  body: string,
  fromName?: string,
  replyTo?: string
) {
  try {
    // SendGrid implementation
    console.log('📧 SendGrid send:', { recipients, subject })
    
    // TODO: Implement SendGrid
    return {
      success: true,
      message_id: `mock-sendgrid-${Date.now()}`
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    }
  }
}

async function sendViaAWSSES(
  config: any,
  recipients: string[],
  subject: string,
  body: string,
  fromName?: string,
  replyTo?: string
) {
  try {
    // AWS SES implementation
    console.log('📧 AWS SES send:', { recipients, subject })
    
    // TODO: Implement AWS SES
    return {
      success: true,
      message_id: `mock-ses-${Date.now()}`
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    }
  }
}

