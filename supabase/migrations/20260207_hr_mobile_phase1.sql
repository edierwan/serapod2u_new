-- ============================================================================
-- HR Mobile Phase 1 - Supporting Schema (v3 - matches actual production DB)
-- ============================================================================
-- Run this AFTER all existing HR migrations.
--
-- ACTUAL DB column conventions (from current_schema.sql):
--   hr_attendance_entries      -> user_id (uuid FK to users.id)
--   hr_attendance_corrections  -> requested_by, entry_id
--   hr_leave_balances          -> employee_id (uuid FK to users.id)
--   hr_leave_requests          -> employee_id (uuid FK to users.id)
--   hr_payroll_run_items       -> employee_user_id, pcb_amount, allowances_amount
--   hr_shifts                  -> (NOT hr_attendance_shifts)
--
-- This migration ONLY adds:
--   1. hr_employees bridge table (numeric employee_no starting 10000)
--   2. Backfill existing HQ users into hr_employees
--   3. Shortcut approval columns on hr_leave_requests
--   4. Dashboard summary view for mobile home screen
-- ============================================================================

-- 1. Sequence for employee numbers starting at 10000
CREATE SEQUENCE IF NOT EXISTS public.hr_employee_no_seq
    START WITH 10000
    INCREMENT BY 1
    NO MAXVALUE
    CACHE 1;

-- 2. hr_employees - bridge table giving each user a numeric HR employee ID
CREATE TABLE IF NOT EXISTS public.hr_employees (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_no     integer NOT NULL DEFAULT nextval('public.hr_employee_no_seq'),
    user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    hire_date       date DEFAULT CURRENT_DATE,
    probation_end   date,
    status          text NOT NULL DEFAULT 'active',
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hr_employees_user_org_uniq UNIQUE (user_id, organization_id),
    CONSTRAINT hr_employees_no_uniq UNIQUE (employee_no),
    CONSTRAINT hr_employees_status_check CHECK (status IN ('active','probation','suspended','resigned','terminated'))
);

ALTER SEQUENCE public.hr_employee_no_seq OWNED BY public.hr_employees.employee_no;

CREATE INDEX IF NOT EXISTS hr_employees_org_idx ON public.hr_employees(organization_id);
CREATE INDEX IF NOT EXISTS hr_employees_user_idx ON public.hr_employees(user_id);
CREATE INDEX IF NOT EXISTS hr_employees_no_idx ON public.hr_employees(employee_no);

COMMENT ON TABLE public.hr_employees IS 'HR employee registry. Bridges users table to HR-specific employee_no (auto-increment from 10000). One row per user per organization.';
COMMENT ON COLUMN public.hr_employees.employee_no IS 'Human-readable employee number starting from 10000, auto-assigned';

-- RLS
ALTER TABLE public.hr_employees ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='hr_employees' AND policyname='hr_employees_read') THEN
        CREATE POLICY hr_employees_read ON public.hr_employees
            FOR SELECT USING (
                organization_id IN (SELECT organization_id FROM public.users WHERE id = auth.uid())
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='hr_employees' AND policyname='hr_employees_own') THEN
        CREATE POLICY hr_employees_own ON public.hr_employees
            FOR ALL USING (user_id = auth.uid());
    END IF;
END $$;


-- 3. Backfill: Insert all existing HQ-org users into hr_employees
--    (only if they don't already have an hr_employees row)
INSERT INTO public.hr_employees (user_id, organization_id, hire_date, status)
SELECT
    u.id,
    u.organization_id,
    COALESCE(u.join_date, u.created_at::date),
    CASE
        WHEN u.employment_status = 'active' THEN 'active'
        WHEN u.employment_status = 'resigned' THEN 'resigned'
        WHEN u.employment_status = 'terminated' THEN 'terminated'
        ELSE 'active'
    END
FROM public.users u
JOIN public.organizations o ON o.id = u.organization_id
WHERE o.org_type_code = 'HQ'
  AND u.is_active = true
  AND NOT EXISTS (
      SELECT 1 FROM public.hr_employees he
      WHERE he.user_id = u.id AND he.organization_id = u.organization_id
  )
ON CONFLICT (user_id, organization_id) DO NOTHING;


-- 4. Add employee_no column to users table for quick access (optional convenience)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='users' AND column_name='employee_no') THEN
        ALTER TABLE public.users ADD COLUMN employee_no integer;
    END IF;
