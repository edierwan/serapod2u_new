--
-- PostgreSQL database dump
--

\restrict wp8Ad4e9utI0SMZpqd0o60QjiLJcHr6NEeF1iiS0cReGKxHjhicf4C2So6LNUam

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

-- Started on 2025-10-23 14:21:21 +08

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 136 (class 2615 OID 17586)
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- TOC entry 39 (class 2615 OID 16542)
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- TOC entry 1702 (class 1247 OID 22554)
-- Name: document_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.document_status AS ENUM (
    'pending',
    'acknowledged',
    'completed'
);


--
-- TOC entry 5624 (class 0 OID 0)
-- Dependencies: 1702
-- Name: TYPE document_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.document_status IS 'PO/Invoice/Payment: pending→acknowledged; Receipt: completed';


--
-- TOC entry 1699 (class 1247 OID 22544)
-- Name: document_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.document_type AS ENUM (
    'PO',
    'INVOICE',
    'PAYMENT',
    'RECEIPT'
);


--
-- TOC entry 5625 (class 0 OID 0)
-- Dependencies: 1699
-- Name: TYPE document_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.document_type IS 'PO → Invoice → Payment → Receipt';


--
-- TOC entry 1524 (class 1247 OID 22534)
-- Name: order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_status AS ENUM (
    'draft',
    'submitted',
    'approved',
    'closed'
);


--
-- TOC entry 5626 (class 0 OID 0)
-- Dependencies: 1524
-- Name: TYPE order_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.order_status IS 'draft → submitted → approved → closed';


--
-- TOC entry 1521 (class 1247 OID 22527)
-- Name: order_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_type AS ENUM (
    'H2M',
    'D2H',
    'S2D'
);


--
-- TOC entry 5627 (class 0 OID 0)
-- Dependencies: 1521
-- Name: TYPE order_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.order_type IS 'HQ→MFG, DIST→HQ, SHOP→DIST';


--
-- TOC entry 1597 (class 1247 OID 17392)
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: -
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS'
);


