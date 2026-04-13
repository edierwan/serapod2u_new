-- Add session management columns for single-session enforcement
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS active_session_id TEXT,
  ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMPTZ;
