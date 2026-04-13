-- ============================================================================
-- QR Verification Log & Silent Recovery Infrastructure
-- Migration: 20260404_qr_verification_log
-- Date: 2026-04-04
-- Purpose: Log every QR verification attempt with internal classification
--          to support silent recovery workflow (Phase 1)
-- ============================================================================

-- ── 1. Verification log table ────────────────────────────────────────────────
-- Captures every scan attempt at the API layer. Internal-only — never
-- exposed to consumers.

CREATE TABLE IF NOT EXISTS qr_verification_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Raw input
  raw_code      text NOT NULL,                -- exact string received by API
  source_url    text,                         -- full URL if scanned from tracking link

  -- Parsed fields (NULL when shape is invalid)
  parsed_product_sku   text,
  parsed_variant_code  text,
  parsed_order_no      text,
  parsed_sequence      int,
  parsed_hash_suffix   text,

  -- ── Internal classification ────────────────────────────────────────────
  -- lookup_result: what happened in the DB
  --   'exact_match'           → code found as-is in qr_codes
  --   'base_code_match'       → found after stripping hash (legacy)
  --   'pattern_match'         → found via LIKE pattern (truncated URL)
  --   'not_found'             → no record in qr_codes
  --   'db_error'              → unexpected database error
  lookup_result text NOT NULL DEFAULT 'not_found',

  -- shape_status: structural validity of the scanned code
  --   'valid_product'  → matches PROD-... regex
  --   'valid_master'   → matches MASTER-... regex
  --   'invalid'        → does not match any known format
  shape_status  text NOT NULL DEFAULT 'invalid',

  -- hash_status: HMAC validation outcome
  --   'valid'          → hash matches expected HMAC
  --   'invalid'        → hash present but wrong
  --   'missing'        → no hash segment found
  --   'legacy'         → matched via legacy hash algorithm
  --   'skipped'        → no hash validation performed (shape invalid / not found)
  hash_status   text NOT NULL DEFAULT 'skipped',

  -- trust_level: composite classification (the key field for recovery decisions)
  --   'exact_match'           → code found + hash valid → full trust
  --   'recovered_match'       → code regenerated/resolved by fallback → high trust
  --   'valid_shape_unresolved'→ valid format + valid hash but not in DB → pending recovery
  --   'valid_shape_bad_hash'  → valid format but hash mismatch → suspicious
  --   'invalid_shape'         → not a recognized QR format → reject
  trust_level   text NOT NULL DEFAULT 'invalid_shape',

  -- ── Contextual data (DB lookups) ──────────────────────────────────────
  qr_code_id    uuid REFERENCES qr_codes(id),       -- set if record found
  order_id      uuid REFERENCES orders(id),          -- set if order resolved
  order_exists  boolean DEFAULT false,               -- true if parsed_order_no exists in orders
  qr_exists     boolean DEFAULT false,               -- true if code found in qr_codes

  -- ── Outcome ───────────────────────────────────────────────────────────
  -- user_facing_outcome: what the consumer actually saw
  --   'genuine'                → normal success flow
  --   'already_collected'      → points already awarded
  --   'not_activated'          → product still in warehouse/mfg
  --   'temporarily_unavailable'→ neutral message for unresolved
  --   'invalid_code'           → clearly invalid format
  --   'error'                  → 500 / unexpected failure
  user_facing_outcome text NOT NULL DEFAULT 'error',

  -- points_outcome: what happened with points
  --   'awarded'        → points given
  --   'already_awarded'→ idempotent duplicate
  --   'blocked'        → blocked by safety rules
  --   'not_applicable' → verify-only, no points action
  --   'pending'        → recovery queue
  points_outcome text NOT NULL DEFAULT 'not_applicable',

  -- ── Recovery tracking ─────────────────────────────────────────────────
  is_recovery_candidate boolean NOT NULL DEFAULT false,
  recovery_status       text DEFAULT 'none',         -- none / pending / resolved / rejected
  recovered_at          timestamptz,
  recovered_by          uuid REFERENCES auth.users(id),
  recovery_notes        text,

  -- ── Actor / Environment ───────────────────────────────────────────────
  consumer_phone  text,
  consumer_name   text,
  shop_id         uuid,
  org_id          uuid,
  ip_address      inet,
  user_agent      text,

  -- ── Testing ───────────────────────────────────────────────────────────
  is_test_data    boolean NOT NULL DEFAULT false,
  test_actor      text,
  notes           text
);

