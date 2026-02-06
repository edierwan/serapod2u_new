-- ============================================================================
-- HR Mobile Phase 1 - Supporting Schema (v2 - column-name fixes)
-- ============================================================================
-- Run this migration AFTER the existing HR migrations.
-- IMPORTANT existing column conventions:
--   hr_leave_requests    -> employee_id  (not user_id)
--   hr_leave_balances    -> employee_id, entitled, taken, pending, carried_forward
--   hr_payroll_run_items -> employee_user_id, gross_amount, deductions_amount, net_amount
--   hr_payroll_runs      -> NO name column
-- ============================================================================

-- 1. hr_attendance_entries
CREATE TABLE IF NOT EXISTS public.hr_attendance_entries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    shift_id        uuid,
    clock_in_at     timestamptz NOT NULL DEFAULT now(),
    clock_out_at    timestamptz,
    attendance_flag text,
    total_hours     numeric(6,2),
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_entries_employee_date
    ON public.hr_attendance_entries (employee_id, clock_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_entries_org
    ON public.hr_attendance_entries (organization_id, clock_in_at DESC);

ALTER TABLE public.hr_attendance_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_attendance_entries' AND policyname = 'attendance_own') THEN
        CREATE POLICY attendance_own ON public.hr_attendance_entries FOR ALL USING (auth.uid() = employee_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_attendance_entries' AND policyname = 'attendance_org_read') THEN
        CREATE POLICY attendance_org_read ON public.hr_attendance_entries
            FOR SELECT USING (organization_id IN (SELECT organization_id FROM public.users WHERE id = auth.uid()));
    END IF;
END $$;

-- 2. hr_attendance_shifts
CREATE TABLE IF NOT EXISTS public.hr_attendance_shifts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name            text NOT NULL,
    start_time      time NOT NULL DEFAULT '09:00',
    end_time        time NOT NULL DEFAULT '18:00',
    break_minutes   int NOT NULL DEFAULT 60,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hr_attendance_shifts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_attendance_shifts' AND policyname = 'shifts_org_read') THEN
        CREATE POLICY shifts_org_read ON public.hr_attendance_shifts
            FOR SELECT USING (organization_id IN (SELECT organization_id FROM public.users WHERE id = auth.uid()));
    END IF;
END $$;

-- 3. hr_attendance_corrections
CREATE TABLE IF NOT EXISTS public.hr_attendance_corrections (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    attendance_entry_id uuid REFERENCES public.hr_attendance_entries(id) ON DELETE SET NULL,
    reason              text NOT NULL,
    corrected_clock_in  timestamptz,
    corrected_clock_out timestamptz,
    status              text NOT NULL DEFAULT 'pending',
    reviewed_by         uuid REFERENCES public.users(id),
    reviewed_at         timestamptz,
    review_comment      text,
    requested_at        timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_corrections_employee
    ON public.hr_attendance_corrections (employee_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_status
    ON public.hr_attendance_corrections (organization_id, status);

ALTER TABLE public.hr_attendance_corrections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_attendance_corrections' AND policyname = 'corrections_own') THEN
        CREATE POLICY corrections_own ON public.hr_attendance_corrections FOR ALL USING (auth.uid() = employee_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_attendance_corrections' AND policyname = 'corrections_org_read') THEN
        CREATE POLICY corrections_org_read ON public.hr_attendance_corrections
            FOR SELECT USING (organization_id IN (SELECT organization_id FROM public.users WHERE id = auth.uid()));
    END IF;
END $$;

-- 4. Add detailed breakdown columns to existing hr_payroll_run_items
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_payroll_run_items' AND column_name='basic_salary') THEN
        ALTER TABLE public.hr_payroll_run_items ADD COLUMN basic_salary numeric(12,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_payroll_run_items' AND column_name='allowances_json') THEN
        ALTER TABLE public.hr_payroll_run_items ADD COLUMN allowances_json jsonb DEFAULT '[]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_payroll_run_items' AND column_name='deductions_json') THEN
        ALTER TABLE public.hr_payroll_run_items ADD COLUMN deductions_json jsonb DEFAULT '[]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_payroll_run_items' AND column_name='epf_employee') THEN
        ALTER TABLE public.hr_payroll_run_items ADD COLUMN epf_employee numeric(12,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_payroll_run_items' AND column_name='epf_employer') THEN
        ALTER TABLE public.hr_payroll_run_items ADD COLUMN epf_employer numeric(12,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_payroll_run_items' AND column_name='socso_employee') THEN
        ALTER TABLE public.hr_payroll_run_items ADD COLUMN socso_employee numeric(12,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_payroll_run_items' AND column_name='socso_employer') THEN
        ALTER TABLE public.hr_payroll_run_items ADD COLUMN socso_employer numeric(12,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_payroll_run_items' AND column_name='eis_employee') THEN
        ALTER TABLE public.hr_payroll_run_items ADD COLUMN eis_employee numeric(12,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_payroll_run_items' AND column_name='eis_employer') THEN
        ALTER TABLE public.hr_payroll_run_items ADD COLUMN eis_employer numeric(12,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_payroll_run_items' AND column_name='pcb_tax') THEN
        ALTER TABLE public.hr_payroll_run_items ADD COLUMN pcb_tax numeric(12,2) DEFAULT 0;
    END IF;
END $$;

-- 5. Ensure hr_leave_requests has shortcut approval columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_leave_requests' AND column_name='approved_by') THEN
        ALTER TABLE public.hr_leave_requests ADD COLUMN approved_by uuid REFERENCES public.users(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_leave_requests' AND column_name='approved_at') THEN
        ALTER TABLE public.hr_leave_requests ADD COLUMN approved_at timestamptz;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_leave_requests' AND column_name='approval_comment') THEN
        ALTER TABLE public.hr_leave_requests ADD COLUMN approval_comment text;
    END IF;
END $$;

-- 6. Dashboard view (uses employee_id to match actual schema)
CREATE OR REPLACE VIEW public.hr_employee_dashboard AS
SELECT
    u.id AS user_id,
    u.full_name,
    u.organization_id,
    u.role_code,
    (
        SELECT json_build_object(
            'clocked_in', ae.clock_in_at IS NOT NULL AND ae.clock_out_at IS NULL,
            'clock_in_at', ae.clock_in_at,
            'clock_out_at', ae.clock_out_at
        )
        FROM public.hr_attendance_entries ae
        WHERE ae.employee_id = u.id
          AND ae.clock_in_at >= CURRENT_DATE
        ORDER BY ae.clock_in_at DESC
        LIMIT 1
    ) AS today_attendance,
    (
        SELECT count(*)
        FROM public.hr_leave_requests lr
        WHERE lr.organization_id = u.organization_id
          AND lr.status = 'pending'
          AND lr.employee_id != u.id
    ) AS pending_approvals
FROM public.users u;

DO $$
BEGIN
    RAISE NOTICE 'HR Mobile Phase 1 schema migration v2 completed successfully.';
END $$;
