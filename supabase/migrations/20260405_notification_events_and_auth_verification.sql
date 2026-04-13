-- =============================================================================
-- Migration: notification_events + auth_verification_codes
-- Purpose:   Reusable notification audit trail and secure OTP verification
-- Date:      2026-04-05
-- Supports:  password_reset, registration_verification, phone_verification,
--            campaign_notifications, transaction_alerts, delivery_updates, etc.
-- =============================================================================

-- 1. notification_events — generic outbound/inbound notification activity log
CREATE TABLE IF NOT EXISTS public.notification_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    channel         text NOT NULL,                -- whatsapp, sms, email, push
    provider        text,                         -- baileys, twilio, ses, etc.
    event_type      text NOT NULL,                -- e.g. password_reset_otp_requested
    purpose         text NOT NULL,                -- password_reset, registration_verification, etc.
    recipient_phone text,
    recipient_email text,
    user_id         uuid,
    consumer_id     uuid,
    related_entity_type text,
    related_entity_id   uuid,
    message_template    text,
    message_body        text,                     -- sanitized version
    provider_message_id text,
    provider_status     text,
    status          text NOT NULL DEFAULT 'pending', -- pending, sent, delivered, failed, verified, completed
    error_code      text,
    error_message   text,
    meta            jsonb NOT NULL DEFAULT '{}',
    request_ip      text,
    requested_at    timestamptz,
    sent_at         timestamptz,
    verified_at     timestamptz,
    completed_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes for reporting and lookups
CREATE INDEX IF NOT EXISTS idx_notification_events_channel      ON public.notification_events (channel);
CREATE INDEX IF NOT EXISTS idx_notification_events_provider     ON public.notification_events (provider);
CREATE INDEX IF NOT EXISTS idx_notification_events_event_type   ON public.notification_events (event_type);
CREATE INDEX IF NOT EXISTS idx_notification_events_purpose      ON public.notification_events (purpose);
CREATE INDEX IF NOT EXISTS idx_notification_events_phone        ON public.notification_events (recipient_phone);
CREATE INDEX IF NOT EXISTS idx_notification_events_user_id      ON public.notification_events (user_id);
CREATE INDEX IF NOT EXISTS idx_notification_events_created_at   ON public.notification_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_events_status       ON public.notification_events (status);

-- 2. auth_verification_codes — secure OTP / verification code storage
CREATE TABLE IF NOT EXISTS public.auth_verification_codes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    purpose             text NOT NULL,             -- password_reset, registration, phone_verification
    channel             text NOT NULL,             -- whatsapp, sms, email
    phone_normalized    text NOT NULL,             -- E.164 format e.g. +60192277233
    user_id             uuid,
    consumer_id         uuid,
    code_hash           text NOT NULL,             -- bcrypt/sha256 hash of the OTP
    expires_at          timestamptz NOT NULL,
    verified_at         timestamptz,
    used_at             timestamptz,
    invalidated_at      timestamptz,
    attempt_count       int NOT NULL DEFAULT 0,
    resend_count        int NOT NULL DEFAULT 0,
    max_attempts        int NOT NULL DEFAULT 5,
    request_ip          text,
    request_user_agent  text,
    reset_token         text,                      -- short-lived token issued after OTP verified
    reset_token_expires timestamptz,
    meta                jsonb NOT NULL DEFAULT '{}',
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_auth_verif_phone_purpose
    ON public.auth_verification_codes (phone_normalized, purpose, channel);
CREATE INDEX IF NOT EXISTS idx_auth_verif_active
    ON public.auth_verification_codes (phone_normalized, purpose, channel)
    WHERE invalidated_at IS NULL AND used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_verif_reset_token
    ON public.auth_verification_codes (reset_token)
    WHERE reset_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_verif_created_at
    ON public.auth_verification_codes (created_at DESC);

-- RLS: These tables should only be accessed by service role (server-side).
-- Disable RLS so the admin/service-role client can access freely,
-- and anon/authenticated roles have no direct access.
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_verification_codes ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically. No policies needed for anon/authenticated
-- since all access goes through server-side API routes using the service role key.

-- Grant usage to service_role (already has bypass but explicit for clarity)
GRANT ALL ON public.notification_events TO service_role;
GRANT ALL ON public.auth_verification_codes TO service_role;

-- Deny direct access to anon and authenticated roles
REVOKE ALL ON public.notification_events FROM anon, authenticated;
REVOKE ALL ON public.auth_verification_codes FROM anon, authenticated;