END $$;

-- Backfill employee_no into users table
UPDATE public.users u
SET employee_no = he.employee_no
FROM public.hr_employees he
WHERE he.user_id = u.id
  AND u.employee_no IS NULL;


-- 5. Ensure hr_leave_requests has shortcut approval columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='hr_leave_requests' AND column_name='approved_by') THEN
        ALTER TABLE public.hr_leave_requests ADD COLUMN approved_by uuid REFERENCES public.users(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='hr_leave_requests' AND column_name='approved_at') THEN
        ALTER TABLE public.hr_leave_requests ADD COLUMN approved_at timestamptz;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='hr_leave_requests' AND column_name='approval_comment') THEN
        ALTER TABLE public.hr_leave_requests ADD COLUMN approval_comment text;
    END IF;
END $$;


-- 6. Dashboard summary view for mobile home screen
--    Uses ACTUAL column names from production DB
CREATE OR REPLACE VIEW public.hr_employee_dashboard AS
SELECT
    u.id AS user_id,
    u.full_name,
    u.organization_id,
    u.role_code,
    he.employee_no,
    -- Today's attendance (hr_attendance_entries.user_id)
    (
        SELECT json_build_object(
            'clocked_in', ae.clock_in_at IS NOT NULL AND ae.clock_out_at IS NULL,
            'clock_in_at', ae.clock_in_at,
            'clock_out_at', ae.clock_out_at
        )
        FROM public.hr_attendance_entries ae
        WHERE ae.user_id = u.id
          AND ae.clock_in_at >= CURRENT_DATE
        ORDER BY ae.clock_in_at DESC
        LIMIT 1
    ) AS today_attendance,
    -- Pending leave approvals (hr_leave_requests.employee_id)
    (
        SELECT count(*)
        FROM public.hr_leave_requests lr
        WHERE lr.organization_id = u.organization_id
          AND lr.status = 'pending'
          AND lr.employee_id != u.id
    ) AS pending_approvals
FROM public.users u
LEFT JOIN public.hr_employees he ON he.user_id = u.id;


-- 7. Auto-assign employee_no trigger for new HQ users
CREATE OR REPLACE FUNCTION public.fn_auto_create_hr_employee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org_type text;
BEGIN
    -- Only create HR employee record for HQ org users
    SELECT org_type_code INTO v_org_type
    FROM public.organizations
    WHERE id = NEW.organization_id;

    IF v_org_type = 'HQ' THEN
        INSERT INTO public.hr_employees (user_id, organization_id, hire_date, status)
        VALUES (NEW.id, NEW.organization_id, COALESCE(NEW.join_date, CURRENT_DATE), 'active')
        ON CONFLICT (user_id, organization_id) DO NOTHING;

        -- Also update user's employee_no
        UPDATE public.users
        SET employee_no = (
            SELECT employee_no FROM public.hr_employees
            WHERE user_id = NEW.id AND organization_id = NEW.organization_id
        )
        WHERE id = NEW.id AND employee_no IS NULL;
    END IF;

    RETURN NEW;
END;
$$;

-- Drop and recreate to be safe
DROP TRIGGER IF EXISTS trg_auto_create_hr_employee ON public.users;
CREATE TRIGGER trg_auto_create_hr_employee
    AFTER INSERT ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_auto_create_hr_employee();


DO $$
BEGIN
    RAISE NOTICE 'HR Mobile Phase 1 v3 completed: hr_employees table created, HQ users backfilled with employee_no starting from 10000.';
END $$;
