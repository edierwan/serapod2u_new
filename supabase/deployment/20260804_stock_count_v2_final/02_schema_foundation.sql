-- =============================================================================
-- 02_schema_foundation.sql  [SCHEMA CHANGE]
-- =============================================================================
-- PURPOSE      : Create the Opening Balance policy / bulk / allocation ledger tables.
-- PREREQUISITES: 01_preflight_read_only.sql reported PASS or REVIEW_REQUIRED (reviewed).
-- MUTATES      : SCHEMA ONLY. Creates tables + one index. No row is inserted, updated or deleted.
-- EXPECTED     : All 9 tables exist. Re-running is a no-op (CREATE TABLE IF NOT EXISTS).
-- VERIFY       : 08_post_deployment_verification.sql section T.
-- -----------------------------------------------------------------------------
-- All SQL bodies below are copied verbatim from the authoritative migrations
-- listed per section. Only selection, ordering and idempotency guards are new.
-- Authoritative application commit: 9a62556aae6f64af3bc98f159196179669311b3f
-- =============================================================================

BEGIN;

-- ---- source (verbatim): supabase/migrations/20260731230000_inventory_cutoff_d2h_policy.sql

create table if not exists public.inventory_cutoff_d2h_policies (
  cutoff_id uuid primary key
    references public.inventory_opening_cutoffs(id) on delete restrict,
  policy text not null check (policy in ('exclude_all', 'review_select')),
  boundary_at timestamptz not null,
  warehouse_organization_id uuid not null
    references public.organizations(id),
  company_id uuid not null
    references public.organizations(id),
  product_category_id uuid not null
    references public.product_categories(id),
  eligible_order_count integer not null check (eligible_order_count >= 0),
  eligible_item_count integer not null check (eligible_item_count >= 0),
  eligible_quantity integer not null check (eligible_quantity >= 0),
  selected_order_count integer not null default 0 check (selected_order_count >= 0),
  selected_item_count integer not null default 0 check (selected_item_count >= 0),
  selected_quantity integer not null default 0 check (selected_quantity >= 0),
  excluded_order_count integer not null default 0 check (excluded_order_count >= 0),
  excluded_item_count integer not null default 0 check (excluded_item_count >= 0),
  excluded_quantity integer not null default 0 check (excluded_quantity >= 0),
  eligible_order_ids uuid[] not null default '{}',
  selected_order_ids uuid[] not null default '{}',
  excluded_order_ids uuid[] not null default '{}',
  confirmation_fingerprint text not null,
  decided_by uuid not null references public.users(id),
  decided_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (
    (policy = 'exclude_all' and selected_order_count = 0 and cardinality(selected_order_ids) = 0)
    or
    (policy = 'review_select')
  )
);

create table if not exists public.inventory_cutoff_d2h_policy_requests (
  cutoff_id uuid not null
    references public.inventory_opening_cutoffs(id) on delete cascade,
  idempotency_key uuid not null,
  policy text not null check (policy in ('exclude_all', 'review_select')),
  scope_fingerprint text not null,
  requested_order_ids uuid[] not null default '{}',
  result jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (cutoff_id, idempotency_key)
);

-- ---- source (verbatim): supabase/migrations/20260801090000_inventory_cutoff_h2m_policy.sql

create table if not exists public.inventory_cutoff_h2m_policies (
  cutoff_id uuid primary key
    references public.inventory_opening_cutoffs(id) on delete restrict,
  policy text not null check (policy in ('exclude_all', 'review_select')),
  boundary_at timestamptz not null,
  warehouse_organization_id uuid not null
    references public.organizations(id),
  company_id uuid not null
    references public.organizations(id),
  product_category_id uuid not null
    references public.product_categories(id),
  eligible_order_count integer not null check (eligible_order_count >= 0),
  eligible_item_count integer not null check (eligible_item_count >= 0),
  eligible_ordered_quantity integer not null check (eligible_ordered_quantity >= 0),
  eligible_received_before_boundary integer not null check (eligible_received_before_boundary >= 0),
  eligible_outstanding_quantity integer not null check (eligible_outstanding_quantity >= 0),
  selected_order_count integer not null default 0 check (selected_order_count >= 0),
  selected_item_count integer not null default 0 check (selected_item_count >= 0),
  selected_ordered_quantity integer not null default 0 check (selected_ordered_quantity >= 0),
  selected_received_before_boundary integer not null default 0 check (selected_received_before_boundary >= 0),
  selected_outstanding_quantity integer not null default 0 check (selected_outstanding_quantity >= 0),
  excluded_order_count integer not null default 0 check (excluded_order_count >= 0),
  excluded_item_count integer not null default 0 check (excluded_item_count >= 0),
  excluded_ordered_quantity integer not null default 0 check (excluded_ordered_quantity >= 0),
  excluded_received_before_boundary integer not null default 0 check (excluded_received_before_boundary >= 0),
  excluded_outstanding_quantity integer not null default 0 check (excluded_outstanding_quantity >= 0),
  eligible_order_ids uuid[] not null default '{}',
  selected_order_ids uuid[] not null default '{}',
  excluded_order_ids uuid[] not null default '{}',
  confirmation_fingerprint text not null,
  decided_by uuid not null references public.users(id),
  decided_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (
    (policy = 'exclude_all' and selected_order_count = 0 and cardinality(selected_order_ids) = 0)
    or
    (policy = 'review_select')
  )
);

