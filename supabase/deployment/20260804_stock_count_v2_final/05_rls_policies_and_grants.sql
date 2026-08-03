-- =============================================================================
-- 05_rls_policies_and_grants.sql  [SCHEMA CHANGE]
-- =============================================================================
-- PURPOSE      : Enable RLS and install the final policies, revokes and grants.
-- PREREQUISITES: 02 and 04 completed.
-- MUTATES      : SCHEMA/ACL ONLY. No business row is modified.
-- EXPECTED     : RLS is enabled on all 9 new tables; policies and grants match the contract.
-- VERIFY       : 08_post_deployment_verification.sql sections R and G.
-- NOTE         : several *_requests / *_posting_context tables intentionally have
--                RLS ENABLED and ZERO policies. That is deny-all by design: they
--                are reached only through SECURITY DEFINER functions. Do not
--                "fix" this by adding policies.
-- -----------------------------------------------------------------------------
-- All SQL bodies below are copied verbatim from the authoritative migrations
-- listed per section. Only selection, ordering and idempotency guards are new.
-- Authoritative application commit: 9a62556aae6f64af3bc98f159196179669311b3f
-- =============================================================================

BEGIN;

-- ---- source (verbatim): supabase/migrations/20260731230000_inventory_cutoff_d2h_policy.sql

alter table public.inventory_cutoff_d2h_policies enable row level security;

alter table public.inventory_cutoff_d2h_policy_requests enable row level security;

drop policy if exists inventory_cutoff_d2h_policies_read
  on public.inventory_cutoff_d2h_policies;

create policy inventory_cutoff_d2h_policies_read
  on public.inventory_cutoff_d2h_policies for select
  using (exists (
    select 1 from public.inventory_opening_cutoffs c
    where c.id = cutoff_id and public.can_access_org(c.warehouse_organization_id)
  ));

drop policy if exists inventory_cutoff_d2h_policies_hq_admin
  on public.inventory_cutoff_d2h_policies;

create policy inventory_cutoff_d2h_policies_hq_admin
  on public.inventory_cutoff_d2h_policies for all
  using (public.is_hq_admin()) with check (public.is_hq_admin());

revoke all on public.inventory_cutoff_d2h_policy_requests
  from public, anon, authenticated;

grant select on public.inventory_cutoff_d2h_policies to authenticated;

comment on table public.inventory_cutoff_d2h_policies is
  'Immutable-per-save Opening Balance D2H policy snapshot. Option A excludes all pre-boundary D2H; Option B records explicit selected/excluded order sets. Never mutates QR data or cancels the cutoff.';

-- ---- source (verbatim): supabase/migrations/20260801090000_inventory_cutoff_h2m_policy.sql

alter table public.inventory_cutoff_h2m_policies enable row level security;

alter table public.inventory_cutoff_h2m_policy_requests enable row level security;

drop policy if exists inventory_cutoff_h2m_policies_read
  on public.inventory_cutoff_h2m_policies;

create policy inventory_cutoff_h2m_policies_read
  on public.inventory_cutoff_h2m_policies for select
  using (exists (
    select 1 from public.inventory_opening_cutoffs c
    where c.id = cutoff_id and public.can_access_org(c.warehouse_organization_id)
  ));

drop policy if exists inventory_cutoff_h2m_policies_hq_admin
  on public.inventory_cutoff_h2m_policies;

create policy inventory_cutoff_h2m_policies_hq_admin
  on public.inventory_cutoff_h2m_policies for all
  using (public.is_hq_admin()) with check (public.is_hq_admin());

revoke all on public.inventory_cutoff_h2m_policy_requests
  from public, anon, authenticated;

grant select on public.inventory_cutoff_h2m_policies to authenticated;

comment on table public.inventory_cutoff_h2m_policies is
  'Immutable-per-save Opening Balance H2M policy snapshot. Option A excludes all eligible H2M from expected incoming; Option B records explicit selected expected-incoming order sets. Never mutates QR, never adds H2M qty at OB posting, never cancels the cutoff.';

-- ---- source (verbatim): supabase/migrations/20260801140000_inventory_cutoff_transactions_policy.sql

alter table public.inventory_cutoff_transactions_policies enable row level security;

alter table public.inventory_cutoff_transactions_policy_requests enable row level security;

alter table public.inventory_cutoff_excluded_transactions enable row level security;

drop policy if exists inventory_cutoff_transactions_policies_read
  on public.inventory_cutoff_transactions_policies;

create policy inventory_cutoff_transactions_policies_read
  on public.inventory_cutoff_transactions_policies for select
  using (exists (
    select 1 from public.inventory_opening_cutoffs c
    where c.id = cutoff_id and public.can_access_org(c.warehouse_organization_id)
  ));

drop policy if exists inventory_cutoff_transactions_policies_hq_admin
  on public.inventory_cutoff_transactions_policies;

create policy inventory_cutoff_transactions_policies_hq_admin
  on public.inventory_cutoff_transactions_policies for all
  using (public.is_hq_admin()) with check (public.is_hq_admin());

drop policy if exists inventory_cutoff_excluded_transactions_read
  on public.inventory_cutoff_excluded_transactions;

create policy inventory_cutoff_excluded_transactions_read
  on public.inventory_cutoff_excluded_transactions for select
  using (exists (
    select 1 from public.inventory_opening_cutoffs c
    where c.id = cutoff_id and public.can_access_org(c.warehouse_organization_id)
  ));

revoke all on public.inventory_cutoff_transactions_policy_requests
  from public, anon, authenticated;

revoke insert, update, delete, truncate
  on public.inventory_cutoff_transactions_policies,
     public.inventory_cutoff_excluded_transactions
  from authenticated;

grant select on public.inventory_cutoff_transactions_policies to authenticated;

grant select on public.inventory_cutoff_excluded_transactions to authenticated;

comment on table public.inventory_cutoff_transactions_policies is
  'Immutable-per-save Opening Balance Transactions policy snapshot for eligible Stock Adjustments, Returns and Stock Transfers. Start Fresh excludes all eligible; Carry Forward carries all eligible; Review carries only checked eligible ones. Never mutates QR data, never cancels the cutoff, never replays a pre-boundary stock movement.';

comment on table public.inventory_cutoff_excluded_transactions is
  'Authoritative historical-exclusion markers written only at successful Opening Balance posting. A guard trigger blocks any later stock movement for an excluded transaction so it can never silently enter the new inventory through its old path. Original transaction records are preserved for audit.';

-- ---- source (verbatim): supabase/migrations/20260801190000_inventory_cutoff_allocation_resolver.sql

alter table public.inventory_cutoff_allocation_requests enable row level security;

revoke all on public.inventory_cutoff_allocation_requests
  from public, anon, authenticated;

comment on table public.inventory_cutoff_allocation_requests is
  'Idempotency + request audit ledger for the Opening Balance allocation resolver. Only the SECURITY DEFINER resolver writes here. Holds no operational inventory/order data.';

-- ---- source (verbatim): supabase/migrations/20260731_inventory_cutoff_authoritative_h2m_incoming_resolver.sql

alter table public.inventory_cutoff_h2m_bulk_requests enable row level security;

revoke all on public.inventory_cutoff_h2m_bulk_requests from public, anon, authenticated;

COMMIT;
