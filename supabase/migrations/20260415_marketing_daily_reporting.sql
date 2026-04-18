BEGIN;

ALTER TABLE public.marketing_campaigns
  DROP CONSTRAINT IF EXISTS marketing_campaigns_objective_check;

ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_objective_check
  CHECK (
    objective = ANY (
      ARRAY[
        'Promo'::text,
        'Announcement'::text,
        'Product Update'::text,
        'Event'::text,
        'Winback'::text,
        'Loyalty Reminder'::text,
        'Daily Reporting'::text
      ]
    )
  );

ALTER TABLE public.marketing_send_logs
  ADD COLUMN IF NOT EXISTS report_date date,
  ADD COLUMN IF NOT EXISTS report_type text,
  ADD COLUMN IF NOT EXISTS message_snapshot text,
  ADD COLUMN IF NOT EXISTS reply_enabled boolean DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketing_send_logs_report_type_check'
  ) THEN
    ALTER TABLE public.marketing_send_logs
      ADD CONSTRAINT marketing_send_logs_report_type_check
      CHECK (report_type IS NULL OR report_type = ANY (ARRAY['daily'::text, 'weekly'::text]));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.marketing_report_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  send_log_id uuid NOT NULL REFERENCES public.marketing_send_logs(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_phone text NOT NULL,
  recipient_name text,
  report_date date NOT NULL,
  report_type text NOT NULL CHECK (report_type = ANY (ARRAY['daily'::text, 'weekly'::text])),
  period_start timestamp with time zone NOT NULL,
  period_end timestamp with time zone NOT NULL,
  unique_customer_count integer NOT NULL DEFAULT 0,
  unique_customer_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  message_snapshot text NOT NULL,
  reply_enabled boolean NOT NULL DEFAULT true,
  last_detail_page_sent integer NOT NULL DEFAULT 0,
  last_reply_received text,
  last_reply_action_triggered text,
  last_reply_received_at timestamp with time zone,
  status text NOT NULL DEFAULT 'active' CHECK (status = ANY (ARRAY['active'::text, 'expired'::text, 'closed'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_report_sessions_send_log_id
  ON public.marketing_report_sessions(send_log_id);

CREATE INDEX IF NOT EXISTS idx_marketing_report_sessions_phone_status
  ON public.marketing_report_sessions(recipient_phone, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_report_sessions_org_id
  ON public.marketing_report_sessions(org_id);

CREATE TABLE IF NOT EXISTS public.marketing_reply_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.marketing_report_sessions(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_phone text NOT NULL,
  reply_received text NOT NULL,
  reply_action text,
  requested_page integer,
  response_snapshot text,
  status text NOT NULL DEFAULT 'success' CHECK (status = ANY (ARRAY['success'::text, 'failed'::text, 'ignored'::text])),
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_reply_logs_session_id
  ON public.marketing_reply_logs(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_reply_logs_org_id
  ON public.marketing_reply_logs(org_id);

ALTER TABLE public.marketing_report_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_reply_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view marketing report sessions for their org" ON public.marketing_report_sessions;
CREATE POLICY "Users can view marketing report sessions for their org"
  ON public.marketing_report_sessions
  FOR SELECT
  USING (
    org_id IN (
      SELECT users.organization_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert marketing report sessions for their org" ON public.marketing_report_sessions;
CREATE POLICY "Users can insert marketing report sessions for their org"
  ON public.marketing_report_sessions
  FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT users.organization_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update marketing report sessions for their org" ON public.marketing_report_sessions;
CREATE POLICY "Users can update marketing report sessions for their org"
  ON public.marketing_report_sessions
  FOR UPDATE
  USING (
    org_id IN (
      SELECT users.organization_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT users.organization_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view marketing reply logs for their org" ON public.marketing_reply_logs;
CREATE POLICY "Users can view marketing reply logs for their org"
  ON public.marketing_reply_logs
  FOR SELECT
  USING (
    org_id IN (
      SELECT users.organization_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert marketing reply logs for their org" ON public.marketing_reply_logs;
CREATE POLICY "Users can insert marketing reply logs for their org"
  ON public.marketing_reply_logs
  FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT users.organization_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS update_marketing_report_sessions_updated_at ON public.marketing_report_sessions;
CREATE TRIGGER update_marketing_report_sessions_updated_at
  BEFORE UPDATE ON public.marketing_report_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMIT;