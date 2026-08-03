-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  INCENTIVE SYSTEM – PRODUCTION MIGRATION                                ║
-- ║  Tables: campaigns, rules, eligibility, payouts, notifications, logs    ║
-- ║  Run this in Supabase SQL Editor                                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════
-- 1. ENUMS
-- ════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE incentive_campaign_status AS ENUM ('draft','active','paused','ended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE incentive_campaign_type AS ENUM ('volume','growth','streak','product-mix','tiered');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE incentive_reward_type AS ENUM ('cash','cash_tiered','rebate_percent','credit_note','gift','points');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE incentive_target_metric AS ENUM ('revenue','order_count','cases_sold','growth_percent','order_streak','sku_diversity');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE incentive_calculation_basis AS ENUM ('approved_only','approved_and_paid','exclude_cancelled','exclude_returns');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE incentive_campaign_logic AS ENUM ('cumulative','monthly_reset','tier_stacking','highest_tier_only');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE incentive_eligibility_scope AS ENUM ('all_distributors','by_tier','selected','by_region','by_brand');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE incentive_payout_status AS ENUM ('qualified','pending_approval','approved','rejected','processing','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE incentive_payment_method AS ENUM ('bank_transfer','credit_note','rebate_invoice','internal_wallet');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE incentive_notif_status AS ENUM ('draft','scheduled','sending','sent','partially_failed','failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE incentive_notif_channel AS ENUM ('whatsapp','in_app','whatsapp_and_inapp');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════════
-- 2. INCENTIVE CAMPAIGNS (master table)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.incentive_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  type          incentive_campaign_type NOT NULL DEFAULT 'volume',
  status        incentive_campaign_status NOT NULL DEFAULT 'draft',
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_campaigns_company ON public.incentive_campaigns(company_id);
CREATE INDEX IF NOT EXISTS idx_incentive_campaigns_status ON public.incentive_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_incentive_campaigns_dates ON public.incentive_campaigns(start_date, end_date);


-- ════════════════════════════════════════════════════════════════
-- 3. CAMPAIGN REWARD RULES
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.incentive_reward_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.incentive_campaigns(id) ON DELETE CASCADE,
  reward_type   incentive_reward_type NOT NULL DEFAULT 'cash',
  reward_value  numeric(12,2) NOT NULL DEFAULT 0,
  reward_formula text,  -- e.g. 'flat', 'per_unit', 'percentage'
  min_reward    numeric(12,2),
  max_reward    numeric(12,2),
  tier_config   jsonb DEFAULT '[]'::jsonb,  -- for tiered: [{min:0,max:100,value:500},{min:101,max:500,value:1000}]
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_reward_rules_campaign ON public.incentive_reward_rules(campaign_id);


-- ════════════════════════════════════════════════════════════════
-- 4. CAMPAIGN QUALIFICATION RULES
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.incentive_qualification_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         uuid NOT NULL REFERENCES public.incentive_campaigns(id) ON DELETE CASCADE,
  target_metric       incentive_target_metric NOT NULL DEFAULT 'revenue',
  target_value        numeric(14,2) NOT NULL DEFAULT 0,
  calculation_period  text NOT NULL DEFAULT 'campaign_duration', -- campaign_duration, monthly, quarterly
  calculation_basis   incentive_calculation_basis NOT NULL DEFAULT 'approved_only',
  campaign_logic      incentive_campaign_logic NOT NULL DEFAULT 'cumulative',
  secondary_metric    incentive_target_metric,
  secondary_value     numeric(14,2),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_qualification_rules_campaign ON public.incentive_qualification_rules(campaign_id);


-- ════════════════════════════════════════════════════════════════
-- 5. CAMPAIGN ELIGIBILITY
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.incentive_eligibility (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.incentive_campaigns(id) ON DELETE CASCADE,
  scope         incentive_eligibility_scope NOT NULL DEFAULT 'all_distributors',
  tier_filter   text[],           -- ['gold','platinum'] 
  org_ids       uuid[],           -- specific org IDs
  region_filter text[],           -- region codes
  brand_filter  text[],           -- brand/category codes
  exclude_org_ids uuid[],         -- explicitly excluded
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_eligibility_campaign ON public.incentive_eligibility(campaign_id);


-- ════════════════════════════════════════════════════════════════
-- 6. CAMPAIGN BUDGET
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.incentive_budgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.incentive_campaigns(id) ON DELETE CASCADE,
  budget_cap    numeric(14,2) NOT NULL DEFAULT 0,
  total_spend   numeric(14,2) NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'MYR',
  auto_pause_on_cap boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_budgets_campaign ON public.incentive_budgets(campaign_id);


-- ════════════════════════════════════════════════════════════════
-- 7. CAMPAIGN PARTICIPANTS (enrollment)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.incentive_participants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.incentive_campaigns(id) ON DELETE CASCADE,
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrolled_at   timestamptz NOT NULL DEFAULT now(),
  current_value numeric(14,2) NOT NULL DEFAULT 0,    -- current metric value
  qualified     boolean NOT NULL DEFAULT false,
  qualified_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_incentive_participants_campaign ON public.incentive_participants(campaign_id);
CREATE INDEX IF NOT EXISTS idx_incentive_participants_org ON public.incentive_participants(org_id);
CREATE INDEX IF NOT EXISTS idx_incentive_participants_qualified ON public.incentive_participants(campaign_id, qualified);


-- ════════════════════════════════════════════════════════════════
-- 8. INCENTIVE PAYOUTS
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.incentive_payouts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id       uuid NOT NULL REFERENCES public.incentive_campaigns(id) ON DELETE CASCADE,
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  participant_id    uuid REFERENCES public.incentive_participants(id),
  
  -- Qualification details
  qualified_metric  text NOT NULL,
  qualified_value   numeric(14,2) NOT NULL DEFAULT 0,
  target_value      numeric(14,2) NOT NULL DEFAULT 0,
  qualification_date timestamptz NOT NULL DEFAULT now(),

  -- Reward
  reward_amount     numeric(12,2) NOT NULL DEFAULT 0,
  reward_type       incentive_reward_type NOT NULL DEFAULT 'cash',
  currency          text NOT NULL DEFAULT 'MYR',
  
  -- Status workflow
  status            incentive_payout_status NOT NULL DEFAULT 'qualified',
  
  -- Approval
  approved_by       uuid REFERENCES auth.users(id),
  approved_at       timestamptz,
  rejection_reason  text,
  adjusted_amount   numeric(12,2),  -- if admin adjusts reward
  
  -- Payment execution
  payment_method    incentive_payment_method,
  paid_at           timestamptz,
  payment_reference text,
  payment_notes     text,
  
  -- Audit
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_payouts_company ON public.incentive_payouts(company_id);
CREATE INDEX IF NOT EXISTS idx_incentive_payouts_campaign ON public.incentive_payouts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_incentive_payouts_org ON public.incentive_payouts(org_id);
CREATE INDEX IF NOT EXISTS idx_incentive_payouts_status ON public.incentive_payouts(status);
CREATE INDEX IF NOT EXISTS idx_incentive_payouts_paid ON public.incentive_payouts(paid_at) WHERE paid_at IS NOT NULL;


-- ════════════════════════════════════════════════════════════════
-- 9. NOTIFICATION TEMPLATES
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.incentive_notification_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  message_type  text NOT NULL,  -- campaign_launch, milestone, weekly_progress, campaign_ending, tier_upgrade, reward_payout
  channel       incentive_notif_channel NOT NULL DEFAULT 'whatsapp',
  template_body text NOT NULL,
  variables     text[] DEFAULT '{}',  -- list of supported variables e.g. {campaign_name}, {dist_name}
  is_enabled    boolean NOT NULL DEFAULT true,
  trigger_type  text,            -- 'event', 'scheduled', 'manual'
  schedule_cron text,            -- for scheduled: '0 9 * * 1' (Mon 9am)
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_notif_templates_company ON public.incentive_notification_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_incentive_notif_templates_type ON public.incentive_notification_templates(message_type);


-- ════════════════════════════════════════════════════════════════
-- 10. NOTIFICATION BLASTS (send jobs)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.incentive_notification_blasts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id     uuid REFERENCES public.incentive_notification_templates(id),
  campaign_id     uuid REFERENCES public.incentive_campaigns(id),
  
  subject         text NOT NULL,
  message_body    text NOT NULL,
  channel         incentive_notif_channel NOT NULL DEFAULT 'whatsapp',
  
  -- Recipients
  total_recipients  int NOT NULL DEFAULT 0,
  valid_recipients  int NOT NULL DEFAULT 0,
  invalid_recipients int NOT NULL DEFAULT 0,
  recipient_filter  jsonb,  -- {scope:'all', tiers:[], org_ids:[]}
  
  -- Status
  status          incentive_notif_status NOT NULL DEFAULT 'draft',
  scheduled_at    timestamptz,
  sent_at         timestamptz,
  completed_at    timestamptz,
  
  -- Results
  delivered_count int NOT NULL DEFAULT 0,
  read_count      int NOT NULL DEFAULT 0,
  failed_count    int NOT NULL DEFAULT 0,
  
  -- Audit
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_notif_blasts_company ON public.incentive_notification_blasts(company_id);
CREATE INDEX IF NOT EXISTS idx_incentive_notif_blasts_status ON public.incentive_notification_blasts(status);
CREATE INDEX IF NOT EXISTS idx_incentive_notif_blasts_scheduled ON public.incentive_notification_blasts(scheduled_at) WHERE scheduled_at IS NOT NULL;


-- ════════════════════════════════════════════════════════════════
-- 11. NOTIFICATION RECIPIENTS (per-recipient delivery tracking)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.incentive_notification_recipients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blast_id      uuid NOT NULL REFERENCES public.incentive_notification_blasts(id) ON DELETE CASCADE,
  org_id        uuid NOT NULL REFERENCES public.organizations(id),
  phone_number  text,
  contact_name  text,
  
  -- Status
  status        text NOT NULL DEFAULT 'pending',  -- pending, sent, delivered, read, failed
  sent_at       timestamptz,
  delivered_at  timestamptz,
  read_at       timestamptz,
  failed_at     timestamptz,
  error_message text,
  
  -- Message
  final_message text,           -- actual message sent (with variables resolved)
  whatsapp_message_id text,     -- external message ID from WA gateway
  
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_notif_recipients_blast ON public.incentive_notification_recipients(blast_id);
CREATE INDEX IF NOT EXISTS idx_incentive_notif_recipients_org ON public.incentive_notification_recipients(org_id);
CREATE INDEX IF NOT EXISTS idx_incentive_notif_recipients_status ON public.incentive_notification_recipients(blast_id, status);


-- ════════════════════════════════════════════════════════════════
-- 12. PAYOUT AUDIT LOG
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.incentive_payout_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id     uuid NOT NULL REFERENCES public.incentive_payouts(id) ON DELETE CASCADE,
  action        text NOT NULL,  -- created, approved, rejected, adjusted, paid, failed
  old_status    text,
  new_status    text,
  amount_before numeric(12,2),
  amount_after  numeric(12,2),
  notes         text,
  performed_by  uuid REFERENCES auth.users(id),
  performed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_payout_audit_payout ON public.incentive_payout_audit_log(payout_id);
CREATE INDEX IF NOT EXISTS idx_incentive_payout_audit_date ON public.incentive_payout_audit_log(performed_at);


-- ════════════════════════════════════════════════════════════════
-- 13. UPDATED_AT TRIGGERS
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ 
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'incentive_campaigns',
    'incentive_reward_rules',
    'incentive_qualification_rules',
    'incentive_eligibility',
    'incentive_budgets',
    'incentive_participants',
    'incentive_payouts',
    'incentive_notification_templates',
    'incentive_notification_blasts'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I; 
       CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I 
       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END $$;


-- ════════════════════════════════════════════════════════════════
-- 14. ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE public.incentive_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentive_reward_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentive_qualification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentive_eligibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentive_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentive_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentive_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentive_notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentive_notification_blasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentive_notification_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentive_payout_audit_log ENABLE ROW LEVEL SECURITY;

-- Policies: authenticated users with company access
-- Campaigns
DROP POLICY IF EXISTS "incentive_campaigns_select" ON public.incentive_campaigns;
CREATE POLICY "incentive_campaigns_select" ON public.incentive_campaigns
  FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS "incentive_campaigns_insert" ON public.incentive_campaigns;
CREATE POLICY "incentive_campaigns_insert" ON public.incentive_campaigns
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS "incentive_campaigns_update" ON public.incentive_campaigns;
CREATE POLICY "incentive_campaigns_update" ON public.incentive_campaigns
  FOR UPDATE TO authenticated
  USING (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS "incentive_campaigns_delete" ON public.incentive_campaigns;
CREATE POLICY "incentive_campaigns_delete" ON public.incentive_campaigns
  FOR DELETE TO authenticated
  USING (company_id = public.get_user_company_id());

-- Child tables: access via campaign join
DO $$
DECLARE
  child_table text;
BEGIN
  FOREACH child_table IN ARRAY ARRAY[
    'incentive_reward_rules',
    'incentive_qualification_rules',
    'incentive_eligibility',
    'incentive_budgets',
    'incentive_participants'
  ] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "%1$s_select" ON public.%1$I;
       CREATE POLICY "%1$s_select" ON public.%1$I
         FOR SELECT TO authenticated
         USING (campaign_id IN (
           SELECT ic.id FROM public.incentive_campaigns ic
           WHERE ic.company_id = public.get_user_company_id()
         ));
       DROP POLICY IF EXISTS "%1$s_insert" ON public.%1$I;
       CREATE POLICY "%1$s_insert" ON public.%1$I
         FOR INSERT TO authenticated
         WITH CHECK (campaign_id IN (
           SELECT ic.id FROM public.incentive_campaigns ic
           WHERE ic.company_id = public.get_user_company_id()
         ));
       DROP POLICY IF EXISTS "%1$s_update" ON public.%1$I;
       CREATE POLICY "%1$s_update" ON public.%1$I
         FOR UPDATE TO authenticated
         USING (campaign_id IN (
           SELECT ic.id FROM public.incentive_campaigns ic
           WHERE ic.company_id = public.get_user_company_id()
         ));
       DROP POLICY IF EXISTS "%1$s_delete" ON public.%1$I;
       CREATE POLICY "%1$s_delete" ON public.%1$I
         FOR DELETE TO authenticated
         USING (campaign_id IN (
           SELECT ic.id FROM public.incentive_campaigns ic
           WHERE ic.company_id = public.get_user_company_id()
         ));',
      child_table
    );
  END LOOP;
END $$;

-- Payouts
DROP POLICY IF EXISTS "incentive_payouts_select" ON public.incentive_payouts;
CREATE POLICY "incentive_payouts_select" ON public.incentive_payouts
  FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS "incentive_payouts_insert" ON public.incentive_payouts;
CREATE POLICY "incentive_payouts_insert" ON public.incentive_payouts
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS "incentive_payouts_update" ON public.incentive_payouts;
CREATE POLICY "incentive_payouts_update" ON public.incentive_payouts
  FOR UPDATE TO authenticated
  USING (company_id = public.get_user_company_id());

-- Notification templates
DROP POLICY IF EXISTS "incentive_notif_templates_select" ON public.incentive_notification_templates;
CREATE POLICY "incentive_notif_templates_select" ON public.incentive_notification_templates
  FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS "incentive_notif_templates_insert" ON public.incentive_notification_templates;
CREATE POLICY "incentive_notif_templates_insert" ON public.incentive_notification_templates
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS "incentive_notif_templates_update" ON public.incentive_notification_templates;
CREATE POLICY "incentive_notif_templates_update" ON public.incentive_notification_templates
  FOR UPDATE TO authenticated
  USING (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS "incentive_notif_templates_delete" ON public.incentive_notification_templates;
CREATE POLICY "incentive_notif_templates_delete" ON public.incentive_notification_templates
  FOR DELETE TO authenticated
  USING (company_id = public.get_user_company_id());

-- Notification blasts
DROP POLICY IF EXISTS "incentive_notif_blasts_select" ON public.incentive_notification_blasts;
CREATE POLICY "incentive_notif_blasts_select" ON public.incentive_notification_blasts
  FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS "incentive_notif_blasts_insert" ON public.incentive_notification_blasts;
CREATE POLICY "incentive_notif_blasts_insert" ON public.incentive_notification_blasts
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS "incentive_notif_blasts_update" ON public.incentive_notification_blasts;
CREATE POLICY "incentive_notif_blasts_update" ON public.incentive_notification_blasts
  FOR UPDATE TO authenticated
  USING (company_id = public.get_user_company_id());

-- Notification recipients
DROP POLICY IF EXISTS "incentive_notif_recipients_select" ON public.incentive_notification_recipients;
CREATE POLICY "incentive_notif_recipients_select" ON public.incentive_notification_recipients
  FOR SELECT TO authenticated
  USING (blast_id IN (
    SELECT b.id FROM public.incentive_notification_blasts b
    WHERE b.company_id = public.get_user_company_id()
  ));

DROP POLICY IF EXISTS "incentive_notif_recipients_insert" ON public.incentive_notification_recipients;
CREATE POLICY "incentive_notif_recipients_insert" ON public.incentive_notification_recipients
  FOR INSERT TO authenticated
  WITH CHECK (blast_id IN (
    SELECT b.id FROM public.incentive_notification_blasts b
    WHERE b.company_id = public.get_user_company_id()
  ));

DROP POLICY IF EXISTS "incentive_notif_recipients_update" ON public.incentive_notification_recipients;
CREATE POLICY "incentive_notif_recipients_update" ON public.incentive_notification_recipients
  FOR UPDATE TO authenticated
  USING (blast_id IN (
    SELECT b.id FROM public.incentive_notification_blasts b
    WHERE b.company_id = public.get_user_company_id()
  ));

-- Payout audit log
DROP POLICY IF EXISTS "incentive_payout_audit_select" ON public.incentive_payout_audit_log;
CREATE POLICY "incentive_payout_audit_select" ON public.incentive_payout_audit_log
  FOR SELECT TO authenticated
  USING (payout_id IN (
    SELECT po.id FROM public.incentive_payouts po
    WHERE po.company_id = public.get_user_company_id()
  ));

DROP POLICY IF EXISTS "incentive_payout_audit_insert" ON public.incentive_payout_audit_log;
CREATE POLICY "incentive_payout_audit_insert" ON public.incentive_payout_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (payout_id IN (
    SELECT po.id FROM public.incentive_payouts po
    WHERE po.company_id = public.get_user_company_id()
  ));


-- ════════════════════════════════════════════════════════════════
-- 15. SEED DEFAULT NOTIFICATION TEMPLATES
-- ════════════════════════════════════════════════════════════════

INSERT INTO public.incentive_notification_templates (
  company_id, name, description, message_type, channel, template_body, variables, is_enabled, trigger_type
)
SELECT 
  c.id,
  t.name,
  t.description,
  t.message_type,
  t.channel::incentive_notif_channel,
  t.template_body,
  t.variables::text[],
  t.is_enabled,
  t.trigger_type
FROM public.organizations c
CROSS JOIN (VALUES
  (
    'Campaign Launch Announcement',
    'Sent when a new campaign goes active',
    'campaign_launch',
    'whatsapp_and_inapp',
    E'🎯 New Incentive Campaign: {campaign_name}\n\nTarget: {target_metric} ≥ {target_value}\nReward: {reward_type} RM{reward_value}\nPeriod: {start_date} – {end_date}\n\nStart ordering now to qualify!',
    '{campaign_name,target_metric,target_value,reward_type,reward_value,start_date,end_date}',
    true,
    'event'
  ),
  (
    'Milestone Achievement Alert',
    'Sent when distributor hits 50%, 75%, 100% of target',
    'milestone',
    'whatsapp',
    E'🏆 Congratulations {dist_name}!\n\nYou''ve reached {milestone}% of your target in {campaign_name}.\nCurrent: {current_value}/{target_value}\n\nKeep going!',
    '{dist_name,milestone,campaign_name,current_value,target_value}',
    true,
    'event'
  ),
  (
    'Weekly Progress Report',
    'Sent every Monday at 9:00 AM',
    'weekly_progress',
    'whatsapp',
    E'📊 Weekly Incentive Report\n\nActive Campaigns: {active_count}\nYour Rank: #{rank}\nRewards Earned: RM{earned}\nNext Milestone: {next_milestone}',
    '{active_count,rank,earned,next_milestone}',
    true,
    'scheduled'
  ),
  (
    'Campaign Ending Reminder',
    'Sent 7 days and 1 day before campaign ends',
    'campaign_ending',
    'whatsapp_and_inapp',
    E'⏰ {campaign_name} ends in {days_left} days!\n\nYour progress: {current_value}/{target_value}\nYou need {remaining} more to qualify.\n\nDon''t miss out on RM{reward_value}!',
    '{campaign_name,days_left,current_value,target_value,remaining,reward_value}',
    true,
    'event'
  ),
  (
    'Tier Upgrade Notification',
    'Sent when distributor moves to a higher tier',
    'tier_upgrade',
    'whatsapp_and_inapp',
    E'👑 You''ve been promoted to {new_tier} tier!\n\nBenefits unlocked:\n- Higher reward multiplier\n- Priority stock allocation\n- Exclusive campaigns',
    '{new_tier}',
    false,
    'event'
  ),
  (
    'Reward Payout Confirmation',
    'Sent when reward is processed',
    'reward_payout',
    'whatsapp',
    E'🎁 Reward Paid!\n\nCampaign: {campaign_name}\nAmount: RM{reward_amount}\nType: {reward_type}\nRef: {ref_number}\n\nThank you for your performance!',
    '{campaign_name,reward_amount,reward_type,ref_number}',
    true,
    'event'
  )
) AS t(name, description, message_type, channel, template_body, variables, is_enabled, trigger_type)
WHERE c.org_type_code = 'HQ'
AND NOT EXISTS (
  SELECT 1 FROM public.incentive_notification_templates nt 
  WHERE nt.company_id = c.id AND nt.message_type = t.message_type
);


-- ════════════════════════════════════════════════════════════════
-- DONE — All incentive system tables created
-- ════════════════════════════════════════════════════════════════
