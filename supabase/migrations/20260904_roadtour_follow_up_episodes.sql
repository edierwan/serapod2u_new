-- RoadTour follow-up episodes.
--
-- Shop Follow-Up is an operational lifecycle, not a recalculation of history.
-- Before this table the queue could only infer "still open" from 7-day scan
-- counts, which freeze once the window matures — so an item could never be
-- closed, and a shop dropped out of view only when the calendar rolled over.
--
-- Episodes are append-only. A shop may accumulate any number of them over time;
-- only one may be OPEN per shop per RoadTour run. Resolved history is kept for
-- audit and is never overwritten by a later episode.

BEGIN;

CREATE TABLE IF NOT EXISTS public.roadtour_follow_ups (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shop_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  roadtour_run_id          uuid REFERENCES public.roadtour_runs(id) ON DELETE SET NULL,
  source_campaign_id       uuid REFERENCES public.roadtour_campaigns(id) ON DELETE SET NULL,
  source_official_visit_id uuid REFERENCES public.roadtour_official_visits(id) ON DELETE SET NULL,

  -- Why the episode was opened. `monthly_decline` and `no_activity` come from
  -- Shop Performance; the rest from the 7-day observation or a manual decision.
  reason text NOT NULL DEFAULT 'manual',

  -- open → the shop is in the active queue. resolved/dismissed → out of it,
  -- kept for audit. A Revisit decision does NOT resolve the episode: the
  -- revisit is a new intervention whose own observation must complete first.
  status text NOT NULL DEFAULT 'open',

  management_action   text,
  assigned_am_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- Set when management chooses Revisit, so the trail runs
  -- follow-up → revisit decision → new campaign → new visit → new 7D observation.
  revisit_campaign_id uuid REFERENCES public.roadtour_campaigns(id) ON DELETE SET NULL,
  revisit_decided_at  timestamptz,

  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolution_note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT roadtour_follow_ups_status_check
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  CONSTRAINT roadtour_follow_ups_reason_check
    CHECK (reason IN ('no_response', 'steep_drop', 'monthly_decline', 'no_activity', 'manual')),
  CONSTRAINT roadtour_follow_ups_action_check
    CHECK (management_action IS NULL OR management_action IN ('monitor', 'contact', 'revisit', 'no_action')),
  -- An episode is resolved exactly when it carries a resolution timestamp.
  CONSTRAINT roadtour_follow_ups_resolved_fields_check
    CHECK ((status = 'open') = (resolved_at IS NULL))
);

-- One OPEN episode per shop per run; resolved history is unlimited.
CREATE UNIQUE INDEX IF NOT EXISTS uq_roadtour_follow_up_open_per_run_shop
  ON public.roadtour_follow_ups (roadtour_run_id, shop_id)
  WHERE status = 'open' AND roadtour_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_roadtour_follow_ups_active
  ON public.roadtour_follow_ups (org_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_roadtour_follow_ups_shop
  ON public.roadtour_follow_ups (shop_id, opened_at DESC);

CREATE OR REPLACE FUNCTION public.roadtour_follow_ups_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_roadtour_follow_ups_updated_at ON public.roadtour_follow_ups;
CREATE TRIGGER trg_roadtour_follow_ups_updated_at
  BEFORE UPDATE ON public.roadtour_follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.roadtour_follow_ups_touch_updated_at();

ALTER TABLE public.roadtour_follow_ups ENABLE ROW LEVEL SECURITY;

-- Same permission surface as roadtour_official_visits.
DROP POLICY IF EXISTS roadtour_follow_ups_admin_select ON public.roadtour_follow_ups;
CREATE POLICY roadtour_follow_ups_admin_select ON public.roadtour_follow_ups
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role_code = ANY (ARRAY['SA','HQ','POWER_USER','HQ_ADMIN','SUPER_ADMIN','ADMIN'])
  ));

DROP POLICY IF EXISTS roadtour_follow_ups_admin_manage ON public.roadtour_follow_ups;
CREATE POLICY roadtour_follow_ups_admin_manage ON public.roadtour_follow_ups
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role_code = ANY (ARRAY['SA','HQ','POWER_USER','HQ_ADMIN','SUPER_ADMIN','ADMIN'])
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role_code = ANY (ARRAY['SA','HQ','POWER_USER','HQ_ADMIN','SUPER_ADMIN','ADMIN'])
  ));

COMMIT;