--
-- TOC entry 530 (class 1255 OID 20324)
-- Name: _org_depth_ok(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._org_depth_ok(p_org_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH RECURSIVE up AS (
    SELECT id, parent_org_id, 1 AS depth
    FROM organizations
    WHERE id = p_org_id
    UNION ALL
    SELECT o.id, o.parent_org_id, up.depth + 1
    FROM organizations o
    JOIN up ON o.id = up.parent_org_id
    WHERE up.depth < 10
  )
  SELECT COALESCE(MAX(depth),0) <= 5 FROM up;
$$;


--
-- TOC entry 728 (class 1255 OID 21058)
-- Name: archive_old_audit_logs(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.archive_old_audit_logs(days_to_keep integer DEFAULT 90) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  rows_archived INTEGER;
BEGIN
  -- Ensure archive table exists with identical structure
  CREATE TABLE IF NOT EXISTS public.audit_logs_archive (LIKE public.audit_logs INCLUDING ALL);

  -- Move & count rows older than the retention window
  WITH moved AS (
    DELETE FROM public.audit_logs
    WHERE created_at < (CURRENT_DATE - (days_to_keep * INTERVAL '1 day'))
    RETURNING *
  )
  INSERT INTO public.audit_logs_archive
  SELECT * FROM moved;

  GET DIAGNOSTICS rows_archived = ROW_COUNT;

  RAISE NOTICE 'Archived % audit log records older than % days', rows_archived, days_to_keep;
  RETURN rows_archived;
END;
$$;


--
-- TOC entry 5628 (class 0 OID 0)
-- Dependencies: 728
-- Name: FUNCTION archive_old_audit_logs(days_to_keep integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.archive_old_audit_logs(days_to_keep integer) IS 'Archives audit logs older than N days (default 90) into audit_logs_archive and removes them from the hot table.';


--
-- TOC entry 840 (class 1255 OID 20668)
-- Name: audit_trigger_func(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_trigger_func() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_old_data jsonb;
  v_new_data jsonb;
  v_changed_fields text[];
  v_entity_id uuid;
  v_headers json;
BEGIN
  -- Current auth user (may be NULL for service calls)
  v_user_id := auth.uid();

  -- Email is best-effort (auth.users is Supabase-managed)
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- Prepare old/new payloads and changed field list
  IF TG_OP = 'DELETE' THEN
    v_old_data := to_jsonb(OLD);
    v_new_data := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
    SELECT array_agg(key)
      INTO v_changed_fields
    FROM jsonb_each(v_new_data)
    WHERE v_new_data->key IS DISTINCT FROM v_old_data->key;
  ELSIF TG_OP = 'INSERT' THEN
    v_old_data := NULL;
    v_new_data := to_jsonb(NEW);
  END IF;

  -- Try to capture the entity id from either new or old row
  v_entity_id := COALESCE(
    NULLIF((v_new_data->>'id')::uuid, NULL),
    NULLIF((v_old_data->>'id')::uuid, NULL)
  );

  -- Request headers (may be null outside http context)
  v_headers := NULLIF(current_setting('request.headers', true), '')::json;

  INSERT INTO public.audit_logs (
    user_id,
    user_email,
    action,
    entity_type,   -- table name
    entity_id,
    old_values,
    new_values,
    changed_fields,
    ip_address,
    user_agent
  )
  VALUES (
    v_user_id,
    v_user_email,
    TG_OP,
    TG_TABLE_NAME,
    v_entity_id,
    v_old_data,
    v_new_data,
    v_changed_fields,
    inet_client_addr(),
    COALESCE(v_headers->>'user-agent', NULL)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- TOC entry 711 (class 1255 OID 20454)
-- Name: can_access_org(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_org(p_org_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.is_active = true
      AND (
        public.is_hq_admin()
        OR u.organization_id = p_org_id
        OR p_org_id IN (SELECT org_id FROM public.get_org_descendants(u.organization_id))
        OR u.organization_id IN (SELECT org_id FROM public.get_org_descendants(p_org_id))
      )
  );
$$;


--
-- TOC entry 5629 (class 0 OID 0)
-- Dependencies: 711
-- Name: FUNCTION can_access_org(p_org_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.can_access_org(p_org_id uuid) IS 'Checks if current user can access organization data based on org hierarchy (descendant/ancestor) and HQ override';


--
-- TOC entry 533 (class 1255 OID 20550)
-- Name: check_agreement_expiry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_agreement_expiry() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.agreement_end_date IS NOT NULL
     AND NEW.agreement_end_date < CURRENT_DATE
     AND COALESCE(NEW.is_active, true) = true THEN
    NEW.is_active := false;
  END IF;
  RETURN NEW;
END;
$$;


--
-- TOC entry 817 (class 1255 OID 20714)
-- Name: cleanup_old_audit_logs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_audit_logs() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  DELETE FROM public.audit_logs
  WHERE created_at < CURRENT_DATE - INTERVAL '90 days';
END;
$$;


--
-- TOC entry 709 (class 1255 OID 35321)
-- Name: cleanup_old_notifications(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_notifications(p_retention_days integer DEFAULT 90) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Archive to logs if needed, then delete from outbox
  WITH deleted AS (
    DELETE FROM public.notifications_outbox
    WHERE created_at < NOW() - (p_retention_days || ' days')::INTERVAL
      AND status IN ('sent', 'failed')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;

  -- Also cleanup very old logs
  DELETE FROM public.notification_logs
  WHERE created_at < NOW() - ((p_retention_days + 30) || ' days')::INTERVAL;

  RAISE NOTICE 'Cleaned up % old notifications', v_deleted_count;
  RETURN v_deleted_count;
END;
$$;


--
-- TOC entry 5630 (class 0 OID 0)
-- Dependencies: 709
-- Name: FUNCTION cleanup_old_notifications(p_retention_days integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.cleanup_old_notifications(p_retention_days integer) IS 'Removes old sent/failed notifications from outbox to maintain performance';


--
-- TOC entry 706 (class 1255 OID 22104)
-- Name: create_new_user(text, text, text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_new_user(p_email text, p_password text, p_role_code text DEFAULT 'GUEST'::text, p_organization_id uuid DEFAULT NULL::uuid, p_full_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
  v_result JSON;
BEGIN
  -- Note: This function is called AFTER auth.users is created by the app
  -- It just ensures public.users record exists and is updated
  
  -- The app must create auth.users first using:
  -- supabaseAdmin.auth.admin.createUser()
  
  -- This function is a helper, not a replacement for the auth API
  RAISE EXCEPTION 'This function is deprecated. Use the application code approach instead.';
  
END;
$$;


--
-- TOC entry 511 (class 1255 OID 17790)
-- Name: current_user_org_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_org_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT u.organization_id
  FROM public.users u
  WHERE u.id = auth.uid();
$$;


--
-- TOC entry 872 (class 1255 OID 17786)
-- Name: current_user_role_level(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_role_level() RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
    SELECT r.role_level
    FROM public.users u
    JOIN public.roles r ON r.role_code = u.role_code
    WHERE u.id = auth.uid()
    AND u.is_active = true;
$$;


--
-- TOC entry 746 (class 1255 OID 22947)
-- Name: detect_order_type(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_order_type(p_buyer_org_id uuid, p_seller_org_id uuid) RETURNS public.order_type
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_buyer text := public.get_org_type(p_buyer_org_id);
  v_seller text := public.get_org_type(p_seller_org_id);
BEGIN
  IF v_buyer='HQ'   AND v_seller='MFG'  THEN RETURN 'H2M'; END IF;
  IF v_buyer='DIST' AND v_seller='HQ'   THEN RETURN 'D2H'; END IF;
  IF v_buyer='SHOP' AND v_seller='DIST' THEN RETURN 'S2D'; END IF;
  RAISE EXCEPTION 'Invalid buyer→seller org types: % → %', v_buyer, v_seller;
END;
$$;


--
-- TOC entry 589 (class 1255 OID 30404)
-- Name: enforce_redemption_cap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_redemption_cap() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  lim record;
  curr integer;
  now_ok boolean := true;
BEGIN
  SELECT * INTO lim FROM public.redemption_order_limits rol WHERE rol.order_id = NEW.order_id;
  IF lim.enforce_limit IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF lim.max_redemptions IS NULL OR lim.max_redemptions <= 0 THEN
    RAISE EXCEPTION 'REDEMPTION_LIMIT_CONFIG_INVALID';
  END IF;
  IF lim.start_at IS NOT NULL AND now() < lim.start_at THEN
    RAISE EXCEPTION 'REDEMPTION_NOT_STARTED';
  END IF;
  IF lim.end_at IS NOT NULL AND now() > lim.end_at THEN
    RAISE EXCEPTION 'REDEMPTION_ENDED';
  END IF;
  SELECT count(*) INTO curr FROM public.redemption_orders ro WHERE ro.order_id = NEW.order_id;
  IF curr >= lim.max_redemptions THEN
    RAISE EXCEPTION 'REDEMPTION_LIMIT_REACHED';
  END IF;
  RETURN NEW;
END;
$$;


--
-- TOC entry 569 (class 1255 OID 18485)
-- Name: ensure_distributor_org(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_distributor_org(p_org_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE 
    v_type TEXT;
BEGIN
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'distributor_id cannot be NULL';
    END IF;
    
    SELECT org_type_code INTO v_type 
    FROM public.organizations 
    WHERE id = p_org_id;
    
    IF v_type IS DISTINCT FROM 'DIST' THEN
        RAISE EXCEPTION 'Organization % is not a DISTRIBUTOR (got %)', p_org_id, v_type;
    END IF;
END;
$$;


--
-- TOC entry 544 (class 1255 OID 18486)
-- Name: ensure_shop_org(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_shop_org(p_org_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE 
    v_type TEXT;
BEGIN
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'shop_id cannot be NULL';
    END IF;
    
    SELECT org_type_code INTO v_type 
    FROM public.organizations 
    WHERE id = p_org_id;
    
    IF v_type IS DISTINCT FROM 'SHOP' THEN
        RAISE EXCEPTION 'Organization % is not a SHOP (got %)', p_org_id, v_type;
    END IF;
END;
$$;


--
-- TOC entry 743 (class 1255 OID 30548)
-- Name: fn_create_otp(uuid, text, text, text, text, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_create_otp(p_org_id uuid, p_channel text, p_phone text, p_email text, p_subject_type text, p_subject_ref uuid, p_purpose text, p_ttl_sec integer DEFAULT 300) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_code text := lpad(((floor(random()*900000)::int) + 100000)::text, 6, '0');
  v_salt text := encode(gen_random_bytes(16), 'hex');
  v_hash text := encode(digest(v_code || v_salt, 'sha256'), 'hex');
  v_expires timestamptz := now() + make_interval(secs => p_ttl_sec);
BEGIN
  INSERT INTO public.otp_challenges(
    id, org_id, subject_type, subject_ref, channel, phone, email,
    code_hash, salt, expires_at, metadata
  )
  VALUES (
    v_id, p_org_id, p_subject_type, p_subject_ref, p_channel, p_phone, p_email,
    v_hash, v_salt, v_expires,
    jsonb_build_object('purpose', coalesce(p_purpose, 'generic'))
  );

  INSERT INTO public.notifications_outbox(
    id, org_id, channel, to_phone, template_code, payload_json, status
  )
  VALUES (
    gen_random_uuid(), p_org_id, p_channel, p_phone, 'OTP_GENERIC',
    jsonb_build_object('code', v_code, 'expires_at', to_char(v_expires, 'YYYY-MM-DD"T"HH24:MI:SSOF')),
    'queued'
  );

  RETURN v_id;
END;
$$;


--
-- TOC entry 468 (class 1255 OID 30549)
-- Name: fn_verify_otp(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_verify_otp(p_challenge_id uuid, p_code text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  r record;
  v_hash text;
BEGIN
  SELECT *
  INTO r
  FROM public.otp_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF r.status <> 'pending' THEN
    RETURN FALSE;
  END IF;

  IF r.expires_at < now() THEN
    UPDATE public.otp_challenges SET status='expired' WHERE id = r.id;
    RETURN FALSE;
  END IF;

  IF r.attempts >= r.max_attempts THEN
    UPDATE public.otp_challenges SET status='blocked' WHERE id = r.id;
    RETURN FALSE;
  END IF;

  v_hash := encode(digest(p_code || r.salt, 'sha256'), 'hex');

  IF v_hash = r.code_hash THEN
    UPDATE public.otp_challenges
    SET status='verified', verified_at=now()
    WHERE id = r.id;
    RETURN TRUE;
  ELSE
    UPDATE public.otp_challenges
    SET attempts = attempts + 1
    WHERE id = r.id;
    RETURN FALSE;
  END IF;
END;
$$;


--
-- TOC entry 786 (class 1255 OID 22318)
-- Name: generate_doc_number(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_doc_number(p_company_id uuid, p_prefix text, p_order_type text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_yymm   TEXT;
  v_scope  TEXT;
  v_seq    INTEGER;
  v_doc_no TEXT;
BEGIN
  -- Current month/year in MMYY
  v_yymm := TO_CHAR(CURRENT_DATE, 'MMYY');

  -- Scope groups counters by company + doc kind + order type + month
  v_scope := p_prefix || '-' || p_order_type || '-' || v_yymm;

  -- Atomically get and increment the per-scope monthly counter
  INSERT INTO public.doc_counters (company_id, scope_code, yymm, next_seq)
  VALUES (p_company_id, v_scope, v_yymm, 1)
  ON CONFLICT (company_id, scope_code, yymm)
  DO UPDATE SET
    next_seq = public.doc_counters.next_seq + 1,
    updated_at = NOW()
  RETURNING next_seq INTO v_seq;

  -- Guard: enforce 2-digit ceilings (00–99 => max next_seq = 99)
  IF v_seq > 99 THEN
    RAISE EXCEPTION 'Monthly sequence exhausted for scope % (MMYY=%). Max is 99.',
      v_scope, v_yymm;
  END IF;

  -- Compose number with 2-digit padding
  v_doc_no := p_prefix || '-' || p_order_type || '-' || v_yymm || '-' || LPAD(v_seq::TEXT, 2, '0');

  RETURN v_doc_no;
END;
$$;


--
-- TOC entry 5631 (class 0 OID 0)
-- Dependencies: 786
-- Name: FUNCTION generate_doc_number(p_company_id uuid, p_prefix text, p_order_type text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.generate_doc_number(p_company_id uuid, p_prefix text, p_order_type text) IS 'Generates human-readable document numbers with monthly reset and 2-digit sequence (00–99), e.g. ORD-HM-1025-00';


--
-- TOC entry 850 (class 1255 OID 26949)
-- Name: generate_master_qr_code_string(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_master_qr_code_string(p_order_no text, p_case_number integer) RETURNS text
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Format: MASTER-{order_no}-CASE-{case_number}
  -- Example: MASTER-ORD-HM-1025-01-CASE-001
  RETURN format('MASTER-%s-CASE-%s',
    p_order_no,
    LPAD(p_case_number::text, 3, '0')
  );
END;
$$;


--
-- TOC entry 5632 (class 0 OID 0)
-- Dependencies: 850
-- Name: FUNCTION generate_master_qr_code_string(p_order_no text, p_case_number integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.generate_master_qr_code_string(p_order_no text, p_case_number integer) IS 'Generates unique Master QR code string for cases';


--
-- TOC entry 537 (class 1255 OID 26948)
-- Name: generate_qr_code_string(text, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_qr_code_string(p_product_code text, p_variant_code text, p_order_no text, p_sequence integer) RETURNS text
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Format: PROD-{product_code}-{variant_code}-{order_no}-{sequence}
  -- Example: PROD-VAPE001-MINT-ORD-HM-1025-01-00001
  RETURN format('PROD-%s-%s-%s-%s',
    p_product_code,
    p_variant_code,
    p_order_no,
    LPAD(p_sequence::text, 5, '0')
  );
END;
$$;


--
-- TOC entry 5633 (class 0 OID 0)
-- Dependencies: 537
-- Name: FUNCTION generate_qr_code_string(p_product_code text, p_variant_code text, p_order_no text, p_sequence integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.generate_qr_code_string(p_product_code text, p_variant_code text, p_order_no text, p_sequence integer) IS 'Generates unique QR code string for individual products';


--
-- TOC entry 852 (class 1255 OID 35526)
-- Name: generate_transfer_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_transfer_number() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_year TEXT;
    v_month TEXT;
    v_sequence INTEGER;
    v_transfer_no TEXT;
BEGIN
    v_year := TO_CHAR(NOW(), 'YY');
    v_month := TO_CHAR(NOW(), 'MM');
    
    -- Get next sequence for this month
    SELECT COALESCE(MAX(CAST(SUBSTRING(transfer_no FROM 8 FOR 4) AS INTEGER)), 0) + 1
    INTO v_sequence
    FROM public.stock_transfers
    WHERE transfer_no LIKE 'ST' || v_year || v_month || '%';
    
    v_transfer_no := 'ST' || v_year || v_month || LPAD(v_sequence::TEXT, 4, '0');
    
    RETURN v_transfer_no;
END;
$$;


--
-- TOC entry 859 (class 1255 OID 22944)
-- Name: get_company_id(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_company_id(p_org_id uuid) RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  WITH RECURSIVE up AS (
    SELECT id, parent_org_id, org_type_code
    FROM public.organizations
    WHERE id = p_org_id
    UNION ALL
    SELECT o.id, o.parent_org_id, o.org_type_code
    FROM public.organizations o
    JOIN up ON o.id = up.parent_org_id
  )
  SELECT id FROM up WHERE org_type_code = 'HQ' LIMIT 1;
$$;


--
-- TOC entry 5634 (class 0 OID 0)
-- Dependencies: 859
-- Name: FUNCTION get_company_id(p_org_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_company_id(p_org_id uuid) IS 'Returns root HQ organization id (tenant/company) for a given organization.';


--
-- TOC entry 719 (class 1255 OID 22957)
-- Name: get_current_price(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_current_price(p_variant_id uuid, p_buyer_org_id uuid) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  SELECT pp.unit_price
  FROM public.product_pricing pp
  WHERE pp.variant_id = p_variant_id
    AND (pp.organization_id = p_buyer_org_id OR pp.organization_id IS NULL)
    AND pp.is_active = true
    AND pp.effective_from <= CURRENT_DATE
    AND (pp.effective_to IS NULL OR pp.effective_to >= CURRENT_DATE)
  ORDER BY
    CASE WHEN pp.organization_id = p_buyer_org_id THEN 1 ELSE 2 END,
    pp.effective_from DESC
  LIMIT 1;
$$;


--
-- TOC entry 588 (class 1255 OID 33345)
-- Name: get_distributor_product_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_distributor_product_count(p_distributor_id uuid) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT COUNT(DISTINCT product_id)::INTEGER
  FROM public.distributor_products
  WHERE distributor_id = p_distributor_id
    AND is_active = true;
$$;


--
-- TOC entry 5635 (class 0 OID 0)
-- Dependencies: 588
-- Name: FUNCTION get_distributor_product_count(p_distributor_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_distributor_product_count(p_distributor_id uuid) IS 'Returns the count of distinct active products for a specific distributor';


--
-- TOC entry 750 (class 1255 OID 33343)
-- Name: get_distributor_shop_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_distributor_shop_count(p_distributor_id uuid) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.shop_distributors
  WHERE distributor_id = p_distributor_id
    AND is_active = true;
$$;


--
-- TOC entry 5636 (class 0 OID 0)
-- Dependencies: 750
-- Name: FUNCTION get_distributor_shop_count(p_distributor_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_distributor_shop_count(p_distributor_id uuid) IS 'Returns the count of active shops for a specific distributor';


--
-- TOC entry 689 (class 1255 OID 33346)
-- Name: get_hq_aggregated_product_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_hq_aggregated_product_count(p_hq_id uuid) RETURNS integer
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_total int := 0;
BEGIN
  WITH RECURSIVE tree AS (
    SELECT o.id, o.org_type_code
    FROM public.organizations o
    WHERE o.parent_org_id = p_hq_id
      AND o.is_active = TRUE
    UNION ALL
    SELECT c.id, c.org_type_code
    FROM public.organizations c
    JOIN tree t ON c.parent_org_id = t.id
    WHERE c.is_active = TRUE
  ),
  mfgs AS (
    SELECT id FROM tree WHERE org_type_code = 'MFG'
  )
  SELECT COALESCE(SUM(public.get_manufacturer_product_count(id)), 0)::int
  INTO v_total
  FROM mfgs;

  RETURN v_total;
END;
$$;


--
-- TOC entry 5637 (class 0 OID 0)
-- Dependencies: 689
-- Name: FUNCTION get_hq_aggregated_product_count(p_hq_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_hq_aggregated_product_count(p_hq_id uuid) IS 'Returns aggregated product count from all child manufacturers under an HQ';


--
-- TOC entry 505 (class 1255 OID 33344)
-- Name: get_manufacturer_product_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_manufacturer_product_count(p_manufacturer_id uuid) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.products
  WHERE manufacturer_id = p_manufacturer_id
    AND is_active = true;
$$;


--
-- TOC entry 5638 (class 0 OID 0)
-- Dependencies: 505
-- Name: FUNCTION get_manufacturer_product_count(p_manufacturer_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_manufacturer_product_count(p_manufacturer_id uuid) IS 'Returns the count of active products for a specific manufacturer';


--
-- TOC entry 811 (class 1255 OID 35319)
-- Name: get_notification_stats(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_notification_stats(p_org_id uuid, p_days integer DEFAULT 30) RETURNS TABLE(total_sent bigint, total_failed bigint, total_pending bigint, success_rate numeric, by_channel jsonb, by_event jsonb, recent_failures jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
      COUNT(*) FILTER (WHERE status = 'failed' AND retry_count >= max_retries) as failed_count,
      COUNT(*) FILTER (WHERE status IN ('queued', 'scheduled', 'processing')) as pending_count,
      jsonb_object_agg(
        channel,
        jsonb_build_object(
          'sent', COUNT(*) FILTER (WHERE status = 'sent'),
          'failed', COUNT(*) FILTER (WHERE status = 'failed')
        )
      ) FILTER (WHERE channel IS NOT NULL) as channel_stats,
      jsonb_object_agg(
        event_code,
        jsonb_build_object(
          'sent', COUNT(*) FILTER (WHERE status = 'sent'),
          'failed', COUNT(*) FILTER (WHERE status = 'failed')
        )
      ) FILTER (WHERE event_code IS NOT NULL) as event_stats
    FROM public.notifications_outbox
    WHERE org_id = p_org_id
      AND created_at >= NOW() - (p_days || ' days')::INTERVAL
  ),
  failures AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', id,
        'event_code', event_code,
        'channel', channel,
        'error', error,
        'created_at', created_at
      ) ORDER BY created_at DESC
    ) as failure_list
    FROM public.notifications_outbox
    WHERE org_id = p_org_id
      AND status = 'failed'
      AND created_at >= NOW() - INTERVAL '7 days'
    LIMIT 10
  )
  SELECT
    s.sent_count::BIGINT,
    s.failed_count::BIGINT,
    s.pending_count::BIGINT,
    CASE 
      WHEN (s.sent_count + s.failed_count) > 0 
      THEN ROUND((s.sent_count::NUMERIC / (s.sent_count + s.failed_count)::NUMERIC) * 100, 2)
      ELSE 0
    END as success_rate,
    COALESCE(s.channel_stats, '{}'::jsonb),
    COALESCE(s.event_stats, '{}'::jsonb),
    COALESCE(f.failure_list, '[]'::jsonb)
  FROM stats s
  CROSS JOIN failures f;
END;
$$;


--
-- TOC entry 5639 (class 0 OID 0)
-- Dependencies: 811
-- Name: FUNCTION get_notification_stats(p_org_id uuid, p_days integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_notification_stats(p_org_id uuid, p_days integer) IS 'Returns comprehensive notification statistics for an organization';


--
-- TOC entry 698 (class 1255 OID 20453)
-- Name: get_org_ancestors(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_org_ancestors(p_org_id uuid) RETURNS TABLE(org_id uuid, level integer)
    LANGUAGE sql STABLE
    AS $$
  WITH RECURSIVE a AS (
    SELECT id, parent_org_id, 0 AS level
    FROM organizations
    WHERE id = p_org_id
    UNION ALL
    SELECT o.id, o.parent_org_id, a.level + 1
    FROM organizations o
    JOIN a ON o.id = a.parent_org_id
    WHERE a.level < 10
  )
  SELECT id, level FROM a;
$$;


--
-- TOC entry 5640 (class 0 OID 0)
-- Dependencies: 698
-- Name: FUNCTION get_org_ancestors(p_org_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_org_ancestors(p_org_id uuid) IS 'Returns all parent organizations recursively (including the given org at level 0)';


--
-- TOC entry 853 (class 1255 OID 33347)
-- Name: get_org_children_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_org_children_count(p_org_id uuid) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.organizations
  WHERE parent_org_id = p_org_id
    AND is_active = true;
$$;


--
-- TOC entry 5641 (class 0 OID 0)
-- Dependencies: 853
-- Name: FUNCTION get_org_children_count(p_org_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_org_children_count(p_org_id uuid) IS 'Returns the count of active child organizations';


--
-- TOC entry 509 (class 1255 OID 20452)
-- Name: get_org_descendants(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_org_descendants(p_org_id uuid) RETURNS TABLE(org_id uuid, level integer)
    LANGUAGE sql STABLE
    AS $$
  WITH RECURSIVE d AS (
    SELECT id, 0 AS level
    FROM organizations
    WHERE id = p_org_id
    UNION ALL
    SELECT o.id, d.level + 1
    FROM organizations o
    JOIN d ON o.parent_org_id = d.id
    WHERE d.level < 10
  )
  SELECT id, level FROM d;
$$;


--
-- TOC entry 5642 (class 0 OID 0)
-- Dependencies: 509
-- Name: FUNCTION get_org_descendants(p_org_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_org_descendants(p_org_id uuid) IS 'Returns all child organizations recursively (including the given org at level 0)';


--
-- TOC entry 543 (class 1255 OID 33964)
-- Name: get_org_descendants_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_org_descendants_count(p_org_id uuid) RETURNS TABLE(total_count integer, shops_count integer, dists_count integer, mfgs_count integer, warehouses_count integer)
    LANGUAGE sql STABLE
    AS $$
WITH RECURSIVE tree AS (
  SELECT o.id, o.org_type_code
  FROM public.organizations o
  WHERE o.parent_org_id = p_org_id
    AND o.is_active = TRUE
  UNION ALL
  SELECT c.id, c.org_type_code
  FROM public.organizations c
  JOIN tree t ON c.parent_org_id = t.id
  WHERE c.is_active = TRUE
)
SELECT
  COUNT(*)::int AS total_count,
  COUNT(*) FILTER (WHERE org_type_code = 'SHOP')::int AS shops_count,
  COUNT(*) FILTER (WHERE org_type_code = 'DIST')::int AS dists_count,
  COUNT(*) FILTER (WHERE org_type_code = 'MFG')::int  AS mfgs_count,
  COUNT(*) FILTER (WHERE org_type_code = 'WH')::int   AS warehouses_count
FROM tree;
$$;


--
-- TOC entry 757 (class 1255 OID 33349)
-- Name: get_org_order_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_org_order_count(p_org_id uuid) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT (
    COALESCE((SELECT COUNT(*) FROM public.orders WHERE buyer_org_id = p_org_id), 0) +
    COALESCE((SELECT COUNT(*) FROM public.orders WHERE seller_org_id = p_org_id), 0)
  )::INTEGER;
$$;


--
-- TOC entry 5643 (class 0 OID 0)
-- Dependencies: 757
-- Name: FUNCTION get_org_order_count(p_org_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_org_order_count(p_org_id uuid) IS 'Returns the total count of orders for an organization (as buyer or seller)';


--
-- TOC entry 758 (class 1255 OID 33350)
-- Name: get_org_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_org_stats(p_org_id uuid) RETURNS TABLE(org_id uuid, org_type_code text, children_count integer, users_count integer, products_count integer, distributors_count integer, shops_count integer, orders_count integer)
    LANGUAGE sql STABLE
    AS $$
  WITH org_info AS (
    SELECT id, org_type_code
    FROM public.organizations
    WHERE id = p_org_id
  )
  SELECT 
    p_org_id AS org_id,
    oi.org_type_code,
    -- Children count (for HQ)
    public.get_org_children_count(p_org_id) AS children_count,
    -- Users count (all org types)
    public.get_org_user_count(p_org_id) AS users_count,
    -- Products count (different logic per org type)
    CASE 
      WHEN oi.org_type_code = 'HQ' THEN public.get_hq_aggregated_product_count(p_org_id)
      WHEN oi.org_type_code = 'MFG' THEN public.get_manufacturer_product_count(p_org_id)
      WHEN oi.org_type_code = 'DIST' THEN public.get_distributor_product_count(p_org_id)
      ELSE 0
    END AS products_count,
    -- Distributors count (for shops only)
    CASE 
      WHEN oi.org_type_code = 'SHOP' THEN public.get_shop_distributor_count(p_org_id)
      ELSE 0
    END AS distributors_count,
    -- Shops count (for distributors only)
    CASE 
      WHEN oi.org_type_code = 'DIST' THEN public.get_distributor_shop_count(p_org_id)
      ELSE 0
    END AS shops_count,
    -- Orders count (all org types)
    public.get_org_order_count(p_org_id) AS orders_count
  FROM org_info oi;
$$;


--
-- TOC entry 5644 (class 0 OID 0)
-- Dependencies: 758
-- Name: FUNCTION get_org_stats(p_org_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_org_stats(p_org_id uuid) IS 'Returns all statistics for an organization based on its type. This is the main function to call from the frontend.';


--
-- TOC entry 542 (class 1255 OID 33351)
-- Name: get_org_stats_batch(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_org_stats_batch(p_org_ids uuid[]) RETURNS TABLE(org_id uuid, org_type_code text, children_count integer, users_count integer, products_count integer, distributors_count integer, shops_count integer, orders_count integer)
    LANGUAGE sql STABLE
    AS $$
  WITH org_info AS (
    SELECT id, org_type_code
    FROM public.organizations
    WHERE id = ANY(p_org_ids)
  ),
  children_counts AS (
    SELECT parent_org_id AS org_id, COUNT(*)::INTEGER AS count
    FROM public.organizations
    WHERE parent_org_id = ANY(p_org_ids)
      AND is_active = true
    GROUP BY parent_org_id
  ),
  user_counts AS (
    SELECT organization_id AS org_id, COUNT(*)::INTEGER AS count
    FROM public.users
    WHERE organization_id = ANY(p_org_ids)
      AND is_active = true
    GROUP BY organization_id
  ),
  mfg_product_counts AS (
    SELECT manufacturer_id AS org_id, COUNT(*)::INTEGER AS count
    FROM public.products
    WHERE manufacturer_id = ANY(p_org_ids)
      AND is_active = true
    GROUP BY manufacturer_id
  ),
  dist_product_counts AS (
    SELECT distributor_id AS org_id, COUNT(DISTINCT product_id)::INTEGER AS count
    FROM public.distributor_products
    WHERE distributor_id = ANY(p_org_ids)
      AND is_active = true
    GROUP BY distributor_id
  ),
  hq_product_counts AS (
    SELECT o.parent_org_id AS org_id, COUNT(p.id)::INTEGER AS count
    FROM public.organizations o
    INNER JOIN public.products p ON p.manufacturer_id = o.id
    WHERE o.parent_org_id = ANY(p_org_ids)
      AND o.org_type_code = 'MFG'
      AND o.is_active = true
      AND p.is_active = true
    GROUP BY o.parent_org_id
  ),
  shop_distributor_counts AS (
    SELECT shop_id AS org_id, COUNT(*)::INTEGER AS count
    FROM public.shop_distributors
    WHERE shop_id = ANY(p_org_ids)
      AND is_active = true
    GROUP BY shop_id
  ),
  distributor_shop_counts AS (
    SELECT distributor_id AS org_id, COUNT(*)::INTEGER AS count
    FROM public.shop_distributors
    WHERE distributor_id = ANY(p_org_ids)
      AND is_active = true
    GROUP BY distributor_id
  ),
  order_counts AS (
    SELECT org_id, SUM(count)::INTEGER AS count
    FROM (
      SELECT buyer_org_id AS org_id, COUNT(*) AS count
      FROM public.orders
      WHERE buyer_org_id = ANY(p_org_ids)
      GROUP BY buyer_org_id
      UNION ALL
      SELECT seller_org_id AS org_id, COUNT(*) AS count
      FROM public.orders
      WHERE seller_org_id = ANY(p_org_ids)
      GROUP BY seller_org_id
    ) combined
    GROUP BY org_id
  )
  SELECT 
    oi.id AS org_id,
    oi.org_type_code,
    COALESCE(cc.count, 0) AS children_count,
    COALESCE(uc.count, 0) AS users_count,
    CASE 
      WHEN oi.org_type_code = 'HQ' THEN COALESCE(hqpc.count, 0)
      WHEN oi.org_type_code = 'MFG' THEN COALESCE(mpc.count, 0)
      WHEN oi.org_type_code = 'DIST' THEN COALESCE(dpc.count, 0)
      ELSE 0
    END AS products_count,
    CASE 
      WHEN oi.org_type_code = 'SHOP' THEN COALESCE(sdc.count, 0)
      ELSE 0
    END AS distributors_count,
    CASE 
      WHEN oi.org_type_code = 'DIST' THEN COALESCE(dsc.count, 0)
      ELSE 0
    END AS shops_count,
    COALESCE(oc.count, 0) AS orders_count
  FROM org_info oi
  LEFT JOIN children_counts cc ON cc.org_id = oi.id
  LEFT JOIN user_counts uc ON uc.org_id = oi.id
  LEFT JOIN mfg_product_counts mpc ON mpc.org_id = oi.id
  LEFT JOIN dist_product_counts dpc ON dpc.org_id = oi.id
  LEFT JOIN hq_product_counts hqpc ON hqpc.org_id = oi.id
  LEFT JOIN shop_distributor_counts sdc ON sdc.org_id = oi.id
  LEFT JOIN distributor_shop_counts dsc ON dsc.org_id = oi.id
  LEFT JOIN order_counts oc ON oc.org_id = oi.id;
$$;


--
-- TOC entry 5645 (class 0 OID 0)
-- Dependencies: 542
-- Name: FUNCTION get_org_stats_batch(p_org_ids uuid[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_org_stats_batch(p_org_ids uuid[]) IS 'Returns statistics for multiple organizations efficiently. Use this for list views.';


--
-- TOC entry 827 (class 1255 OID 22946)
-- Name: get_org_type(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_org_type(p_org_id uuid) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT org_type_code FROM public.organizations WHERE id = p_org_id;
$$;


--
-- TOC entry 787 (class 1255 OID 33348)
-- Name: get_org_user_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_org_user_count(p_org_id uuid) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.users
  WHERE organization_id = p_org_id
    AND is_active = true;
$$;


--
-- TOC entry 5646 (class 0 OID 0)
-- Dependencies: 787
-- Name: FUNCTION get_org_user_count(p_org_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_org_user_count(p_org_id uuid) IS 'Returns the count of active users in a specific organization';


--
-- TOC entry 523 (class 1255 OID 35318)
-- Name: get_pending_notifications(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_pending_notifications(p_limit integer DEFAULT 100) RETURNS TABLE(id uuid, org_id uuid, event_code text, channel text, to_phone text, to_email text, template_code text, payload_json jsonb, priority text, provider_name text, retry_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.org_id,
    n.event_code,
    n.channel,
    n.to_phone,
    n.to_email,
    n.template_code,
    n.payload_json,
    n.priority,
    n.provider_name,
    n.retry_count
  FROM public.notifications_outbox n
  WHERE 
    -- Ready to send
    (n.status = 'queued' OR (n.status = 'failed' AND n.retry_count < n.max_retries AND n.next_retry_at <= NOW()))
    -- Or scheduled and time has come
    OR (n.status = 'scheduled' AND n.scheduled_for <= NOW())
  ORDER BY 
    -- Priority order
    CASE n.priority
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'normal' THEN 3
      WHEN 'low' THEN 4
    END,
    n.created_at ASC
  LIMIT p_limit
  FOR UPDATE SKIP LOCKED; -- Prevent race conditions
END;
$$;


--
-- TOC entry 5647 (class 0 OID 0)
-- Dependencies: 523
-- Name: FUNCTION get_pending_notifications(p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_pending_notifications(p_limit integer) IS 'Gets pending notifications ready for delivery with priority ordering and locking';


--
-- TOC entry 681 (class 1255 OID 22950)
-- Name: get_remaining_quantity(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_remaining_quantity(p_parent_order_id uuid, p_variant_id uuid) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(parent.qty,0) - COALESCE(SUM(child.qty),0)
  FROM public.order_items parent
  LEFT JOIN public.orders child_o
    ON child_o.parent_order_id = p_parent_order_id
   AND child_o.status = 'approved'
  LEFT JOIN public.order_items child
    ON child.order_id = child_o.id
   AND child.variant_id = p_variant_id
  WHERE parent.order_id = p_parent_order_id
    AND parent.variant_id = p_variant_id
  GROUP BY parent.qty;
$$;


--
-- TOC entry 637 (class 1255 OID 21122)
-- Name: get_shop_available_products(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_shop_available_products(p_shop_id uuid, p_search text DEFAULT NULL::text) RETURNS TABLE(product_id uuid, product_code text, product_name text, variant_id uuid, variant_name text, brand_name text, distributor_id uuid, distributor_name text, unit_price numeric, in_stock boolean, available_quantity integer, is_preferred_distributor boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    sp.product_id,
    sp.product_code,
    sp.product_name,
    sp.default_variant_id    AS variant_id,
    sp.default_variant_name  AS variant_name,
    sp.brand_name,
    sp.distributor_id,
    sp.distributor_name,
    sp.distributor_cost      AS unit_price,
    sp.in_stock,
    sp.distributor_stock     AS available_quantity,
    sp.is_preferred          AS is_preferred_distributor
  FROM public.mv_shop_available_products sp
  WHERE sp.shop_id = p_shop_id
    AND sp.is_available = true
    AND (
      p_search IS NULL
      OR sp.product_name ILIKE '%' || p_search || '%'
      OR sp.brand_name   ILIKE '%' || p_search || '%'
      OR sp.product_code ILIKE '%' || p_search || '%'
    )
  ORDER BY
    sp.is_preferred DESC,
    sp.in_stock DESC,
    sp.product_name;
END;
$$;


--
-- TOC entry 5648 (class 0 OID 0)
-- Dependencies: 637
-- Name: FUNCTION get_shop_available_products(p_shop_id uuid, p_search text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_shop_available_products(p_shop_id uuid, p_search text) IS 'All available (and optionally filtered) products a shop can buy from its distributors.';


--
-- TOC entry 553 (class 1255 OID 33342)
-- Name: get_shop_distributor_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_shop_distributor_count(p_shop_id uuid) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.shop_distributors
  WHERE shop_id = p_shop_id
    AND is_active = true;
$$;


--
-- TOC entry 5649 (class 0 OID 0)
-- Dependencies: 553
-- Name: FUNCTION get_shop_distributor_count(p_shop_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_shop_distributor_count(p_shop_id uuid) IS 'Returns the count of active distributors for a specific shop';


--
-- TOC entry 829 (class 1255 OID 18640)
-- Name: get_storage_url(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_storage_url(bucket_name text, file_path text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    RETURN concat(
        current_setting('app.settings.supabase_url', true),
        '/storage/v1/object/public/',
        bucket_name,
        '/',
        file_path
    );
END;
$$;


--
-- TOC entry 622 (class 1255 OID 21431)
-- Name: get_user_by_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_by_email(p_email text) RETURNS TABLE(id uuid, email text, full_name text, role_code text, organization_id uuid, is_active boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT 
    u.id,
    u.email,
    u.full_name,
    u.role_code,
    u.organization_id,
    u.is_active
  FROM public.users u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;
$$;


--
-- TOC entry 5650 (class 0 OID 0)
-- Dependencies: 622
-- Name: FUNCTION get_user_by_email(p_email text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_user_by_email(p_email text) IS 'Safely retrieves user by email without throwing errors when not found';


--
-- TOC entry 634 (class 1255 OID 17792)
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    -- New users default to GUEST role
    INSERT INTO public.users (id, email, role_code, created_at)
    VALUES (NEW.id, NEW.email, 'GUEST', now())
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;


--
-- TOC entry 624 (class 1255 OID 34994)
-- Name: hard_delete_organization(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hard_delete_organization(p_org_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_org_type TEXT;
  v_org_name TEXT;
  v_org_code TEXT;
  v_has_orders BOOLEAN := FALSE;
  v_order_count INTEGER := 0;
  v_child_count INTEGER := 0;
  v_user_count INTEGER := 0;
  v_deleted_shop_distributors INTEGER := 0;
  v_deleted_distributor_products INTEGER := 0;
  v_deleted_inventory INTEGER := 0;
  v_deleted_users INTEGER := 0;
BEGIN
  -- Get organization details
  SELECT org_type_code, org_name, org_code
  INTO v_org_type, v_org_name, v_org_code
  FROM public.organizations
  WHERE id = p_org_id;

  -- Check if organization exists
  IF v_org_type IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organization not found',
      'error_code', 'ORG_NOT_FOUND'
    );
  END IF;

  -- Check if organization has any orders (as buyer or seller)
  SELECT 
    EXISTS (
      SELECT 1 FROM public.orders 
      WHERE buyer_org_id = p_org_id OR seller_org_id = p_org_id
    ),
    COUNT(*) 
  INTO v_has_orders, v_order_count
  FROM public.orders 
  WHERE buyer_org_id = p_org_id OR seller_org_id = p_org_id;

  IF v_has_orders THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('%s (%s) cannot be deleted because it has %s order(s) in the system', 
        v_org_name, v_org_code, v_order_count),
      'error_code', 'HAS_ORDERS',
      'order_count', v_order_count,
      'org_name', v_org_name,
      'org_code', v_org_code
    );
  END IF;

  -- Check if organization has child organizations
  SELECT COUNT(*) INTO v_child_count
  FROM public.organizations
  WHERE parent_org_id = p_org_id AND is_active = true;

  IF v_child_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('%s (%s) cannot be deleted because it has %s active child organization(s)', 
        v_org_name, v_org_code, v_child_count),
      'error_code', 'HAS_CHILDREN',
      'child_count', v_child_count,
      'org_name', v_org_name,
      'org_code', v_org_code
    );
  END IF;

  -- Get count of users before deletion
  SELECT COUNT(*) INTO v_user_count
  FROM public.users
  WHERE organization_id = p_org_id;

  -- Begin deletion process
  -- Note: Many tables have ON DELETE CASCADE, so they'll be auto-deleted
  -- We'll track what we explicitly delete

  -- 1. Delete shop_distributors entries (if SHOP)
  IF v_org_type = 'SHOP' THEN
    DELETE FROM public.shop_distributors
    WHERE shop_id = p_org_id;
    GET DIAGNOSTICS v_deleted_shop_distributors = ROW_COUNT;
  END IF;

  -- 2. Delete shop_distributors entries (if DIST - where this org is the distributor)
  IF v_org_type = 'DIST' THEN
    DELETE FROM public.shop_distributors
    WHERE distributor_id = p_org_id;
    GET DIAGNOSTICS v_deleted_shop_distributors = ROW_COUNT;
  END IF;

  -- 3. Delete distributor_products entries (if DIST)
  IF v_org_type = 'DIST' THEN
    DELETE FROM public.distributor_products
    WHERE distributor_id = p_org_id;
    GET DIAGNOSTICS v_deleted_distributor_products = ROW_COUNT;
  END IF;

  -- 4. Delete product inventory (CASCADE will handle this, but we count it)
  SELECT COUNT(*) INTO v_deleted_inventory
  FROM public.product_inventory
  WHERE organization_id = p_org_id;

  -- 5. Delete users (important to do before org deletion)
  DELETE FROM public.users
  WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_deleted_users = ROW_COUNT;

  -- 6. Delete notification settings
  DELETE FROM public.org_notification_settings
  WHERE org_id = p_org_id;

  -- 7. Delete message templates
  DELETE FROM public.message_templates
  WHERE org_id = p_org_id;

  -- 8. Delete journey configurations
  DELETE FROM public.journey_configurations
  WHERE org_id = p_org_id;

  -- 9. Delete points rules
  DELETE FROM public.points_rules
  WHERE org_id = p_org_id;

  -- 10. Finally, delete the organization itself
  -- This will CASCADE delete many related records:
  -- - product_inventory (ON DELETE CASCADE)
  -- - distributor_products (ON DELETE CASCADE)
  -- - shop_distributors (ON DELETE CASCADE)
  -- - child organizations (parent_org_id references)
  DELETE FROM public.organizations
  WHERE id = p_org_id;

  -- Return success with deletion summary
  RETURN jsonb_build_object(
    'success', true,
    'message', format('%s (%s) has been permanently deleted', v_org_name, v_org_code),
    'deleted_organization', jsonb_build_object(
      'id', p_org_id,
      'name', v_org_name,
      'code', v_org_code,
      'type', v_org_type
    ),
    'deleted_related_records', jsonb_build_object(
      'users', v_deleted_users,
      'shop_distributors', v_deleted_shop_distributors,
      'distributor_products', v_deleted_distributor_products,
      'inventory_records', v_deleted_inventory
    )
  );

EXCEPTION
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot delete organization due to foreign key constraint. There may be related records that need to be deleted first.',
      'error_code', 'FOREIGN_KEY_VIOLATION',
      'org_name', v_org_name,
      'org_code', v_org_code
    );
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Unexpected error: %s', SQLERRM),
      'error_code', 'UNEXPECTED_ERROR',
      'org_name', v_org_name,
      'org_code', v_org_code
    );
END;
$$;


--
-- TOC entry 5651 (class 0 OID 0)
-- Dependencies: 624
-- Name: FUNCTION hard_delete_organization(p_org_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.hard_delete_organization(p_org_id uuid) IS 'Hard deletes an organization and all related data. 
Prevents deletion if:
- Organization has any orders (as buyer or seller)
- Organization has active child organizations
Returns JSON with success status and deletion details.
Automatically removes:
- Users
- Shop-distributor relationships
- Distributor-product relationships  
- Product inventory
- Notification settings
- Message templates
- Journey configurations
- Points rules';


--
-- TOC entry 545 (class 1255 OID 17789)
-- Name: has_role_level(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role_level(required_level integer) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.roles r ON r.role_code = u.role_code
        WHERE u.id = auth.uid()
        AND r.role_level <= required_level
        AND u.is_active = true
    );
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 421 (class 1259 OID 22790)
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    doc_type public.document_type NOT NULL,
    doc_no text NOT NULL,
    status public.document_status DEFAULT 'pending'::public.document_status NOT NULL,
    issued_by_org_id uuid NOT NULL,
    issued_to_org_id uuid NOT NULL,
    company_id uuid NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    created_by uuid NOT NULL,
    acknowledged_by uuid,
    acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 5652 (class 0 OID 0)
-- Dependencies: 421
-- Name: TABLE documents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.documents IS 'Workflow documents (PO, Invoice, Payment, Receipt).';


--
-- TOC entry 5653 (class 0 OID 0)
-- Dependencies: 421
-- Name: COLUMN documents.payload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.documents.payload IS 'Flexible JSONB for doc-specific fields.';


--
-- TOC entry 834 (class 1255 OID 22955)
-- Name: invoice_acknowledge(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoice_acknowledge(p_document_id uuid, p_payment_proof_url text DEFAULT NULL::text) RETURNS public.documents
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE d public.documents; o public.orders; v_pay_id uuid; v_required boolean;
BEGIN
  SELECT * INTO d FROM public.documents
   WHERE id=p_document_id AND doc_type='INVOICE'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice document not found'; END IF;
  IF d.status <> 'pending' THEN RAISE EXCEPTION 'Invoice must be pending'; END IF;

  SELECT * INTO o FROM public.orders WHERE id=d.order_id;

  -- Use root HQ org (company) to read setting
  v_required := public.is_payment_proof_required(o.company_id);
  IF v_required AND p_payment_proof_url IS NULL THEN
    RAISE EXCEPTION 'Payment proof is required for this organization';
  END IF;

  UPDATE public.documents
     SET status='acknowledged', acknowledged_by=auth.uid(),
         acknowledged_at=now(), updated_at=now()
   WHERE id=p_document_id
   RETURNING * INTO d;

  INSERT INTO public.documents (
    order_id, doc_type, doc_no, status,
    issued_by_org_id, issued_to_org_id,
    company_id, created_by, payload
  )
  VALUES (
    o.id, 'PAYMENT',
    public.generate_doc_number(o.company_id, 'PAY', replace(o.order_type::text,'2','')),
    'pending',
    o.buyer_org_id,    -- buyer issues payment
    o.seller_org_id,
    o.company_id, auth.uid(),
    jsonb_build_object('invoice_id', p_document_id)
  )
  RETURNING id INTO v_pay_id;

  IF p_payment_proof_url IS NOT NULL THEN
    INSERT INTO public.document_files (document_id, file_url, company_id, uploaded_by)
    VALUES (v_pay_id, p_payment_proof_url, o.company_id, auth.uid());
  END IF;

  RETURN d;
END;
$$;


--
-- TOC entry 512 (class 1255 OID 17788)
-- Name: is_hq_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_hq_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.roles r ON r.role_code = u.role_code
        WHERE u.id = auth.uid()
        AND r.role_level <= 10
        AND u.is_active = true
    );
$$;


--
-- TOC entry 837 (class 1255 OID 22948)
-- Name: is_payment_proof_required(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_payment_proof_required(p_org_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE((settings->>'require_payment_proof')::boolean, true)
  FROM public.organizations
  WHERE id = p_org_id;
$$;


--
-- TOC entry 664 (class 1255 OID 22945)
-- Name: is_power_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_power_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.role_code = u.role_code
    WHERE u.id = auth.uid()
      AND u.is_active = true
      AND r.role_level <= 20 -- SUPER/HQ_ADMIN/POWER_USER
  );
$$;


--
-- TOC entry 5654 (class 0 OID 0)
-- Dependencies: 664
-- Name: FUNCTION is_power_user(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_power_user() IS 'True if current user has role_level <= 20 (Power User or higher).';


--
-- TOC entry 731 (class 1255 OID 21123)
-- Name: is_product_available_for_shop(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_product_available_for_shop(p_shop_id uuid, p_product_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.mv_shop_available_products
    WHERE shop_id = p_shop_id
      AND product_id = p_product_id
      AND is_available = true
      AND in_stock = true
  );
$$;


--
-- TOC entry 5655 (class 0 OID 0)
-- Dependencies: 731
-- Name: FUNCTION is_product_available_for_shop(p_shop_id uuid, p_product_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_product_available_for_shop(p_shop_id uuid, p_product_id uuid) IS 'Fast availability check of a product for a given shop (requires mv_shop_available_products).';


--
-- TOC entry 571 (class 1255 OID 17787)
-- Name: is_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
        AND u.role_code = 'SA'
        AND u.is_active = true
    );
$$;


--
-- TOC entry 578 (class 1255 OID 35317)
-- Name: log_notification_attempt(uuid, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_notification_attempt(p_outbox_id uuid, p_status text, p_provider_message_id text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text, p_provider_response jsonb DEFAULT NULL::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_outbox RECORD;
BEGIN
  -- Get outbox record
  SELECT * INTO v_outbox
  FROM public.notifications_outbox
  WHERE id = p_outbox_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outbox record not found: %', p_outbox_id;
  END IF;

  -- Update outbox
  UPDATE public.notifications_outbox
  SET 
    status = p_status,
    provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
    error = CASE WHEN p_status = 'failed' THEN p_error_message ELSE NULL END,
    sent_at = CASE WHEN p_status = 'sent' THEN NOW() ELSE sent_at END,
    retry_count = CASE WHEN p_status = 'failed' THEN retry_count + 1 ELSE retry_count END,
    next_retry_at = CASE 
      WHEN p_status = 'failed' AND retry_count < max_retries 
      THEN NOW() + (INTERVAL '5 minutes' * POWER(2, retry_count)) -- Exponential backoff
      ELSE NULL 
    END
  WHERE id = p_outbox_id;

  -- Log the attempt
  INSERT INTO public.notification_logs (
    outbox_id,
    org_id,
    event_code,
    channel,
    provider_name,
    recipient_type,
    recipient_value,
    status,
    status_details,
    provider_message_id,
    provider_response,
    sent_at,
    failed_at,
    error_message,
    retry_count,
    created_at
  ) VALUES (
    p_outbox_id,
    v_outbox.org_id,
    v_outbox.event_code,
    v_outbox.channel,
    v_outbox.provider_name,
    CASE 
      WHEN v_outbox.to_phone IS NOT NULL THEN 'phone'
      WHEN v_outbox.to_email IS NOT NULL THEN 'email'
      ELSE 'unknown'
    END,
    COALESCE(v_outbox.to_phone, v_outbox.to_email, 'unknown'),
    p_status,
    CASE 
      WHEN p_status = 'sent' THEN 'Successfully sent to provider'
      WHEN p_status = 'failed' THEN p_error_message
      ELSE NULL
    END,
    p_provider_message_id,
    p_provider_response,
    CASE WHEN p_status = 'sent' THEN NOW() ELSE NULL END,
    CASE WHEN p_status = 'failed' THEN NOW() ELSE NULL END,
    p_error_message,
    v_outbox.retry_count,
    NOW()
  );
END;
$$;


--
-- TOC entry 5656 (class 0 OID 0)
-- Dependencies: 578
-- Name: FUNCTION log_notification_attempt(p_outbox_id uuid, p_status text, p_provider_message_id text, p_error_message text, p_provider_response jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.log_notification_attempt(p_outbox_id uuid, p_status text, p_provider_message_id text, p_error_message text, p_provider_response jsonb) IS 'Logs delivery attempt and updates outbox status with retry logic';


--
-- TOC entry 494 (class 1255 OID 22725)
-- Name: order_items_before_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.order_items_before_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT o.company_id INTO v_company_id
  FROM public.orders o
  WHERE o.id = NEW.order_id;

  NEW.company_id := v_company_id;
  RETURN NEW;
END;
$$;


--
-- TOC entry 419 (class 1259 OID 22622)
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    order_no text NOT NULL,
    order_type public.order_type NOT NULL,
    company_id uuid NOT NULL,
    buyer_org_id uuid NOT NULL,
    seller_org_id uuid NOT NULL,
    parent_order_id uuid,
    status public.order_status DEFAULT 'draft'::public.order_status NOT NULL,
    units_per_case integer DEFAULT 100,
    qr_buffer_percent numeric(5,2) DEFAULT 10.00,
    has_rfid boolean DEFAULT false,
    has_points boolean DEFAULT true,
    has_lucky_draw boolean DEFAULT false,
    has_redeem boolean DEFAULT false,
    notes text,
    created_by uuid NOT NULL,
    updated_by uuid,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT no_self_parent CHECK ((id IS DISTINCT FROM parent_order_id)),
    CONSTRAINT orders_qr_buffer_percent_check CHECK (((qr_buffer_percent >= (0)::numeric) AND (qr_buffer_percent <= (100)::numeric))),
    CONSTRAINT orders_units_per_case_check CHECK ((units_per_case > 0))
);


--
-- TOC entry 5657 (class 0 OID 0)
-- Dependencies: 419
-- Name: TABLE orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.orders IS 'Orders with tenant isolation via company_id';


--
-- TOC entry 5658 (class 0 OID 0)
-- Dependencies: 419
-- Name: COLUMN orders.order_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.order_no IS 'Generated by generate_doc_number() → 2-digit monthly sequence';


--
-- TOC entry 741 (class 1255 OID 22953)
-- Name: orders_approve(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orders_approve(p_order_id uuid) RETURNS public.orders
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v public.orders;
  v_user_org uuid;
  v_user_org_type text;
  v_can boolean := false;
  v_code text;
BEGIN
  SELECT * INTO v FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v.status <> 'submitted' THEN RAISE EXCEPTION 'Order must be in submitted'; END IF;

  SELECT organization_id INTO v_user_org FROM public.users WHERE id = auth.uid();
  v_user_org_type := public.get_org_type(v_user_org);

  -- Approval permissions
  CASE v.order_type
    WHEN 'H2M' THEN
      IF v_user_org_type='HQ' AND public.is_power_user() THEN v_can := true; END IF;
    WHEN 'D2H' THEN
      -- HQ approvers (Power User or Admin) – requires is_hq_admin() function to exist
      IF v_user_org_type='HQ' AND (public.is_power_user() OR
          EXISTS (SELECT 1 FROM pg_proc WHERE proname='is_hq_admin' AND pg_function_is_visible(oid) AND public.is_hq_admin())) THEN
        v_can := true;
      END IF;
    WHEN 'S2D' THEN
      -- Distributor seller approves
      IF v_user_org = v.seller_org_id AND public.is_power_user() THEN v_can := true; END IF;
  END CASE;

  IF NOT v_can THEN
    RAISE EXCEPTION 'User lacks permission to approve this order type';
  END IF;

  -- Parent checks
  IF v.parent_order_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id=v.parent_order_id AND status='approved') THEN
      RAISE EXCEPTION 'Parent order must be approved first';
    END IF;
    PERFORM public.validate_child_quantities(p_order_id, v.parent_order_id);
  END IF;

  -- Approve
  UPDATE public.orders
     SET status='approved',
         approved_by=auth.uid(),
         approved_at=now(),
         updated_by=auth.uid(),
         updated_at=now()
   WHERE id=p_order_id
   RETURNING * INTO v;

  -- Auto-create PO document (uses 2-digit doc numbers)
  v_code := replace(v.order_type::text,'2',''); -- H2M→HM, etc.
  INSERT INTO public.documents (
    order_id, doc_type, doc_no, status,
    issued_by_org_id, issued_to_org_id,
    company_id, created_by
  )
  VALUES (
    v.id, 'PO',
    public.generate_doc_number(v.company_id, 'PO', v_code),
    'pending',
    v.buyer_org_id,  -- buyer issues PO
    v.seller_org_id,
    v.company_id, auth.uid()
  );

  RETURN v;
END;
$$;


--
-- TOC entry 585 (class 1255 OID 22724)
-- Name: orders_before_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orders_before_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_order_type_code text;
BEGIN
  -- Detect order type if not provided
  IF NEW.order_type IS NULL THEN
    NEW.order_type := public.detect_order_type(NEW.buyer_org_id, NEW.seller_org_id);
  END IF;

  -- Ensure company_id (root HQ of buyer)
  IF NEW.company_id IS NULL THEN
    NEW.company_id := public.get_company_id(NEW.buyer_org_id);
  END IF;

  -- Generate human order number using 2-digit sequence
  v_order_type_code := replace(NEW.order_type::text, '2', ''); -- H2M→HM, D2H→DH, S2D→SD
  NEW.order_no := public.generate_doc_number(NEW.company_id, 'ORD', v_order_type_code);

  -- Set created_by if missing
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;


--
-- TOC entry 541 (class 1255 OID 22952)
-- Name: orders_submit(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orders_submit(p_order_id uuid) RETURNS public.orders
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE v public.orders; v_items int;
BEGIN
  SELECT * INTO v FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v.status <> 'draft' THEN RAISE EXCEPTION 'Order must be in draft'; END IF;

  SELECT COUNT(*) INTO v_items FROM public.order_items WHERE order_id = p_order_id;
  IF v_items = 0 THEN RAISE EXCEPTION 'Order must have at least one item'; END IF;

  IF v.parent_order_id IS NOT NULL THEN
    PERFORM public.validate_child_items(p_order_id, v.parent_order_id);
  END IF;

  UPDATE public.orders
     SET status='submitted', updated_by=auth.uid(), updated_at=now()
   WHERE id=p_order_id
   RETURNING * INTO v;

  RETURN v;
END;
$$;


--
-- TOC entry 778 (class 1255 OID 22956)
-- Name: payment_acknowledge(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payment_acknowledge(p_document_id uuid) RETURNS public.documents
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE d public.documents; o public.orders;
BEGIN
  SELECT * INTO d FROM public.documents
   WHERE id=p_document_id AND doc_type='PAYMENT'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment document not found'; END IF;
  IF d.status <> 'pending' THEN RAISE EXCEPTION 'Payment must be pending'; END IF;

  SELECT * INTO o FROM public.orders WHERE id=d.order_id;

  UPDATE public.documents
     SET status='acknowledged', acknowledged_by=auth.uid(),
         acknowledged_at=now(), updated_at=now()
   WHERE id=p_document_id
   RETURNING * INTO d;

  INSERT INTO public.documents (
    order_id, doc_type, doc_no, status,
    issued_by_org_id, issued_to_org_id,
    company_id, created_by, payload
  )
  VALUES (
    o.id, 'RECEIPT',
    public.generate_doc_number(o.company_id, 'RCPT', replace(o.order_type::text,'2','')),
    'completed',              -- receipt is terminal
    o.seller_org_id,          -- seller issues receipt
    o.buyer_org_id,
    o.company_id, auth.uid(),
    jsonb_build_object('payment_id', p_document_id)
  );

  UPDATE public.orders
     SET status='closed', updated_by=auth.uid(), updated_at=now()
   WHERE id = o.id;

  RETURN d;
END;
$$;


--
-- TOC entry 733 (class 1255 OID 22954)
-- Name: po_acknowledge(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.po_acknowledge(p_document_id uuid) RETURNS public.documents
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE d public.documents; o public.orders;
BEGIN
  SELECT * INTO d FROM public.documents
   WHERE id=p_document_id AND doc_type='PO'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PO document not found'; END IF;
  IF d.status <> 'pending' THEN RAISE EXCEPTION 'PO must be pending'; END IF;

  SELECT * INTO o FROM public.orders WHERE id=d.order_id;

  UPDATE public.documents
     SET status='acknowledged', acknowledged_by=auth.uid(),
         acknowledged_at=now(), updated_at=now()
   WHERE id=p_document_id
   RETURNING * INTO d;

  INSERT INTO public.documents (
    order_id, doc_type, doc_no, status,
    issued_by_org_id, issued_to_org_id,
    company_id, created_by
  )
  VALUES (
    o.id, 'INVOICE',
    public.generate_doc_number(o.company_id, 'INV', replace(o.order_type::text,'2','')),
    'pending',
    o.seller_org_id,   -- seller issues invoice
    o.buyer_org_id,
    o.company_id, auth.uid()
  );

  RETURN d;
END;
$$;


--
-- TOC entry 690 (class 1255 OID 35316)
-- Name: queue_notification(uuid, text, text, text, text, text, jsonb, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_notification(p_org_id uuid, p_event_code text, p_channel text, p_recipient_phone text DEFAULT NULL::text, p_recipient_email text DEFAULT NULL::text, p_template_code text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_priority text DEFAULT 'normal'::text, p_scheduled_for timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_notification_id UUID;
  v_template_body TEXT;
  v_provider_name TEXT;
  v_is_enabled BOOLEAN;
BEGIN
  -- Check if this event type is enabled for the org
  SELECT enabled INTO v_is_enabled
  FROM public.notification_settings
  WHERE org_id = p_org_id 
    AND event_code = p_event_code
    AND p_channel = ANY(channels_enabled);

  IF NOT FOUND OR v_is_enabled = false THEN
    RAISE NOTICE 'Notification event % not enabled for org % on channel %', p_event_code, p_org_id, p_channel;
    RETURN NULL;
  END IF;

  -- Get active provider for this channel
  SELECT provider_name INTO v_provider_name
  FROM public.notification_provider_configs
  WHERE org_id = p_org_id
    AND channel = p_channel
    AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_provider_name IS NULL THEN
    RAISE EXCEPTION 'No active provider configured for channel % in org %', p_channel, p_org_id;
  END IF;

  -- Get template if specified, otherwise use default from notification_types
  IF p_template_code IS NULL THEN
    SELECT default_template_code INTO p_template_code
    FROM public.notification_types
    WHERE event_code = p_event_code;
  END IF;

  -- Insert into outbox
  INSERT INTO public.notifications_outbox (
    org_id,
    event_code,
    channel,
    to_phone,
    to_email,
    template_code,
    payload_json,
    priority,
    provider_name,
    scheduled_for,
    status,
    retry_count,
    max_retries,
    created_at
  ) VALUES (
    p_org_id,
    p_event_code,
    p_channel,
    p_recipient_phone,
    p_recipient_email,
    p_template_code,
    p_payload,
    p_priority,
    v_provider_name,
    p_scheduled_for,
    CASE WHEN p_scheduled_for IS NOT NULL THEN 'scheduled' ELSE 'queued' END,
    0,
    3,
    NOW()
  ) RETURNING id INTO v_notification_id;

  -- Log the queued notification
  INSERT INTO public.notification_logs (
    outbox_id,
    org_id,
    event_code,
    channel,
    provider_name,
    recipient_type,
    recipient_value,
    status,
    queued_at,
    created_at
  ) VALUES (
    v_notification_id,
    p_org_id,
    p_event_code,
    p_channel,
    v_provider_name,
    CASE 
      WHEN p_recipient_phone IS NOT NULL THEN 'phone'
      WHEN p_recipient_email IS NOT NULL THEN 'email'
      ELSE 'unknown'
    END,
    COALESCE(p_recipient_phone, p_recipient_email, 'unknown'),
    'queued',
    NOW(),
    NOW()
  );

  RETURN v_notification_id;
END;
$$;


--
-- TOC entry 5659 (class 0 OID 0)
-- Dependencies: 690
-- Name: FUNCTION queue_notification(p_org_id uuid, p_event_code text, p_channel text, p_recipient_phone text, p_recipient_email text, p_template_code text, p_payload jsonb, p_priority text, p_scheduled_for timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.queue_notification(p_org_id uuid, p_event_code text, p_channel text, p_recipient_phone text, p_recipient_email text, p_template_code text, p_payload jsonb, p_priority text, p_scheduled_for timestamp with time zone) IS 'Queues a notification for delivery. Checks if event is enabled and provider is configured.';


--
-- TOC entry 592 (class 1255 OID 35525)
-- Name: record_stock_movement(text, uuid, uuid, integer, numeric, uuid, text, text, text, text, uuid, text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_stock_movement(p_movement_type text, p_variant_id uuid, p_organization_id uuid, p_quantity_change integer, p_unit_cost numeric DEFAULT NULL::numeric, p_manufacturer_id uuid DEFAULT NULL::uuid, p_warehouse_location text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_reference_type text DEFAULT 'manual'::text, p_reference_id uuid DEFAULT NULL::uuid, p_reference_no text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid, p_created_by uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_movement_id UUID;
    v_current_qty INTEGER;
    v_new_qty INTEGER;
    v_inventory_id UUID;
    v_company_id UUID;
BEGIN
    -- Get company_id if not provided
    IF p_company_id IS NULL THEN
        SELECT company_id INTO v_company_id FROM public.organizations WHERE id = p_organization_id;
    ELSE
        v_company_id := p_company_id;
    END IF;

    -- Get current inventory record
    SELECT id, quantity_on_hand INTO v_inventory_id, v_current_qty
    FROM public.product_inventory
    WHERE variant_id = p_variant_id 
      AND organization_id = p_organization_id
      AND is_active = true;

    -- If no inventory record exists, create one
    IF v_inventory_id IS NULL THEN
        INSERT INTO public.product_inventory (
            variant_id,
            organization_id,
            quantity_on_hand,
            quantity_allocated,
            warehouse_location,
            average_cost,
            company_id,
            created_at,
            updated_at
        ) VALUES (
            p_variant_id,
            p_organization_id,
            0,
            0,
            p_warehouse_location,
            p_unit_cost,
            v_company_id,
            NOW(),
            NOW()
        ) RETURNING id, quantity_on_hand INTO v_inventory_id, v_current_qty;
    END IF;

    -- Calculate new quantity
    v_new_qty := v_current_qty + p_quantity_change;

    -- Ensure quantity doesn't go negative
    IF v_new_qty < 0 THEN
        RAISE EXCEPTION 'Insufficient stock. Current: %, Requested change: %', v_current_qty, p_quantity_change;
    END IF;

    -- Create movement record
    INSERT INTO public.stock_movements (
        movement_type,
        reference_type,
        reference_id,
        reference_no,
        variant_id,
        to_organization_id,
        quantity_change,
        quantity_before,
        quantity_after,
        unit_cost,
        manufacturer_id,
        warehouse_location,
        reason,
        notes,
        company_id,
        created_by,
        created_at
    ) VALUES (
        p_movement_type,
        p_reference_type,
        p_reference_id,
        p_reference_no,
        p_variant_id,
        p_organization_id,
        p_quantity_change,
        v_current_qty,
        v_new_qty,
        p_unit_cost,
        p_manufacturer_id,
        p_warehouse_location,
        p_reason,
        p_notes,
        v_company_id,
        p_created_by,
        NOW()
    ) RETURNING id INTO v_movement_id;

    -- Update inventory
    UPDATE public.product_inventory
    SET 
        quantity_on_hand = v_new_qty,
        warehouse_location = COALESCE(p_warehouse_location, warehouse_location),
        average_cost = CASE 
            WHEN p_unit_cost IS NOT NULL AND p_quantity_change > 0 THEN
                -- Weighted average for additions
                ((COALESCE(average_cost, 0) * v_current_qty) + (p_unit_cost * p_quantity_change)) / NULLIF(v_new_qty, 0)
            ELSE
                COALESCE(average_cost, p_unit_cost)
        END,
        updated_at = NOW()
    WHERE id = v_inventory_id;

    RETURN v_movement_id;
END;
$$;


--
-- TOC entry 5660 (class 0 OID 0)
-- Dependencies: 592
-- Name: FUNCTION record_stock_movement(p_movement_type text, p_variant_id uuid, p_organization_id uuid, p_quantity_change integer, p_unit_cost numeric, p_manufacturer_id uuid, p_warehouse_location text, p_reason text, p_notes text, p_reference_type text, p_reference_id uuid, p_reference_no text, p_company_id uuid, p_created_by uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.record_stock_movement(p_movement_type text, p_variant_id uuid, p_organization_id uuid, p_quantity_change integer, p_unit_cost numeric, p_manufacturer_id uuid, p_warehouse_location text, p_reason text, p_notes text, p_reference_type text, p_reference_id uuid, p_reference_no text, p_company_id uuid, p_created_by uuid) IS 'Records stock movement and updates product_inventory atomically';


--
-- TOC entry 687 (class 1255 OID 20996)
-- Name: refresh_all_materialized_views(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_all_materialized_views() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Refresh major analytics views concurrently
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_product_catalog;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_shop_available_products;

  RAISE NOTICE 'All materialized views refreshed successfully at %', now();
END;
$$;


--
-- TOC entry 5661 (class 0 OID 0)
-- Dependencies: 687
-- Name: FUNCTION refresh_all_materialized_views(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_all_materialized_views() IS 'Refreshes all materialized views (product catalog, shop availability) concurrently for analytics/dashboard consistency.';


--
-- TOC entry 640 (class 1255 OID 20608)
-- Name: refresh_product_catalog(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_product_catalog() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$ 
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_catalog;
END;
$$;


--
-- TOC entry 764 (class 1255 OID 20625)
-- Name: refresh_shop_products(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_shop_products() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$ 
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_shop_available_products;
END;
$$;


--
-- TOC entry 851 (class 1255 OID 35320)
-- Name: render_template(text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.render_template(p_template_code text, p_org_id uuid, p_payload jsonb) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_template_body TEXT;
  v_result TEXT;
  v_key TEXT;
  v_value TEXT;
BEGIN
  -- Get template body
  SELECT body INTO v_template_body
  FROM public.message_templates
  WHERE code = p_template_code
    AND org_id = p_org_id
    AND is_active = true;

  IF v_template_body IS NULL THEN
    RAISE EXCEPTION 'Template not found: % for org %', p_template_code, p_org_id;
  END IF;

  v_result := v_template_body;

  -- Simple variable replacement ({{variable_name}})
  FOR v_key, v_value IN SELECT * FROM jsonb_each_text(p_payload)
  LOOP
    v_result := REPLACE(v_result, '{{' || v_key || '}}', v_value);
  END LOOP;

  RETURN v_result;
END;
$$;


--
-- TOC entry 5662 (class 0 OID 0)
-- Dependencies: 851
-- Name: FUNCTION render_template(p_template_code text, p_org_id uuid, p_payload jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.render_template(p_template_code text, p_org_id uuid, p_payload jsonb) IS 'Renders a message template with variable substitution from payload';


--
-- TOC entry 535 (class 1255 OID 20954)
-- Name: search_products(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_products(search_query text) RETURNS TABLE(product_id uuid, product_code text, product_name text, brand_name text, category_name text, is_active boolean, relevance real)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.product_code,
    p.product_name,
    b.brand_name,
    c.category_name,
    p.is_active,
    ts_rank(
      to_tsvector(
        'english',
        COALESCE(p.product_name,'') || ' ' ||
        COALESCE(b.brand_name,'')   || ' ' ||
        COALESCE(p.product_description,'')
      ),
      plainto_tsquery('english', search_query)
    ) AS relevance
  FROM public.products p
  LEFT JOIN public.brands b             ON b.id = p.brand_id
  LEFT JOIN public.product_categories c ON c.id = p.category_id
  WHERE to_tsvector(
          'english',
          COALESCE(p.product_name,'') || ' ' ||
          COALESCE(b.brand_name,'')   || ' ' ||
          COALESCE(p.product_description,'')
        ) @@ plainto_tsquery('english', search_query)
  ORDER BY relevance DESC, p.product_name;
END;
$$;


--
-- TOC entry 5663 (class 0 OID 0)
-- Dependencies: 535
-- Name: FUNCTION search_products(search_query text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.search_products(search_query text) IS 'Full-text search over products with relevance ranking (name + brand + description).';


--
-- TOC entry 771 (class 1255 OID 34466)
-- Name: sync_shop_distributor_link(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_shop_distributor_link() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Only for SHOP rows that are active and have a DIST parent
  IF NEW.org_type_code = 'SHOP'
     AND NEW.is_active = TRUE
     AND NEW.parent_org_id IS NOT NULL
     AND (SELECT org_type_code FROM public.organizations WHERE id = NEW.parent_org_id) = 'DIST'
  THEN
    INSERT INTO public.shop_distributors (
      shop_id, distributor_id, payment_terms, is_active, is_preferred, created_at, updated_at
    )
    VALUES (NEW.id, NEW.parent_org_id, 'NET_30', TRUE, TRUE, NOW(), NOW())
    ON CONFLICT (shop_id, distributor_id) DO NOTHING;
  END IF;

  RETURN NEW;
END; $$;


--
-- TOC entry 636 (class 1255 OID 22105)
-- Name: sync_user_profile(uuid, text, text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_user_profile(p_user_id uuid, p_email text, p_role_code text DEFAULT 'GUEST'::text, p_organization_id uuid DEFAULT NULL::uuid, p_full_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Insert or update public.users record
  INSERT INTO public.users (
    id,
    email,
    role_code,
    organization_id,
    full_name,
    phone,
    is_active,
    is_verified,
    email_verified_at,
    created_at,
    updated_at
  ) VALUES (
    p_user_id,
    p_email,
    p_role_code,
    p_organization_id,
    p_full_name,
    p_phone,
    TRUE,
    TRUE,
    NOW(),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    role_code = EXCLUDED.role_code,
    organization_id = EXCLUDED.organization_id,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    is_active = EXCLUDED.is_active,
    is_verified = EXCLUDED.is_verified,
    email_verified_at = EXCLUDED.email_verified_at,
    updated_at = NOW();

  -- Return result
  SELECT json_build_object(
    'success', TRUE,
    'user_id', p_user_id,
    'email', p_email
  ) INTO v_result;

  RETURN v_result;
END;
$$;


--
-- TOC entry 5664 (class 0 OID 0)
-- Dependencies: 636
-- Name: FUNCTION sync_user_profile(p_user_id uuid, p_email text, p_role_code text, p_organization_id uuid, p_full_name text, p_phone text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sync_user_profile(p_user_id uuid, p_email text, p_role_code text, p_organization_id uuid, p_full_name text, p_phone text) IS 'Syncs or creates public.users record after auth.users is created. 
Call this from app immediately after creating auth user.
Example: SELECT sync_user_profile(user_id, email, role_code, org_id, name, phone)';


--
-- TOC entry 489 (class 1255 OID 35324)
-- Name: trigger_document_notification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_document_notification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_event_code TEXT;
  v_order RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Map document type and status to event code
    v_event_code := CASE
      WHEN NEW.doc_type = 'PO' AND NEW.status = 'pending' THEN 'po_created'
      WHEN NEW.doc_type = 'PO' AND NEW.status = 'acknowledged' THEN 'po_acknowledged'
      WHEN NEW.doc_type = 'INVOICE' AND NEW.status = 'pending' THEN 'invoice_created'
      WHEN NEW.doc_type = 'INVOICE' AND NEW.status = 'acknowledged' THEN 'invoice_acknowledged'
      WHEN NEW.doc_type = 'PAYMENT' AND NEW.status = 'acknowledged' THEN 'payment_received'
      WHEN NEW.doc_type = 'RECEIPT' THEN 'receipt_issued'
      ELSE NULL
    END;

    IF v_event_code IS NOT NULL THEN
      -- Get order details
      SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;

      -- Queue notification
      PERFORM public.queue_notification(
        NEW.company_id,
        v_event_code,
        channel,
        NULL,
        NULL,
        NULL,
        jsonb_build_object(
          'doc_type', NEW.doc_type,
          'doc_no', NEW.doc_no,
          'order_no', v_order.order_no,
          'issued_by', (SELECT org_name FROM organizations WHERE id = NEW.issued_by_org_id),
          'issued_to', (SELECT org_name FROM organizations WHERE id = NEW.issued_to_org_id)
        ),
        'normal',
        NULL
      )
      FROM unnest(ARRAY['whatsapp', 'email']) AS channel;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- TOC entry 5665 (class 0 OID 0)
-- Dependencies: 489
-- Name: FUNCTION trigger_document_notification(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.trigger_document_notification() IS 'Automatically queues notifications for document workflow events';


--
-- TOC entry 474 (class 1255 OID 35322)
-- Name: trigger_order_notification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_order_notification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_event_code TEXT;
  v_company_id UUID;
  v_buyer_org_id UUID;
  v_seller_org_id UUID;
BEGIN
  -- Determine event code based on status change
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'submitted' AND OLD.status = 'draft' THEN
      v_event_code := 'order_submitted';
    ELSIF NEW.status = 'approved' AND OLD.status = 'submitted' THEN
      v_event_code := 'order_approved';
    ELSIF NEW.status = 'closed' AND OLD.status = 'approved' THEN
      v_event_code := 'order_closed';
    ELSE
      RETURN NEW; -- No notification needed
    END IF;

    v_company_id := NEW.company_id;
    v_buyer_org_id := NEW.buyer_org_id;
    v_seller_org_id := NEW.seller_org_id;

    -- Queue notifications for enabled channels
    PERFORM public.queue_notification(
      v_company_id,
      v_event_code,
      channel,
      NULL, -- Phone will be looked up from user
      NULL, -- Email will be looked up from user  
      NULL, -- Use default template
      jsonb_build_object(
        'order_no', NEW.order_no,
        'order_type', NEW.order_type,
        'buyer_org', (SELECT org_name FROM organizations WHERE id = v_buyer_org_id),
        'seller_org', (SELECT org_name FROM organizations WHERE id = v_seller_org_id),
        'status', NEW.status
      ),
      'normal',
      NULL
    )
    FROM unnest(ARRAY['whatsapp', 'sms', 'email']) AS channel;
  END IF;

  RETURN NEW;
END;
$$;


--
-- TOC entry 5666 (class 0 OID 0)
-- Dependencies: 474
-- Name: FUNCTION trigger_order_notification(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.trigger_order_notification() IS 'Automatically queues notifications when order status changes';


--
-- TOC entry 609 (class 1255 OID 24896)
-- Name: update_last_login(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_last_login(user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE users
  SET 
    last_login_at = NOW(),
    updated_at = NOW()
  WHERE id = user_id;
END;
$$;


--
-- TOC entry 517 (class 1255 OID 35534)
-- Name: update_stock_transfers_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_stock_transfers_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- TOC entry 630 (class 1255 OID 17791)
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


--
-- TOC entry 598 (class 1255 OID 22949)
-- Name: validate_child_items(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_child_items(p_order_id uuid, p_parent_order_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE v_cnt int;
BEGIN
  SELECT COUNT(*) INTO v_cnt
  FROM public.order_items c
  WHERE c.order_id = p_order_id
    AND NOT EXISTS (
      SELECT 1 FROM public.order_items p
      WHERE p.order_id = p_parent_order_id
        AND p.variant_id = c.variant_id
    );

  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'Child order has % variants not present in parent', v_cnt;
  END IF;
  RETURN true;
END;
$$;


--
-- TOC entry 700 (class 1255 OID 22951)
-- Name: validate_child_quantities(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_child_quantities(p_order_id uuid, p_parent_order_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE r RECORD; v_remaining int;
BEGIN
  FOR r IN
    SELECT variant_id, qty FROM public.order_items WHERE order_id = p_order_id
  LOOP
    v_remaining := public.get_remaining_quantity(p_parent_order_id, r.variant_id);
    IF r.qty > v_remaining THEN
      RAISE EXCEPTION 'Variant % qty (%) exceeds remaining (%) of parent %',
        r.variant_id, r.qty, v_remaining, p_parent_order_id;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;


--
-- TOC entry 792 (class 1255 OID 20548)
-- Name: validate_default_variant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_default_variant() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- If marking this variant as default, ensure no other default exists for the product
  IF NEW.is_default = true THEN
    IF EXISTS (
      SELECT 1
      FROM public.product_variants v
      WHERE v.product_id = NEW.product_id
        AND v.id <> NEW.id
        AND v.is_default = true
    ) THEN
      RAISE EXCEPTION 'Product % already has a default variant', NEW.product_id;
    END IF;
  END IF;

  -- If this will be the only variant for the product, force it to default
  IF NOT EXISTS (
    SELECT 1
    FROM public.product_variants v
    WHERE v.product_id = NEW.product_id
      AND v.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN
    NEW.is_default := true;
  END IF;

  RETURN NEW;
END;
$$;


--
-- TOC entry 483 (class 1255 OID 18487)
-- Name: validate_distributor_products(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_distributor_products() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.ensure_distributor_org(NEW.distributor_id);
    RETURN NEW;
END;
$$;


--
-- TOC entry 676 (class 1255 OID 23260)
-- Name: validate_org_hierarchy(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_org_hierarchy() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_parent_type TEXT;
  v_has_children INTEGER;
BEGIN
  -- HQ organizations cannot have a parent
  IF NEW.org_type_code = 'HQ' AND NEW.parent_org_id IS NOT NULL THEN
    RAISE EXCEPTION 'Headquarters organizations cannot have a parent organization';
  END IF;

  -- If parent_org_id is set, validate based on org type
  IF NEW.parent_org_id IS NOT NULL THEN
    -- Get parent organization type
    SELECT org_type_code INTO v_parent_type
    FROM public.organizations
    WHERE id = NEW.parent_org_id;

    IF v_parent_type IS NULL THEN
      RAISE EXCEPTION 'Parent organization not found';
    END IF;

    -- Validate based on organization type
    CASE NEW.org_type_code
      WHEN 'MFG' THEN  -- Manufacturer
        -- Can have HQ as parent or be independent (NULL is allowed)
        IF v_parent_type != 'HQ' THEN
          RAISE EXCEPTION 'Manufacturer must report to HQ or be independent';
        END IF;

      WHEN 'DIST' THEN  -- Distributor
        -- Must have HQ as parent
        IF v_parent_type != 'HQ' THEN
          RAISE EXCEPTION 'Distributor must report to HQ';
        END IF;

      WHEN 'WH' THEN  -- Warehouse
        -- Can report to HQ or Distributor
        IF v_parent_type NOT IN ('HQ', 'DIST') THEN
          RAISE EXCEPTION 'Warehouse must report to HQ or Distributor';
        END IF;

      WHEN 'SHOP' THEN  -- Shop
        -- Must report to Distributor
        IF v_parent_type != 'DIST' THEN
          RAISE EXCEPTION 'Shop must report to Distributor';
        END IF;

      ELSE
        -- Unknown org type
        RAISE EXCEPTION 'Unknown organization type: %', NEW.org_type_code;
    END CASE;
  ELSE
    -- parent_org_id is NULL - validate which types can be independent
    IF NEW.org_type_code IN ('DIST', 'SHOP') THEN
      RAISE EXCEPTION '% must have a parent organization', 
        CASE NEW.org_type_code
          WHEN 'DIST' THEN 'Distributor'
          WHEN 'SHOP' THEN 'Shop'
        END;
    END IF;
  END IF;

  -- If changing org type, validate against existing children
  IF TG_OP = 'UPDATE' AND OLD.org_type_code != NEW.org_type_code THEN
    SELECT COUNT(*) INTO v_has_children
    FROM public.organizations
    WHERE parent_org_id = NEW.id AND is_active = true;

    -- If changing to SHOP, cannot have children
    IF NEW.org_type_code = 'SHOP' AND v_has_children > 0 THEN
      RAISE EXCEPTION 'Cannot change to Shop - organization has % child organizations', v_has_children;
    END IF;

    -- If changing to DIST, children must be WH or SHOP
    IF NEW.org_type_code = 'DIST' THEN
      IF EXISTS (
        SELECT 1 FROM public.organizations
        WHERE parent_org_id = NEW.id
        AND org_type_code NOT IN ('WH', 'SHOP')
        AND is_active = true
      ) THEN
        RAISE EXCEPTION 'Cannot change to Distributor - has incompatible child organizations';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- TOC entry 5667 (class 0 OID 0)
-- Dependencies: 676
-- Name: FUNCTION validate_org_hierarchy(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.validate_org_hierarchy() IS 'Enforces organization hierarchy rules:
- HQ: No parent (root level)
- Manufacturer: Optional HQ parent or independent
- Distributor: Required HQ parent
- Warehouse: Required HQ or Distributor parent
- Shop: Required Distributor parent';


--
-- TOC entry 462 (class 1255 OID 18489)
-- Name: validate_shop_distributors(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_shop_distributors() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.ensure_shop_org(NEW.shop_id);
    PERFORM public.ensure_distributor_org(NEW.distributor_id);
    RETURN NEW;
END;
$$;


--
-- TOC entry 742 (class 1255 OID 17327)
-- Name: add_prefixes(text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.add_prefixes(_bucket_id text, _name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    prefixes text[];
BEGIN
    prefixes := "storage"."get_prefixes"("_name");

    IF array_length(prefixes, 1) > 0 THEN
        INSERT INTO storage.prefixes (name, bucket_id)
        SELECT UNNEST(prefixes) as name, "_bucket_id" ON CONFLICT DO NOTHING;
    END IF;
END;
$$;


--
-- TOC entry 566 (class 1255 OID 17250)
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


--
-- TOC entry 529 (class 1255 OID 17413)
-- Name: delete_leaf_prefixes(text[], text[]); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.delete_leaf_prefixes(bucket_ids text[], names text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_rows_deleted integer;
BEGIN
    LOOP
        WITH candidates AS (
            SELECT DISTINCT
                t.bucket_id,
                unnest(storage.get_prefixes(t.name)) AS name
            FROM unnest(bucket_ids, names) AS t(bucket_id, name)
        ),
        uniq AS (
             SELECT
                 bucket_id,
                 name,
                 storage.get_level(name) AS level
             FROM candidates
             WHERE name <> ''
             GROUP BY bucket_id, name
        ),
        leaf AS (
             SELECT
                 p.bucket_id,
                 p.name,
                 p.level
             FROM storage.prefixes AS p
                  JOIN uniq AS u
                       ON u.bucket_id = p.bucket_id
                           AND u.name = p.name
                           AND u.level = p.level
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM storage.objects AS o
                 WHERE o.bucket_id = p.bucket_id
                   AND o.level = p.level + 1
                   AND o.name COLLATE "C" LIKE p.name || '/%'
             )
             AND NOT EXISTS (
                 SELECT 1
                 FROM storage.prefixes AS c
                 WHERE c.bucket_id = p.bucket_id
                   AND c.level = p.level + 1
                   AND c.name COLLATE "C" LIKE p.name || '/%'
             )
        )
        DELETE
        FROM storage.prefixes AS p
            USING leaf AS l
        WHERE p.bucket_id = l.bucket_id
          AND p.name = l.name
          AND p.level = l.level;

        GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
        EXIT WHEN v_rows_deleted = 0;
    END LOOP;
END;
$$;


--
-- TOC entry 593 (class 1255 OID 17328)
-- Name: delete_prefix(text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.delete_prefix(_bucket_id text, _name text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    -- Check if we can delete the prefix
    IF EXISTS(
        SELECT FROM "storage"."prefixes"
        WHERE "prefixes"."bucket_id" = "_bucket_id"
          AND level = "storage"."get_level"("_name") + 1
          AND "prefixes"."name" COLLATE "C" LIKE "_name" || '/%'
        LIMIT 1
    )
    OR EXISTS(
        SELECT FROM "storage"."objects"
        WHERE "objects"."bucket_id" = "_bucket_id"
          AND "storage"."get_level"("objects"."name") = "storage"."get_level"("_name") + 1
          AND "objects"."name" COLLATE "C" LIKE "_name" || '/%'
        LIMIT 1
    ) THEN
    -- There are sub-objects, skip deletion
    RETURN false;
    ELSE
        DELETE FROM "storage"."prefixes"
        WHERE "prefixes"."bucket_id" = "_bucket_id"
          AND level = "storage"."get_level"("_name")
          AND "prefixes"."name" = "_name";
        RETURN true;
    END IF;
END;
$$;


--
-- TOC entry 819 (class 1255 OID 17331)
-- Name: delete_prefix_hierarchy_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.delete_prefix_hierarchy_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    prefix text;
BEGIN
    prefix := "storage"."get_prefix"(OLD."name");

    IF coalesce(prefix, '') != '' THEN
        PERFORM "storage"."delete_prefix"(OLD."bucket_id", prefix);
    END IF;

    RETURN OLD;
END;
$$;


--
-- TOC entry 697 (class 1255 OID 17389)
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


--
-- TOC entry 756 (class 1255 OID 17210)
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    SELECT _parts[array_length(_parts,1)] INTO _filename;
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


--
-- TOC entry 661 (class 1255 OID 17209)
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


--
-- TOC entry 793 (class 1255 OID 17207)
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


--
-- TOC entry 513 (class 1255 OID 17309)
-- Name: get_level(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_level(name text) RETURNS integer
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
SELECT array_length(string_to_array("name", '/'), 1);
$$;


--
-- TOC entry 651 (class 1255 OID 17325)
-- Name: get_prefix(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_prefix(name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$
SELECT
    CASE WHEN strpos("name", '/') > 0 THEN
             regexp_replace("name", '[\/]{1}[^\/]+\/?$', '')
         ELSE
             ''
        END;
$_$;


--
-- TOC entry 524 (class 1255 OID 17326)
-- Name: get_prefixes(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_prefixes(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
DECLARE
    parts text[];
    prefixes text[];
    prefix text;
BEGIN
    -- Split the name into parts by '/'
    parts := string_to_array("name", '/');
    prefixes := '{}';

    -- Construct the prefixes, stopping one level below the last part
    FOR i IN 1..array_length(parts, 1) - 1 LOOP
            prefix := array_to_string(parts[1:i], '/');
            prefixes := array_append(prefixes, prefix);
    END LOOP;

    RETURN prefixes;
END;
$$;


--
-- TOC entry 508 (class 1255 OID 17387)
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint) as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


--
-- TOC entry 575 (class 1255 OID 17292)
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


--
-- TOC entry 639 (class 1255 OID 17254)
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_objects_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(name COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(name from length($1) + 1)) > 0 THEN
                        substring(name from 1 for length($1) + position($2 IN substring(name from length($1) + 1)))
                    ELSE
                        name
                END AS name, id, metadata, updated_at
            FROM
                storage.objects
            WHERE
                bucket_id = $5 AND
                name ILIKE $1 || ''%'' AND
                CASE
                    WHEN $6 != '''' THEN
                    name COLLATE "C" > $6
                ELSE true END
                AND CASE
                    WHEN $4 != '''' THEN
                        CASE
                            WHEN position($2 IN substring(name from length($1) + 1)) > 0 THEN
                                substring(name from 1 for length($1) + position($2 IN substring(name from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                name COLLATE "C" > $4
                            END
                    ELSE
                        true
                END
            ORDER BY
                name COLLATE "C" ASC) as e order by name COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_token, bucket_id, start_after;
END;
$_$;


--
-- TOC entry 679 (class 1255 OID 17411)
-- Name: lock_top_prefixes(text[], text[]); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.lock_top_prefixes(bucket_ids text[], names text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_bucket text;
    v_top text;
BEGIN
    FOR v_bucket, v_top IN
        SELECT DISTINCT t.bucket_id,
            split_part(t.name, '/', 1) AS top
        FROM unnest(bucket_ids, names) AS t(bucket_id, name)
        WHERE t.name <> ''
        ORDER BY 1, 2
        LOOP
            PERFORM pg_advisory_xact_lock(hashtextextended(v_bucket || '/' || v_top, 0));
        END LOOP;
END;
$$;


--
-- TOC entry 565 (class 1255 OID 17416)
-- Name: objects_delete_cleanup(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.objects_delete_cleanup() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_bucket_ids text[];
    v_names      text[];
BEGIN
    IF current_setting('storage.gc.prefixes', true) = '1' THEN
        RETURN NULL;
    END IF;

    PERFORM set_config('storage.gc.prefixes', '1', true);

    SELECT COALESCE(array_agg(d.bucket_id), '{}'),
           COALESCE(array_agg(d.name), '{}')
    INTO v_bucket_ids, v_names
    FROM deleted AS d
    WHERE d.name <> '';

    PERFORM storage.lock_top_prefixes(v_bucket_ids, v_names);
    PERFORM storage.delete_leaf_prefixes(v_bucket_ids, v_names);

    RETURN NULL;
END;
$$;


--
-- TOC entry 693 (class 1255 OID 17330)
-- Name: objects_insert_prefix_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.objects_insert_prefix_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    NEW.level := "storage"."get_level"(NEW."name");

    RETURN NEW;
END;
$$;


--
-- TOC entry 814 (class 1255 OID 17418)
-- Name: objects_update_cleanup(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.objects_update_cleanup() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    -- NEW - OLD (destinations to create prefixes for)
    v_add_bucket_ids text[];
    v_add_names      text[];

    -- OLD - NEW (sources to prune)
    v_src_bucket_ids text[];
    v_src_names      text[];
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NULL;
    END IF;

    -- 1) Compute NEW−OLD (added paths) and OLD−NEW (moved-away paths)
    WITH added AS (
        SELECT n.bucket_id, n.name
        FROM new_rows n
        WHERE n.name <> '' AND position('/' in n.name) > 0
        EXCEPT
        SELECT o.bucket_id, o.name FROM old_rows o WHERE o.name <> ''
    ),
    moved AS (
         SELECT o.bucket_id, o.name
         FROM old_rows o
         WHERE o.name <> ''
         EXCEPT
         SELECT n.bucket_id, n.name FROM new_rows n WHERE n.name <> ''
    )
    SELECT
        -- arrays for ADDED (dest) in stable order
        COALESCE( (SELECT array_agg(a.bucket_id ORDER BY a.bucket_id, a.name) FROM added a), '{}' ),
        COALESCE( (SELECT array_agg(a.name      ORDER BY a.bucket_id, a.name) FROM added a), '{}' ),
        -- arrays for MOVED (src) in stable order
        COALESCE( (SELECT array_agg(m.bucket_id ORDER BY m.bucket_id, m.name) FROM moved m), '{}' ),
        COALESCE( (SELECT array_agg(m.name      ORDER BY m.bucket_id, m.name) FROM moved m), '{}' )
    INTO v_add_bucket_ids, v_add_names, v_src_bucket_ids, v_src_names;

    -- Nothing to do?
    IF (array_length(v_add_bucket_ids, 1) IS NULL) AND (array_length(v_src_bucket_ids, 1) IS NULL) THEN
        RETURN NULL;
    END IF;

    -- 2) Take per-(bucket, top) locks: ALL prefixes in consistent global order to prevent deadlocks
    DECLARE
        v_all_bucket_ids text[];
        v_all_names text[];
    BEGIN
        -- Combine source and destination arrays for consistent lock ordering
        v_all_bucket_ids := COALESCE(v_src_bucket_ids, '{}') || COALESCE(v_add_bucket_ids, '{}');
        v_all_names := COALESCE(v_src_names, '{}') || COALESCE(v_add_names, '{}');

        -- Single lock call ensures consistent global ordering across all transactions
        IF array_length(v_all_bucket_ids, 1) IS NOT NULL THEN
            PERFORM storage.lock_top_prefixes(v_all_bucket_ids, v_all_names);
        END IF;
    END;

    -- 3) Create destination prefixes (NEW−OLD) BEFORE pruning sources
    IF array_length(v_add_bucket_ids, 1) IS NOT NULL THEN
        WITH candidates AS (
            SELECT DISTINCT t.bucket_id, unnest(storage.get_prefixes(t.name)) AS name
            FROM unnest(v_add_bucket_ids, v_add_names) AS t(bucket_id, name)
            WHERE name <> ''
        )
        INSERT INTO storage.prefixes (bucket_id, name)
        SELECT c.bucket_id, c.name
        FROM candidates c
        ON CONFLICT DO NOTHING;
    END IF;

    -- 4) Prune source prefixes bottom-up for OLD−NEW
    IF array_length(v_src_bucket_ids, 1) IS NOT NULL THEN
        -- re-entrancy guard so DELETE on prefixes won't recurse
        IF current_setting('storage.gc.prefixes', true) <> '1' THEN
            PERFORM set_config('storage.gc.prefixes', '1', true);
        END IF;

        PERFORM storage.delete_leaf_prefixes(v_src_bucket_ids, v_src_names);
    END IF;

    RETURN NULL;
END;
$$;


--
-- TOC entry 548 (class 1255 OID 17424)
-- Name: objects_update_level_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.objects_update_level_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Ensure this is an update operation and the name has changed
    IF TG_OP = 'UPDATE' AND (NEW."name" <> OLD."name" OR NEW."bucket_id" <> OLD."bucket_id") THEN
        -- Set the new level
        NEW."level" := "storage"."get_level"(NEW."name");
    END IF;
    RETURN NEW;
END;
$$;


--
-- TOC entry 463 (class 1255 OID 17388)
-- Name: objects_update_prefix_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.objects_update_prefix_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    old_prefixes TEXT[];
BEGIN
    -- Ensure this is an update operation and the name has changed
    IF TG_OP = 'UPDATE' AND (NEW."name" <> OLD."name" OR NEW."bucket_id" <> OLD."bucket_id") THEN
        -- Retrieve old prefixes
        old_prefixes := "storage"."get_prefixes"(OLD."name");

        -- Remove old prefixes that are only used by this object
        WITH all_prefixes as (
            SELECT unnest(old_prefixes) as prefix
        ),
        can_delete_prefixes as (
             SELECT prefix
             FROM all_prefixes
             WHERE NOT EXISTS (
                 SELECT 1 FROM "storage"."objects"
                 WHERE "bucket_id" = OLD."bucket_id"
                   AND "name" <> OLD."name"
                   AND "name" LIKE (prefix || '%')
             )
         )
        DELETE FROM "storage"."prefixes" WHERE name IN (SELECT prefix FROM can_delete_prefixes);

        -- Add new prefixes
        PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    END IF;
    -- Set the new level
    NEW."level" := "storage"."get_level"(NEW."name");

    RETURN NEW;
END;
$$;


--
-- TOC entry 615 (class 1255 OID 17308)
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


--
-- TOC entry 680 (class 1255 OID 17419)
-- Name: prefixes_delete_cleanup(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.prefixes_delete_cleanup() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_bucket_ids text[];
    v_names      text[];
BEGIN
    IF current_setting('storage.gc.prefixes', true) = '1' THEN
        RETURN NULL;
    END IF;

    PERFORM set_config('storage.gc.prefixes', '1', true);

    SELECT COALESCE(array_agg(d.bucket_id), '{}'),
           COALESCE(array_agg(d.name), '{}')
    INTO v_bucket_ids, v_names
    FROM deleted AS d
    WHERE d.name <> '';

    PERFORM storage.lock_top_prefixes(v_bucket_ids, v_names);
    PERFORM storage.delete_leaf_prefixes(v_bucket_ids, v_names);

    RETURN NULL;
END;
$$;


--
-- TOC entry 835 (class 1255 OID 17329)
-- Name: prefixes_insert_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.prefixes_insert_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    RETURN NEW;
END;
$$;


--
-- TOC entry 701 (class 1255 OID 17228)
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql
    AS $$
declare
    can_bypass_rls BOOLEAN;
begin
    SELECT rolbypassrls
    INTO can_bypass_rls
    FROM pg_roles
    WHERE rolname = coalesce(nullif(current_setting('role', true), 'none'), current_user);

    IF can_bypass_rls THEN
        RETURN QUERY SELECT * FROM storage.search_v1_optimised(prefix, bucketname, limits, levels, offsets, search, sortcolumn, sortorder);
    ELSE
        RETURN QUERY SELECT * FROM storage.search_legacy_v1(prefix, bucketname, limits, levels, offsets, search, sortcolumn, sortorder);
    END IF;
end;
$$;


--
-- TOC entry 784 (class 1255 OID 17384)
-- Name: search_legacy_v1(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_legacy_v1(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
declare
    v_order_by text;
    v_sort_order text;
begin
    case
        when sortcolumn = 'name' then
            v_order_by = 'name';
        when sortcolumn = 'updated_at' then
            v_order_by = 'updated_at';
        when sortcolumn = 'created_at' then
            v_order_by = 'created_at';
        when sortcolumn = 'last_accessed_at' then
            v_order_by = 'last_accessed_at';
        else
            v_order_by = 'name';
        end case;

    case
        when sortorder = 'asc' then
            v_sort_order = 'asc';
        when sortorder = 'desc' then
            v_sort_order = 'desc';
        else
            v_sort_order = 'asc';
        end case;

    v_order_by = v_order_by || ' ' || v_sort_order;

    return query execute
        'with folders as (
           select path_tokens[$1] as folder
           from storage.objects
             where objects.name ilike $2 || $3 || ''%''
               and bucket_id = $4
               and array_length(objects.path_tokens, 1) <> $1
           group by folder
           order by folder ' || v_sort_order || '
     )
     (select folder as "name",
            null as id,
            null as updated_at,
            null as created_at,
            null as last_accessed_at,
            null as metadata from folders)
     union all
     (select path_tokens[$1] as "name",
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
     from storage.objects
     where objects.name ilike $2 || $3 || ''%''
       and bucket_id = $4
       and array_length(objects.path_tokens, 1) = $1
     order by ' || v_order_by || ')
     limit $5
     offset $6' using levels, prefix, search, bucketname, limits, offsets;
end;
$_$;


--
-- TOC entry 674 (class 1255 OID 17383)
-- Name: search_v1_optimised(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v1_optimised(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
declare
    v_order_by text;
    v_sort_order text;
begin
    case
        when sortcolumn = 'name' then
            v_order_by = 'name';
        when sortcolumn = 'updated_at' then
            v_order_by = 'updated_at';
        when sortcolumn = 'created_at' then
            v_order_by = 'created_at';
        when sortcolumn = 'last_accessed_at' then
            v_order_by = 'last_accessed_at';
        else
            v_order_by = 'name';
        end case;

    case
        when sortorder = 'asc' then
            v_sort_order = 'asc';
        when sortorder = 'desc' then
            v_sort_order = 'desc';
        else
            v_sort_order = 'asc';
        end case;

    v_order_by = v_order_by || ' ' || v_sort_order;

    return query execute
        'with folders as (
           select (string_to_array(name, ''/''))[level] as name
           from storage.prefixes
             where lower(prefixes.name) like lower($2 || $3) || ''%''
               and bucket_id = $4
               and level = $1
           order by name ' || v_sort_order || '
     )
     (select name,
            null as id,
            null as updated_at,
            null as created_at,
            null as last_accessed_at,
            null as metadata from folders)
     union all
     (select path_tokens[level] as "name",
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
     from storage.objects
     where lower(objects.name) like lower($2 || $3) || ''%''
       and bucket_id = $4
       and level = $1
     order by ' || v_order_by || ')
     limit $5
     offset $6' using levels, prefix, search, bucketname, limits, offsets;
end;
$_$;


--
-- TOC entry 540 (class 1255 OID 17410)
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    sort_col text;
    sort_ord text;
    cursor_op text;
    cursor_expr text;
    sort_expr text;
BEGIN
    -- Validate sort_order
    sort_ord := lower(sort_order);
    IF sort_ord NOT IN ('asc', 'desc') THEN
        sort_ord := 'asc';
    END IF;

    -- Determine cursor comparison operator
    IF sort_ord = 'asc' THEN
        cursor_op := '>';
    ELSE
        cursor_op := '<';
    END IF;
    
    sort_col := lower(sort_column);
    -- Validate sort column  
    IF sort_col IN ('updated_at', 'created_at') THEN
        cursor_expr := format(
            '($5 = '''' OR ROW(date_trunc(''milliseconds'', %I), name COLLATE "C") %s ROW(COALESCE(NULLIF($6, '''')::timestamptz, ''epoch''::timestamptz), $5))',
            sort_col, cursor_op
        );
        sort_expr := format(
            'COALESCE(date_trunc(''milliseconds'', %I), ''epoch''::timestamptz) %s, name COLLATE "C" %s',
            sort_col, sort_ord, sort_ord
        );
    ELSE
        cursor_expr := format('($5 = '''' OR name COLLATE "C" %s $5)', cursor_op);
        sort_expr := format('name COLLATE "C" %s', sort_ord);
    END IF;

    RETURN QUERY EXECUTE format(
        $sql$
        SELECT * FROM (
            (
                SELECT
                    split_part(name, '/', $4) AS key,
                    name,
                    NULL::uuid AS id,
                    updated_at,
                    created_at,
                    NULL::timestamptz AS last_accessed_at,
                    NULL::jsonb AS metadata
                FROM storage.prefixes
                WHERE name COLLATE "C" LIKE $1 || '%%'
                    AND bucket_id = $2
                    AND level = $4
                    AND %s
                ORDER BY %s
                LIMIT $3
            )
            UNION ALL
            (
                SELECT
                    split_part(name, '/', $4) AS key,
                    name,
                    id,
                    updated_at,
                    created_at,
                    last_accessed_at,
                    metadata
                FROM storage.objects
                WHERE name COLLATE "C" LIKE $1 || '%%'
                    AND bucket_id = $2
                    AND level = $4
                    AND %s
                ORDER BY %s
                LIMIT $3
            )
        ) obj
        ORDER BY %s
        LIMIT $3
        $sql$,
        cursor_expr,    -- prefixes WHERE
        sort_expr,      -- prefixes ORDER BY
        cursor_expr,    -- objects WHERE
        sort_expr,      -- objects ORDER BY
        sort_expr       -- final ORDER BY
    )
    USING prefix, bucket_name, limits, levels, start_after, sort_column_after;
END;
$_$;


--
-- TOC entry 485 (class 1255 OID 17230)
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


--
-- TOC entry 389 (class 1259 OID 17768)
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    user_email text,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    old_values jsonb,
    new_values jsonb,
    changed_fields text[],
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT audit_action_valid CHECK ((action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- TOC entry 5668 (class 0 OID 0)
-- Dependencies: 389
-- Name: TABLE audit_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_logs IS 'Audit trail for all data changes';


--
-- TOC entry 396 (class 1259 OID 18005)
-- Name: brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brands (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    brand_code text NOT NULL,
    brand_name text NOT NULL,
    brand_name_search text GENERATED ALWAYS AS (lower(brand_name)) STORED,
    brand_description text,
    logo_url text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid
);


--
-- TOC entry 5669 (class 0 OID 0)
-- Dependencies: 396
-- Name: TABLE brands; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.brands IS 'Product brands';


--
-- TOC entry 435 (class 1259 OID 26816)
-- Name: consumer_activations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumer_activations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    qr_code_id uuid NOT NULL,
    consumer_phone text NOT NULL,
    consumer_email text,
    consumer_name text,
    activated_at timestamp with time zone DEFAULT now(),
    activation_location text,
    activation_device_info jsonb,
    points_awarded integer DEFAULT 0,
    lucky_draw_entry_id uuid,
    is_verified boolean DEFAULT true,
    verification_notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 5670 (class 0 OID 0)
-- Dependencies: 435
-- Name: TABLE consumer_activations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.consumer_activations IS 'Consumer QR code scans and point/lucky draw activations';


--
-- TOC entry 407 (class 1259 OID 18411)
-- Name: distributor_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.distributor_products (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    distributor_id uuid NOT NULL,
    product_id uuid NOT NULL,
    agreement_number text,
    agreement_start_date date,
    agreement_end_date date,
    distributor_cost numeric(12,2),
    min_order_quantity integer DEFAULT 1,
    max_order_quantity integer,
    lead_time_days integer DEFAULT 7,
    territory_coverage text[],
    is_active boolean DEFAULT true,
    is_exclusive boolean DEFAULT false,
    can_backorder boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT valid_agreement_dates CHECK (((agreement_end_date IS NULL) OR (agreement_end_date >= agreement_start_date)))
);


--
-- TOC entry 5671 (class 0 OID 0)
-- Dependencies: 407
-- Name: TABLE distributor_products; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.distributor_products IS 'Which distributors carry which products';


--
-- TOC entry 392 (class 1259 OID 17883)
-- Name: districts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.districts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    state_id uuid NOT NULL,
    district_code text NOT NULL,
    district_name text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 5672 (class 0 OID 0)
-- Dependencies: 392
-- Name: TABLE districts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.districts IS 'Districts/Daerah';


--
-- TOC entry 418 (class 1259 OID 22256)
-- Name: doc_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doc_counters (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    scope_code text NOT NULL,
    yymm text NOT NULL,
    next_seq integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT valid_seq_2digit CHECK (((next_seq > 0) AND (next_seq <= 99))),
    CONSTRAINT valid_yymm CHECK ((yymm ~ '^\d{4}$'::text))
);


--
-- TOC entry 5673 (class 0 OID 0)
-- Dependencies: 418
-- Name: TABLE doc_counters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.doc_counters IS 'Transaction-safe counters for document numbering (resets monthly, supports 2-digit 00-99 per month).';


--
-- TOC entry 422 (class 1259 OID 22837)
-- Name: document_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_files (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    document_id uuid NOT NULL,
    file_url text NOT NULL,
    file_name text,
    file_size integer,
    mime_type text,
    company_id uuid NOT NULL,
    uploaded_by uuid NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now(),
    CONSTRAINT valid_file_size CHECK (((file_size IS NULL) OR (file_size > 0)))
);


--
-- TOC entry 5674 (class 0 OID 0)
-- Dependencies: 422
-- Name: TABLE document_files; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_files IS 'File attachments for workflow documents (e.g., payment proof, invoice PDFs).';


--
-- TOC entry 438 (class 1259 OID 29940)
-- Name: journey_configurations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journey_configurations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    points_enabled boolean,
    lucky_draw_enabled boolean,
    redemption_enabled boolean,
    require_staff_otp_for_points boolean,
    require_customer_otp_for_lucky_draw boolean,
    require_customer_otp_for_redemption boolean,
    start_at timestamp with time zone,
    end_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- TOC entry 439 (class 1259 OID 29963)
-- Name: journey_order_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journey_order_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    journey_config_id uuid NOT NULL,
    order_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 433 (class 1259 OID 26748)
-- Name: lucky_draw_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lucky_draw_campaigns (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    campaign_code text NOT NULL,
    campaign_name text NOT NULL,
    campaign_description text,
    campaign_image_url text,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone NOT NULL,
    draw_date timestamp with time zone,
    max_entries_per_consumer integer,
    requires_purchase boolean DEFAULT true,
    prizes jsonb,
    status text DEFAULT 'draft'::text,
    winners jsonb,
    drawn_at timestamp with time zone,
    drawn_by uuid,
    terms_and_conditions text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT lucky_draw_campaigns_dates_valid CHECK ((end_date > start_date)),
    CONSTRAINT lucky_draw_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'closed'::text, 'drawn'::text, 'completed'::text])))
);


--
-- TOC entry 5675 (class 0 OID 0)
-- Dependencies: 433
-- Name: TABLE lucky_draw_campaigns; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.lucky_draw_campaigns IS 'Lucky draw campaigns linked to QR codes';


--
-- TOC entry 434 (class 1259 OID 26782)
-- Name: lucky_draw_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lucky_draw_entries (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    campaign_id uuid NOT NULL,
    company_id uuid NOT NULL,
    consumer_phone text NOT NULL,
    consumer_email text,
    consumer_name text,
    qr_code_id uuid,
    entry_number text NOT NULL,
    entry_date timestamp with time zone DEFAULT now(),
    is_winner boolean DEFAULT false,
    prize_won jsonb,
    prize_claimed boolean DEFAULT false,
    prize_claimed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 5676 (class 0 OID 0)
-- Dependencies: 434
-- Name: TABLE lucky_draw_entries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.lucky_draw_entries IS 'Consumer entries in lucky draw campaigns';


--
-- TOC entry 441 (class 1259 OID 30138)
-- Name: lucky_draw_order_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lucky_draw_order_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    order_id uuid NOT NULL,
    journey_config_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 445 (class 1259 OID 30356)
-- Name: message_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    code text NOT NULL,
    channel text NOT NULL,
    body text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 394 (class 1259 OID 17915)
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_type_code text NOT NULL,
    parent_org_id uuid,
    org_code text NOT NULL,
    org_name text NOT NULL,
    org_name_search text GENERATED ALWAYS AS (lower(org_name)) STORED,
    registration_no text,
    tax_id text,
    website text,
    address text,
    address_line2 text,
    city text,
    state_id uuid,
    district_id uuid,
    postal_code text,
    country_code text DEFAULT 'MY'::text,
    latitude numeric(9,6),
    longitude numeric(9,6),
    settings jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_by uuid,
    contact_name text,
    contact_title text,
    contact_phone text,
    contact_email text,
    logo_url text,
    CONSTRAINT no_self_parent CHECK ((id IS DISTINCT FROM parent_org_id)),
    CONSTRAINT org_code_format CHECK ((org_code ~ '^[A-Z0-9\-]{3,20}$'::text))
);


--
-- TOC entry 5677 (class 0 OID 0)
-- Dependencies: 394
-- Name: TABLE organizations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.organizations IS 'All organizations in supply chain (HQ, Manufacturers, Distributors, Warehouses, Shops)';


--
-- TOC entry 5678 (class 0 OID 0)
-- Dependencies: 394
-- Name: COLUMN organizations.contact_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.contact_name IS 'Primary contact person full name';


--
-- TOC entry 5679 (class 0 OID 0)
-- Dependencies: 394
-- Name: COLUMN organizations.contact_title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.contact_title IS 'Contact person job title/position';


--
-- TOC entry 5680 (class 0 OID 0)
-- Dependencies: 394
-- Name: COLUMN organizations.contact_phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.contact_phone IS 'Contact person direct phone number';


--
-- TOC entry 5681 (class 0 OID 0)
-- Dependencies: 394
-- Name: COLUMN organizations.contact_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.contact_email IS 'Contact person direct email address';


--
-- TOC entry 5682 (class 0 OID 0)
-- Dependencies: 394
-- Name: COLUMN organizations.logo_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.logo_url IS 'URL to organization logo/avatar image stored in Supabase Storage';


--
-- TOC entry 395 (class 1259 OID 17974)
-- Name: product_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_categories (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    parent_category_id uuid,
    category_code text NOT NULL,
    category_name text NOT NULL,
    category_name_search text GENERATED ALWAYS AS (lower(category_name)) STORED,
    category_description text,
    is_vape boolean DEFAULT false,
    image_url text,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT no_self_parent_cat CHECK ((id IS DISTINCT FROM parent_category_id))
);


--
-- TOC entry 5683 (class 0 OID 0)
-- Dependencies: 395
-- Name: TABLE product_categories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_categories IS 'Product categories (Vape, Non-Vape, etc.)';


--
-- TOC entry 404 (class 1259 OID 18309)
-- Name: product_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_inventory (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    variant_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    quantity_on_hand integer DEFAULT 0,
    quantity_allocated integer DEFAULT 0,
    quantity_available integer GENERATED ALWAYS AS ((quantity_on_hand - quantity_allocated)) STORED,
    cases_on_hand integer DEFAULT 0,
    units_on_hand integer DEFAULT 0,
    reorder_point integer DEFAULT 10,
    reorder_quantity integer DEFAULT 50,
    max_stock_level integer,
    warehouse_location text,
    average_cost numeric(12,2),
    total_value numeric(15,2) GENERATED ALWAYS AS (((quantity_on_hand)::numeric * COALESCE(average_cost, (0)::numeric))) STORED,
    is_active boolean DEFAULT true,
    last_counted_at timestamp with time zone,
    last_counted_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT valid_quantities CHECK (((quantity_on_hand >= 0) AND (quantity_allocated >= 0) AND (quantity_allocated <= quantity_on_hand)))
);


--
-- TOC entry 5684 (class 0 OID 0)
-- Dependencies: 404
-- Name: TABLE product_inventory; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_inventory IS 'Inventory tracking per organization';


--
-- TOC entry 401 (class 1259 OID 18206)
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    product_id uuid NOT NULL,
    variant_code text NOT NULL,
    variant_name text NOT NULL,
    variant_name_search text GENERATED ALWAYS AS (lower(variant_name)) STORED,
    attributes jsonb DEFAULT '{}'::jsonb,
    barcode text,
    manufacturer_sku text,
    base_cost numeric(12,2),
    suggested_retail_price numeric(12,2),
    is_active boolean DEFAULT true,
    is_default boolean DEFAULT false,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    image_url text
);


--
-- TOC entry 5685 (class 0 OID 0)
-- Dependencies: 401
-- Name: TABLE product_variants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_variants IS 'Product variations - flavors, sizes, nicotine strengths, etc.';


--
-- TOC entry 5686 (class 0 OID 0)
-- Dependencies: 401
-- Name: COLUMN product_variants.image_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_variants.image_url IS 'URL to variant image stored in avatars bucket with cache-busting timestamp';


--
-- TOC entry 400 (class 1259 OID 18140)
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    manufacturer_id uuid,
    category_id uuid NOT NULL,
    brand_id uuid,
    group_id uuid,
    subgroup_id uuid,
    product_code text NOT NULL,
    product_name text NOT NULL,
    product_name_search text GENERATED ALWAYS AS (lower(product_name)) STORED,
    product_description text,
    short_description text,
    is_vape boolean DEFAULT false,
    requires_tracking boolean DEFAULT true,
    is_serialized boolean DEFAULT false,
    regulatory_info jsonb DEFAULT '{}'::jsonb,
    health_warning text,
    age_restriction integer DEFAULT 18,
    base_unit_type text DEFAULT 'PIECE'::text,
    units_per_case integer DEFAULT 1,
    case_dimensions jsonb,
    is_active boolean DEFAULT true,
    is_discontinued boolean DEFAULT false,
    discontinued_at timestamp with time zone,
    launch_date date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_by uuid,
    CONSTRAINT product_code_format CHECK ((product_code ~ '^[A-Z0-9\-]{3,20}$'::text)),
    CONSTRAINT valid_units_per_case CHECK ((units_per_case > 0))
);


--
-- TOC entry 5687 (class 0 OID 0)
-- Dependencies: 400
-- Name: TABLE products; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.products IS 'Products owned by company';


--
-- TOC entry 5688 (class 0 OID 0)
-- Dependencies: 400
-- Name: COLUMN products.manufacturer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.manufacturer_id IS 'Contract manufacturer (optional)';


--
-- TOC entry 5689 (class 0 OID 0)
-- Dependencies: 400
-- Name: COLUMN products.is_serialized; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.is_serialized IS 'TRUE = track individual units, FALSE = track cases/batches';


--
-- TOC entry 408 (class 1259 OID 18448)
-- Name: shop_distributors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_distributors (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    shop_id uuid NOT NULL,
    distributor_id uuid NOT NULL,
    account_number text,
    credit_limit numeric(12,2),
    payment_terms text DEFAULT 'NET_30'::text,
    preferred_delivery_day text,
    delivery_notes text,
    is_active boolean DEFAULT true,
    is_preferred boolean DEFAULT false,
    total_orders integer DEFAULT 0,
    total_value numeric(15,2) DEFAULT 0,
    last_order_date date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    approved_by uuid,
    approved_at timestamp with time zone,
    CONSTRAINT valid_payment_terms CHECK ((payment_terms = ANY (ARRAY['COD'::text, 'NET_7'::text, 'NET_15'::text, 'NET_30'::text, 'NET_60'::text, 'NET_90'::text])))
);


--
-- TOC entry 5690 (class 0 OID 0)
-- Dependencies: 408
-- Name: TABLE shop_distributors; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.shop_distributors IS 'Shop-Distributor relationships';


--
-- TOC entry 413 (class 1259 OID 20609)
-- Name: mv_shop_available_products; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_shop_available_products AS
 SELECT DISTINCT sd.shop_id,
    s.org_name AS shop_name,
    s.state_id AS shop_state_id,
    s.district_id AS shop_district_id,
    sd.distributor_id,
    d.org_name AS distributor_name,
    p.id AS product_id,
    p.product_code,
    p.product_name,
    p.is_vape,
    b.brand_name,
    c.category_name,
    pv.id AS default_variant_id,
    pv.variant_name AS default_variant_name,
    dp.distributor_cost,
    dp.min_order_quantity,
    dp.max_order_quantity,
    dp.lead_time_days,
    sd.payment_terms,
    sd.credit_limit,
    sd.is_preferred,
    pi.quantity_available AS distributor_stock,
    (pi.quantity_available > 0) AS in_stock,
    dp.is_active AS distributor_carries_product,
    sd.is_active AS shop_distributor_active,
    p.is_active AS product_active,
    (dp.is_active AND sd.is_active AND p.is_active) AS is_available
   FROM ((((((((public.shop_distributors sd
     JOIN public.organizations s ON (((s.id = sd.shop_id) AND (s.org_type_code = 'SHOP'::text))))
     JOIN public.organizations d ON (((d.id = sd.distributor_id) AND (d.org_type_code = 'DIST'::text))))
     JOIN public.distributor_products dp ON (((dp.distributor_id = sd.distributor_id) AND (dp.is_active = true))))
     JOIN public.products p ON (((p.id = dp.product_id) AND (p.is_active = true))))
     LEFT JOIN public.brands b ON ((b.id = p.brand_id)))
     LEFT JOIN public.product_categories c ON ((c.id = p.category_id)))
     LEFT JOIN public.product_variants pv ON (((pv.product_id = p.id) AND (pv.is_default = true))))
     LEFT JOIN public.product_inventory pi ON (((pi.variant_id = pv.id) AND (pi.organization_id = sd.distributor_id) AND (pi.is_active = true))))
  WHERE ((sd.is_active = true) AND ((dp.agreement_end_date IS NULL) OR (dp.agreement_end_date >= CURRENT_DATE)))
  WITH NO DATA;


--
-- TOC entry 5691 (class 0 OID 0)
-- Dependencies: 413
-- Name: MATERIALIZED VIEW mv_shop_available_products; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.mv_shop_available_products IS 'Materialized view for shop product availability; refresh via refresh_shop_products()';


--
-- TOC entry 452 (class 1259 OID 35234)
-- Name: notification_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    outbox_id uuid,
    org_id uuid NOT NULL,
    event_code text,
    channel text NOT NULL,
    provider_name text,
    recipient_type text,
    recipient_value text,
    status text NOT NULL,
    status_details text,
    provider_message_id text,
    provider_response jsonb,
    queued_at timestamp with time zone,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    failed_at timestamp with time zone,
    error_code text,
    error_message text,
    retry_count integer DEFAULT 0,
    cost_amount numeric(10,4),
    cost_currency text DEFAULT 'MYR'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 5692 (class 0 OID 0)
-- Dependencies: 452
-- Name: TABLE notification_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_logs IS 'Comprehensive delivery logs for all notifications';


--
-- TOC entry 5693 (class 0 OID 0)
-- Dependencies: 452
-- Name: COLUMN notification_logs.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_logs.status IS 'Detailed delivery status from provider webhooks';


--
-- TOC entry 450 (class 1259 OID 35175)
-- Name: notification_provider_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_provider_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    channel text NOT NULL,
    provider_name text NOT NULL,
    is_active boolean DEFAULT false,
    is_sandbox boolean DEFAULT true,
    config_encrypted text,
    config_iv text,
    config_public jsonb DEFAULT '{}'::jsonb,
    last_test_at timestamp with time zone,
    last_test_status text,
    last_test_error text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT notification_provider_configs_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text])))
);


--
-- TOC entry 5694 (class 0 OID 0)
-- Dependencies: 450
-- Name: TABLE notification_provider_configs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_provider_configs IS 'Provider API configurations with encrypted credentials';


--
-- TOC entry 5695 (class 0 OID 0)
-- Dependencies: 450
-- Name: COLUMN notification_provider_configs.is_sandbox; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_provider_configs.is_sandbox IS 'Use provider test/sandbox mode instead of production';


--
-- TOC entry 5696 (class 0 OID 0)
-- Dependencies: 450
-- Name: COLUMN notification_provider_configs.config_encrypted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_provider_configs.config_encrypted IS 'Encrypted JSON containing API keys and secrets';


--
-- TOC entry 5697 (class 0 OID 0)
-- Dependencies: 450
-- Name: COLUMN notification_provider_configs.config_public; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_provider_configs.config_public IS 'Non-sensitive config like phone numbers, sender IDs, display names';


--
-- TOC entry 451 (class 1259 OID 35201)
-- Name: notification_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    event_code text NOT NULL,
    enabled boolean DEFAULT false,
    channels_enabled text[] DEFAULT '{}'::text[],
    recipient_roles text[],
    recipient_users uuid[],
    recipient_custom text[],
    template_code text,
    priority text DEFAULT 'normal'::text,
    retry_enabled boolean DEFAULT true,
    max_retries integer DEFAULT 3,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notification_settings_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'critical'::text])))
);


--
-- TOC entry 5698 (class 0 OID 0)
-- Dependencies: 451
-- Name: TABLE notification_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_settings IS 'Per-organization settings for each notification type';


--
-- TOC entry 5699 (class 0 OID 0)
-- Dependencies: 451
-- Name: COLUMN notification_settings.channels_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_settings.channels_enabled IS 'Array of channels to use: whatsapp, sms, email';


--
-- TOC entry 5700 (class 0 OID 0)
-- Dependencies: 451
-- Name: COLUMN notification_settings.recipient_roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_settings.recipient_roles IS 'Which user roles should receive this notification';


--
-- TOC entry 449 (class 1259 OID 35160)
-- Name: notification_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    event_code text NOT NULL,
    event_name text NOT NULL,
    event_description text,
    default_enabled boolean DEFAULT false,
    available_channels text[] DEFAULT ARRAY['whatsapp'::text, 'sms'::text, 'email'::text],
    default_template_code text,
    is_system boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 5701 (class 0 OID 0)
-- Dependencies: 449
-- Name: TABLE notification_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_types IS 'Catalog of all notification event types with their default settings';


--
-- TOC entry 5702 (class 0 OID 0)
-- Dependencies: 449
-- Name: COLUMN notification_types.category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_types.category IS 'Grouping: order, document, inventory, qr, user';


--
-- TOC entry 5703 (class 0 OID 0)
-- Dependencies: 449
-- Name: COLUMN notification_types.event_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_types.event_code IS 'Unique identifier for the event (used in code)';


--
-- TOC entry 5704 (class 0 OID 0)
-- Dependencies: 449
-- Name: COLUMN notification_types.is_system; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_types.is_system IS 'Critical system events that cannot be disabled';


--
-- TOC entry 446 (class 1259 OID 30373)
-- Name: notifications_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    channel text NOT NULL,
    to_phone text,
    template_code text,
    payload_json jsonb,
    status text DEFAULT 'queued'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    event_code text,
    to_email text,
    priority text DEFAULT 'normal'::text,
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 3,
    next_retry_at timestamp with time zone,
    provider_name text,
    provider_message_id text,
    scheduled_for timestamp with time zone,
    CONSTRAINT notifications_outbox_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT notifications_outbox_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'cancelled'::text, 'scheduled'::text])))
);


--
-- TOC entry 5705 (class 0 OID 0)
-- Dependencies: 446
-- Name: COLUMN notifications_outbox.event_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications_outbox.event_code IS 'Links to notification_types.event_code';


--
-- TOC entry 5706 (class 0 OID 0)
-- Dependencies: 446
-- Name: COLUMN notifications_outbox.provider_message_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications_outbox.provider_message_id IS 'External provider message ID for tracking';


--
-- TOC entry 420 (class 1259 OID 22691)
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    qty integer NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    line_total numeric(15,2) GENERATED ALWAYS AS (((qty)::numeric * unit_price)) STORED,
    company_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT order_items_qty_check CHECK ((qty > 0)),
    CONSTRAINT order_items_unit_price_check CHECK ((unit_price >= (0)::numeric))
);


--
-- TOC entry 5707 (class 0 OID 0)
-- Dependencies: 420
-- Name: TABLE order_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.order_items IS 'Order line items (variant-level detail)';


--
-- TOC entry 444 (class 1259 OID 30340)
-- Name: org_notification_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_notification_settings (
    org_id uuid NOT NULL,
    otp_enabled boolean DEFAULT false NOT NULL,
    otp_channel text DEFAULT 'whatsapp'::text NOT NULL,
    whatsapp_enabled boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 393 (class 1259 OID 17902)
-- Name: organization_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_types (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    type_code text NOT NULL,
    type_name text NOT NULL,
    type_description text,
    hierarchy_level integer NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT type_code_format CHECK ((type_code = upper(type_code)))
);


--
-- TOC entry 5708 (class 0 OID 0)
-- Dependencies: 393
-- Name: TABLE organization_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.organization_types IS 'Types of organizations in supply chain';


--
-- TOC entry 5709 (class 0 OID 0)
-- Dependencies: 393
-- Name: COLUMN organization_types.hierarchy_level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organization_types.hierarchy_level IS '1=HQ, 2=Manufacturer, 3=Distributor, 4=Warehouse, 5=Shop';


--
-- TOC entry 448 (class 1259 OID 30528)
-- Name: otp_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    subject_type text NOT NULL,
    subject_ref uuid,
    channel text NOT NULL,
    phone text,
    email text,
    code_hash text NOT NULL,
    salt text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    verified_at timestamp with time zone,
    CONSTRAINT otp_challenges_subject_type_check CHECK ((subject_type = ANY (ARRAY['staff'::text, 'customer'::text])))
);


--
-- TOC entry 440 (class 1259 OID 30024)
-- Name: points_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.points_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    journey_config_id uuid,
    name text DEFAULT 'Default'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    points_per_scan integer DEFAULT 0 NOT NULL,
    expires_after_days integer,
    allow_manual_adjustment boolean DEFAULT false NOT NULL,
    effective_from timestamp with time zone,
    effective_to timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- TOC entry 436 (class 1259 OID 26849)
-- Name: points_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.points_transactions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    consumer_phone text NOT NULL,
    consumer_email text,
    transaction_type text NOT NULL,
    points_amount integer NOT NULL,
    balance_after integer NOT NULL,
    qr_code_id uuid,
    redeem_item_id uuid,
    description text,
    transaction_date timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT points_transactions_transaction_type_check CHECK ((transaction_type = ANY (ARRAY['earn'::text, 'redeem'::text, 'expire'::text, 'adjust'::text])))
);


--
-- TOC entry 5710 (class 0 OID 0)
-- Dependencies: 436
-- Name: TABLE points_transactions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.points_transactions IS 'Ledger of all point earn/redeem transactions';


--
-- TOC entry 406 (class 1259 OID 18382)
-- Name: product_attributes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_attributes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    product_id uuid,
    variant_id uuid,
    attribute_name text NOT NULL,
    attribute_value text NOT NULL,
    attribute_type text DEFAULT 'TEXT'::text,
    unit_of_measure text,
    attribute_group text,
    is_searchable boolean DEFAULT true,
    is_filterable boolean DEFAULT false,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT attribute_belongs_to_product_or_variant CHECK ((((product_id IS NOT NULL) AND (variant_id IS NULL)) OR ((product_id IS NULL) AND (variant_id IS NOT NULL)))),
    CONSTRAINT valid_attribute_type CHECK ((attribute_type = ANY (ARRAY['TEXT'::text, 'NUMBER'::text, 'BOOLEAN'::text, 'DATE'::text, 'LIST'::text, 'JSON'::text])))
);


--
-- TOC entry 5711 (class 0 OID 0)
-- Dependencies: 406
-- Name: TABLE product_attributes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_attributes IS 'Flexible product/variant attributes';


--
-- TOC entry 397 (class 1259 OID 18027)
-- Name: product_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_groups (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    category_id uuid NOT NULL,
    group_code text NOT NULL,
    group_name text NOT NULL,
    group_name_search text GENERATED ALWAYS AS (lower(group_name)) STORED,
    group_description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 5712 (class 0 OID 0)
-- Dependencies: 397
-- Name: TABLE product_groups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_groups IS 'Product groups within categories';


--
-- TOC entry 405 (class 1259 OID 18349)
-- Name: product_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_images (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    product_id uuid,
    variant_id uuid,
    image_url text NOT NULL,
    image_type text DEFAULT 'PRODUCT'::text,
    title text,
    alt_text text,
    width integer,
    height integer,
    file_size integer,
    mime_type text,
    is_primary boolean DEFAULT false,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    uploaded_by uuid,
    CONSTRAINT image_belongs_to_product_or_variant CHECK ((((product_id IS NOT NULL) AND (variant_id IS NULL)) OR ((product_id IS NULL) AND (variant_id IS NOT NULL)))),
    CONSTRAINT valid_image_type CHECK ((image_type = ANY (ARRAY['PRODUCT'::text, 'PACKAGING'::text, 'LIFESTYLE'::text, 'CERTIFICATE'::text, 'WARNING'::text, 'DETAIL'::text])))
);


--
-- TOC entry 5713 (class 0 OID 0)
-- Dependencies: 405
-- Name: TABLE product_images; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_images IS 'Product and variant images';


--
-- TOC entry 403 (class 1259 OID 18269)
-- Name: product_pricing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_pricing (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    variant_id uuid NOT NULL,
    organization_id uuid,
    price_tier text DEFAULT 'STANDARD'::text,
    unit_price numeric(12,2) NOT NULL,
    case_price numeric(12,2),
    min_quantity integer DEFAULT 1,
    max_quantity integer,
    volume_discount_percent numeric(5,2) DEFAULT 0,
    promotional_discount_percent numeric(5,2) DEFAULT 0,
    currency_code text DEFAULT 'MYR'::text,
    effective_from date DEFAULT CURRENT_DATE,
    effective_to date,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT valid_date_range CHECK (((effective_to IS NULL) OR (effective_to >= effective_from))),
    CONSTRAINT valid_price_tier CHECK ((price_tier = ANY (ARRAY['MANUFACTURER_COST'::text, 'WHOLESALE'::text, 'DISTRIBUTOR'::text, 'RETAIL'::text, 'PROMO'::text, 'VIP'::text, 'TRADE'::text]))),
    CONSTRAINT valid_prices CHECK (((unit_price >= (0)::numeric) AND ((case_price IS NULL) OR (case_price >= (0)::numeric)))),
    CONSTRAINT valid_quantity_range CHECK (((max_quantity IS NULL) OR (max_quantity >= min_quantity)))
);


--
-- TOC entry 5714 (class 0 OID 0)
-- Dependencies: 403
-- Name: TABLE product_pricing; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_pricing IS 'Product pricing by tier and organization';


--
-- TOC entry 402 (class 1259 OID 18234)
-- Name: product_skus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_skus (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    variant_id uuid NOT NULL,
    organization_id uuid,
    sku_code text NOT NULL,
    internal_code text,
    sku_type text DEFAULT 'RETAIL'::text,
    package_type text DEFAULT 'UNIT'::text,
    quantity_per_package integer DEFAULT 1,
    is_active boolean DEFAULT true,
    effective_from date DEFAULT CURRENT_DATE,
    effective_to date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT valid_package_type CHECK ((package_type = ANY (ARRAY['UNIT'::text, 'CASE'::text, 'PALLET'::text, 'BUNDLE'::text]))),
    CONSTRAINT valid_sku_type CHECK ((sku_type = ANY (ARRAY['RETAIL'::text, 'WHOLESALE'::text, 'B2B'::text, 'PROMO'::text])))
);


--
-- TOC entry 5715 (class 0 OID 0)
-- Dependencies: 402
-- Name: TABLE product_skus; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_skus IS 'Organization-specific SKU codes';


--
-- TOC entry 398 (class 1259 OID 18048)
-- Name: product_subgroups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_subgroups (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    group_id uuid NOT NULL,
    subgroup_code text NOT NULL,
    subgroup_name text NOT NULL,
    subgroup_name_search text GENERATED ALWAYS AS (lower(subgroup_name)) STORED,
    subgroup_description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 5716 (class 0 OID 0)
-- Dependencies: 398
-- Name: TABLE product_subgroups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_subgroups IS 'Product sub-groups within groups';


--
-- TOC entry 428 (class 1259 OID 26484)
-- Name: qr_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qr_batches (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    company_id uuid NOT NULL,
    total_master_codes integer DEFAULT 0 NOT NULL,
    total_unique_codes integer DEFAULT 0 NOT NULL,
    buffer_percent numeric(5,2) DEFAULT 10.00,
    excel_file_url text,
    excel_generated_at timestamp with time zone,
    excel_generated_by uuid,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT qr_batches_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'generated'::text, 'printing'::text, 'in_production'::text, 'completed'::text])))
);


--
-- TOC entry 5717 (class 0 OID 0)
-- Dependencies: 428
-- Name: TABLE qr_batches; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.qr_batches IS 'QR code batches generated per H2M order';


--
-- TOC entry 5718 (class 0 OID 0)
-- Dependencies: 428
-- Name: COLUMN qr_batches.buffer_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.qr_batches.buffer_percent IS 'Extra QR codes for damaged/lost units (from orders.qr_buffer_percent)';


--
-- TOC entry 430 (class 1259 OID 26592)
-- Name: qr_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qr_codes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    batch_id uuid NOT NULL,
    master_code_id uuid,
    company_id uuid NOT NULL,
    order_id uuid NOT NULL,
    order_item_id uuid,
    product_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    code text NOT NULL,
    sequence_number integer NOT NULL,
    points_value integer DEFAULT 0,
    has_lucky_draw boolean DEFAULT false,
    has_redeem boolean DEFAULT false,
    redeem_item_id uuid,
    lucky_draw_campaign_id uuid,
    status text DEFAULT 'pending'::text,
    current_location_org_id uuid,
    last_scanned_at timestamp with time zone,
    last_scanned_by uuid,
    activated_at timestamp with time zone,
    activated_by_consumer text,
    is_active boolean DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT qr_codes_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'printed'::text, 'packed'::text, 'received_warehouse'::text, 'shipped_distributor'::text, 'activated'::text, 'redeemed'::text, 'expired'::text])))
);


--
-- TOC entry 5719 (class 0 OID 0)
-- Dependencies: 430
-- Name: TABLE qr_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.qr_codes IS 'Individual QR codes for each product unit';


--
-- TOC entry 5720 (class 0 OID 0)
-- Dependencies: 430
-- Name: COLUMN qr_codes.code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.qr_codes.code IS 'Unique QR code string (product-based format)';


--
-- TOC entry 5721 (class 0 OID 0)
-- Dependencies: 430
-- Name: COLUMN qr_codes.points_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.qr_codes.points_value IS 'Points awarded when consumer scans';


--
-- TOC entry 429 (class 1259 OID 26524)
-- Name: qr_master_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qr_master_codes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    batch_id uuid NOT NULL,
    company_id uuid NOT NULL,
    master_code text NOT NULL,
    case_number integer NOT NULL,
    expected_unit_count integer NOT NULL,
    actual_unit_count integer DEFAULT 0,
    status text DEFAULT 'pending'::text,
    manufacturer_scanned_at timestamp with time zone,
    manufacturer_scanned_by uuid,
    manufacturer_org_id uuid,
    warehouse_received_at timestamp with time zone,
    warehouse_received_by uuid,
    warehouse_org_id uuid,
    shipped_to_distributor_id uuid,
    shipped_at timestamp with time zone,
    shipped_by uuid,
    shipment_order_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT qr_master_codes_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'printed'::text, 'packed'::text, 'received_warehouse'::text, 'shipped_distributor'::text, 'opened'::text])))
);


--
-- TOC entry 5722 (class 0 OID 0)
-- Dependencies: 429
-- Name: TABLE qr_master_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.qr_master_codes IS 'Master QR codes for cases/boxes containing multiple products';


--
-- TOC entry 5723 (class 0 OID 0)
-- Dependencies: 429
-- Name: COLUMN qr_master_codes.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.qr_master_codes.status IS 'Movement status: pending → packed → received_warehouse → shipped_distributor';


--
-- TOC entry 431 (class 1259 OID 26667)
-- Name: qr_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qr_movements (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    qr_code_id uuid,
    qr_master_code_id uuid,
    movement_type text NOT NULL,
    from_org_id uuid,
    to_org_id uuid,
    current_status text,
    scanned_at timestamp with time zone DEFAULT now(),
    scanned_by uuid,
    scan_location text,
    device_info jsonb,
    related_order_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT qr_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['manufacture_scan'::text, 'warehouse_receive'::text, 'warehouse_ship'::text, 'consumer_scan'::text, 'quality_check'::text, 'audit'::text])))
);


--
-- TOC entry 5724 (class 0 OID 0)
-- Dependencies: 431
-- Name: TABLE qr_movements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.qr_movements IS 'Complete scan history for all QR codes (audit trail)';


--
-- TOC entry 437 (class 1259 OID 26879)
-- Name: qr_validation_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qr_validation_reports (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    warehouse_org_id uuid NOT NULL,
    distributor_org_id uuid NOT NULL,
    destination_order_id uuid,
    source_order_id uuid,
    expected_quantities jsonb NOT NULL,
    scanned_quantities jsonb NOT NULL,
    master_codes_scanned text[],
    unique_codes_scanned text[],
    is_matched boolean DEFAULT false,
    discrepancy_details jsonb,
    validation_status text DEFAULT 'pending'::text,
    approved_by uuid,
    approved_at timestamp with time zone,
    approval_notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT qr_validation_reports_validation_status_check CHECK ((validation_status = ANY (ARRAY['pending'::text, 'matched'::text, 'discrepancy'::text, 'approved'::text])))
);


--
-- TOC entry 5725 (class 0 OID 0)
-- Dependencies: 437
-- Name: TABLE qr_validation_reports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.qr_validation_reports IS 'Warehouse shipment validation: expected vs scanned quantities';


--
-- TOC entry 432 (class 1259 OID 26720)
-- Name: redeem_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redeem_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    item_code text NOT NULL,
    item_name text NOT NULL,
    item_description text,
    item_image_url text,
    points_required integer NOT NULL,
    stock_quantity integer DEFAULT 0,
    max_redemptions_per_consumer integer,
    is_active boolean DEFAULT true,
    valid_from timestamp with time zone,
    valid_until timestamp with time zone,
    terms_and_conditions text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT redeem_items_points_positive CHECK ((points_required > 0))
);


--
-- TOC entry 5726 (class 0 OID 0)
-- Dependencies: 432
-- Name: TABLE redeem_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.redeem_items IS 'Catalog of items consumers can redeem with points';


--
-- TOC entry 447 (class 1259 OID 30390)
-- Name: redemption_order_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redemption_order_limits (
    order_id uuid NOT NULL,
    enforce_limit boolean DEFAULT false NOT NULL,
    max_redemptions integer,
    start_at timestamp with time zone,
    end_at timestamp with time zone,
    exhausted_message text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 443 (class 1259 OID 30256)
-- Name: redemption_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redemption_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    journey_config_id uuid,
    order_id uuid NOT NULL,
    qr_code_id uuid NOT NULL,
    shop_org_id uuid,
    staff_user_id uuid,
    customer_phone text,
    status text DEFAULT 'completed'::text NOT NULL,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 442 (class 1259 OID 30224)
-- Name: redemption_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redemption_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    journey_config_id uuid,
    name text DEFAULT 'Default'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    require_staff_login boolean DEFAULT true NOT NULL,
    require_staff_otp boolean DEFAULT false NOT NULL,
    require_customer_otp boolean DEFAULT false NOT NULL,
    per_qr_max integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- TOC entry 390 (class 1259 OID 17848)
-- Name: regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    region_code text NOT NULL,
    region_name text NOT NULL,
    country_code text DEFAULT 'MY'::text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 5727 (class 0 OID 0)
-- Dependencies: 390
-- Name: TABLE regions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.regions IS 'Top-level geographic regions';


--
-- TOC entry 387 (class 1259 OID 17725)
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    role_code text NOT NULL,
    role_name text NOT NULL,
    role_description text,
    role_level integer NOT NULL,
    permissions jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT role_code_format CHECK ((role_code = upper(role_code)))
);


--
-- TOC entry 5728 (class 0 OID 0)
-- Dependencies: 387
-- Name: TABLE roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.roles IS 'Role definitions with hierarchy levels';


--
-- TOC entry 5729 (class 0 OID 0)
-- Dependencies: 387
-- Name: COLUMN roles.role_level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.role_level IS '1=Super Admin, 10=HQ Admin, 20=Power User, 30=Manager, 40=User, 50=Guest';


--
-- TOC entry 391 (class 1259 OID 17863)
-- Name: states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.states (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    region_id uuid,
    state_code text NOT NULL,
    state_name text NOT NULL,
    country_code text DEFAULT 'MY'::text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 5730 (class 0 OID 0)
-- Dependencies: 391
-- Name: TABLE states; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.states IS 'States/Negeri';


--
-- TOC entry 454 (class 1259 OID 35458)
-- Name: stock_adjustment_reasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_adjustment_reasons (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    reason_code text NOT NULL,
    reason_name text NOT NULL,
    reason_description text,
    requires_approval boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 453 (class 1259 OID 35406)
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movements (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    movement_type text NOT NULL,
    reference_type text,
    reference_id uuid,
    reference_no text,
    variant_id uuid NOT NULL,
    from_organization_id uuid,
    to_organization_id uuid,
    quantity_change integer NOT NULL,
    quantity_before integer NOT NULL,
    quantity_after integer NOT NULL,
    unit_cost numeric(12,2),
    total_cost numeric(15,2) GENERATED ALWAYS AS (((abs(quantity_change))::numeric * COALESCE(unit_cost, (0)::numeric))) STORED,
    manufacturer_id uuid,
    warehouse_location text,
    reason text,
    notes text,
    company_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['addition'::text, 'adjustment'::text, 'transfer_out'::text, 'transfer_in'::text, 'allocation'::text, 'deallocation'::text, 'order_fulfillment'::text, 'order_cancelled'::text]))),
    CONSTRAINT stock_movements_reference_type_check CHECK ((reference_type = ANY (ARRAY['manual'::text, 'order'::text, 'transfer'::text, 'adjustment'::text, 'purchase_order'::text, 'return'::text]))),
    CONSTRAINT valid_movement_direction CHECK ((((movement_type = 'transfer_out'::text) AND (from_organization_id IS NOT NULL)) OR ((movement_type = 'transfer_in'::text) AND (to_organization_id IS NOT NULL)) OR (movement_type <> ALL (ARRAY['transfer_out'::text, 'transfer_in'::text])))),
    CONSTRAINT valid_quantity_change CHECK ((((movement_type = ANY (ARRAY['addition'::text, 'transfer_in'::text, 'deallocation'::text, 'order_cancelled'::text])) AND (quantity_change > 0)) OR ((movement_type = 'adjustment'::text) AND (quantity_change <> 0)) OR ((movement_type = ANY (ARRAY['transfer_out'::text, 'allocation'::text, 'order_fulfillment'::text])) AND (quantity_change < 0))))
);


--
-- TOC entry 5731 (class 0 OID 0)
-- Dependencies: 453
-- Name: TABLE stock_movements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stock_movements IS 'Complete audit trail of all inventory movements';


--
-- TOC entry 5732 (class 0 OID 0)
-- Dependencies: 453
-- Name: COLUMN stock_movements.movement_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stock_movements.movement_type IS 'Type of stock movement: addition, adjustment, transfer, allocation, fulfillment';


--
-- TOC entry 5733 (class 0 OID 0)
-- Dependencies: 453
-- Name: COLUMN stock_movements.quantity_change; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stock_movements.quantity_change IS 'Positive for increases, negative for decreases';


--
-- TOC entry 5734 (class 0 OID 0)
-- Dependencies: 453
-- Name: COLUMN stock_movements.manufacturer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stock_movements.manufacturer_id IS 'Tracks which manufacturer supplied the stock (for additions)';


--
-- TOC entry 455 (class 1259 OID 35472)
-- Name: stock_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_transfers (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    transfer_no text NOT NULL,
    from_organization_id uuid NOT NULL,
    to_organization_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_items integer DEFAULT 0,
    total_value numeric(15,2) DEFAULT 0,
    shipped_at timestamp with time zone,
    received_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    notes text,
    company_id uuid NOT NULL,
    created_by uuid NOT NULL,
    approved_by uuid,
    received_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT no_self_transfer CHECK ((from_organization_id <> to_organization_id)),
    CONSTRAINT stock_transfers_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_transit'::text, 'received'::text, 'cancelled'::text])))
);


--
-- TOC entry 5735 (class 0 OID 0)
-- Dependencies: 455
-- Name: TABLE stock_transfers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stock_transfers IS 'Stock transfer orders between warehouses/organizations';


--
-- TOC entry 388 (class 1259 OID 17739)
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    phone text,
    role_code text NOT NULL,
    organization_id uuid,
    avatar_url text,
    is_active boolean DEFAULT true,
    is_verified boolean DEFAULT false,
    email_verified_at timestamp with time zone,
    phone_verified_at timestamp with time zone,
    last_login_at timestamp with time zone,
    last_login_ip inet,
    preferences jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT valid_email CHECK ((email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::text))
);


--
-- TOC entry 5736 (class 0 OID 0)
-- Dependencies: 388
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.users IS 'User profiles - single tenant, role-based access';


--
-- TOC entry 414 (class 1259 OID 20898)
-- Name: v_current_pricing; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_current_pricing AS
 SELECT pp.id,
    pp.variant_id,
    pv.variant_code,
    pv.variant_name,
    p.id AS product_id,
    p.product_code,
    p.product_name,
    pp.organization_id,
    o.org_name,
    o.org_type_code,
    pp.price_tier,
    pp.unit_price,
    pp.case_price,
    pp.min_quantity,
    pp.max_quantity,
    pp.volume_discount_percent,
    pp.promotional_discount_percent,
    round(((pp.unit_price * ((1)::numeric - (COALESCE(pp.volume_discount_percent, (0)::numeric) / (100)::numeric))) * ((1)::numeric - (COALESCE(pp.promotional_discount_percent, (0)::numeric) / (100)::numeric))), 2) AS effective_unit_price,
    pp.currency_code,
    pp.effective_from,
    pp.effective_to
   FROM (((public.product_pricing pp
     JOIN public.product_variants pv ON ((pv.id = pp.variant_id)))
     JOIN public.products p ON ((p.id = pv.product_id)))
     LEFT JOIN public.organizations o ON ((o.id = pp.organization_id)))
  WHERE ((pp.is_active = true) AND (pp.effective_from <= CURRENT_DATE) AND ((pp.effective_to IS NULL) OR (pp.effective_to >= CURRENT_DATE)));


--
-- TOC entry 5737 (class 0 OID 0)
-- Dependencies: 414
-- Name: VIEW v_current_pricing; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_current_pricing IS 'Current active pricing with discounts applied and no need for date filtering.';


--
-- TOC entry 424 (class 1259 OID 23081)
-- Name: v_document_workflow; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_document_workflow AS
 SELECT o.id AS order_id,
    o.order_no,
    o.order_type,
    o.status AS order_status,
    max(
        CASE
            WHEN (d.doc_type = 'PO'::public.document_type) THEN d.status
            ELSE NULL::public.document_status
        END) AS po_status,
    max(
        CASE
            WHEN (d.doc_type = 'INVOICE'::public.document_type) THEN d.status
            ELSE NULL::public.document_status
        END) AS invoice_status,
    max(
        CASE
            WHEN (d.doc_type = 'PAYMENT'::public.document_type) THEN d.status
            ELSE NULL::public.document_status
        END) AS payment_status,
    max(
        CASE
            WHEN (d.doc_type = 'RECEIPT'::public.document_type) THEN d.status
            ELSE NULL::public.document_status
        END) AS receipt_status,
    max(
        CASE
            WHEN (d.doc_type = 'PO'::public.document_type) THEN d.doc_no
            ELSE NULL::text
        END) AS po_no,
    max(
        CASE
            WHEN (d.doc_type = 'INVOICE'::public.document_type) THEN d.doc_no
            ELSE NULL::text
        END) AS invoice_no,
    max(
        CASE
            WHEN (d.doc_type = 'PAYMENT'::public.document_type) THEN d.doc_no
            ELSE NULL::text
        END) AS payment_no,
    max(
        CASE
            WHEN (d.doc_type = 'RECEIPT'::public.document_type) THEN d.doc_no
            ELSE NULL::text
        END) AS receipt_no
   FROM (public.orders o
     LEFT JOIN public.documents d ON ((d.order_id = o.id)))
  GROUP BY o.id, o.order_no, o.order_type, o.status;


--
-- TOC entry 5738 (class 0 OID 0)
-- Dependencies: 424
-- Name: VIEW v_document_workflow; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_document_workflow IS 'PO/Invoice/Payment/Receipt numbers + statuses per order';


--
-- TOC entry 410 (class 1259 OID 18521)
-- Name: v_hq_inventory; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_hq_inventory AS
 SELECT p.id AS product_id,
    p.product_code,
    p.product_name,
    pv.id AS variant_id,
    pv.variant_code,
    pv.variant_name,
    hq.id AS hq_org_id,
    hq.org_name AS hq_org_name,
    pi.quantity_on_hand,
    pi.quantity_allocated,
    pi.quantity_available,
    pi.average_cost,
    pi.total_value
   FROM (((public.products p
     JOIN public.product_variants pv ON (((pv.product_id = p.id) AND (pv.is_active = true))))
     JOIN public.organizations hq ON ((hq.org_type_code = 'HQ'::text)))
     LEFT JOIN public.product_inventory pi ON (((pi.variant_id = pv.id) AND (pi.organization_id = hq.id) AND (pi.is_active = true))));


--
-- TOC entry 415 (class 1259 OID 20903)
-- Name: v_low_stock_alerts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_low_stock_alerts AS
 SELECT pi.id,
    pi.organization_id,
    o.org_name,
    o.org_type_code,
    pi.variant_id,
    pv.variant_code,
    pv.variant_name,
    p.id AS product_id,
    p.product_code,
    p.product_name,
    p.brand_id,
    b.brand_name,
    pi.quantity_on_hand,
    pi.quantity_allocated,
    pi.quantity_available,
    pi.reorder_point,
    pi.reorder_quantity,
    pi.max_stock_level,
    (pi.reorder_point - pi.quantity_available) AS units_below_reorder,
        CASE
            WHEN (pi.reorder_point > 0) THEN round((((pi.quantity_available)::numeric / (pi.reorder_point)::numeric) * (100)::numeric), 1)
            ELSE (0)::numeric
        END AS stock_level_percent,
        CASE
            WHEN (pi.quantity_available <= 0) THEN 'CRITICAL'::text
            WHEN ((pi.quantity_available)::numeric <= ((pi.reorder_point)::numeric * 0.5)) THEN 'HIGH'::text
            WHEN (pi.quantity_available <= pi.reorder_point) THEN 'MEDIUM'::text
            ELSE 'LOW'::text
        END AS priority,
    pi.warehouse_location,
    pi.last_counted_at,
    pi.updated_at
   FROM ((((public.product_inventory pi
     JOIN public.product_variants pv ON ((pv.id = pi.variant_id)))
     JOIN public.products p ON ((p.id = pv.product_id)))
     LEFT JOIN public.brands b ON ((b.id = p.brand_id)))
     JOIN public.organizations o ON ((o.id = pi.organization_id)))
  WHERE ((pi.is_active = true) AND (pi.quantity_available <= pi.reorder_point))
  ORDER BY
        CASE
            WHEN (pi.quantity_available <= 0) THEN 1
            WHEN ((pi.quantity_available)::numeric <= ((pi.reorder_point)::numeric * 0.5)) THEN 2
            WHEN (pi.quantity_available <= pi.reorder_point) THEN 3
            ELSE 4
        END, pi.quantity_available;


--
-- TOC entry 5739 (class 0 OID 0)
-- Dependencies: 415
-- Name: VIEW v_low_stock_alerts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_low_stock_alerts IS 'Low stock alerts with priority levels (CRITICAL/HIGH/MEDIUM/LOW).';


--
-- TOC entry 423 (class 1259 OID 23076)
-- Name: v_order_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_order_summary AS
SELECT
    NULL::uuid AS id,
    NULL::text AS order_no,
    NULL::public.order_type AS order_type,
    NULL::public.order_status AS status,
    NULL::text AS buyer_name,
    NULL::text AS seller_name,
    NULL::bigint AS item_count,
    NULL::numeric AS total_amount,
    NULL::uuid AS parent_order_id,
    NULL::text AS parent_order_no,
    NULL::timestamp with time zone AS created_at,
    NULL::timestamp with time zone AS approved_at,
    NULL::text AS created_by_name,
    NULL::text AS approved_by_name;


--
-- TOC entry 5740 (class 0 OID 0)
-- Dependencies: 423
-- Name: VIEW v_order_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_order_summary IS 'Order summary with totals and human-readable org/user names';


--
-- TOC entry 399 (class 1259 OID 18092)
-- Name: v_org_hierarchy; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_org_hierarchy AS
 WITH RECURSIVE org_tree AS (
         SELECT o.id,
            o.org_code,
            o.org_name,
            o.org_type_code,
            ot.type_name,
            o.parent_org_id,
            1 AS level,
            ARRAY[o.org_name] AS path,
            o.org_code AS path_codes
           FROM (public.organizations o
             JOIN public.organization_types ot ON ((ot.type_code = o.org_type_code)))
          WHERE (o.parent_org_id IS NULL)
        UNION ALL
         SELECT child.id,
            child.org_code,
            child.org_name,
            child.org_type_code,
            ot.type_name,
            child.parent_org_id,
            (parent.level + 1),
            (parent.path || child.org_name),
            ((parent.path_codes || ' → '::text) || child.org_code)
           FROM ((public.organizations child
             JOIN public.organization_types ot ON ((ot.type_code = child.org_type_code)))
             JOIN org_tree parent ON ((child.parent_org_id = parent.id)))
        )
 SELECT id,
    org_code,
    org_name,
    org_type_code,
    type_name,
    parent_org_id,
    level,
    path,
    path_codes
   FROM org_tree
  ORDER BY level, org_name;


--
-- TOC entry 426 (class 1259 OID 23262)
-- Name: v_org_hierarchy_validation; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_org_hierarchy_validation AS
 SELECT o.id,
    o.org_code,
    o.org_name,
    o.org_type_code,
    ot.type_name AS org_type_name,
    o.parent_org_id,
    p.org_name AS parent_org_name,
    p.org_type_code AS parent_org_type,
        CASE
            WHEN ((o.org_type_code = 'HQ'::text) AND (o.parent_org_id IS NULL)) THEN '✅ Valid'::text
            WHEN ((o.org_type_code = 'HQ'::text) AND (o.parent_org_id IS NOT NULL)) THEN '❌ HQ cannot have parent'::text
            WHEN ((o.org_type_code = 'MFG'::text) AND (o.parent_org_id IS NULL)) THEN '✅ Valid (Independent)'::text
            WHEN ((o.org_type_code = 'MFG'::text) AND (p.org_type_code = 'HQ'::text)) THEN '✅ Valid'::text
            WHEN (o.org_type_code = 'MFG'::text) THEN '❌ Invalid parent type'::text
            WHEN ((o.org_type_code = 'DIST'::text) AND (o.parent_org_id IS NULL)) THEN '❌ Must have HQ parent'::text
            WHEN ((o.org_type_code = 'DIST'::text) AND (p.org_type_code = 'HQ'::text)) THEN '✅ Valid'::text
            WHEN (o.org_type_code = 'DIST'::text) THEN '❌ Must report to HQ'::text
            WHEN ((o.org_type_code = 'WH'::text) AND (o.parent_org_id IS NULL)) THEN '❌ Must have parent'::text
            WHEN ((o.org_type_code = 'WH'::text) AND (p.org_type_code = ANY (ARRAY['HQ'::text, 'DIST'::text]))) THEN '✅ Valid'::text
            WHEN (o.org_type_code = 'WH'::text) THEN '❌ Must report to HQ or Distributor'::text
            WHEN ((o.org_type_code = 'SHOP'::text) AND (o.parent_org_id IS NULL)) THEN '❌ Must have Distributor parent'::text
            WHEN ((o.org_type_code = 'SHOP'::text) AND (p.org_type_code = 'DIST'::text)) THEN '✅ Valid'::text
            WHEN (o.org_type_code = 'SHOP'::text) THEN '❌ Must report to Distributor'::text
            ELSE '⚠️ Unknown'::text
        END AS validation_status,
        CASE
            WHEN ((o.org_type_code = 'HQ'::text) AND (o.parent_org_id IS NOT NULL)) THEN 'Remove parent organization'::text
            WHEN ((o.org_type_code = 'MFG'::text) AND (o.parent_org_id IS NOT NULL) AND (p.org_type_code <> 'HQ'::text)) THEN 'Change parent to HQ or remove parent'::text
            WHEN ((o.org_type_code = 'DIST'::text) AND (o.parent_org_id IS NULL)) THEN 'Select an HQ as parent'::text
            WHEN ((o.org_type_code = 'DIST'::text) AND (p.org_type_code <> 'HQ'::text)) THEN 'Change parent to HQ'::text
            WHEN ((o.org_type_code = 'WH'::text) AND (o.parent_org_id IS NULL)) THEN 'Select HQ or Distributor as parent'::text
            WHEN ((o.org_type_code = 'WH'::text) AND (p.org_type_code <> ALL (ARRAY['HQ'::text, 'DIST'::text]))) THEN 'Change parent to HQ or Distributor'::text
            WHEN ((o.org_type_code = 'SHOP'::text) AND (o.parent_org_id IS NULL)) THEN 'Select a Distributor as parent'::text
            WHEN ((o.org_type_code = 'SHOP'::text) AND (p.org_type_code <> 'DIST'::text)) THEN 'Change parent to Distributor'::text
            ELSE NULL::text
        END AS suggested_fix,
    o.is_active,
    o.created_at,
    o.updated_at
   FROM ((public.organizations o
     LEFT JOIN public.organizations p ON ((o.parent_org_id = p.id)))
     LEFT JOIN public.organization_types ot ON ((o.org_type_code = ot.type_code)))
  ORDER BY
        CASE
            WHEN (o.org_type_code = 'HQ'::text) THEN 1
            WHEN (o.org_type_code = 'MFG'::text) THEN 2
            WHEN (o.org_type_code = 'DIST'::text) THEN 3
            WHEN (o.org_type_code = 'WH'::text) THEN 4
            WHEN (o.org_type_code = 'SHOP'::text) THEN 5
            ELSE NULL::integer
        END, o.org_name;


--
-- TOC entry 5741 (class 0 OID 0)
-- Dependencies: 426
-- Name: VIEW v_org_hierarchy_validation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_org_hierarchy_validation IS 'Shows all organizations with hierarchy validation status and suggested fixes for invalid configurations';


--
-- TOC entry 416 (class 1259 OID 20908)
-- Name: v_org_hierarchy_with_stock; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_org_hierarchy_with_stock AS
 WITH RECURSIVE org_tree AS (
         SELECT o.id,
            o.org_code,
            o.org_name,
            o.org_type_code,
            ot_1.type_name,
            o.parent_org_id,
            1 AS level,
            ARRAY[o.org_name] AS path,
            o.org_code AS path_codes,
            o.is_active
           FROM (public.organizations o
             JOIN public.organization_types ot_1 ON ((ot_1.type_code = o.org_type_code)))
          WHERE (o.parent_org_id IS NULL)
        UNION ALL
         SELECT c.id,
            c.org_code,
            c.org_name,
            c.org_type_code,
            ot_1.type_name,
            c.parent_org_id,
            (p.level + 1),
            (p.path || c.org_name),
            ((p.path_codes || ' → '::text) || c.org_code),
            c.is_active
           FROM ((public.organizations c
             JOIN public.organization_types ot_1 ON ((ot_1.type_code = c.org_type_code)))
             JOIN org_tree p ON ((c.parent_org_id = p.id)))
        )
 SELECT ot.id,
    ot.org_code,
    ot.org_name,
    ot.org_type_code,
    ot.type_name,
    ot.parent_org_id,
    ot.level,
    ot.path,
    ot.path_codes,
    ot.is_active,
    count(DISTINCT pi.variant_id) AS total_variants_in_stock,
    sum(COALESCE(pi.quantity_on_hand, 0)) AS total_units_on_hand,
    sum(COALESCE(pi.quantity_available, 0)) AS total_units_available,
    sum(COALESCE(pi.total_value, (0)::numeric)) AS total_inventory_value,
    count(DISTINCT
        CASE
            WHEN (pi.quantity_available <= pi.reorder_point) THEN pi.variant_id
            ELSE NULL::uuid
        END) AS low_stock_items
   FROM (org_tree ot
     LEFT JOIN public.product_inventory pi ON (((pi.organization_id = ot.id) AND (pi.is_active = true))))
  GROUP BY ot.id, ot.org_code, ot.org_name, ot.org_type_code, ot.type_name, ot.parent_org_id, ot.level, ot.path, ot.path_codes, ot.is_active
  ORDER BY ot.level, ot.org_name;


--
-- TOC entry 5742 (class 0 OID 0)
-- Dependencies: 416
-- Name: VIEW v_org_hierarchy_with_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_org_hierarchy_with_stock IS 'Organization hierarchy with aggregated inventory statistics.';


--
-- TOC entry 425 (class 1259 OID 23086)
-- Name: v_parent_order_remaining; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_parent_order_remaining AS
 SELECT parent.id AS parent_order_id,
    parent.order_no AS parent_order_no,
    parent_items.variant_id,
    pv.variant_name,
    p.product_name,
    parent_items.qty AS parent_qty,
    COALESCE(sum(child_items.qty), (0)::bigint) AS allocated_qty,
    (parent_items.qty - COALESCE(sum(child_items.qty), (0)::bigint)) AS remaining_qty,
    round((((COALESCE(sum(child_items.qty), (0)::bigint))::numeric / NULLIF((parent_items.qty)::numeric, (0)::numeric)) * (100)::numeric), 2) AS allocated_percent
   FROM (((((public.orders parent
     JOIN public.order_items parent_items ON ((parent_items.order_id = parent.id)))
     LEFT JOIN public.orders child_orders ON (((child_orders.parent_order_id = parent.id) AND (child_orders.status = 'approved'::public.order_status))))
     LEFT JOIN public.order_items child_items ON (((child_items.order_id = child_orders.id) AND (child_items.variant_id = parent_items.variant_id))))
     LEFT JOIN public.product_variants pv ON ((pv.id = parent_items.variant_id)))
     LEFT JOIN public.products p ON ((p.id = pv.product_id)))
  WHERE (parent.status = 'approved'::public.order_status)
  GROUP BY parent.id, parent.order_no, parent_items.variant_id, parent_items.qty, pv.variant_name, p.product_name;


--
-- TOC entry 5743 (class 0 OID 0)
-- Dependencies: 425
-- Name: VIEW v_parent_order_remaining; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_parent_order_remaining IS 'Remaining quantities for approved parent orders, by variant';


--
-- TOC entry 409 (class 1259 OID 18516)
-- Name: v_product_catalog; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_product_catalog AS
SELECT
    NULL::uuid AS id,
    NULL::text AS product_code,
    NULL::text AS product_name,
    NULL::boolean AS is_vape,
    NULL::text AS brand_name,
    NULL::text AS category_name,
    NULL::text AS group_name,
    NULL::text AS subgroup_name,
    NULL::text AS manufacturer_name,
    NULL::bigint AS variant_count,
    NULL::bigint AS image_count,
    NULL::boolean AS is_active,
    NULL::boolean AS is_discontinued,
    NULL::timestamp with time zone AS created_at;


--
-- TOC entry 411 (class 1259 OID 18526)
-- Name: v_shop_available_products; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_shop_available_products AS
 SELECT DISTINCT sd.shop_id,
    s.org_name AS shop_name,
    sd.distributor_id,
    d.org_name AS distributor_name,
    p.id AS product_id,
    p.product_code,
    p.product_name,
    p.is_vape,
    b.brand_name,
    c.category_name,
    dp.distributor_cost AS distributor_wholesale_cost,
    dp.territory_coverage,
    dp.lead_time_days,
    sd.payment_terms,
    sd.credit_limit,
    pi.quantity_available AS distributor_stock,
    dp.is_active AS distributor_carries_product,
    sd.is_active AS shop_distributor_active,
    p.is_active AS product_active
   FROM ((((((((public.shop_distributors sd
     JOIN public.organizations s ON (((s.id = sd.shop_id) AND (s.org_type_code = 'SHOP'::text))))
     JOIN public.organizations d ON (((d.id = sd.distributor_id) AND (d.org_type_code = 'DIST'::text))))
     JOIN public.distributor_products dp ON ((dp.distributor_id = sd.distributor_id)))
     JOIN public.products p ON ((p.id = dp.product_id)))
     LEFT JOIN public.brands b ON ((b.id = p.brand_id)))
     LEFT JOIN public.product_categories c ON ((c.id = p.category_id)))
     LEFT JOIN public.product_variants pv ON (((pv.product_id = p.id) AND (pv.is_default = true))))
     LEFT JOIN public.product_inventory pi ON (((pi.variant_id = pv.id) AND (pi.organization_id = sd.distributor_id))));


--
-- TOC entry 417 (class 1259 OID 21186)
-- Name: v_system_statistics; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_system_statistics AS
 SELECT 'Organizations'::text AS entity,
    count(*) AS total,
    count(*) FILTER (WHERE (organizations.is_active = true)) AS active
   FROM public.organizations
UNION ALL
 SELECT 'Products'::text AS entity,
    count(*) AS total,
    count(*) FILTER (WHERE (products.is_active = true)) AS active
   FROM public.products
UNION ALL
 SELECT 'Product Variants'::text AS entity,
    count(*) AS total,
    count(*) FILTER (WHERE (product_variants.is_active = true)) AS active
   FROM public.product_variants
UNION ALL
 SELECT 'Users'::text AS entity,
    count(*) AS total,
    count(*) FILTER (WHERE (users.is_active = true)) AS active
   FROM public.users
UNION ALL
 SELECT 'Brands'::text AS entity,
    count(*) AS total,
    count(*) FILTER (WHERE (brands.is_active = true)) AS active
   FROM public.brands
UNION ALL
 SELECT 'Shop-Distributor Relationships'::text AS entity,
    count(*) AS total,
    count(*) FILTER (WHERE (shop_distributors.is_active = true)) AS active
   FROM public.shop_distributors
UNION ALL
 SELECT 'Distributor Products'::text AS entity,
    count(*) AS total,
    count(*) FILTER (WHERE (distributor_products.is_active = true)) AS active
   FROM public.distributor_products
UNION ALL
 SELECT 'Inventory Records'::text AS entity,
    count(*) AS total,
    count(*) FILTER (WHERE (product_inventory.is_active = true)) AS active
   FROM public.product_inventory
UNION ALL
 SELECT 'Audit Log Entries (Last 30 days)'::text AS entity,
    count(*) AS total,
    count(*) AS active
   FROM public.audit_logs
  WHERE (audit_logs.created_at >= (CURRENT_DATE - '30 days'::interval));


--
-- TOC entry 5744 (class 0 OID 0)
-- Dependencies: 417
-- Name: VIEW v_system_statistics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_system_statistics IS 'System-wide entity counts for dashboard statistics';


--
-- TOC entry 427 (class 1259 OID 23942)
-- Name: v_user_roles; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_user_roles AS
 SELECT role_code,
    role_name,
    role_level
   FROM public.roles
  WHERE ((is_active = true) AND (role_code = ANY (ARRAY['SA'::text, 'HQ'::text, 'POWER_USER'::text, 'MANAGER'::text, 'USER'::text, 'GUEST'::text])))
  ORDER BY role_level, role_code;


--
-- TOC entry 356 (class 1259 OID 16546)
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL
);


--
-- TOC entry 5745 (class 0 OID 0)
-- Dependencies: 356
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- TOC entry 385 (class 1259 OID 17398)
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_analytics (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 358 (class 1259 OID 16588)
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- TOC entry 357 (class 1259 OID 16561)
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb,
    level integer
);


--
-- TOC entry 5746 (class 0 OID 0)
-- Dependencies: 357
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- TOC entry 384 (class 1259 OID 17310)
-- Name: prefixes; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.prefixes (
    bucket_id text NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    level integer GENERATED ALWAYS AS (storage.get_level(name)) STORED NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- TOC entry 382 (class 1259 OID 17256)
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb
);


--
-- TOC entry 383 (class 1259 OID 17270)
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 4795 (class 2606 OID 18161)
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- TOC entry 412 (class 1259 OID 20592)
-- Name: mv_product_catalog; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_product_catalog AS
 SELECT p.id,
    p.product_code,
    p.product_name,
    p.is_vape,
    b.brand_name,
    c.category_name,
    g.group_name,
    sg.subgroup_name,
    m.org_name AS manufacturer_name,
    count(DISTINCT pv.id) AS variant_count,
    count(DISTINCT pi.id) AS image_count,
    p.is_active,
    p.is_discontinued,
    p.created_at,
    p.updated_at
   FROM (((((((public.products p
     LEFT JOIN public.brands b ON ((b.id = p.brand_id)))
     LEFT JOIN public.product_categories c ON ((c.id = p.category_id)))
     LEFT JOIN public.product_groups g ON ((g.id = p.group_id)))
     LEFT JOIN public.product_subgroups sg ON ((sg.id = p.subgroup_id)))
     LEFT JOIN public.organizations m ON ((m.id = p.manufacturer_id)))
     LEFT JOIN public.product_variants pv ON (((pv.product_id = p.id) AND (pv.is_active = true))))
     LEFT JOIN public.product_images pi ON (((pi.product_id = p.id) AND (pi.is_active = true))))
  GROUP BY p.id, b.brand_name, c.category_name, g.group_name, sg.subgroup_name, m.org_name
  WITH NO DATA;


--
-- TOC entry 5747 (class 0 OID 0)
-- Dependencies: 412
-- Name: MATERIALIZED VIEW mv_product_catalog; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.mv_product_catalog IS 'Materialized view for fast product catalog queries; refresh via refresh_product_catalog()';


--
-- TOC entry 4709 (class 2606 OID 17777)
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- TOC entry 4762 (class 2606 OID 18018)
-- Name: brands brands_brand_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_brand_code_key UNIQUE (brand_code);


--
-- TOC entry 4764 (class 2606 OID 18016)
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);


--
-- TOC entry 4619 (class 2606 OID 20325)
-- Name: organizations chk_org_hierarchy_depth; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.organizations
    ADD CONSTRAINT chk_org_hierarchy_depth CHECK (public._org_depth_ok(id)) NOT VALID;


--
-- TOC entry 4999 (class 2606 OID 26827)
-- Name: consumer_activations consumer_activations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumer_activations
    ADD CONSTRAINT consumer_activations_pkey PRIMARY KEY (id);


--
-- TOC entry 5001 (class 2606 OID 26829)
-- Name: consumer_activations consumer_activations_qr_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumer_activations
    ADD CONSTRAINT consumer_activations_qr_unique UNIQUE (qr_code_id);


--
-- TOC entry 4853 (class 2606 OID 18426)
-- Name: distributor_products distributor_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distributor_products
    ADD CONSTRAINT distributor_products_pkey PRIMARY KEY (id);


--
-- TOC entry 4727 (class 2606 OID 17892)
-- Name: districts districts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.districts
    ADD CONSTRAINT districts_pkey PRIMARY KEY (id);


--
-- TOC entry 4883 (class 2606 OID 22268)
-- Name: doc_counters doc_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_counters
    ADD CONSTRAINT doc_counters_pkey PRIMARY KEY (id);


--
-- TOC entry 4927 (class 2606 OID 22846)
-- Name: document_files document_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_files
    ADD CONSTRAINT document_files_pkey PRIMARY KEY (id);


--
-- TOC entry 4915 (class 2606 OID 22801)
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- TOC entry 5022 (class 2606 OID 29950)
-- Name: journey_configurations journey_configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_configurations
    ADD CONSTRAINT journey_configurations_pkey PRIMARY KEY (id);


--
-- TOC entry 5025 (class 2606 OID 29971)
-- Name: journey_order_links journey_order_links_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_order_links
    ADD CONSTRAINT journey_order_links_order_id_key UNIQUE (order_id);


--
-- TOC entry 5027 (class 2606 OID 29969)
-- Name: journey_order_links journey_order_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_order_links
    ADD CONSTRAINT journey_order_links_pkey PRIMARY KEY (id);


--
-- TOC entry 4986 (class 2606 OID 26763)
-- Name: lucky_draw_campaigns lucky_draw_campaigns_company_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_campaigns
    ADD CONSTRAINT lucky_draw_campaigns_company_code_unique UNIQUE (company_id, campaign_code);


--
-- TOC entry 4988 (class 2606 OID 26761)
-- Name: lucky_draw_campaigns lucky_draw_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_campaigns
    ADD CONSTRAINT lucky_draw_campaigns_pkey PRIMARY KEY (id);


--
-- TOC entry 4995 (class 2606 OID 26795)
-- Name: lucky_draw_entries lucky_draw_entries_campaign_entry_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_entries
    ADD CONSTRAINT lucky_draw_entries_campaign_entry_unique UNIQUE (campaign_id, entry_number);


--
-- TOC entry 4997 (class 2606 OID 26793)
-- Name: lucky_draw_entries lucky_draw_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_entries
    ADD CONSTRAINT lucky_draw_entries_pkey PRIMARY KEY (id);


--
-- TOC entry 5035 (class 2606 OID 30146)
-- Name: lucky_draw_order_links lucky_draw_order_links_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_order_links
    ADD CONSTRAINT lucky_draw_order_links_order_id_key UNIQUE (order_id);


--
-- TOC entry 5037 (class 2606 OID 30144)
-- Name: lucky_draw_order_links lucky_draw_order_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_order_links
    ADD CONSTRAINT lucky_draw_order_links_pkey PRIMARY KEY (id);


--
-- TOC entry 5050 (class 2606 OID 30367)
-- Name: message_templates message_templates_org_id_code_channel_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_org_id_code_channel_key UNIQUE (org_id, code, channel);


--
-- TOC entry 5052 (class 2606 OID 30365)
-- Name: message_templates message_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_pkey PRIMARY KEY (id);


--
-- TOC entry 5087 (class 2606 OID 35244)
-- Name: notification_logs notification_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_pkey PRIMARY KEY (id);


--
-- TOC entry 5073 (class 2606 OID 35190)
-- Name: notification_provider_configs notification_provider_configs_org_id_channel_provider_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_provider_configs
    ADD CONSTRAINT notification_provider_configs_org_id_channel_provider_name_key UNIQUE (org_id, channel, provider_name);


--
-- TOC entry 5075 (class 2606 OID 35188)
-- Name: notification_provider_configs notification_provider_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_provider_configs
    ADD CONSTRAINT notification_provider_configs_pkey PRIMARY KEY (id);


--
-- TOC entry 5079 (class 2606 OID 35218)
-- Name: notification_settings notification_settings_org_id_event_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_settings
    ADD CONSTRAINT notification_settings_org_id_event_code_key UNIQUE (org_id, event_code);


--
-- TOC entry 5081 (class 2606 OID 35216)
-- Name: notification_settings notification_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_settings
    ADD CONSTRAINT notification_settings_pkey PRIMARY KEY (id);


--
-- TOC entry 5068 (class 2606 OID 35174)
-- Name: notification_types notification_types_event_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_types
    ADD CONSTRAINT notification_types_event_code_key UNIQUE (event_code);


--
-- TOC entry 5070 (class 2606 OID 35172)
-- Name: notification_types notification_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_types
    ADD CONSTRAINT notification_types_pkey PRIMARY KEY (id);


--
-- TOC entry 5060 (class 2606 OID 30382)
-- Name: notifications_outbox notifications_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications_outbox
    ADD CONSTRAINT notifications_outbox_pkey PRIMARY KEY (id);


--
-- TOC entry 4911 (class 2606 OID 22701)
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- TOC entry 4902 (class 2606 OID 22641)
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- TOC entry 5048 (class 2606 OID 30350)
-- Name: org_notification_settings org_notification_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_notification_settings
    ADD CONSTRAINT org_notification_settings_pkey PRIMARY KEY (org_id);


--
-- TOC entry 4733 (class 2606 OID 17912)
-- Name: organization_types organization_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_types
    ADD CONSTRAINT organization_types_pkey PRIMARY KEY (id);


--
-- TOC entry 4735 (class 2606 OID 17914)
-- Name: organization_types organization_types_type_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_types
    ADD CONSTRAINT organization_types_type_code_key UNIQUE (type_code);


--
-- TOC entry 4749 (class 2606 OID 17932)
-- Name: organizations organizations_org_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_org_code_key UNIQUE (org_code);


--
-- TOC entry 4751 (class 2606 OID 17930)
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- TOC entry 5066 (class 2606 OID 30540)
-- Name: otp_challenges otp_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_challenges
    ADD CONSTRAINT otp_challenges_pkey PRIMARY KEY (id);


--
-- TOC entry 5031 (class 2606 OID 30036)
-- Name: points_rules points_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_rules
    ADD CONSTRAINT points_rules_pkey PRIMARY KEY (id);


--
-- TOC entry 5011 (class 2606 OID 26859)
-- Name: points_transactions points_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_pkey PRIMARY KEY (id);


--
-- TOC entry 4851 (class 2606 OID 18396)
-- Name: product_attributes product_attributes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attributes
    ADD CONSTRAINT product_attributes_pkey PRIMARY KEY (id);


--
-- TOC entry 4758 (class 2606 OID 17990)
-- Name: product_categories product_categories_category_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_category_code_key UNIQUE (category_code);


--
-- TOC entry 4760 (class 2606 OID 17988)
-- Name: product_categories product_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_pkey PRIMARY KEY (id);


--
-- TOC entry 4774 (class 2606 OID 18038)
-- Name: product_groups product_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_groups
    ADD CONSTRAINT product_groups_pkey PRIMARY KEY (id);


--
-- TOC entry 4845 (class 2606 OID 18363)
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- TOC entry 4838 (class 2606 OID 18328)
-- Name: product_inventory product_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_inventory
    ADD CONSTRAINT product_inventory_pkey PRIMARY KEY (id);


--
-- TOC entry 4829 (class 2606 OID 18289)
-- Name: product_pricing product_pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_pricing
    ADD CONSTRAINT product_pricing_pkey PRIMARY KEY (id);


--
-- TOC entry 4817 (class 2606 OID 18250)
-- Name: product_skus product_skus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_skus
    ADD CONSTRAINT product_skus_pkey PRIMARY KEY (id);


--
-- TOC entry 4819 (class 2606 OID 18252)
-- Name: product_skus product_skus_sku_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_skus
    ADD CONSTRAINT product_skus_sku_code_key UNIQUE (sku_code);


--
-- TOC entry 4780 (class 2606 OID 18059)
-- Name: product_subgroups product_subgroups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_subgroups
    ADD CONSTRAINT product_subgroups_pkey PRIMARY KEY (id);


--
-- TOC entry 4806 (class 2606 OID 18222)
-- Name: product_variants product_variants_barcode_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_barcode_key UNIQUE (barcode);


--
-- TOC entry 4808 (class 2606 OID 18220)
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- TOC entry 4797 (class 2606 OID 18163)
-- Name: products products_product_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_product_code_key UNIQUE (product_code);


--
-- TOC entry 4935 (class 2606 OID 26500)
-- Name: qr_batches qr_batches_order_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_batches
    ADD CONSTRAINT qr_batches_order_unique UNIQUE (order_id);


--
-- TOC entry 4937 (class 2606 OID 26498)
-- Name: qr_batches qr_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_batches
    ADD CONSTRAINT qr_batches_pkey PRIMARY KEY (id);


--
-- TOC entry 4961 (class 2606 OID 26611)
-- Name: qr_codes qr_codes_batch_sequence_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_batch_sequence_unique UNIQUE (batch_id, sequence_number);


--
-- TOC entry 4963 (class 2606 OID 26609)
-- Name: qr_codes qr_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_code_key UNIQUE (code);


--
-- TOC entry 4965 (class 2606 OID 26607)
-- Name: qr_codes qr_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_pkey PRIMARY KEY (id);


--
-- TOC entry 4945 (class 2606 OID 26540)
-- Name: qr_master_codes qr_master_codes_batch_case_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_master_codes
    ADD CONSTRAINT qr_master_codes_batch_case_unique UNIQUE (batch_id, case_number);


--
-- TOC entry 4947 (class 2606 OID 26538)
-- Name: qr_master_codes qr_master_codes_master_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_master_codes
    ADD CONSTRAINT qr_master_codes_master_code_key UNIQUE (master_code);


--
-- TOC entry 4949 (class 2606 OID 26536)
-- Name: qr_master_codes qr_master_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_master_codes
    ADD CONSTRAINT qr_master_codes_pkey PRIMARY KEY (id);


--
-- TOC entry 4974 (class 2606 OID 26677)
-- Name: qr_movements qr_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_movements
    ADD CONSTRAINT qr_movements_pkey PRIMARY KEY (id);


--
-- TOC entry 5018 (class 2606 OID 26891)
-- Name: qr_validation_reports qr_validation_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_validation_reports
    ADD CONSTRAINT qr_validation_reports_pkey PRIMARY KEY (id);


--
-- TOC entry 4979 (class 2606 OID 26734)
-- Name: redeem_items redeem_items_company_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redeem_items
    ADD CONSTRAINT redeem_items_company_code_unique UNIQUE (company_id, item_code);


--
-- TOC entry 4981 (class 2606 OID 26732)
-- Name: redeem_items redeem_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redeem_items
    ADD CONSTRAINT redeem_items_pkey PRIMARY KEY (id);


--
-- TOC entry 5062 (class 2606 OID 30398)
-- Name: redemption_order_limits redemption_order_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_order_limits
    ADD CONSTRAINT redemption_order_limits_pkey PRIMARY KEY (order_id);


--
-- TOC entry 5044 (class 2606 OID 30266)
-- Name: redemption_orders redemption_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_orders
    ADD CONSTRAINT redemption_orders_pkey PRIMARY KEY (id);


--
-- TOC entry 5041 (class 2606 OID 30238)
-- Name: redemption_policies redemption_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_policies
    ADD CONSTRAINT redemption_policies_pkey PRIMARY KEY (id);


--
-- TOC entry 4717 (class 2606 OID 17858)
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (id);


--
-- TOC entry 4719 (class 2606 OID 17860)
-- Name: regions regions_region_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_region_code_key UNIQUE (region_code);


--
-- TOC entry 4695 (class 2606 OID 17736)
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- TOC entry 4697 (class 2606 OID 17738)
-- Name: roles roles_role_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_role_code_key UNIQUE (role_code);


--
-- TOC entry 4870 (class 2606 OID 18463)
-- Name: shop_distributors shop_distributors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_distributors
    ADD CONSTRAINT shop_distributors_pkey PRIMARY KEY (id);


--
-- TOC entry 4723 (class 2606 OID 17873)
-- Name: states states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.states
    ADD CONSTRAINT states_pkey PRIMARY KEY (id);


--
-- TOC entry 5099 (class 2606 OID 35469)
-- Name: stock_adjustment_reasons stock_adjustment_reasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment_reasons
    ADD CONSTRAINT stock_adjustment_reasons_pkey PRIMARY KEY (id);


--
-- TOC entry 5101 (class 2606 OID 35471)
-- Name: stock_adjustment_reasons stock_adjustment_reasons_reason_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_adjustment_reasons
    ADD CONSTRAINT stock_adjustment_reasons_reason_code_key UNIQUE (reason_code);


--
-- TOC entry 5097 (class 2606 OID 35419)
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- TOC entry 5108 (class 2606 OID 35487)
-- Name: stock_transfers stock_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_pkey PRIMARY KEY (id);


--
-- TOC entry 5110 (class 2606 OID 35489)
-- Name: stock_transfers stock_transfers_transfer_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_transfer_no_key UNIQUE (transfer_no);


--
-- TOC entry 4886 (class 2606 OID 22270)
-- Name: doc_counters uq_counter_scope; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_counters
    ADD CONSTRAINT uq_counter_scope UNIQUE (company_id, scope_code, yymm);


--
-- TOC entry 4861 (class 2606 OID 18428)
-- Name: distributor_products uq_dist_product; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distributor_products
    ADD CONSTRAINT uq_dist_product UNIQUE (distributor_id, product_id);


--
-- TOC entry 4731 (class 2606 OID 17894)
-- Name: districts uq_district_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.districts
    ADD CONSTRAINT uq_district_code UNIQUE (state_id, district_code);


--
-- TOC entry 4925 (class 2606 OID 22803)
-- Name: documents uq_document_no; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT uq_document_no UNIQUE (company_id, doc_no);


--
-- TOC entry 4776 (class 2606 OID 18040)
-- Name: product_groups uq_group_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_groups
    ADD CONSTRAINT uq_group_code UNIQUE (category_id, group_code);


--
-- TOC entry 4904 (class 2606 OID 22643)
-- Name: orders uq_order_no; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT uq_order_no UNIQUE (company_id, order_no);


--
-- TOC entry 4913 (class 2606 OID 22703)
-- Name: order_items uq_order_variant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT uq_order_variant UNIQUE (order_id, variant_id);


--
-- TOC entry 4821 (class 2606 OID 18254)
-- Name: product_skus uq_org_variant_sku; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_skus
    ADD CONSTRAINT uq_org_variant_sku UNIQUE (organization_id, variant_id, sku_type, package_type);


--
-- TOC entry 4831 (class 2606 OID 20323)
-- Name: product_pricing uq_pricing_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_pricing
    ADD CONSTRAINT uq_pricing_no_overlap EXCLUDE USING gist (variant_id WITH =, organization_id WITH =, price_tier WITH =, daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]'::text) WITH &&) WHERE ((is_active = true));


--
-- TOC entry 4811 (class 2606 OID 18224)
-- Name: product_variants uq_product_variant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT uq_product_variant UNIQUE (product_id, variant_code);


--
-- TOC entry 4872 (class 2606 OID 18465)
-- Name: shop_distributors uq_shop_distributor; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_distributors
    ADD CONSTRAINT uq_shop_distributor UNIQUE (shop_id, distributor_id);


--
-- TOC entry 4725 (class 2606 OID 17875)
-- Name: states uq_state_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.states
    ADD CONSTRAINT uq_state_code UNIQUE (country_code, state_code);


--
-- TOC entry 4782 (class 2606 OID 18061)
-- Name: product_subgroups uq_subgroup_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_subgroups
    ADD CONSTRAINT uq_subgroup_code UNIQUE (group_id, subgroup_code);


--
-- TOC entry 4840 (class 2606 OID 18330)
-- Name: product_inventory uq_variant_org; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_inventory
    ADD CONSTRAINT uq_variant_org UNIQUE (variant_id, organization_id);


--
-- TOC entry 4705 (class 2606 OID 17753)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 4707 (class 2606 OID 17751)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 4639 (class 2606 OID 20802)
-- Name: distributor_products valid_order_quantities; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.distributor_products
    ADD CONSTRAINT valid_order_quantities CHECK (((max_order_quantity IS NULL) OR (max_order_quantity >= min_order_quantity))) NOT VALID;


--
-- TOC entry 5748 (class 0 OID 0)
-- Dependencies: 4639
-- Name: CONSTRAINT valid_order_quantities ON distributor_products; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT valid_order_quantities ON public.distributor_products IS 'Ensures max order quantity is not less than min order quantity';


--
-- TOC entry 4630 (class 2606 OID 20804)
-- Name: product_pricing valid_pricing_amounts; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.product_pricing
    ADD CONSTRAINT valid_pricing_amounts CHECK (((unit_price > (0)::numeric) AND ((case_price IS NULL) OR (case_price >= unit_price)))) NOT VALID;


--
-- TOC entry 4633 (class 2606 OID 20803)
-- Name: product_inventory valid_reorder_point; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.product_inventory
    ADD CONSTRAINT valid_reorder_point CHECK (((reorder_point >= 0) AND (reorder_quantity > 0))) NOT VALID;


--
-- TOC entry 4693 (class 2606 OID 17408)
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- TOC entry 4671 (class 2606 OID 16554)
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- TOC entry 4681 (class 2606 OID 16595)
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- TOC entry 4683 (class 2606 OID 16593)
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- TOC entry 4679 (class 2606 OID 16571)
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- TOC entry 4691 (class 2606 OID 17319)
-- Name: prefixes prefixes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.prefixes
    ADD CONSTRAINT prefixes_pkey PRIMARY KEY (bucket_id, level, name);


--
-- TOC entry 4688 (class 2606 OID 17279)
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- TOC entry 4686 (class 2606 OID 17264)
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- TOC entry 4846 (class 1259 OID 18409)
-- Name: idx_attributes_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attributes_name ON public.product_attributes USING btree (attribute_name);


--
-- TOC entry 4847 (class 1259 OID 18407)
-- Name: idx_attributes_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attributes_product ON public.product_attributes USING btree (product_id);


--
-- TOC entry 4848 (class 1259 OID 18410)
-- Name: idx_attributes_searchable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attributes_searchable ON public.product_attributes USING btree (attribute_name, attribute_value) WHERE (is_searchable = true);


--
-- TOC entry 4849 (class 1259 OID 18408)
-- Name: idx_attributes_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attributes_variant ON public.product_attributes USING btree (variant_id);


--
-- TOC entry 4710 (class 1259 OID 17785)
-- Name: idx_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_created ON public.audit_logs USING btree (created_at DESC);


--
-- TOC entry 4711 (class 1259 OID 20410)
-- Name: idx_audit_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_created_at ON public.audit_logs USING btree (created_at);


--
-- TOC entry 4712 (class 1259 OID 17784)
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_entity ON public.audit_logs USING btree (entity_type, entity_id, created_at DESC);


--
-- TOC entry 4713 (class 1259 OID 17783)
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user ON public.audit_logs USING btree (user_id, created_at DESC);


--
-- TOC entry 4765 (class 1259 OID 18026)
-- Name: idx_brands_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brands_active ON public.brands USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 4766 (class 1259 OID 18024)
-- Name: idx_brands_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brands_code ON public.brands USING btree (brand_code);


--
-- TOC entry 4767 (class 1259 OID 20400)
-- Name: idx_brands_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brands_created_by ON public.brands USING btree (created_by);


--
-- TOC entry 4768 (class 1259 OID 20856)
-- Name: idx_brands_name_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brands_name_fts ON public.brands USING gin (to_tsvector('english'::regconfig, COALESCE(brand_name, ''::text)));


--
-- TOC entry 4769 (class 1259 OID 20408)
-- Name: idx_brands_name_pattern; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brands_name_pattern ON public.brands USING btree (brand_name_search text_pattern_ops);


--
-- TOC entry 4770 (class 1259 OID 18025)
-- Name: idx_brands_name_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brands_name_search ON public.brands USING btree (brand_name_search);


--
-- TOC entry 4752 (class 1259 OID 18004)
-- Name: idx_categories_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_active ON public.product_categories USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 4753 (class 1259 OID 18001)
-- Name: idx_categories_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_code ON public.product_categories USING btree (category_code);


--
-- TOC entry 4754 (class 1259 OID 20401)
-- Name: idx_categories_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_created_by ON public.product_categories USING btree (created_by);


--
-- TOC entry 4755 (class 1259 OID 18002)
-- Name: idx_categories_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_parent ON public.product_categories USING btree (parent_category_id);


--
-- TOC entry 4756 (class 1259 OID 18003)
-- Name: idx_categories_vape; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_vape ON public.product_categories USING btree (is_vape, is_active);


--
-- TOC entry 5002 (class 1259 OID 26848)
-- Name: idx_consumer_activations_activated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumer_activations_activated_at ON public.consumer_activations USING btree (activated_at DESC);


--
-- TOC entry 5003 (class 1259 OID 26846)
-- Name: idx_consumer_activations_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumer_activations_company ON public.consumer_activations USING btree (company_id);


--
-- TOC entry 5004 (class 1259 OID 26847)
-- Name: idx_consumer_activations_consumer_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumer_activations_consumer_phone ON public.consumer_activations USING btree (consumer_phone);


--
-- TOC entry 5005 (class 1259 OID 26845)
-- Name: idx_consumer_activations_qr_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumer_activations_qr_code ON public.consumer_activations USING btree (qr_code_id);


--
-- TOC entry 4884 (class 1259 OID 22276)
-- Name: idx_counters_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_counters_lookup ON public.doc_counters USING btree (company_id, scope_code, yymm);


--
-- TOC entry 4854 (class 1259 OID 18446)
-- Name: idx_dist_products_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dist_products_active ON public.distributor_products USING btree (distributor_id, is_active) WHERE (is_active = true);


--
-- TOC entry 4855 (class 1259 OID 20402)
-- Name: idx_dist_products_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dist_products_created_by ON public.distributor_products USING btree (created_by);


--
-- TOC entry 4856 (class 1259 OID 18444)
-- Name: idx_dist_products_distributor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dist_products_distributor ON public.distributor_products USING btree (distributor_id);


--
-- TOC entry 4857 (class 1259 OID 18445)
-- Name: idx_dist_products_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dist_products_product ON public.distributor_products USING btree (product_id);


--
-- TOC entry 4858 (class 1259 OID 18447)
-- Name: idx_dist_products_territory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dist_products_territory ON public.distributor_products USING gin (territory_coverage) WHERE (is_active = true);


--
-- TOC entry 4859 (class 1259 OID 33355)
-- Name: idx_distributor_products_distributor_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_distributor_products_distributor_active ON public.distributor_products USING btree (distributor_id, product_id) WHERE (is_active = true);


--
-- TOC entry 4728 (class 1259 OID 17901)
-- Name: idx_districts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_districts_active ON public.districts USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 4729 (class 1259 OID 17900)
-- Name: idx_districts_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_districts_state ON public.districts USING btree (state_id);


--
-- TOC entry 4928 (class 1259 OID 22858)
-- Name: idx_doc_files_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_files_company ON public.document_files USING btree (company_id);


--
-- TOC entry 4929 (class 1259 OID 22857)
-- Name: idx_doc_files_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_files_document ON public.document_files USING btree (document_id);


--
-- TOC entry 4930 (class 1259 OID 22859)
-- Name: idx_doc_files_uploaded_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_files_uploaded_by ON public.document_files USING btree (uploaded_by);


--
-- TOC entry 4916 (class 1259 OID 22832)
-- Name: idx_documents_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_company ON public.documents USING btree (company_id);


--
-- TOC entry 4917 (class 1259 OID 22835)
-- Name: idx_documents_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_created_at ON public.documents USING btree (created_at DESC);


--
-- TOC entry 4918 (class 1259 OID 22833)
-- Name: idx_documents_issued_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_issued_by ON public.documents USING btree (issued_by_org_id);


--
-- TOC entry 4919 (class 1259 OID 22834)
-- Name: idx_documents_issued_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_issued_to ON public.documents USING btree (issued_to_org_id);


--
-- TOC entry 4920 (class 1259 OID 22829)
-- Name: idx_documents_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_order ON public.documents USING btree (order_id);


--
-- TOC entry 4921 (class 1259 OID 22836)
-- Name: idx_documents_order_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_order_type ON public.documents USING btree (order_id, doc_type);


--
-- TOC entry 4922 (class 1259 OID 22831)
-- Name: idx_documents_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_status ON public.documents USING btree (status);


--
-- TOC entry 4923 (class 1259 OID 22830)
-- Name: idx_documents_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_type ON public.documents USING btree (doc_type);


--
-- TOC entry 4771 (class 1259 OID 18047)
-- Name: idx_groups_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_active ON public.product_groups USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 4772 (class 1259 OID 18046)
-- Name: idx_groups_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_category ON public.product_groups USING btree (category_id);


--
-- TOC entry 4841 (class 1259 OID 18381)
-- Name: idx_images_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_images_primary ON public.product_images USING btree (product_id, is_primary) WHERE (is_primary = true);


--
-- TOC entry 4842 (class 1259 OID 18379)
-- Name: idx_images_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_images_product ON public.product_images USING btree (product_id);


--
-- TOC entry 4843 (class 1259 OID 18380)
-- Name: idx_images_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_images_variant ON public.product_images USING btree (variant_id);


--
-- TOC entry 4832 (class 1259 OID 20850)
-- Name: idx_inventory_available_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_available_stock ON public.product_inventory USING btree (organization_id, variant_id) WHERE ((is_active = true) AND (quantity_available > 0));


--
-- TOC entry 4833 (class 1259 OID 20405)
-- Name: idx_inventory_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_lookup ON public.product_inventory USING btree (variant_id, organization_id, is_active) WHERE (quantity_available > 0);


--
-- TOC entry 4834 (class 1259 OID 18348)
-- Name: idx_inventory_low_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_low_stock ON public.product_inventory USING btree (organization_id) WHERE ((quantity_available <= reorder_point) AND (is_active = true));


--
-- TOC entry 4835 (class 1259 OID 18347)
-- Name: idx_inventory_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_org ON public.product_inventory USING btree (organization_id);


--
-- TOC entry 4836 (class 1259 OID 18346)
-- Name: idx_inventory_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_variant ON public.product_inventory USING btree (variant_id);


--
-- TOC entry 4982 (class 1259 OID 26779)
-- Name: idx_lucky_draw_campaigns_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lucky_draw_campaigns_company ON public.lucky_draw_campaigns USING btree (company_id);


--
-- TOC entry 4983 (class 1259 OID 26781)
-- Name: idx_lucky_draw_campaigns_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lucky_draw_campaigns_dates ON public.lucky_draw_campaigns USING btree (start_date, end_date);


--
-- TOC entry 4984 (class 1259 OID 26780)
-- Name: idx_lucky_draw_campaigns_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lucky_draw_campaigns_status ON public.lucky_draw_campaigns USING btree (status);


--
-- TOC entry 4989 (class 1259 OID 26811)
-- Name: idx_lucky_draw_entries_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lucky_draw_entries_campaign ON public.lucky_draw_entries USING btree (campaign_id);


--
-- TOC entry 4990 (class 1259 OID 26812)
-- Name: idx_lucky_draw_entries_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lucky_draw_entries_company ON public.lucky_draw_entries USING btree (company_id);


--
-- TOC entry 4991 (class 1259 OID 26813)
-- Name: idx_lucky_draw_entries_consumer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lucky_draw_entries_consumer ON public.lucky_draw_entries USING btree (consumer_phone);


--
-- TOC entry 4992 (class 1259 OID 26814)
-- Name: idx_lucky_draw_entries_qr_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lucky_draw_entries_qr_code ON public.lucky_draw_entries USING btree (qr_code_id);


--
-- TOC entry 4993 (class 1259 OID 26815)
-- Name: idx_lucky_draw_entries_winners; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lucky_draw_entries_winners ON public.lucky_draw_entries USING btree (campaign_id, is_winner);


--
-- TOC entry 4874 (class 1259 OID 20605)
-- Name: idx_mv_product_catalog_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_product_catalog_active ON public.mv_product_catalog USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 4875 (class 1259 OID 20606)
-- Name: idx_mv_product_catalog_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_product_catalog_brand ON public.mv_product_catalog USING btree (brand_name);


--
-- TOC entry 4876 (class 1259 OID 20607)
-- Name: idx_mv_product_catalog_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_product_catalog_category ON public.mv_product_catalog USING btree (category_name);


--
-- TOC entry 4877 (class 1259 OID 20604)
-- Name: idx_mv_product_catalog_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_product_catalog_id ON public.mv_product_catalog USING btree (id);


--
-- TOC entry 4878 (class 1259 OID 20622)
-- Name: idx_mv_shop_products_dist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_shop_products_dist ON public.mv_shop_available_products USING btree (distributor_id);


--
-- TOC entry 4879 (class 1259 OID 20624)
-- Name: idx_mv_shop_products_in_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_shop_products_in_stock ON public.mv_shop_available_products USING btree (shop_id, in_stock) WHERE (in_stock = true);


--
-- TOC entry 4880 (class 1259 OID 20623)
-- Name: idx_mv_shop_products_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_shop_products_product ON public.mv_shop_available_products USING btree (product_id);


--
-- TOC entry 4881 (class 1259 OID 20621)
-- Name: idx_mv_shop_products_shop; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_shop_products_shop ON public.mv_shop_available_products USING btree (shop_id, is_available);


--
-- TOC entry 5082 (class 1259 OID 35261)
-- Name: idx_notif_logs_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_logs_event ON public.notification_logs USING btree (event_code, created_at DESC);


--
-- TOC entry 5083 (class 1259 OID 35259)
-- Name: idx_notif_logs_org_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_logs_org_created ON public.notification_logs USING btree (org_id, created_at DESC);


--
-- TOC entry 5084 (class 1259 OID 35262)
-- Name: idx_notif_logs_provider_msg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_logs_provider_msg ON public.notification_logs USING btree (provider_message_id) WHERE (provider_message_id IS NOT NULL);


--
-- TOC entry 5085 (class 1259 OID 35260)
-- Name: idx_notif_logs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_logs_status ON public.notification_logs USING btree (status, created_at DESC);


--
-- TOC entry 5053 (class 1259 OID 35258)
-- Name: idx_notif_outbox_event_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_outbox_event_code ON public.notifications_outbox USING btree (event_code);


--
-- TOC entry 5054 (class 1259 OID 35256)
-- Name: idx_notif_outbox_next_retry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_outbox_next_retry ON public.notifications_outbox USING btree (next_retry_at) WHERE ((status = 'failed'::text) AND (retry_count < max_retries));


--
-- TOC entry 5055 (class 1259 OID 35257)
-- Name: idx_notif_outbox_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_outbox_scheduled ON public.notifications_outbox USING btree (scheduled_for) WHERE (status = 'scheduled'::text);


--
-- TOC entry 5056 (class 1259 OID 35255)
-- Name: idx_notif_outbox_status_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_outbox_status_priority ON public.notifications_outbox USING btree (status, priority DESC, created_at);


--
-- TOC entry 5071 (class 1259 OID 35265)
-- Name: idx_notif_provider_org_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_provider_org_channel ON public.notification_provider_configs USING btree (org_id, channel, is_active);


--
-- TOC entry 5076 (class 1259 OID 35264)
-- Name: idx_notif_settings_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_settings_enabled ON public.notification_settings USING btree (enabled) WHERE (enabled = true);


--
-- TOC entry 5077 (class 1259 OID 35263)
-- Name: idx_notif_settings_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_settings_org ON public.notification_settings USING btree (org_id);


--
-- TOC entry 4905 (class 1259 OID 22722)
-- Name: idx_order_items_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_company ON public.order_items USING btree (company_id);


--
-- TOC entry 4906 (class 1259 OID 22719)
-- Name: idx_order_items_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order ON public.order_items USING btree (order_id);


--
-- TOC entry 4907 (class 1259 OID 22723)
-- Name: idx_order_items_order_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_variant ON public.order_items USING btree (order_id, variant_id);


--
-- TOC entry 4908 (class 1259 OID 22720)
-- Name: idx_order_items_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_product ON public.order_items USING btree (product_id);


--
-- TOC entry 4909 (class 1259 OID 22721)
-- Name: idx_order_items_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_variant ON public.order_items USING btree (variant_id);


--
-- TOC entry 4887 (class 1259 OID 22686)
-- Name: idx_orders_approved_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_approved_by ON public.orders USING btree (approved_by);


--
-- TOC entry 4888 (class 1259 OID 22680)
-- Name: idx_orders_buyer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_buyer ON public.orders USING btree (buyer_org_id);


--
-- TOC entry 4889 (class 1259 OID 33358)
-- Name: idx_orders_buyer_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_buyer_org ON public.orders USING btree (buyer_org_id);


--
-- TOC entry 4890 (class 1259 OID 22689)
-- Name: idx_orders_buyer_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_buyer_status ON public.orders USING btree (buyer_org_id, status);


--
-- TOC entry 4891 (class 1259 OID 22679)
-- Name: idx_orders_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_company ON public.orders USING btree (company_id);


--
-- TOC entry 4892 (class 1259 OID 22688)
-- Name: idx_orders_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_company_status ON public.orders USING btree (company_id, status);


--
-- TOC entry 4893 (class 1259 OID 22687)
-- Name: idx_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at DESC);


--
-- TOC entry 4894 (class 1259 OID 22685)
-- Name: idx_orders_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_by ON public.orders USING btree (created_by);


--
-- TOC entry 4895 (class 1259 OID 22682)
-- Name: idx_orders_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_parent ON public.orders USING btree (parent_order_id);


--
-- TOC entry 4896 (class 1259 OID 22690)
-- Name: idx_orders_parent_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_parent_status ON public.orders USING btree (parent_order_id, status) WHERE (parent_order_id IS NOT NULL);


--
-- TOC entry 4897 (class 1259 OID 22681)
-- Name: idx_orders_seller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_seller ON public.orders USING btree (seller_org_id);


--
-- TOC entry 4898 (class 1259 OID 33359)
-- Name: idx_orders_seller_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_seller_org ON public.orders USING btree (seller_org_id);


--
-- TOC entry 4899 (class 1259 OID 22683)
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- TOC entry 4900 (class 1259 OID 22684)
-- Name: idx_orders_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_type ON public.orders USING btree (order_type);


--
-- TOC entry 4736 (class 1259 OID 33356)
-- Name: idx_organizations_parent_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organizations_parent_active ON public.organizations USING btree (parent_org_id, org_type_code) WHERE (is_active = true);


--
-- TOC entry 4737 (class 1259 OID 17968)
-- Name: idx_orgs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_active ON public.organizations USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 4738 (class 1259 OID 17965)
-- Name: idx_orgs_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_code ON public.organizations USING btree (org_code);


--
-- TOC entry 4739 (class 1259 OID 21275)
-- Name: idx_orgs_contact_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_contact_email ON public.organizations USING btree (contact_email) WHERE (contact_email IS NOT NULL);


--
-- TOC entry 4740 (class 1259 OID 21274)
-- Name: idx_orgs_contact_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_contact_name ON public.organizations USING btree (contact_name) WHERE (contact_name IS NOT NULL);


--
-- TOC entry 4741 (class 1259 OID 20857)
-- Name: idx_orgs_name_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_name_fts ON public.organizations USING gin (to_tsvector('english'::regconfig, COALESCE(org_name, ''::text)));


--
-- TOC entry 4742 (class 1259 OID 20409)
-- Name: idx_orgs_name_pattern; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_name_pattern ON public.organizations USING btree (org_name_search text_pattern_ops);


--
-- TOC entry 4743 (class 1259 OID 17966)
-- Name: idx_orgs_name_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_name_search ON public.organizations USING btree (org_name_search);


--
-- TOC entry 4744 (class 1259 OID 17964)
-- Name: idx_orgs_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_parent ON public.organizations USING btree (parent_org_id);


--
-- TOC entry 4745 (class 1259 OID 20854)
-- Name: idx_orgs_settings_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_settings_gin ON public.organizations USING gin (settings);


--
-- TOC entry 4746 (class 1259 OID 17967)
-- Name: idx_orgs_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_state ON public.organizations USING btree (state_id);


--
-- TOC entry 4747 (class 1259 OID 17963)
-- Name: idx_orgs_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_type ON public.organizations USING btree (org_type_code);


--
-- TOC entry 5006 (class 1259 OID 26875)
-- Name: idx_points_transactions_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_transactions_company ON public.points_transactions USING btree (company_id);


--
-- TOC entry 5007 (class 1259 OID 26876)
-- Name: idx_points_transactions_consumer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_transactions_consumer ON public.points_transactions USING btree (consumer_phone);


--
-- TOC entry 5008 (class 1259 OID 26878)
-- Name: idx_points_transactions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_transactions_date ON public.points_transactions USING btree (transaction_date DESC);


--
-- TOC entry 5009 (class 1259 OID 26877)
-- Name: idx_points_transactions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_transactions_type ON public.points_transactions USING btree (transaction_type);


--
-- TOC entry 4822 (class 1259 OID 20851)
-- Name: idx_pricing_current_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_current_active ON public.product_pricing USING btree (variant_id, organization_id, price_tier, is_active, effective_from, COALESCE(effective_to, 'infinity'::date));


--
-- TOC entry 4823 (class 1259 OID 18308)
-- Name: idx_pricing_effective; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_effective ON public.product_pricing USING btree (effective_from, effective_to) WHERE (is_active = true);


--
-- TOC entry 4824 (class 1259 OID 20404)
-- Name: idx_pricing_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_lookup ON public.product_pricing USING btree (variant_id, organization_id, is_active, effective_from, effective_to);


--
-- TOC entry 4825 (class 1259 OID 18306)
-- Name: idx_pricing_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_org ON public.product_pricing USING btree (organization_id);


--
-- TOC entry 4826 (class 1259 OID 18307)
-- Name: idx_pricing_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_tier ON public.product_pricing USING btree (price_tier, is_active);


--
-- TOC entry 4827 (class 1259 OID 18305)
-- Name: idx_pricing_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_variant ON public.product_pricing USING btree (variant_id);


--
-- TOC entry 4798 (class 1259 OID 30790)
-- Name: idx_product_variants_image_url; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_image_url ON public.product_variants USING btree (image_url) WHERE (image_url IS NOT NULL);


--
-- TOC entry 5749 (class 0 OID 0)
-- Dependencies: 4798
-- Name: INDEX idx_product_variants_image_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_product_variants_image_url IS 'Index for product variants with images for faster filtering';


--
-- TOC entry 4783 (class 1259 OID 18204)
-- Name: idx_products_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_active ON public.products USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 4784 (class 1259 OID 18202)
-- Name: idx_products_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_brand ON public.products USING btree (brand_id);


--
-- TOC entry 4785 (class 1259 OID 18201)
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category ON public.products USING btree (category_id);


--
-- TOC entry 4786 (class 1259 OID 18199)
-- Name: idx_products_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_code ON public.products USING btree (product_code);


--
-- TOC entry 4787 (class 1259 OID 18200)
-- Name: idx_products_manufacturer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_manufacturer ON public.products USING btree (manufacturer_id);


--
-- TOC entry 4788 (class 1259 OID 33354)
-- Name: idx_products_manufacturer_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_manufacturer_active ON public.products USING btree (manufacturer_id) WHERE (is_active = true);


--
-- TOC entry 4789 (class 1259 OID 20855)
-- Name: idx_products_name_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_name_fts ON public.products USING gin (to_tsvector('english'::regconfig, COALESCE(product_name, ''::text)));


--
-- TOC entry 4790 (class 1259 OID 20407)
-- Name: idx_products_name_pattern; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_name_pattern ON public.products USING btree (product_name_search text_pattern_ops);


--
-- TOC entry 4791 (class 1259 OID 18205)
-- Name: idx_products_name_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_name_search ON public.products USING btree (product_name_search);


--
-- TOC entry 4792 (class 1259 OID 20852)
-- Name: idx_products_regulatory_info_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_regulatory_info_gin ON public.products USING gin (regulatory_info);


--
-- TOC entry 4793 (class 1259 OID 18203)
-- Name: idx_products_vape; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_vape ON public.products USING btree (is_vape, is_active);


--
-- TOC entry 4931 (class 1259 OID 26522)
-- Name: idx_qr_batches_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_batches_company ON public.qr_batches USING btree (company_id);


--
-- TOC entry 4932 (class 1259 OID 26521)
-- Name: idx_qr_batches_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_batches_order ON public.qr_batches USING btree (order_id);


--
-- TOC entry 4933 (class 1259 OID 26523)
-- Name: idx_qr_batches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_batches_status ON public.qr_batches USING btree (status);


--
-- TOC entry 4950 (class 1259 OID 26666)
-- Name: idx_qr_codes_activation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_codes_activation ON public.qr_codes USING btree (activated_at) WHERE (activated_at IS NOT NULL);


--
-- TOC entry 4951 (class 1259 OID 26657)
-- Name: idx_qr_codes_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_codes_batch ON public.qr_codes USING btree (batch_id);


--
-- TOC entry 4952 (class 1259 OID 26660)
-- Name: idx_qr_codes_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_codes_code ON public.qr_codes USING btree (code);


--
-- TOC entry 4953 (class 1259 OID 26659)
-- Name: idx_qr_codes_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_codes_company ON public.qr_codes USING btree (company_id);


--
-- TOC entry 4954 (class 1259 OID 26665)
-- Name: idx_qr_codes_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_codes_location ON public.qr_codes USING btree (current_location_org_id);


--
-- TOC entry 4955 (class 1259 OID 26658)
-- Name: idx_qr_codes_master; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_codes_master ON public.qr_codes USING btree (master_code_id);


--
-- TOC entry 4956 (class 1259 OID 26661)
-- Name: idx_qr_codes_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_codes_order ON public.qr_codes USING btree (order_id);


--
-- TOC entry 4957 (class 1259 OID 26662)
-- Name: idx_qr_codes_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_codes_product ON public.qr_codes USING btree (product_id);


--
-- TOC entry 4958 (class 1259 OID 26664)
-- Name: idx_qr_codes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_codes_status ON public.qr_codes USING btree (status);


--
-- TOC entry 4959 (class 1259 OID 26663)
-- Name: idx_qr_codes_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_codes_variant ON public.qr_codes USING btree (variant_id);


--
-- TOC entry 4938 (class 1259 OID 26586)
-- Name: idx_qr_master_codes_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_master_codes_batch ON public.qr_master_codes USING btree (batch_id);


--
-- TOC entry 4939 (class 1259 OID 26587)
-- Name: idx_qr_master_codes_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_master_codes_company ON public.qr_master_codes USING btree (company_id);


--
-- TOC entry 4940 (class 1259 OID 26591)
-- Name: idx_qr_master_codes_distributor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_master_codes_distributor ON public.qr_master_codes USING btree (shipped_to_distributor_id);


--
-- TOC entry 4941 (class 1259 OID 26589)
-- Name: idx_qr_master_codes_master_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_master_codes_master_code ON public.qr_master_codes USING btree (master_code);


--
-- TOC entry 4942 (class 1259 OID 26588)
-- Name: idx_qr_master_codes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_master_codes_status ON public.qr_master_codes USING btree (status);


--
-- TOC entry 4943 (class 1259 OID 26590)
-- Name: idx_qr_master_codes_warehouse; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_master_codes_warehouse ON public.qr_master_codes USING btree (warehouse_org_id, status);


--
-- TOC entry 4966 (class 1259 OID 26713)
-- Name: idx_qr_movements_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_movements_company ON public.qr_movements USING btree (company_id);


--
-- TOC entry 4967 (class 1259 OID 26717)
-- Name: idx_qr_movements_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_movements_from ON public.qr_movements USING btree (from_org_id);


--
-- TOC entry 4968 (class 1259 OID 26715)
-- Name: idx_qr_movements_master; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_movements_master ON public.qr_movements USING btree (qr_master_code_id);


--
-- TOC entry 4969 (class 1259 OID 26714)
-- Name: idx_qr_movements_qr_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_movements_qr_code ON public.qr_movements USING btree (qr_code_id);


--
-- TOC entry 4970 (class 1259 OID 26719)
-- Name: idx_qr_movements_scanned_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_movements_scanned_at ON public.qr_movements USING btree (scanned_at DESC);


--
-- TOC entry 4971 (class 1259 OID 26718)
-- Name: idx_qr_movements_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_movements_to ON public.qr_movements USING btree (to_org_id);


--
-- TOC entry 4972 (class 1259 OID 26716)
-- Name: idx_qr_movements_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_movements_type ON public.qr_movements USING btree (movement_type);


--
-- TOC entry 5012 (class 1259 OID 26927)
-- Name: idx_qr_validation_reports_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_validation_reports_company ON public.qr_validation_reports USING btree (company_id);


--
-- TOC entry 5013 (class 1259 OID 26929)
-- Name: idx_qr_validation_reports_distributor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_validation_reports_distributor ON public.qr_validation_reports USING btree (distributor_org_id);


--
-- TOC entry 5014 (class 1259 OID 26930)
-- Name: idx_qr_validation_reports_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_validation_reports_order ON public.qr_validation_reports USING btree (destination_order_id);


--
-- TOC entry 5015 (class 1259 OID 26931)
-- Name: idx_qr_validation_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_validation_reports_status ON public.qr_validation_reports USING btree (validation_status);


--
-- TOC entry 5016 (class 1259 OID 26928)
-- Name: idx_qr_validation_reports_warehouse; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_validation_reports_warehouse ON public.qr_validation_reports USING btree (warehouse_org_id);


--
-- TOC entry 4975 (class 1259 OID 26746)
-- Name: idx_redeem_items_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_redeem_items_active ON public.redeem_items USING btree (is_active, valid_from, valid_until);


--
-- TOC entry 4976 (class 1259 OID 26745)
-- Name: idx_redeem_items_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_redeem_items_company ON public.redeem_items USING btree (company_id);


--
-- TOC entry 4977 (class 1259 OID 26747)
-- Name: idx_redeem_items_points; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_redeem_items_points ON public.redeem_items USING btree (points_required);


--
-- TOC entry 4714 (class 1259 OID 17862)
-- Name: idx_regions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_regions_active ON public.regions USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 4715 (class 1259 OID 17861)
-- Name: idx_regions_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_regions_code ON public.regions USING btree (region_code);


--
-- TOC entry 4862 (class 1259 OID 18483)
-- Name: idx_shop_dist_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shop_dist_active ON public.shop_distributors USING btree (shop_id, is_active) WHERE (is_active = true);


--
-- TOC entry 4863 (class 1259 OID 20403)
-- Name: idx_shop_dist_approved_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shop_dist_approved_by ON public.shop_distributors USING btree (approved_by);


--
-- TOC entry 4864 (class 1259 OID 18482)
-- Name: idx_shop_dist_distributor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shop_dist_distributor ON public.shop_distributors USING btree (distributor_id);


--
-- TOC entry 4865 (class 1259 OID 18484)
-- Name: idx_shop_dist_preferred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shop_dist_preferred ON public.shop_distributors USING btree (shop_id, is_preferred) WHERE (is_preferred = true);


--
-- TOC entry 4866 (class 1259 OID 18481)
-- Name: idx_shop_dist_shop; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shop_dist_shop ON public.shop_distributors USING btree (shop_id);


--
-- TOC entry 4867 (class 1259 OID 33353)
-- Name: idx_shop_distributors_distributor_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shop_distributors_distributor_active ON public.shop_distributors USING btree (distributor_id) WHERE (is_active = true);


--
-- TOC entry 4868 (class 1259 OID 33352)
-- Name: idx_shop_distributors_shop_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shop_distributors_shop_active ON public.shop_distributors USING btree (shop_id) WHERE (is_active = true);


--
-- TOC entry 4812 (class 1259 OID 18268)
-- Name: idx_skus_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skus_active ON public.product_skus USING btree (variant_id, is_active) WHERE (is_active = true);


--
-- TOC entry 4813 (class 1259 OID 18267)
-- Name: idx_skus_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skus_code ON public.product_skus USING btree (sku_code);


--
-- TOC entry 4814 (class 1259 OID 18266)
-- Name: idx_skus_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skus_org ON public.product_skus USING btree (organization_id);


--
-- TOC entry 4815 (class 1259 OID 18265)
-- Name: idx_skus_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skus_variant ON public.product_skus USING btree (variant_id);


--
-- TOC entry 4720 (class 1259 OID 17882)
-- Name: idx_states_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_states_active ON public.states USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 4721 (class 1259 OID 17881)
-- Name: idx_states_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_states_region ON public.states USING btree (region_id);


--
-- TOC entry 5088 (class 1259 OID 35455)
-- Name: idx_stock_movements_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_movements_company ON public.stock_movements USING btree (company_id);


--
-- TOC entry 5089 (class 1259 OID 35456)
-- Name: idx_stock_movements_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_movements_created_at ON public.stock_movements USING btree (created_at DESC);


--
-- TOC entry 5090 (class 1259 OID 35451)
-- Name: idx_stock_movements_from_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_movements_from_org ON public.stock_movements USING btree (from_organization_id);


--
-- TOC entry 5091 (class 1259 OID 35457)
-- Name: idx_stock_movements_manufacturer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_movements_manufacturer ON public.stock_movements USING btree (manufacturer_id) WHERE (manufacturer_id IS NOT NULL);


--
-- TOC entry 5092 (class 1259 OID 35454)
-- Name: idx_stock_movements_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_movements_reference ON public.stock_movements USING btree (reference_type, reference_id);


--
-- TOC entry 5093 (class 1259 OID 35452)
-- Name: idx_stock_movements_to_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_movements_to_org ON public.stock_movements USING btree (to_organization_id);


--
-- TOC entry 5094 (class 1259 OID 35453)
-- Name: idx_stock_movements_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_movements_type ON public.stock_movements USING btree (movement_type);


--
-- TOC entry 5095 (class 1259 OID 35450)
-- Name: idx_stock_movements_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_movements_variant ON public.stock_movements USING btree (variant_id);


--
-- TOC entry 5102 (class 1259 OID 35523)
-- Name: idx_stock_transfers_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_transfers_company ON public.stock_transfers USING btree (company_id);


--
-- TOC entry 5103 (class 1259 OID 35520)
-- Name: idx_stock_transfers_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_transfers_from ON public.stock_transfers USING btree (from_organization_id);


--
-- TOC entry 5104 (class 1259 OID 35522)
-- Name: idx_stock_transfers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_transfers_status ON public.stock_transfers USING btree (status);


--
-- TOC entry 5105 (class 1259 OID 35521)
-- Name: idx_stock_transfers_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_transfers_to ON public.stock_transfers USING btree (to_organization_id);


--
-- TOC entry 5106 (class 1259 OID 35524)
-- Name: idx_stock_transfers_transfer_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_transfers_transfer_no ON public.stock_transfers USING btree (transfer_no);


--
-- TOC entry 4777 (class 1259 OID 18068)
-- Name: idx_subgroups_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subgroups_active ON public.product_subgroups USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 4778 (class 1259 OID 18067)
-- Name: idx_subgroups_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subgroups_group ON public.product_subgroups USING btree (group_id);


--
-- TOC entry 4699 (class 1259 OID 17767)
-- Name: idx_users_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_active ON public.users USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 4700 (class 1259 OID 17764)
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (lower(email));


--
-- TOC entry 4701 (class 1259 OID 17766)
-- Name: idx_users_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_org ON public.users USING btree (organization_id);


--
-- TOC entry 4702 (class 1259 OID 33357)
-- Name: idx_users_organization_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_organization_active ON public.users USING btree (organization_id) WHERE (is_active = true);


--
-- TOC entry 4703 (class 1259 OID 17765)
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role_code);


--
-- TOC entry 4799 (class 1259 OID 18232)
-- Name: idx_variants_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_active ON public.product_variants USING btree (product_id, is_active) WHERE (is_active = true);


--
-- TOC entry 4800 (class 1259 OID 18233)
-- Name: idx_variants_attributes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_attributes ON public.product_variants USING gin (attributes);


--
-- TOC entry 4801 (class 1259 OID 20853)
-- Name: idx_variants_attributes_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_attributes_gin ON public.product_variants USING gin (attributes);


--
-- TOC entry 4802 (class 1259 OID 18231)
-- Name: idx_variants_barcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_barcode ON public.product_variants USING btree (barcode) WHERE (barcode IS NOT NULL);


--
-- TOC entry 4803 (class 1259 OID 18230)
-- Name: idx_variants_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_product ON public.product_variants USING btree (product_id);


--
-- TOC entry 4804 (class 1259 OID 20406)
-- Name: idx_variants_product_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_product_active ON public.product_variants USING btree (product_id, is_active, is_default);


--
-- TOC entry 5023 (class 1259 OID 29982)
-- Name: jol_journey_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jol_journey_idx ON public.journey_order_links USING btree (journey_config_id);


--
-- TOC entry 5019 (class 1259 OID 29962)
-- Name: journey_configurations_org_default_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX journey_configurations_org_default_ux ON public.journey_configurations USING btree (org_id) WHERE (is_default = true);


--
-- TOC entry 5020 (class 1259 OID 29961)
-- Name: journey_configurations_org_name_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX journey_configurations_org_name_ux ON public.journey_configurations USING btree (org_id, name);


--
-- TOC entry 5033 (class 1259 OID 30162)
-- Name: ldol_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ldol_campaign_idx ON public.lucky_draw_order_links USING btree (campaign_id);


--
-- TOC entry 5057 (class 1259 OID 30388)
-- Name: notif_outbox_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notif_outbox_org_idx ON public.notifications_outbox USING btree (org_id);


--
-- TOC entry 5058 (class 1259 OID 30389)
-- Name: notif_outbox_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notif_outbox_status_idx ON public.notifications_outbox USING btree (status);


--
-- TOC entry 5063 (class 1259 OID 30547)
-- Name: otp_challenges_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX otp_challenges_org_created_idx ON public.otp_challenges USING btree (org_id, created_at);


--
-- TOC entry 5064 (class 1259 OID 30546)
-- Name: otp_challenges_phone_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX otp_challenges_phone_status_idx ON public.otp_challenges USING btree (phone, status);


--
-- TOC entry 5028 (class 1259 OID 30053)
-- Name: points_rules_journey_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX points_rules_journey_idx ON public.points_rules USING btree (journey_config_id);


--
-- TOC entry 5029 (class 1259 OID 30052)
-- Name: points_rules_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX points_rules_org_idx ON public.points_rules USING btree (org_id);


--
-- TOC entry 5032 (class 1259 OID 30054)
-- Name: points_rules_unique_active_per_journey_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX points_rules_unique_active_per_journey_ux ON public.points_rules USING btree (journey_config_id) WHERE ((is_active = true) AND (journey_config_id IS NOT NULL));


--
-- TOC entry 5042 (class 1259 OID 30298)
-- Name: redemption_orders_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redemption_orders_order_idx ON public.redemption_orders USING btree (order_id);


--
-- TOC entry 5045 (class 1259 OID 30299)
-- Name: redemption_orders_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redemption_orders_shop_idx ON public.redemption_orders USING btree (shop_org_id);


--
-- TOC entry 5046 (class 1259 OID 30297)
-- Name: redemption_orders_unique_qr_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX redemption_orders_unique_qr_ux ON public.redemption_orders USING btree (qr_code_id);


--
-- TOC entry 5038 (class 1259 OID 30254)
-- Name: redemption_policies_active_per_journey_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX redemption_policies_active_per_journey_ux ON public.redemption_policies USING btree (journey_config_id) WHERE ((is_active = true) AND (journey_config_id IS NOT NULL));


--
-- TOC entry 5039 (class 1259 OID 30255)
-- Name: redemption_policies_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redemption_policies_org_idx ON public.redemption_policies USING btree (org_id);


--
-- TOC entry 4809 (class 1259 OID 20320)
-- Name: uq_product_default_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_product_default_variant ON public.product_variants USING btree (product_id) WHERE (is_default = true);


--
-- TOC entry 4698 (class 1259 OID 23986)
-- Name: uq_roles_active_name_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_roles_active_name_lower ON public.roles USING btree (lower(role_name)) WHERE (is_active = true);


--
-- TOC entry 4873 (class 1259 OID 20321)
-- Name: uq_shop_preferred_distributor; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_shop_preferred_distributor ON public.shop_distributors USING btree (shop_id) WHERE (is_preferred = true);


--
-- TOC entry 4669 (class 1259 OID 16560)
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- TOC entry 4672 (class 1259 OID 16582)
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- TOC entry 4684 (class 1259 OID 17291)
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- TOC entry 4673 (class 1259 OID 17337)
-- Name: idx_name_bucket_level_unique; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX idx_name_bucket_level_unique ON storage.objects USING btree (name COLLATE "C", bucket_id, level);


--
-- TOC entry 4674 (class 1259 OID 17255)
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- TOC entry 4675 (class 1259 OID 17370)
-- Name: idx_objects_lower_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_lower_name ON storage.objects USING btree ((path_tokens[level]), lower(name) text_pattern_ops, bucket_id, level);


--
-- TOC entry 4689 (class 1259 OID 17371)
-- Name: idx_prefixes_lower_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_prefixes_lower_name ON storage.prefixes USING btree (bucket_id, level, ((string_to_array(name, '/'::text))[level]), lower(name) text_pattern_ops);


--
-- TOC entry 4676 (class 1259 OID 16583)
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- TOC entry 4677 (class 1259 OID 17369)
-- Name: objects_bucket_id_level_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX objects_bucket_id_level_idx ON storage.objects USING btree (bucket_id, level, name COLLATE "C");


--
-- TOC entry 5478 (class 2618 OID 23079)
-- Name: v_order_summary _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.v_order_summary AS
 SELECT o.id,
    o.order_no,
    o.order_type,
    o.status,
    buyer.org_name AS buyer_name,
    seller.org_name AS seller_name,
    count(DISTINCT oi.id) AS item_count,
    sum(oi.line_total) AS total_amount,
    o.parent_order_id,
    po.order_no AS parent_order_no,
    o.created_at,
    o.approved_at,
    creator.full_name AS created_by_name,
    approver.full_name AS approved_by_name
   FROM ((((((public.orders o
     LEFT JOIN public.organizations buyer ON ((buyer.id = o.buyer_org_id)))
     LEFT JOIN public.organizations seller ON ((seller.id = o.seller_org_id)))
     LEFT JOIN public.order_items oi ON ((oi.order_id = o.id)))
     LEFT JOIN public.orders po ON ((po.id = o.parent_order_id)))
     LEFT JOIN public.users creator ON ((creator.id = o.created_by)))
     LEFT JOIN public.users approver ON ((approver.id = o.approved_by)))
  GROUP BY o.id, buyer.org_name, seller.org_name, po.order_no, creator.full_name, approver.full_name;


--
-- TOC entry 5469 (class 2618 OID 18519)
-- Name: v_product_catalog _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.v_product_catalog AS
 SELECT p.id,
    p.product_code,
    p.product_name,
    p.is_vape,
    b.brand_name,
    c.category_name,
    g.group_name,
    sg.subgroup_name,
    m.org_name AS manufacturer_name,
    count(DISTINCT pv.id) AS variant_count,
    count(DISTINCT pi.id) AS image_count,
    p.is_active,
    p.is_discontinued,
    p.created_at
   FROM (((((((public.products p
     LEFT JOIN public.brands b ON ((b.id = p.brand_id)))
     LEFT JOIN public.product_categories c ON ((c.id = p.category_id)))
     LEFT JOIN public.product_groups g ON ((g.id = p.group_id)))
     LEFT JOIN public.product_subgroups sg ON ((sg.id = p.subgroup_id)))
     LEFT JOIN public.organizations m ON ((m.id = p.manufacturer_id)))
     LEFT JOIN public.product_variants pv ON (((pv.product_id = p.id) AND (pv.is_active = true))))
     LEFT JOIN public.product_images pi ON (((pi.product_id = p.id) AND (pi.is_active = true))))
  GROUP BY p.id, b.brand_name, c.category_name, g.group_name, sg.subgroup_name, m.org_name;


--
-- TOC entry 5294 (class 2620 OID 20671)
-- Name: product_inventory audit_inventory_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_inventory_trigger AFTER INSERT OR DELETE OR UPDATE ON public.product_inventory FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();


--
-- TOC entry 5292 (class 2620 OID 20670)
-- Name: product_pricing audit_pricing_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_pricing_trigger AFTER INSERT OR DELETE OR UPDATE ON public.product_pricing FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();


--
-- TOC entry 5287 (class 2620 OID 20669)
-- Name: products audit_products_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_products_trigger AFTER INSERT OR DELETE OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();


--
-- TOC entry 5297 (class 2620 OID 20551)
-- Name: distributor_products check_agreement_expiry_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_agreement_expiry_trigger BEFORE INSERT OR UPDATE ON public.distributor_products FOR EACH ROW EXECUTE FUNCTION public.check_agreement_expiry();


--
-- TOC entry 5307 (class 2620 OID 22860)
-- Name: documents documents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5280 (class 2620 OID 23261)
-- Name: organizations enforce_org_hierarchy; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_org_hierarchy BEFORE INSERT OR UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.validate_org_hierarchy();


--
-- TOC entry 5305 (class 2620 OID 22727)
-- Name: order_items order_items_before_insert_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_items_before_insert_trigger BEFORE INSERT ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.order_items_before_insert();


--
-- TOC entry 5306 (class 2620 OID 22729)
-- Name: order_items order_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_items_updated_at BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5302 (class 2620 OID 22726)
-- Name: orders orders_before_insert_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_before_insert_trigger BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.orders_before_insert();


--
-- TOC entry 5303 (class 2620 OID 22728)
-- Name: orders orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5284 (class 2620 OID 18071)
-- Name: brands set_brands_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_brands_updated_at BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5283 (class 2620 OID 18070)
-- Name: product_categories set_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_categories_updated_at BEFORE UPDATE ON public.product_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5298 (class 2620 OID 18496)
-- Name: distributor_products set_dist_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_dist_products_updated_at BEFORE UPDATE ON public.distributor_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5285 (class 2620 OID 18072)
-- Name: product_groups set_groups_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_groups_updated_at BEFORE UPDATE ON public.product_groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5295 (class 2620 OID 18495)
-- Name: product_inventory set_inventory_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_inventory_updated_at BEFORE UPDATE ON public.product_inventory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5313 (class 2620 OID 26946)
-- Name: lucky_draw_campaigns set_lucky_draw_campaigns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_lucky_draw_campaigns_updated_at BEFORE UPDATE ON public.lucky_draw_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5281 (class 2620 OID 18069)
-- Name: organizations set_orgs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_orgs_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5293 (class 2620 OID 18494)
-- Name: product_pricing set_pricing_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_pricing_updated_at BEFORE UPDATE ON public.product_pricing FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5296 (class 2620 OID 21185)
-- Name: product_attributes set_product_attributes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_product_attributes_updated_at BEFORE UPDATE ON public.product_attributes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5288 (class 2620 OID 18491)
-- Name: products set_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5309 (class 2620 OID 26942)
-- Name: qr_batches set_qr_batches_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_qr_batches_updated_at BEFORE UPDATE ON public.qr_batches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5311 (class 2620 OID 26944)
-- Name: qr_codes set_qr_codes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_qr_codes_updated_at BEFORE UPDATE ON public.qr_codes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5310 (class 2620 OID 26943)
-- Name: qr_master_codes set_qr_master_codes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_qr_master_codes_updated_at BEFORE UPDATE ON public.qr_master_codes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5314 (class 2620 OID 26947)
-- Name: qr_validation_reports set_qr_validation_reports_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_qr_validation_reports_updated_at BEFORE UPDATE ON public.qr_validation_reports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5312 (class 2620 OID 26945)
-- Name: redeem_items set_redeem_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_redeem_items_updated_at BEFORE UPDATE ON public.redeem_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5300 (class 2620 OID 18497)
-- Name: shop_distributors set_shop_dist_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_shop_dist_updated_at BEFORE UPDATE ON public.shop_distributors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5291 (class 2620 OID 18493)
-- Name: product_skus set_skus_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_skus_updated_at BEFORE UPDATE ON public.product_skus FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5286 (class 2620 OID 18073)
-- Name: product_subgroups set_subgroups_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_subgroups_updated_at BEFORE UPDATE ON public.product_subgroups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5279 (class 2620 OID 17793)
-- Name: users set_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5289 (class 2620 OID 18492)
-- Name: product_variants set_variants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_variants_updated_at BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5315 (class 2620 OID 30466)
-- Name: redemption_orders trg_enforce_redemption_cap; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_redemption_cap BEFORE INSERT ON public.redemption_orders FOR EACH ROW EXECUTE FUNCTION public.enforce_redemption_cap();


--
-- TOC entry 5282 (class 2620 OID 34508)
-- Name: organizations trg_sync_shop_dist; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_shop_dist AFTER INSERT OR UPDATE OF parent_org_id, is_active ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.sync_shop_distributor_link();


--
-- TOC entry 5308 (class 2620 OID 35325)
-- Name: documents trigger_document_notification; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_document_notification AFTER INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.trigger_document_notification();


--
-- TOC entry 5304 (class 2620 OID 35323)
-- Name: orders trigger_order_status_notification; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_order_status_notification AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.trigger_order_notification();


--
-- TOC entry 5319 (class 2620 OID 35535)
-- Name: stock_transfers trigger_update_stock_transfers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_stock_transfers_updated_at BEFORE UPDATE ON public.stock_transfers FOR EACH ROW EXECUTE FUNCTION public.update_stock_transfers_updated_at();


--
-- TOC entry 5318 (class 2620 OID 35274)
-- Name: notification_settings update_notification_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_notification_settings_updated_at BEFORE UPDATE ON public.notification_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5316 (class 2620 OID 35272)
-- Name: notification_types update_notification_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_notification_types_updated_at BEFORE UPDATE ON public.notification_types FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5317 (class 2620 OID 35273)
-- Name: notification_provider_configs update_provider_configs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_provider_configs_updated_at BEFORE UPDATE ON public.notification_provider_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5290 (class 2620 OID 20549)
-- Name: product_variants validate_default_variant_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_default_variant_trigger BEFORE INSERT OR UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.validate_default_variant();


--
-- TOC entry 5299 (class 2620 OID 18488)
-- Name: distributor_products validate_distributor_products_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_distributor_products_trigger BEFORE INSERT OR UPDATE OF distributor_id ON public.distributor_products FOR EACH ROW EXECUTE FUNCTION public.validate_distributor_products();


--
-- TOC entry 5301 (class 2620 OID 18490)
-- Name: shop_distributors validate_shop_distributors_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_shop_distributors_trigger BEFORE INSERT OR UPDATE OF shop_id, distributor_id ON public.shop_distributors FOR EACH ROW EXECUTE FUNCTION public.validate_shop_distributors();


--
-- TOC entry 5272 (class 2620 OID 17390)
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- TOC entry 5273 (class 2620 OID 17427)
-- Name: objects objects_delete_delete_prefix; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER objects_delete_delete_prefix AFTER DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();


--
-- TOC entry 5274 (class 2620 OID 17333)
-- Name: objects objects_insert_create_prefix; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER objects_insert_create_prefix BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.objects_insert_prefix_trigger();


--
-- TOC entry 5275 (class 2620 OID 17426)
-- Name: objects objects_update_create_prefix; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER objects_update_create_prefix BEFORE UPDATE ON storage.objects FOR EACH ROW WHEN (((new.name <> old.name) OR (new.bucket_id <> old.bucket_id))) EXECUTE FUNCTION storage.objects_update_prefix_trigger();


--
-- TOC entry 5277 (class 2620 OID 17386)
-- Name: prefixes prefixes_create_hierarchy; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER prefixes_create_hierarchy BEFORE INSERT ON storage.prefixes FOR EACH ROW WHEN ((pg_trigger_depth() < 1)) EXECUTE FUNCTION storage.prefixes_insert_trigger();


--
-- TOC entry 5278 (class 2620 OID 17428)
-- Name: prefixes prefixes_delete_hierarchy; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER prefixes_delete_hierarchy AFTER DELETE ON storage.prefixes FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();


--
-- TOC entry 5276 (class 2620 OID 17231)
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- TOC entry 5119 (class 2606 OID 17778)
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- TOC entry 5130 (class 2606 OID 18019)
-- Name: brands brands_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5217 (class 2606 OID 26830)
-- Name: consumer_activations consumer_activations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumer_activations
    ADD CONSTRAINT consumer_activations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id);


--
-- TOC entry 5218 (class 2606 OID 26840)
-- Name: consumer_activations consumer_activations_lucky_draw_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumer_activations
    ADD CONSTRAINT consumer_activations_lucky_draw_entry_id_fkey FOREIGN KEY (lucky_draw_entry_id) REFERENCES public.lucky_draw_entries(id);


--
-- TOC entry 5219 (class 2606 OID 26835)
-- Name: consumer_activations consumer_activations_qr_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumer_activations
    ADD CONSTRAINT consumer_activations_qr_code_id_fkey FOREIGN KEY (qr_code_id) REFERENCES public.qr_codes(id);


--
-- TOC entry 5154 (class 2606 OID 18439)
-- Name: distributor_products distributor_products_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distributor_products
    ADD CONSTRAINT distributor_products_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5155 (class 2606 OID 18429)
-- Name: distributor_products distributor_products_distributor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distributor_products
    ADD CONSTRAINT distributor_products_distributor_id_fkey FOREIGN KEY (distributor_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 5156 (class 2606 OID 18434)
-- Name: distributor_products distributor_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distributor_products
    ADD CONSTRAINT distributor_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5121 (class 2606 OID 17895)
-- Name: districts districts_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.districts
    ADD CONSTRAINT districts_state_id_fkey FOREIGN KEY (state_id) REFERENCES public.states(id);


--
-- TOC entry 5160 (class 2606 OID 22271)
-- Name: doc_counters doc_counters_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_counters
    ADD CONSTRAINT doc_counters_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id);


--
-- TOC entry 5176 (class 2606 OID 22847)
-- Name: document_files document_files_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_files
    ADD CONSTRAINT document_files_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- TOC entry 5177 (class 2606 OID 22852)
-- Name: document_files document_files_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_files
    ADD CONSTRAINT document_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- TOC entry 5171 (class 2606 OID 22824)
-- Name: documents documents_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.users(id);


--
-- TOC entry 5172 (class 2606 OID 22819)
-- Name: documents documents_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5173 (class 2606 OID 22809)
-- Name: documents documents_issued_by_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_issued_by_org_id_fkey FOREIGN KEY (issued_by_org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5174 (class 2606 OID 22814)
-- Name: documents documents_issued_to_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_issued_to_org_id_fkey FOREIGN KEY (issued_to_org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5175 (class 2606 OID 22804)
-- Name: documents documents_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- TOC entry 5116 (class 2606 OID 17969)
-- Name: users fk_users_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- TOC entry 5230 (class 2606 OID 29956)
-- Name: journey_configurations journey_configurations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_configurations
    ADD CONSTRAINT journey_configurations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5231 (class 2606 OID 29951)
-- Name: journey_configurations journey_configurations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_configurations
    ADD CONSTRAINT journey_configurations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5232 (class 2606 OID 29972)
-- Name: journey_order_links journey_order_links_journey_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_order_links
    ADD CONSTRAINT journey_order_links_journey_config_id_fkey FOREIGN KEY (journey_config_id) REFERENCES public.journey_configurations(id) ON DELETE CASCADE;


--
-- TOC entry 5233 (class 2606 OID 29977)
-- Name: journey_order_links journey_order_links_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_order_links
    ADD CONSTRAINT journey_order_links_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- TOC entry 5211 (class 2606 OID 26764)
-- Name: lucky_draw_campaigns lucky_draw_campaigns_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_campaigns
    ADD CONSTRAINT lucky_draw_campaigns_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id);


--
-- TOC entry 5212 (class 2606 OID 26774)
-- Name: lucky_draw_campaigns lucky_draw_campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_campaigns
    ADD CONSTRAINT lucky_draw_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5213 (class 2606 OID 26769)
-- Name: lucky_draw_campaigns lucky_draw_campaigns_drawn_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_campaigns
    ADD CONSTRAINT lucky_draw_campaigns_drawn_by_fkey FOREIGN KEY (drawn_by) REFERENCES public.users(id);


--
-- TOC entry 5214 (class 2606 OID 26796)
-- Name: lucky_draw_entries lucky_draw_entries_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_entries
    ADD CONSTRAINT lucky_draw_entries_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.lucky_draw_campaigns(id) ON DELETE CASCADE;


--
-- TOC entry 5215 (class 2606 OID 26801)
-- Name: lucky_draw_entries lucky_draw_entries_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_entries
    ADD CONSTRAINT lucky_draw_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id);


--
-- TOC entry 5216 (class 2606 OID 26806)
-- Name: lucky_draw_entries lucky_draw_entries_qr_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_entries
    ADD CONSTRAINT lucky_draw_entries_qr_code_id_fkey FOREIGN KEY (qr_code_id) REFERENCES public.qr_codes(id);


--
-- TOC entry 5237 (class 2606 OID 30147)
-- Name: lucky_draw_order_links lucky_draw_order_links_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_order_links
    ADD CONSTRAINT lucky_draw_order_links_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.lucky_draw_campaigns(id) ON DELETE CASCADE;


--
-- TOC entry 5238 (class 2606 OID 30157)
-- Name: lucky_draw_order_links lucky_draw_order_links_journey_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_order_links
    ADD CONSTRAINT lucky_draw_order_links_journey_config_id_fkey FOREIGN KEY (journey_config_id) REFERENCES public.journey_configurations(id) ON DELETE SET NULL;


--
-- TOC entry 5239 (class 2606 OID 30152)
-- Name: lucky_draw_order_links lucky_draw_order_links_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lucky_draw_order_links
    ADD CONSTRAINT lucky_draw_order_links_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- TOC entry 5250 (class 2606 OID 30368)
-- Name: message_templates message_templates_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5258 (class 2606 OID 35250)
-- Name: notification_logs notification_logs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 5259 (class 2606 OID 35245)
-- Name: notification_logs notification_logs_outbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_outbox_id_fkey FOREIGN KEY (outbox_id) REFERENCES public.notifications_outbox(id) ON DELETE SET NULL;


--
-- TOC entry 5254 (class 2606 OID 35196)
-- Name: notification_provider_configs notification_provider_configs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_provider_configs
    ADD CONSTRAINT notification_provider_configs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5255 (class 2606 OID 35191)
-- Name: notification_provider_configs notification_provider_configs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_provider_configs
    ADD CONSTRAINT notification_provider_configs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 5256 (class 2606 OID 35224)
-- Name: notification_settings notification_settings_event_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_settings
    ADD CONSTRAINT notification_settings_event_code_fkey FOREIGN KEY (event_code) REFERENCES public.notification_types(event_code) ON DELETE CASCADE;


--
-- TOC entry 5257 (class 2606 OID 35219)
-- Name: notification_settings notification_settings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_settings
    ADD CONSTRAINT notification_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 5251 (class 2606 OID 30383)
-- Name: notifications_outbox notifications_outbox_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications_outbox
    ADD CONSTRAINT notifications_outbox_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5168 (class 2606 OID 22704)
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- TOC entry 5169 (class 2606 OID 22709)
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- TOC entry 5170 (class 2606 OID 22714)
-- Name: order_items order_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- TOC entry 5161 (class 2606 OID 22674)
-- Name: orders orders_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- TOC entry 5162 (class 2606 OID 22649)
-- Name: orders orders_buyer_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_buyer_org_id_fkey FOREIGN KEY (buyer_org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5163 (class 2606 OID 22644)
-- Name: orders orders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id);


--
-- TOC entry 5164 (class 2606 OID 22664)
-- Name: orders orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5165 (class 2606 OID 22659)
-- Name: orders orders_parent_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_parent_order_id_fkey FOREIGN KEY (parent_order_id) REFERENCES public.orders(id);


--
-- TOC entry 5166 (class 2606 OID 22654)
-- Name: orders orders_seller_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_seller_org_id_fkey FOREIGN KEY (seller_org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5167 (class 2606 OID 22669)
-- Name: orders orders_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- TOC entry 5249 (class 2606 OID 30351)
-- Name: org_notification_settings org_notification_settings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_notification_settings
    ADD CONSTRAINT org_notification_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5122 (class 2606 OID 17953)
-- Name: organizations organizations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5123 (class 2606 OID 17948)
-- Name: organizations organizations_district_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_district_id_fkey FOREIGN KEY (district_id) REFERENCES public.districts(id);


--
-- TOC entry 5124 (class 2606 OID 17933)
-- Name: organizations organizations_org_type_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_org_type_code_fkey FOREIGN KEY (org_type_code) REFERENCES public.organization_types(type_code);


--
-- TOC entry 5125 (class 2606 OID 17938)
-- Name: organizations organizations_parent_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_parent_org_id_fkey FOREIGN KEY (parent_org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5126 (class 2606 OID 17943)
-- Name: organizations organizations_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_state_id_fkey FOREIGN KEY (state_id) REFERENCES public.states(id);


--
-- TOC entry 5127 (class 2606 OID 17958)
-- Name: organizations organizations_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- TOC entry 5253 (class 2606 OID 30541)
-- Name: otp_challenges otp_challenges_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_challenges
    ADD CONSTRAINT otp_challenges_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5234 (class 2606 OID 30047)
-- Name: points_rules points_rules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_rules
    ADD CONSTRAINT points_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5235 (class 2606 OID 30042)
-- Name: points_rules points_rules_journey_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_rules
    ADD CONSTRAINT points_rules_journey_config_id_fkey FOREIGN KEY (journey_config_id) REFERENCES public.journey_configurations(id) ON DELETE SET NULL;


--
-- TOC entry 5236 (class 2606 OID 30037)
-- Name: points_rules points_rules_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_rules
    ADD CONSTRAINT points_rules_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5220 (class 2606 OID 26860)
-- Name: points_transactions points_transactions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id);


--
-- TOC entry 5221 (class 2606 OID 26865)
-- Name: points_transactions points_transactions_qr_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_qr_code_id_fkey FOREIGN KEY (qr_code_id) REFERENCES public.qr_codes(id);


--
-- TOC entry 5222 (class 2606 OID 26870)
-- Name: points_transactions points_transactions_redeem_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_redeem_item_id_fkey FOREIGN KEY (redeem_item_id) REFERENCES public.redeem_items(id);


--
-- TOC entry 5152 (class 2606 OID 18397)
-- Name: product_attributes product_attributes_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attributes
    ADD CONSTRAINT product_attributes_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5153 (class 2606 OID 18402)
-- Name: product_attributes product_attributes_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attributes
    ADD CONSTRAINT product_attributes_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- TOC entry 5128 (class 2606 OID 17996)
-- Name: product_categories product_categories_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5129 (class 2606 OID 17991)
-- Name: product_categories product_categories_parent_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_parent_category_id_fkey FOREIGN KEY (parent_category_id) REFERENCES public.product_categories(id);


--
-- TOC entry 5131 (class 2606 OID 18041)
-- Name: product_groups product_groups_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_groups
    ADD CONSTRAINT product_groups_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.product_categories(id);


--
-- TOC entry 5149 (class 2606 OID 18364)
-- Name: product_images product_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5150 (class 2606 OID 18374)
-- Name: product_images product_images_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- TOC entry 5151 (class 2606 OID 18369)
-- Name: product_images product_images_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- TOC entry 5146 (class 2606 OID 18341)
-- Name: product_inventory product_inventory_last_counted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_inventory
    ADD CONSTRAINT product_inventory_last_counted_by_fkey FOREIGN KEY (last_counted_by) REFERENCES public.users(id);


--
-- TOC entry 5147 (class 2606 OID 18336)
-- Name: product_inventory product_inventory_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_inventory
    ADD CONSTRAINT product_inventory_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 5148 (class 2606 OID 18331)
-- Name: product_inventory product_inventory_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_inventory
    ADD CONSTRAINT product_inventory_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- TOC entry 5143 (class 2606 OID 18300)
-- Name: product_pricing product_pricing_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_pricing
    ADD CONSTRAINT product_pricing_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5144 (class 2606 OID 18295)
-- Name: product_pricing product_pricing_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_pricing
    ADD CONSTRAINT product_pricing_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- TOC entry 5145 (class 2606 OID 18290)
-- Name: product_pricing product_pricing_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_pricing
    ADD CONSTRAINT product_pricing_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- TOC entry 5141 (class 2606 OID 18260)
-- Name: product_skus product_skus_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_skus
    ADD CONSTRAINT product_skus_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- TOC entry 5142 (class 2606 OID 18255)
-- Name: product_skus product_skus_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_skus
    ADD CONSTRAINT product_skus_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- TOC entry 5132 (class 2606 OID 18062)
-- Name: product_subgroups product_subgroups_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_subgroups
    ADD CONSTRAINT product_subgroups_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.product_groups(id);


--
-- TOC entry 5140 (class 2606 OID 18225)
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5133 (class 2606 OID 18174)
-- Name: products products_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id);


--
-- TOC entry 5134 (class 2606 OID 18169)
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.product_categories(id);


--
-- TOC entry 5135 (class 2606 OID 18189)
-- Name: products products_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5136 (class 2606 OID 18179)
-- Name: products products_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.product_groups(id);


--
-- TOC entry 5137 (class 2606 OID 18164)
-- Name: products products_manufacturer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_manufacturer_id_fkey FOREIGN KEY (manufacturer_id) REFERENCES public.organizations(id);


--
-- TOC entry 5138 (class 2606 OID 18184)
-- Name: products products_subgroup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_subgroup_id_fkey FOREIGN KEY (subgroup_id) REFERENCES public.product_subgroups(id);


--
-- TOC entry 5139 (class 2606 OID 18194)
-- Name: products products_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- TOC entry 5178 (class 2606 OID 26506)
-- Name: qr_batches qr_batches_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_batches
    ADD CONSTRAINT qr_batches_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id);


--
-- TOC entry 5179 (class 2606 OID 26516)
-- Name: qr_batches qr_batches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_batches
    ADD CONSTRAINT qr_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5180 (class 2606 OID 26511)
-- Name: qr_batches qr_batches_excel_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_batches
    ADD CONSTRAINT qr_batches_excel_generated_by_fkey FOREIGN KEY (excel_generated_by) REFERENCES public.users(id);


--
-- TOC entry 5181 (class 2606 OID 26501)
-- Name: qr_batches qr_batches_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_batches
    ADD CONSTRAINT qr_batches_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- TOC entry 5191 (class 2606 OID 26612)
-- Name: qr_codes qr_codes_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.qr_batches(id) ON DELETE CASCADE;


--
-- TOC entry 5192 (class 2606 OID 26622)
-- Name: qr_codes qr_codes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id);


--
-- TOC entry 5193 (class 2606 OID 26647)
-- Name: qr_codes qr_codes_current_location_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_current_location_org_id_fkey FOREIGN KEY (current_location_org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5194 (class 2606 OID 26652)
-- Name: qr_codes qr_codes_last_scanned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_last_scanned_by_fkey FOREIGN KEY (last_scanned_by) REFERENCES public.users(id);


--
-- TOC entry 5195 (class 2606 OID 26937)
-- Name: qr_codes qr_codes_lucky_draw_campaign_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_lucky_draw_campaign_fkey FOREIGN KEY (lucky_draw_campaign_id) REFERENCES public.lucky_draw_campaigns(id) ON DELETE SET NULL;


--
-- TOC entry 5196 (class 2606 OID 26617)
-- Name: qr_codes qr_codes_master_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_master_code_id_fkey FOREIGN KEY (master_code_id) REFERENCES public.qr_master_codes(id) ON DELETE SET NULL;


--
-- TOC entry 5197 (class 2606 OID 26627)
-- Name: qr_codes qr_codes_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- TOC entry 5198 (class 2606 OID 26632)
-- Name: qr_codes qr_codes_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id);


--
-- TOC entry 5199 (class 2606 OID 26637)
-- Name: qr_codes qr_codes_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- TOC entry 5200 (class 2606 OID 26932)
-- Name: qr_codes qr_codes_redeem_item_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_redeem_item_fkey FOREIGN KEY (redeem_item_id) REFERENCES public.redeem_items(id) ON DELETE SET NULL;


--
-- TOC entry 5201 (class 2606 OID 26642)
-- Name: qr_codes qr_codes_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- TOC entry 5182 (class 2606 OID 26541)
-- Name: qr_master_codes qr_master_codes_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_master_codes
    ADD CONSTRAINT qr_master_codes_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.qr_batches(id) ON DELETE CASCADE;


--
-- TOC entry 5183 (class 2606 OID 26546)
-- Name: qr_master_codes qr_master_codes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_master_codes
    ADD CONSTRAINT qr_master_codes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id);


--
-- TOC entry 5184 (class 2606 OID 26556)
-- Name: qr_master_codes qr_master_codes_manufacturer_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_master_codes
    ADD CONSTRAINT qr_master_codes_manufacturer_org_id_fkey FOREIGN KEY (manufacturer_org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5185 (class 2606 OID 26551)
-- Name: qr_master_codes qr_master_codes_manufacturer_scanned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_master_codes
    ADD CONSTRAINT qr_master_codes_manufacturer_scanned_by_fkey FOREIGN KEY (manufacturer_scanned_by) REFERENCES public.users(id);


--
-- TOC entry 5186 (class 2606 OID 26581)
-- Name: qr_master_codes qr_master_codes_shipment_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_master_codes
    ADD CONSTRAINT qr_master_codes_shipment_order_id_fkey FOREIGN KEY (shipment_order_id) REFERENCES public.orders(id);


--
-- TOC entry 5187 (class 2606 OID 26576)
-- Name: qr_master_codes qr_master_codes_shipped_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_master_codes
    ADD CONSTRAINT qr_master_codes_shipped_by_fkey FOREIGN KEY (shipped_by) REFERENCES public.users(id);


--
-- TOC entry 5188 (class 2606 OID 26571)
-- Name: qr_master_codes qr_master_codes_shipped_to_distributor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_master_codes
    ADD CONSTRAINT qr_master_codes_shipped_to_distributor_id_fkey FOREIGN KEY (shipped_to_distributor_id) REFERENCES public.organizations(id);


--
-- TOC entry 5189 (class 2606 OID 26566)
-- Name: qr_master_codes qr_master_codes_warehouse_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_master_codes
    ADD CONSTRAINT qr_master_codes_warehouse_org_id_fkey FOREIGN KEY (warehouse_org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5190 (class 2606 OID 26561)
-- Name: qr_master_codes qr_master_codes_warehouse_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_master_codes
    ADD CONSTRAINT qr_master_codes_warehouse_received_by_fkey FOREIGN KEY (warehouse_received_by) REFERENCES public.users(id);


--
-- TOC entry 5202 (class 2606 OID 26678)
-- Name: qr_movements qr_movements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_movements
    ADD CONSTRAINT qr_movements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id);


--
-- TOC entry 5203 (class 2606 OID 26693)
-- Name: qr_movements qr_movements_from_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_movements
    ADD CONSTRAINT qr_movements_from_org_id_fkey FOREIGN KEY (from_org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5204 (class 2606 OID 26683)
-- Name: qr_movements qr_movements_qr_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_movements
    ADD CONSTRAINT qr_movements_qr_code_id_fkey FOREIGN KEY (qr_code_id) REFERENCES public.qr_codes(id) ON DELETE CASCADE;


--
-- TOC entry 5205 (class 2606 OID 26688)
-- Name: qr_movements qr_movements_qr_master_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_movements
    ADD CONSTRAINT qr_movements_qr_master_code_id_fkey FOREIGN KEY (qr_master_code_id) REFERENCES public.qr_master_codes(id) ON DELETE CASCADE;


--
-- TOC entry 5206 (class 2606 OID 26708)
-- Name: qr_movements qr_movements_related_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_movements
    ADD CONSTRAINT qr_movements_related_order_id_fkey FOREIGN KEY (related_order_id) REFERENCES public.orders(id);


--
-- TOC entry 5207 (class 2606 OID 26703)
-- Name: qr_movements qr_movements_scanned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_movements
    ADD CONSTRAINT qr_movements_scanned_by_fkey FOREIGN KEY (scanned_by) REFERENCES public.users(id);


--
-- TOC entry 5208 (class 2606 OID 26698)
-- Name: qr_movements qr_movements_to_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_movements
    ADD CONSTRAINT qr_movements_to_org_id_fkey FOREIGN KEY (to_org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5223 (class 2606 OID 26917)
-- Name: qr_validation_reports qr_validation_reports_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_validation_reports
    ADD CONSTRAINT qr_validation_reports_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- TOC entry 5224 (class 2606 OID 26892)
-- Name: qr_validation_reports qr_validation_reports_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_validation_reports
    ADD CONSTRAINT qr_validation_reports_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id);


--
-- TOC entry 5225 (class 2606 OID 26922)
-- Name: qr_validation_reports qr_validation_reports_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_validation_reports
    ADD CONSTRAINT qr_validation_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5226 (class 2606 OID 26907)
-- Name: qr_validation_reports qr_validation_reports_destination_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_validation_reports
    ADD CONSTRAINT qr_validation_reports_destination_order_id_fkey FOREIGN KEY (destination_order_id) REFERENCES public.orders(id);


--
-- TOC entry 5227 (class 2606 OID 26902)
-- Name: qr_validation_reports qr_validation_reports_distributor_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_validation_reports
    ADD CONSTRAINT qr_validation_reports_distributor_org_id_fkey FOREIGN KEY (distributor_org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5228 (class 2606 OID 26912)
-- Name: qr_validation_reports qr_validation_reports_source_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_validation_reports
    ADD CONSTRAINT qr_validation_reports_source_order_id_fkey FOREIGN KEY (source_order_id) REFERENCES public.orders(id);


--
-- TOC entry 5229 (class 2606 OID 26897)
-- Name: qr_validation_reports qr_validation_reports_warehouse_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_validation_reports
    ADD CONSTRAINT qr_validation_reports_warehouse_org_id_fkey FOREIGN KEY (warehouse_org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5209 (class 2606 OID 26735)
-- Name: redeem_items redeem_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redeem_items
    ADD CONSTRAINT redeem_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id);


--
-- TOC entry 5210 (class 2606 OID 26740)
-- Name: redeem_items redeem_items_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redeem_items
    ADD CONSTRAINT redeem_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5252 (class 2606 OID 30399)
-- Name: redemption_order_limits redemption_order_limits_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_order_limits
    ADD CONSTRAINT redemption_order_limits_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- TOC entry 5243 (class 2606 OID 30272)
-- Name: redemption_orders redemption_orders_journey_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_orders
    ADD CONSTRAINT redemption_orders_journey_config_id_fkey FOREIGN KEY (journey_config_id) REFERENCES public.journey_configurations(id) ON DELETE SET NULL;


--
-- TOC entry 5244 (class 2606 OID 30277)
-- Name: redemption_orders redemption_orders_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_orders
    ADD CONSTRAINT redemption_orders_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- TOC entry 5245 (class 2606 OID 30267)
-- Name: redemption_orders redemption_orders_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_orders
    ADD CONSTRAINT redemption_orders_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5246 (class 2606 OID 30282)
-- Name: redemption_orders redemption_orders_qr_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_orders
    ADD CONSTRAINT redemption_orders_qr_code_id_fkey FOREIGN KEY (qr_code_id) REFERENCES public.qr_codes(id);


--
-- TOC entry 5247 (class 2606 OID 30287)
-- Name: redemption_orders redemption_orders_shop_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_orders
    ADD CONSTRAINT redemption_orders_shop_org_id_fkey FOREIGN KEY (shop_org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5248 (class 2606 OID 30292)
-- Name: redemption_orders redemption_orders_staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_orders
    ADD CONSTRAINT redemption_orders_staff_user_id_fkey FOREIGN KEY (staff_user_id) REFERENCES public.users(id);


--
-- TOC entry 5240 (class 2606 OID 30249)
-- Name: redemption_policies redemption_policies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_policies
    ADD CONSTRAINT redemption_policies_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 5241 (class 2606 OID 30244)
-- Name: redemption_policies redemption_policies_journey_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_policies
    ADD CONSTRAINT redemption_policies_journey_config_id_fkey FOREIGN KEY (journey_config_id) REFERENCES public.journey_configurations(id) ON DELETE SET NULL;


--
-- TOC entry 5242 (class 2606 OID 30239)
-- Name: redemption_policies redemption_policies_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redemption_policies
    ADD CONSTRAINT redemption_policies_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- TOC entry 5157 (class 2606 OID 18476)
-- Name: shop_distributors shop_distributors_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_distributors
    ADD CONSTRAINT shop_distributors_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- TOC entry 5158 (class 2606 OID 18471)
-- Name: shop_distributors shop_distributors_distributor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_distributors
    ADD CONSTRAINT shop_distributors_distributor_id_fkey FOREIGN KEY (distributor_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 5159 (class 2606 OID 18466)
-- Name: shop_distributors shop_distributors_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_distributors
    ADD CONSTRAINT shop_distributors_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 5120 (class 2606 OID 17876)
-- Name: states states_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.states
    ADD CONSTRAINT states_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id);


--
-- TOC entry 5260 (class 2606 OID 35440)
-- Name: stock_movements stock_movements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 5261 (class 2606 OID 35445)
-- Name: stock_movements stock_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 5262 (class 2606 OID 35425)
-- Name: stock_movements stock_movements_from_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_from_organization_id_fkey FOREIGN KEY (from_organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 5263 (class 2606 OID 35435)
-- Name: stock_movements stock_movements_manufacturer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_manufacturer_id_fkey FOREIGN KEY (manufacturer_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- TOC entry 5264 (class 2606 OID 35430)
-- Name: stock_movements stock_movements_to_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_to_organization_id_fkey FOREIGN KEY (to_organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 5265 (class 2606 OID 35420)
-- Name: stock_movements stock_movements_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- TOC entry 5266 (class 2606 OID 35510)
-- Name: stock_transfers stock_transfers_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 5267 (class 2606 OID 35500)
-- Name: stock_transfers stock_transfers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 5268 (class 2606 OID 35505)
-- Name: stock_transfers stock_transfers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 5269 (class 2606 OID 35490)
-- Name: stock_transfers stock_transfers_from_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_from_organization_id_fkey FOREIGN KEY (from_organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 5270 (class 2606 OID 35515)
-- Name: stock_transfers stock_transfers_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 5271 (class 2606 OID 35495)
-- Name: stock_transfers stock_transfers_to_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_to_organization_id_fkey FOREIGN KEY (to_organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 5117 (class 2606 OID 17754)
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- TOC entry 5118 (class 2606 OID 17759)
-- Name: users users_role_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_code_fkey FOREIGN KEY (role_code) REFERENCES public.roles(role_code);


--
-- TOC entry 5111 (class 2606 OID 16572)
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- TOC entry 5115 (class 2606 OID 17320)
-- Name: prefixes prefixes_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.prefixes
    ADD CONSTRAINT "prefixes_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- TOC entry 5112 (class 2606 OID 17265)
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- TOC entry 5113 (class 2606 OID 17286)
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- TOC entry 5114 (class 2606 OID 17280)
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- TOC entry 5591 (class 3256 OID 35530)
-- Name: stock_adjustment_reasons adjustment_reasons_view_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY adjustment_reasons_view_all ON public.stock_adjustment_reasons FOR SELECT TO authenticated USING ((is_active = true));


--
-- TOC entry 5554 (class 3256 OID 18511)
-- Name: product_attributes attributes_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attributes_admin_all ON public.product_attributes TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5553 (class 3256 OID 18510)
-- Name: product_attributes attributes_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attributes_read_all ON public.product_attributes FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5529 (class 3256 OID 17801)
-- Name: audit_logs audit_insert_system; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_insert_system ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);


--
-- TOC entry 5492 (class 0 OID 17768)
-- Dependencies: 389
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5528 (class 3256 OID 17800)
-- Name: audit_logs audit_read_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_read_admin ON public.audit_logs FOR SELECT TO authenticated USING (public.is_hq_admin());


--
-- TOC entry 5499 (class 0 OID 18005)
-- Dependencies: 396
-- Name: brands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5542 (class 3256 OID 18087)
-- Name: brands brands_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY brands_admin_all ON public.brands TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5541 (class 3256 OID 18086)
-- Name: brands brands_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY brands_read_all ON public.brands FOR SELECT TO authenticated USING (((is_active = true) OR public.is_hq_admin()));


--
-- TOC entry 5540 (class 3256 OID 18085)
-- Name: product_categories categories_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_admin_all ON public.product_categories TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5539 (class 3256 OID 18084)
-- Name: product_categories categories_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_read_all ON public.product_categories FOR SELECT TO authenticated USING (((is_active = true) OR public.is_hq_admin()));


--
-- TOC entry 5575 (class 3256 OID 20507)
-- Name: distributor_products dist_products_dist_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dist_products_dist_manage ON public.distributor_products TO authenticated USING ((public.can_access_org(distributor_id) OR public.is_hq_admin())) WITH CHECK ((public.can_access_org(distributor_id) OR public.is_hq_admin()));


--
-- TOC entry 5574 (class 3256 OID 20506)
-- Name: distributor_products dist_products_read_related; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dist_products_read_related ON public.distributor_products FOR SELECT TO authenticated USING (((is_active = true) AND (public.can_access_org(distributor_id) OR public.is_hq_admin())));


--
-- TOC entry 5509 (class 0 OID 18411)
-- Dependencies: 407
-- Name: distributor_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.distributor_products ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5495 (class 0 OID 17883)
-- Dependencies: 392
-- Name: districts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.districts ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5535 (class 3256 OID 18079)
-- Name: districts districts_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY districts_admin_all ON public.districts TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5534 (class 3256 OID 18078)
-- Name: districts districts_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY districts_read_all ON public.districts FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5511 (class 0 OID 22256)
-- Dependencies: 418
-- Name: doc_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.doc_counters ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5576 (class 3256 OID 22277)
-- Name: doc_counters doc_counters_admin_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doc_counters_admin_only ON public.doc_counters TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5515 (class 0 OID 22837)
-- Dependencies: 422
-- Name: document_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_files ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5583 (class 3256 OID 23027)
-- Name: document_files document_files_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_files_select ON public.document_files FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = document_files.document_id) AND ((d.issued_by_org_id = public.current_user_org_id()) OR (d.issued_to_org_id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (d.company_id = public.get_company_id(public.current_user_org_id()))))))));


--
-- TOC entry 5584 (class 3256 OID 23028)
-- Name: document_files document_files_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_files_write ON public.document_files TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = document_files.document_id) AND ((d.issued_by_org_id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (d.company_id = public.get_company_id(public.current_user_org_id())))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = document_files.document_id) AND ((d.issued_by_org_id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (d.company_id = public.get_company_id(public.current_user_org_id()))))))));


--
-- TOC entry 5514 (class 0 OID 22790)
-- Dependencies: 421
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5581 (class 3256 OID 23025)
-- Name: documents documents_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_select ON public.documents FOR SELECT TO authenticated USING (((issued_by_org_id = public.current_user_org_id()) OR (issued_to_org_id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (company_id = public.get_company_id(public.current_user_org_id())))));


--
-- TOC entry 5582 (class 3256 OID 23026)
-- Name: documents documents_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_write ON public.documents TO authenticated USING (((issued_by_org_id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (company_id = public.get_company_id(public.current_user_org_id()))))) WITH CHECK (((issued_by_org_id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (company_id = public.get_company_id(public.current_user_org_id())))));


--
-- TOC entry 5531 (class 3256 OID 18075)
-- Name: regions geo_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY geo_admin_all ON public.regions TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5530 (class 3256 OID 18074)
-- Name: regions geo_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY geo_read_all ON public.regions FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5544 (class 3256 OID 18089)
-- Name: product_groups groups_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_admin_all ON public.product_groups TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5543 (class 3256 OID 18088)
-- Name: product_groups groups_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_read_all ON public.product_groups FOR SELECT TO authenticated USING (((is_active = true) OR public.is_hq_admin()));


--
-- TOC entry 5552 (class 3256 OID 18509)
-- Name: product_images images_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY images_admin_all ON public.product_images TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5551 (class 3256 OID 18508)
-- Name: product_images images_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY images_read_all ON public.product_images FOR SELECT TO authenticated USING (((is_active = true) OR public.is_hq_admin()));


--
-- TOC entry 5571 (class 3256 OID 20503)
-- Name: product_inventory inventory_org_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventory_org_manage ON public.product_inventory TO authenticated USING ((public.can_access_org(organization_id) OR public.is_hq_admin())) WITH CHECK ((public.can_access_org(organization_id) OR public.is_hq_admin()));


--
-- TOC entry 5570 (class 3256 OID 20502)
-- Name: product_inventory inventory_read_org_hierarchy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventory_read_org_hierarchy ON public.product_inventory FOR SELECT TO authenticated USING (((is_active = true) AND (public.can_access_org(organization_id) OR public.is_hq_admin())));


--
-- TOC entry 5519 (class 0 OID 35234)
-- Dependencies: 452
-- Name: notification_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5615 (class 3256 OID 35271)
-- Name: notification_logs notification_logs_org_view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_logs_org_view ON public.notification_logs FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.organization_id = notification_logs.org_id)))));


--
-- TOC entry 5517 (class 0 OID 35175)
-- Dependencies: 450
-- Name: notification_provider_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_provider_configs ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5518 (class 0 OID 35201)
-- Dependencies: 451
-- Name: notification_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5614 (class 3256 OID 35269)
-- Name: notification_settings notification_settings_hq_power_user; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_settings_hq_power_user ON public.notification_settings TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.users u
     JOIN public.roles r ON ((r.role_code = u.role_code)))
     JOIN public.organizations o ON ((o.id = u.organization_id)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (o.org_type_code = 'HQ'::text) AND (o.id = notification_settings.org_id)))));


--
-- TOC entry 5516 (class 0 OID 35160)
-- Dependencies: 449
-- Name: notification_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_types ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5612 (class 3256 OID 35266)
-- Name: notification_types notification_types_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_types_select ON public.notification_types FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5513 (class 0 OID 22691)
-- Dependencies: 420
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5580 (class 3256 OID 23022)
-- Name: order_items order_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_items_select ON public.order_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND ((o.buyer_org_id = public.current_user_org_id()) OR (o.seller_org_id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (o.company_id = public.get_company_id(public.current_user_org_id()))))))));


--
-- TOC entry 5594 (class 3256 OID 25244)
-- Name: order_items order_items_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_items_write ON public.order_items TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND (o.status = 'draft'::public.order_status) AND ((o.buyer_org_id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (o.company_id = public.get_company_id(public.current_user_org_id())))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND (o.status = 'draft'::public.order_status) AND ((o.buyer_org_id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (o.company_id = public.get_company_id(public.current_user_org_id()))))))));


--
-- TOC entry 5512 (class 0 OID 22622)
-- Dependencies: 419
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5595 (class 3256 OID 25310)
-- Name: orders orders_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_delete ON public.orders FOR DELETE TO authenticated USING ((((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (company_id = public.get_company_id(public.current_user_org_id()))) OR ((buyer_org_id = public.current_user_org_id()) AND (status = ANY (ARRAY['draft'::public.order_status, 'submitted'::public.order_status])))));


--
-- TOC entry 5578 (class 3256 OID 23019)
-- Name: orders orders_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_insert ON public.orders FOR INSERT TO authenticated WITH CHECK ((buyer_org_id = public.current_user_org_id()));


--
-- TOC entry 5577 (class 3256 OID 23018)
-- Name: orders orders_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_select ON public.orders FOR SELECT TO authenticated USING (((buyer_org_id = public.current_user_org_id()) OR (seller_org_id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (company_id = public.get_company_id(public.current_user_org_id())))));


--
-- TOC entry 5579 (class 3256 OID 23020)
-- Name: orders orders_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_update ON public.orders FOR UPDATE TO authenticated USING ((((buyer_org_id = public.current_user_org_id()) AND (status = ANY (ARRAY['draft'::public.order_status, 'submitted'::public.order_status, 'approved'::public.order_status]))) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (company_id = public.get_company_id(public.current_user_org_id()))))) WITH CHECK (((buyer_org_id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user() AND (company_id = public.get_company_id(public.current_user_org_id())))));


--
-- TOC entry 5536 (class 3256 OID 18080)
-- Name: organization_types org_types_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_types_read_all ON public.organization_types FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5537 (class 3256 OID 18081)
-- Name: organization_types org_types_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_types_super_admin ON public.organization_types TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- TOC entry 5496 (class 0 OID 17902)
-- Dependencies: 393
-- Name: organization_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_types ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5497 (class 0 OID 17915)
-- Dependencies: 394
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5590 (class 3256 OID 25100)
-- Name: organizations orgs_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orgs_insert_admin ON public.organizations FOR INSERT TO authenticated WITH CHECK ((public.is_hq_admin() OR public.is_super_admin()));


--
-- TOC entry 5538 (class 3256 OID 18082)
-- Name: organizations orgs_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orgs_read_all ON public.organizations FOR SELECT TO authenticated USING (((is_active = true) OR (id = public.current_user_org_id()) OR public.is_hq_admin()));


--
-- TOC entry 5589 (class 3256 OID 23510)
-- Name: organizations orgs_update_hierarchy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orgs_update_hierarchy ON public.organizations FOR UPDATE TO authenticated USING ((public.is_hq_admin() OR (id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'DIST'::text) AND (org_type_code = 'SHOP'::text) AND (parent_org_id = public.current_user_org_id())))) WITH CHECK ((public.is_hq_admin() OR (id = public.current_user_org_id()) OR ((public.get_org_type(public.current_user_org_id()) = 'DIST'::text) AND (org_type_code = 'SHOP'::text) AND (parent_org_id = public.current_user_org_id()))));


--
-- TOC entry 5569 (class 3256 OID 20501)
-- Name: product_pricing pricing_hq_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pricing_hq_manage ON public.product_pricing TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5568 (class 3256 OID 20500)
-- Name: product_pricing pricing_read_org_hierarchy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pricing_read_org_hierarchy ON public.product_pricing FOR SELECT TO authenticated USING (((is_active = true) AND (effective_from <= CURRENT_DATE) AND ((effective_to IS NULL) OR (effective_to >= CURRENT_DATE)) AND ((organization_id IS NULL) OR public.can_access_org(organization_id) OR public.is_hq_admin())));


--
-- TOC entry 5508 (class 0 OID 18382)
-- Dependencies: 406
-- Name: product_attributes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5498 (class 0 OID 17974)
-- Dependencies: 395
-- Name: product_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5500 (class 0 OID 18027)
-- Dependencies: 397
-- Name: product_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_groups ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5507 (class 0 OID 18349)
-- Dependencies: 405
-- Name: product_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5506 (class 0 OID 18309)
-- Dependencies: 404
-- Name: product_inventory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_inventory ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5505 (class 0 OID 18269)
-- Dependencies: 403
-- Name: product_pricing; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_pricing ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5504 (class 0 OID 18234)
-- Dependencies: 402
-- Name: product_skus; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_skus ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5501 (class 0 OID 18048)
-- Dependencies: 398
-- Name: product_subgroups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_subgroups ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5503 (class 0 OID 18206)
-- Dependencies: 401
-- Name: product_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5502 (class 0 OID 18140)
-- Dependencies: 400
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5567 (class 3256 OID 20499)
-- Name: products products_hq_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_hq_manage ON public.products TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5566 (class 3256 OID 20498)
-- Name: products products_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_read_all ON public.products FOR SELECT TO authenticated USING (((is_active = true) OR public.is_hq_admin()));


--
-- TOC entry 5613 (class 3256 OID 35267)
-- Name: notification_provider_configs provider_configs_hq_power_user; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY provider_configs_hq_power_user ON public.notification_provider_configs TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.users u
     JOIN public.roles r ON ((r.role_code = u.role_code)))
     JOIN public.organizations o ON ((o.id = u.organization_id)))
  WHERE ((u.id = auth.uid()) AND (r.role_level <= 20) AND (o.org_type_code = 'HQ'::text) AND (o.id = notification_provider_configs.org_id)))));


--
-- TOC entry 5493 (class 0 OID 17848)
-- Dependencies: 390
-- Name: regions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5490 (class 0 OID 17725)
-- Dependencies: 387
-- Name: roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5523 (class 3256 OID 17795)
-- Name: roles roles_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_read_all ON public.roles FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5524 (class 3256 OID 17796)
-- Name: roles roles_super_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_super_admin_all ON public.roles TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- TOC entry 5572 (class 3256 OID 20504)
-- Name: shop_distributors shop_dist_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shop_dist_read_own ON public.shop_distributors FOR SELECT TO authenticated USING (((is_active = true) AND (public.can_access_org(shop_id) OR public.can_access_org(distributor_id) OR public.is_hq_admin())));


--
-- TOC entry 5573 (class 3256 OID 20505)
-- Name: shop_distributors shop_dist_shop_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shop_dist_shop_manage ON public.shop_distributors TO authenticated USING ((public.can_access_org(shop_id) OR public.is_hq_admin())) WITH CHECK ((public.can_access_org(shop_id) OR public.is_hq_admin()));


--
-- TOC entry 5510 (class 0 OID 18448)
-- Dependencies: 408
-- Name: shop_distributors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shop_distributors ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5550 (class 3256 OID 18503)
-- Name: product_skus skus_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skus_admin_all ON public.product_skus TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5549 (class 3256 OID 18502)
-- Name: product_skus skus_read_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skus_read_active ON public.product_skus FOR SELECT TO authenticated USING (((is_active = true) OR public.is_hq_admin()));


--
-- TOC entry 5494 (class 0 OID 17863)
-- Dependencies: 391
-- Name: states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.states ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5533 (class 3256 OID 18077)
-- Name: states states_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY states_admin_all ON public.states TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5532 (class 3256 OID 18076)
-- Name: states states_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY states_read_all ON public.states FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5521 (class 0 OID 35458)
-- Dependencies: 454
-- Name: stock_adjustment_reasons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_adjustment_reasons ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5520 (class 0 OID 35406)
-- Dependencies: 453
-- Name: stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5617 (class 3256 OID 35528)
-- Name: stock_movements stock_movements_insert_hq; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_movements_insert_hq ON public.stock_movements FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.organizations o ON ((u.organization_id = o.id)))
  WHERE ((u.id = auth.uid()) AND (o.org_type_code = 'HQ'::text)))));


--
-- TOC entry 5616 (class 3256 OID 35527)
-- Name: stock_movements stock_movements_view_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_movements_view_all ON public.stock_movements FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5522 (class 0 OID 35472)
-- Dependencies: 455
-- Name: stock_transfers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5593 (class 3256 OID 35532)
-- Name: stock_transfers stock_transfers_manage_hq; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_transfers_manage_hq ON public.stock_transfers TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.organizations o ON ((u.organization_id = o.id)))
  WHERE ((u.id = auth.uid()) AND (o.org_type_code = 'HQ'::text)))));


--
-- TOC entry 5592 (class 3256 OID 35531)
-- Name: stock_transfers stock_transfers_view_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_transfers_view_all ON public.stock_transfers FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5546 (class 3256 OID 18091)
-- Name: product_subgroups subgroups_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subgroups_admin_all ON public.product_subgroups TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5545 (class 3256 OID 18090)
-- Name: product_subgroups subgroups_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subgroups_read_all ON public.product_subgroups FOR SELECT TO authenticated USING (((is_active = true) OR public.is_hq_admin()));


--
-- TOC entry 5491 (class 0 OID 17739)
-- Dependencies: 388
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5527 (class 3256 OID 17799)
-- Name: users users_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_admin_all ON public.users TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5525 (class 3256 OID 17797)
-- Name: users users_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_read_own ON public.users FOR SELECT TO authenticated USING (((id = auth.uid()) OR public.is_hq_admin()));


--
-- TOC entry 5526 (class 3256 OID 17798)
-- Name: users users_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update_own ON public.users FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));


--
-- TOC entry 5548 (class 3256 OID 18501)
-- Name: product_variants variants_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY variants_admin_all ON public.product_variants TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());


--
-- TOC entry 5547 (class 3256 OID 18500)
-- Name: product_variants variants_read_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY variants_read_active ON public.product_variants FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_variants.product_id) AND ((p.is_active = true) OR public.is_hq_admin())))));


--
-- TOC entry 5558 (class 3256 OID 18625)
-- Name: objects Admins can delete product images; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Admins can delete product images" ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'product-images'::text) AND ( SELECT public.is_hq_admin() AS is_hq_admin)));


--
-- TOC entry 5565 (class 3256 OID 18638)
-- Name: objects Admins can manage QR codes; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Admins can manage QR codes" ON storage.objects TO authenticated USING (((bucket_id = 'qr-codes'::text) AND ( SELECT public.is_hq_admin() AS is_hq_admin))) WITH CHECK (((bucket_id = 'qr-codes'::text) AND ( SELECT public.is_hq_admin() AS is_hq_admin)));


--
-- TOC entry 5561 (class 3256 OID 18632)
-- Name: objects Admins can manage documents; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Admins can manage documents" ON storage.objects TO authenticated USING (((bucket_id = 'documents'::text) AND ( SELECT public.is_hq_admin() AS is_hq_admin))) WITH CHECK (((bucket_id = 'documents'::text) AND ( SELECT public.is_hq_admin() AS is_hq_admin)));


--
-- TOC entry 5563 (class 3256 OID 18635)
-- Name: objects Admins can manage master data; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Admins can manage master data" ON storage.objects TO authenticated USING (((bucket_id = 'master-data'::text) AND ( SELECT public.is_hq_admin() AS is_hq_admin))) WITH CHECK (((bucket_id = 'master-data'::text) AND ( SELECT public.is_hq_admin() AS is_hq_admin)));


--
-- TOC entry 5557 (class 3256 OID 18624)
-- Name: objects Admins can update product images; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Admins can update product images" ON storage.objects FOR UPDATE TO authenticated USING ((bucket_id = 'product-images'::text)) WITH CHECK (( SELECT public.is_hq_admin() AS is_hq_admin));


--
-- TOC entry 5562 (class 3256 OID 18634)
-- Name: objects Admins can view master data; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Admins can view master data" ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'master-data'::text) AND ( SELECT public.is_hq_admin() AS is_hq_admin)));


--
-- TOC entry 5610 (class 3256 OID 28482)
-- Name: objects Allow QR file access; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Allow QR file access" ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'qr-codes'::text));


--
-- TOC entry 5611 (class 3256 OID 28483)
-- Name: objects Allow QR file upload; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Allow QR file upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'qr-codes'::text));


--
-- TOC entry 5556 (class 3256 OID 18623)
-- Name: objects Authenticated can upload product images; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Authenticated can upload product images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'product-images'::text) AND ( SELECT public.is_hq_admin() AS is_hq_admin)));


--
-- TOC entry 5560 (class 3256 OID 18631)
-- Name: objects Authenticated can view documents; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Authenticated can view documents" ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'documents'::text));


--
-- TOC entry 5600 (class 3256 OID 27387)
-- Name: objects Give anon users access to JPG images in folder 10vraxa_0; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Give anon users access to JPG images in folder 10vraxa_0" ON storage.objects FOR SELECT USING (((bucket_id = 'organization-logos'::text) AND (storage.extension(name) = 'jpg'::text) AND (lower((storage.foldername(name))[1]) = 'public'::text) AND (auth.role() = 'anon'::text)));


--
-- TOC entry 5599 (class 3256 OID 27386)
-- Name: objects Give anon users access to JPG images in folder 10vraxa_1; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Give anon users access to JPG images in folder 10vraxa_1" ON storage.objects FOR INSERT WITH CHECK (((bucket_id = 'organization-logos'::text) AND (storage.extension(name) = 'jpg'::text) AND (lower((storage.foldername(name))[1]) = 'public'::text) AND (auth.role() = 'anon'::text)));


--
-- TOC entry 5601 (class 3256 OID 27388)
-- Name: objects Give anon users access to JPG images in folder 10vraxa_2; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Give anon users access to JPG images in folder 10vraxa_2" ON storage.objects FOR UPDATE USING (((bucket_id = 'organization-logos'::text) AND (storage.extension(name) = 'jpg'::text) AND (lower((storage.foldername(name))[1]) = 'public'::text) AND (auth.role() = 'anon'::text)));


--
-- TOC entry 5602 (class 3256 OID 27389)
-- Name: objects Give users access to own folder 10vraxa_0; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Give users access to own folder 10vraxa_0" ON storage.objects FOR SELECT USING (((bucket_id = 'organization-logos'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[1])));


--
-- TOC entry 5604 (class 3256 OID 27391)
-- Name: objects Give users access to own folder 10vraxa_1; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Give users access to own folder 10vraxa_1" ON storage.objects FOR INSERT WITH CHECK (((bucket_id = 'organization-logos'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[1])));


--
-- TOC entry 5605 (class 3256 OID 27392)
-- Name: objects Give users access to own folder 10vraxa_2; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Give users access to own folder 10vraxa_2" ON storage.objects FOR UPDATE USING (((bucket_id = 'organization-logos'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[1])));


--
-- TOC entry 5603 (class 3256 OID 27390)
-- Name: objects Give users access to own folder 10vraxa_3; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Give users access to own folder 10vraxa_3" ON storage.objects FOR DELETE USING (((bucket_id = 'organization-logos'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[1])));


--
-- TOC entry 5606 (class 3256 OID 27393)
-- Name: objects Give users authenticated access to folder 10vraxa_0; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Give users authenticated access to folder 10vraxa_0" ON storage.objects FOR SELECT USING (((bucket_id = 'organization-logos'::text) AND ((storage.foldername(name))[1] = 'private'::text) AND (auth.role() = 'authenticated'::text)));


--
-- TOC entry 5608 (class 3256 OID 27395)
-- Name: objects Give users authenticated access to folder 10vraxa_1; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Give users authenticated access to folder 10vraxa_1" ON storage.objects FOR INSERT WITH CHECK (((bucket_id = 'organization-logos'::text) AND ((storage.foldername(name))[1] = 'private'::text) AND (auth.role() = 'authenticated'::text)));


--
-- TOC entry 5607 (class 3256 OID 27394)
-- Name: objects Give users authenticated access to folder 10vraxa_2; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Give users authenticated access to folder 10vraxa_2" ON storage.objects FOR UPDATE USING (((bucket_id = 'organization-logos'::text) AND ((storage.foldername(name))[1] = 'private'::text) AND (auth.role() = 'authenticated'::text)));


--
-- TOC entry 5609 (class 3256 OID 27396)
-- Name: objects Give users authenticated access to folder 10vraxa_3; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Give users authenticated access to folder 10vraxa_3" ON storage.objects FOR DELETE USING (((bucket_id = 'organization-logos'::text) AND ((storage.foldername(name))[1] = 'private'::text) AND (auth.role() = 'authenticated'::text)));


--
-- TOC entry 5564 (class 3256 OID 18637)
-- Name: objects Public can view QR codes; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Public can view QR codes" ON storage.objects FOR SELECT USING ((bucket_id = 'qr-codes'::text));


--
-- TOC entry 5559 (class 3256 OID 18626)
-- Name: objects Public can view avatars; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Public can view avatars" ON storage.objects FOR SELECT USING ((bucket_id = 'avatars'::text));


--
-- TOC entry 5555 (class 3256 OID 18622)
-- Name: objects Public can view product images; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Public can view product images" ON storage.objects FOR SELECT USING ((bucket_id = 'product-images'::text));


--
-- TOC entry 5598 (class 3256 OID 27063)
-- Name: objects Users can delete avatars; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Users can delete avatars" ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'avatars'::text) AND (((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)) OR (EXISTS ( SELECT 1
   FROM ((public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
     JOIN public.organizations o ON ((u.organization_id = o.id)))
  WHERE ((u.id = auth.uid()) AND (o.org_type_code = 'HQ'::text) AND (r.role_level <= 20)))))));


--
-- TOC entry 5597 (class 3256 OID 27060)
-- Name: objects Users can update avatars; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Users can update avatars" ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'avatars'::text) AND (((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)) OR (EXISTS ( SELECT 1
   FROM ((public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
     JOIN public.organizations o ON ((u.organization_id = o.id)))
  WHERE ((u.id = auth.uid()) AND (o.org_type_code = 'HQ'::text) AND (r.role_level <= 20))))))) WITH CHECK (((bucket_id = 'avatars'::text) AND (((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)) OR (EXISTS ( SELECT 1
   FROM ((public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
     JOIN public.organizations o ON ((u.organization_id = o.id)))
  WHERE ((u.id = auth.uid()) AND (o.org_type_code = 'HQ'::text) AND (r.role_level <= 20)))))));


--
-- TOC entry 5596 (class 3256 OID 27058)
-- Name: objects Users can upload avatars; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Users can upload avatars" ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'avatars'::text) AND (((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)) OR (EXISTS ( SELECT 1
   FROM ((public.users u
     JOIN public.roles r ON ((u.role_code = r.role_code)))
     JOIN public.organizations o ON ((u.organization_id = o.id)))
  WHERE ((u.id = auth.uid()) AND (o.org_type_code = 'HQ'::text) AND (r.role_level <= 20)))))));


--
-- TOC entry 5483 (class 0 OID 16546)
-- Dependencies: 356
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5489 (class 0 OID 17398)
-- Dependencies: 385
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5485 (class 0 OID 16588)
-- Dependencies: 358
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5484 (class 0 OID 16561)
-- Dependencies: 357
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5588 (class 3256 OID 23075)
-- Name: objects order_docs_delete; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY order_docs_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'order-documents'::text) AND ( SELECT ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user()))));


--
-- TOC entry 5585 (class 3256 OID 23072)
-- Name: objects order_docs_insert; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY order_docs_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'order-documents'::text) AND ( SELECT ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user()))));


--
-- TOC entry 5586 (class 3256 OID 23073)
-- Name: objects order_docs_select; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY order_docs_select ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'order-documents'::text));


--
-- TOC entry 5587 (class 3256 OID 23074)
-- Name: objects order_docs_update; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY order_docs_update ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'order-documents'::text) AND ( SELECT ((public.get_org_type(public.current_user_org_id()) = 'HQ'::text) AND public.is_power_user())))) WITH CHECK ((bucket_id = 'order-documents'::text));


--
-- TOC entry 5488 (class 0 OID 17310)
-- Dependencies: 384
-- Name: prefixes; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.prefixes ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5486 (class 0 OID 17256)
-- Dependencies: 382
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5487 (class 0 OID 17270)
-- Dependencies: 383
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

-- Completed on 2025-10-23 14:21:28 +08

--
-- PostgreSQL database dump complete
--

\unrestrict wp8Ad4e9utI0SMZpqd0o60QjiLJcHr6NEeF1iiS0cReGKxHjhicf4C2So6LNUam