-- ── 2. Indexes for monitoring queries ────────────────────────────────────────

CREATE INDEX idx_qr_vlog_created ON qr_verification_log (created_at DESC);
CREATE INDEX idx_qr_vlog_trust   ON qr_verification_log (trust_level, created_at DESC);
CREATE INDEX idx_qr_vlog_recovery ON qr_verification_log (is_recovery_candidate, recovery_status)
  WHERE is_recovery_candidate = true;
CREATE INDEX idx_qr_vlog_order   ON qr_verification_log (parsed_order_no)
  WHERE parsed_order_no IS NOT NULL;
CREATE INDEX idx_qr_vlog_outcome ON qr_verification_log (user_facing_outcome, created_at DESC);

-- ── 3. RLS ───────────────────────────────────────────────────────────────────
-- Only service_role inserts (API layer). HQ admins can read for monitoring.

ALTER TABLE qr_verification_log ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (used by API routes)
CREATE POLICY "service_role_full_access" ON qr_verification_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- HQ admins (role_level <= 50) can read for the monitoring dashboard
CREATE POLICY "hq_admin_read" ON qr_verification_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      JOIN roles r ON r.role_code = u.role_code
      WHERE u.id = auth.uid()
        AND r.role_level <= 50
    )
  );

-- ── 4. Summary view for the monitoring dashboard ─────────────────────────────

CREATE OR REPLACE VIEW v_qr_recovery_summary AS
SELECT
  trust_level,
  user_facing_outcome,
  recovery_status,
  count(*)                                          AS total_scans,
  count(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS last_24h,
  count(*) FILTER (WHERE created_at >= now() - interval '7 days')   AS last_7d,
  min(created_at)                                   AS first_seen,
  max(created_at)                                   AS last_seen
FROM qr_verification_log
GROUP BY trust_level, user_facing_outcome, recovery_status;

-- ── 5. Detailed recovery candidates view ─────────────────────────────────────

CREATE OR REPLACE VIEW v_qr_recovery_candidates AS
SELECT
  vl.id,
  vl.created_at,
  vl.raw_code,
  vl.parsed_order_no,
  vl.parsed_product_sku,
  vl.parsed_variant_code,
  vl.parsed_sequence,
  vl.parsed_hash_suffix,
  vl.trust_level,
  vl.hash_status,
  vl.lookup_result,
  vl.order_exists,
  vl.qr_exists,
  vl.user_facing_outcome,
  vl.points_outcome,
  vl.recovery_status,
  vl.consumer_phone,
  vl.consumer_name,
  vl.ip_address,
  vl.user_agent,
  vl.notes,
  o.order_no   AS matched_order_no,
  o.id         AS matched_order_id,
  vl.is_test_data
FROM qr_verification_log vl
LEFT JOIN orders o ON o.order_no = vl.parsed_order_no
WHERE vl.is_recovery_candidate = true
ORDER BY vl.created_at DESC;

-- ── 6. Hourly scan stats view (for charts) ──────────────────────────────────

CREATE OR REPLACE VIEW v_qr_scan_hourly_stats AS
SELECT
  date_trunc('hour', created_at) AS hour,
  trust_level,
  user_facing_outcome,
  count(*) AS scan_count
FROM qr_verification_log
WHERE created_at >= now() - interval '30 days'
GROUP BY 1, 2, 3
ORDER BY 1 DESC;

-- ============================================================================
-- Done. Run this in Supabase SQL Editor or via CLI migration.
-- ============================================================================