create table if not exists public.inventory_cutoff_h2m_policy_requests (
  cutoff_id uuid not null
    references public.inventory_opening_cutoffs(id) on delete cascade,
  idempotency_key uuid not null,
  policy text not null check (policy in ('exclude_all', 'review_select')),
  scope_fingerprint text not null,
  requested_order_ids uuid[] not null default '{}',
  result jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (cutoff_id, idempotency_key)
);

-- ---- source (verbatim): supabase/migrations/20260731_inventory_cutoff_authoritative_h2m_incoming_resolver.sql

create table if not exists public.inventory_cutoff_h2m_bulk_requests (
  cutoff_id uuid not null references public.inventory_opening_cutoffs(id) on delete cascade,
  idempotency_key uuid not null,
  action text not null check (action in (
    'selected_incoming','selected_not_incoming','all_remaining_not_incoming'
  )),
  scope_fingerprint text not null,
  requested_order_ids uuid[] not null default '{}',
  result jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (cutoff_id, idempotency_key)
);

-- ---- source (verbatim): supabase/migrations/20260801140000_inventory_cutoff_transactions_policy.sql

create table if not exists public.inventory_cutoff_transactions_policies (
  cutoff_id uuid primary key
    references public.inventory_opening_cutoffs(id) on delete restrict,
  policy text not null
    check (policy in ('exclude_all', 'carry_forward_all', 'review_select')),
  boundary_at timestamptz not null,
  warehouse_organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.organizations(id),
  product_category_id uuid not null references public.product_categories(id),
  eligible_count integer not null default 0 check (eligible_count >= 0),
  carried_count integer not null default 0 check (carried_count >= 0),
  excluded_count integer not null default 0 check (excluded_count >= 0),
  blocked_count integer not null default 0 check (blocked_count >= 0),
  -- Authoritative effective decision snapshot (per transaction type).
  carried_adjustment_ids uuid[] not null default '{}',
  carried_return_ids uuid[] not null default '{}',
  carried_transfer_ids uuid[] not null default '{}',
  excluded_adjustment_ids uuid[] not null default '{}',
  excluded_return_ids uuid[] not null default '{}',
  excluded_transfer_ids uuid[] not null default '{}',
  -- Heterogeneous {type,id} lists for presentation/audit.
  carried_refs jsonb not null default '[]'::jsonb,
  excluded_refs jsonb not null default '[]'::jsonb,
  eligible_refs jsonb not null default '[]'::jsonb,
  confirmation_fingerprint text not null,
  decided_by uuid not null references public.users(id),
  decided_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (
    (policy = 'exclude_all'
      and carried_count = 0
      and cardinality(carried_adjustment_ids) = 0
      and cardinality(carried_return_ids) = 0
      and cardinality(carried_transfer_ids) = 0)
    or policy = 'carry_forward_all'
    or policy = 'review_select'
  )
);

create table if not exists public.inventory_cutoff_transactions_policy_requests (
  cutoff_id uuid not null
    references public.inventory_opening_cutoffs(id) on delete cascade,
  idempotency_key uuid not null,
  policy text not null
    check (policy in ('exclude_all', 'carry_forward_all', 'review_select')),
  scope_fingerprint text not null,
  requested_refs jsonb not null default '[]'::jsonb,
  result jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (cutoff_id, idempotency_key)
);

create table if not exists public.inventory_cutoff_excluded_transactions (
  cutoff_id uuid not null
    references public.inventory_opening_cutoffs(id) on delete restrict,
  transaction_type text not null
    check (transaction_type in ('stock_adjustment', 'return', 'stock_transfer')),
  transaction_id uuid not null,
  warehouse_organization_id uuid not null references public.organizations(id),
  product_category_id uuid not null references public.product_categories(id),
  excluded_by uuid not null references public.users(id),
  excluded_at timestamptz not null default now(),
  primary key (cutoff_id, transaction_type, transaction_id)
);

-- ---- source (verbatim): supabase/migrations/20260801190000_inventory_cutoff_allocation_resolver.sql

create table if not exists public.inventory_cutoff_allocation_requests (
  cutoff_id uuid not null
    references public.inventory_opening_cutoffs(id) on delete cascade,
  idempotency_key uuid not null,
  action text not null check (action in (
    'select_related_order', 'carry_forward_related',
    'exclude_and_release', 'mark_manual_investigation'
  )),
  product_variant_id uuid not null references public.product_variants(id),
  stock_config_id uuid not null references public.inventory_stock_configurations(id),
  related_order_id uuid references public.orders(id),
  result jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (cutoff_id, idempotency_key)
);

-- ---- source (verbatim): supabase/migrations/20260801140000_inventory_cutoff_transactions_policy.sql

create index if not exists inventory_cutoff_excluded_transactions_lookup
  on public.inventory_cutoff_excluded_transactions (transaction_type, transaction_id);

COMMIT;
