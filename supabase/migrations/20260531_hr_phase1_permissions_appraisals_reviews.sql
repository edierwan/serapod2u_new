-- ============================================================
-- HR Phase 1 — "Stop the Bleeding": Permissions, Appraisals, Reviews
-- Date: 2026-05-31
-- Scope: ADDITIVE only. Creates 7 tables that existing wired API
--        routes already query but which do not yet exist in the DB:
--          1. hr_permissions               (GLOBAL permission catalog)
--          2. hr_access_groups             (org-scoped)
--          3. hr_access_group_members      (org-scoped via group)
--          4. hr_access_group_permissions  (org-scoped via group)
--          5. hr_appraisal_cycles          (org-scoped)
--          6. hr_review_templates          (org-scoped, empty/functional)
--          7. hr_performance_reviews       (org-scoped)
--
-- No existing table/column/policy is altered or dropped.
-- RLS follows the existing organization-isolation pattern used by
-- hr_leave_types / departments (users -> roles role_level join).
--
-- Routes unblocked:
--   /api/hr/settings/permissions        (GET/POST/DELETE)
--   /api/hr/performance/appraisals       (GET/POST)
--   /api/hr/performance/reviews          (GET/POST/PATCH)
--   /api/hr/config/audit  default_access_groups action
-- ============================================================

BEGIN;

-- ============================================================
-- 1. hr_permissions — GLOBAL catalog of permission codes
--    (intentionally NOT organization-scoped; shared across orgs.
--     Seeder upserts on `code`, so code must be UNIQUE.)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hr_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    module text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    is_system boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hr_permissions_pkey PRIMARY KEY (id),
    CONSTRAINT hr_permissions_code_key UNIQUE (code)
);
COMMENT ON TABLE public.hr_permissions IS 'Global catalog of HR permission codes (shared across organizations). Seeded via /api/hr/settings/permissions seed_permissions_catalog.';

CREATE INDEX IF NOT EXISTS hr_permissions_module_idx ON public.hr_permissions (module);

-- ============================================================
-- 2. hr_access_groups — named permission group per organization
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hr_access_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hr_access_groups_pkey PRIMARY KEY (id),
    CONSTRAINT hr_access_groups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
    CONSTRAINT hr_access_groups_org_name_key UNIQUE (organization_id, name)
);
COMMENT ON TABLE public.hr_access_groups IS 'HR access groups (roles) scoped per organization.';

CREATE INDEX IF NOT EXISTS hr_access_groups_org_idx ON public.hr_access_groups (organization_id);

-- ============================================================
-- 3. hr_access_group_members — user <-> access group membership
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hr_access_group_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    scope_type text DEFAULT 'global'::text NOT NULL,
    scope_value text,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hr_access_group_members_pkey PRIMARY KEY (id),
    CONSTRAINT hr_access_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.hr_access_groups(id) ON DELETE CASCADE,
    CONSTRAINT hr_access_group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT hr_access_group_members_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT hr_access_group_members_unique UNIQUE (group_id, user_id, scope_type, scope_value)
);
COMMENT ON TABLE public.hr_access_group_members IS 'Membership linking users to HR access groups, with optional scope.';

CREATE INDEX IF NOT EXISTS hr_access_group_members_group_idx ON public.hr_access_group_members (group_id);
CREATE INDEX IF NOT EXISTS hr_access_group_members_user_idx ON public.hr_access_group_members (user_id);

-- ============================================================
-- 4. hr_access_group_permissions — access group <-> permission mapping
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hr_access_group_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hr_access_group_permissions_pkey PRIMARY KEY (id),
    CONSTRAINT hr_access_group_permissions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.hr_access_groups(id) ON DELETE CASCADE,
    CONSTRAINT hr_access_group_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.hr_permissions(id) ON DELETE CASCADE,
    CONSTRAINT hr_access_group_permissions_unique UNIQUE (group_id, permission_id)
);
COMMENT ON TABLE public.hr_access_group_permissions IS 'Maps HR access groups to permission codes.';

CREATE INDEX IF NOT EXISTS hr_access_group_permissions_group_idx ON public.hr_access_group_permissions (group_id);
CREATE INDEX IF NOT EXISTS hr_access_group_permissions_permission_idx ON public.hr_access_group_permissions (permission_id);

-- ============================================================
-- 5. hr_appraisal_cycles — appraisal period definitions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hr_appraisal_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    cycle_type text DEFAULT 'annual'::text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    self_review_enabled boolean DEFAULT true NOT NULL,
    peer_review_enabled boolean DEFAULT false NOT NULL,
    manager_review_required boolean DEFAULT true NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hr_appraisal_cycles_pkey PRIMARY KEY (id),
    CONSTRAINT hr_appraisal_cycles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE
);
COMMENT ON TABLE public.hr_appraisal_cycles IS 'Performance appraisal cycle definitions, scoped per organization.';

CREATE INDEX IF NOT EXISTS hr_appraisal_cycles_org_idx ON public.hr_appraisal_cycles (organization_id);

-- ============================================================
-- 6. hr_review_templates — review form templates (empty/functional)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hr_review_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    template_type text DEFAULT 'general'::text NOT NULL,
    description text,
    sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hr_review_templates_pkey PRIMARY KEY (id),
    CONSTRAINT hr_review_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE
);
COMMENT ON TABLE public.hr_review_templates IS 'Performance review form templates, scoped per organization. Created empty in Phase 1; review_template_id may be NULL.';

CREATE INDEX IF NOT EXISTS hr_review_templates_org_idx ON public.hr_review_templates (organization_id);

-- ============================================================
-- 7. hr_performance_reviews — individual performance reviews
--    NOTE: FK constraint names MUST be exactly
--      hr_performance_reviews_employee_id_fkey
--      hr_performance_reviews_reviewer_id_fkey
--    so PostgREST disambiguates the two users embeds used by
--    /api/hr/performance/reviews GET.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hr_performance_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    reviewer_id uuid,
    appraisal_cycle_id uuid,
    review_template_id uuid,
    review_type text DEFAULT 'manager'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    due_date date,
    submitted_at timestamp with time zone,
    reviewed_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    overall_rating numeric,
    overall_remarks text,
    employee_remarks text,
    responses jsonb,
    kpi_scores jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hr_performance_reviews_pkey PRIMARY KEY (id),
    CONSTRAINT hr_performance_reviews_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
    CONSTRAINT hr_performance_reviews_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT hr_performance_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT hr_performance_reviews_appraisal_cycle_id_fkey FOREIGN KEY (appraisal_cycle_id) REFERENCES public.hr_appraisal_cycles(id) ON DELETE SET NULL,
    CONSTRAINT hr_performance_reviews_review_template_id_fkey FOREIGN KEY (review_template_id) REFERENCES public.hr_review_templates(id) ON DELETE SET NULL
);
COMMENT ON TABLE public.hr_performance_reviews IS 'Individual performance reviews, scoped per organization.';

CREATE INDEX IF NOT EXISTS hr_performance_reviews_org_idx ON public.hr_performance_reviews (organization_id);
CREATE INDEX IF NOT EXISTS hr_performance_reviews_employee_idx ON public.hr_performance_reviews (employee_id);
CREATE INDEX IF NOT EXISTS hr_performance_reviews_reviewer_idx ON public.hr_performance_reviews (reviewer_id);
CREATE INDEX IF NOT EXISTS hr_performance_reviews_cycle_idx ON public.hr_performance_reviews (appraisal_cycle_id);

-- ============================================================
-- RLS — follows existing organization-isolation pattern.
--   SELECT: row belongs to caller's organization.
--   WRITE : caller is an HR admin (role_level <= 20) within the
--           row's organization.
--   hr_permissions is GLOBAL: any authenticated user may SELECT;
--           only admins may write.
-- ============================================================

-- 1. hr_permissions (GLOBAL catalog)
ALTER TABLE public.hr_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_permissions_select ON public.hr_permissions
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY hr_permissions_insert ON public.hr_permissions
    FOR INSERT WITH CHECK (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
    ));

CREATE POLICY hr_permissions_update ON public.hr_permissions
    FOR UPDATE USING (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
    ));

CREATE POLICY hr_permissions_delete ON public.hr_permissions
    FOR DELETE USING (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
    ));

-- 2. hr_access_groups (org-scoped)
ALTER TABLE public.hr_access_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_access_groups_select ON public.hr_access_groups
    FOR SELECT USING (organization_id IN (
        SELECT organization_id FROM public.users WHERE id = auth.uid()
    ));

CREATE POLICY hr_access_groups_insert ON public.hr_access_groups
    FOR INSERT WITH CHECK (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
          AND u.organization_id = hr_access_groups.organization_id
    ));

CREATE POLICY hr_access_groups_update ON public.hr_access_groups
    FOR UPDATE USING (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
          AND u.organization_id = hr_access_groups.organization_id
    ));

CREATE POLICY hr_access_groups_delete ON public.hr_access_groups
    FOR DELETE USING (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
          AND u.organization_id = hr_access_groups.organization_id
    ));

-- 3. hr_access_group_members (org resolved through parent group)
ALTER TABLE public.hr_access_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_access_group_members_select ON public.hr_access_group_members
    FOR SELECT USING (group_id IN (
        SELECT g.id FROM public.hr_access_groups g
        WHERE g.organization_id IN (
            SELECT organization_id FROM public.users WHERE id = auth.uid()
        )
    ));

CREATE POLICY hr_access_group_members_insert ON public.hr_access_group_members
    FOR INSERT WITH CHECK (EXISTS (
        SELECT 1 FROM public.hr_access_groups g
        JOIN public.users u ON u.organization_id = g.organization_id
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE g.id = hr_access_group_members.group_id
          AND u.id = auth.uid() AND r.role_level <= 20
    ));

CREATE POLICY hr_access_group_members_delete ON public.hr_access_group_members
    FOR DELETE USING (EXISTS (
        SELECT 1 FROM public.hr_access_groups g
        JOIN public.users u ON u.organization_id = g.organization_id
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE g.id = hr_access_group_members.group_id
          AND u.id = auth.uid() AND r.role_level <= 20
    ));

-- 4. hr_access_group_permissions (org resolved through parent group)
ALTER TABLE public.hr_access_group_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_access_group_permissions_select ON public.hr_access_group_permissions
    FOR SELECT USING (group_id IN (
        SELECT g.id FROM public.hr_access_groups g
        WHERE g.organization_id IN (
            SELECT organization_id FROM public.users WHERE id = auth.uid()
        )
    ));

CREATE POLICY hr_access_group_permissions_insert ON public.hr_access_group_permissions
    FOR INSERT WITH CHECK (EXISTS (
        SELECT 1 FROM public.hr_access_groups g
        JOIN public.users u ON u.organization_id = g.organization_id
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE g.id = hr_access_group_permissions.group_id
          AND u.id = auth.uid() AND r.role_level <= 20
    ));

CREATE POLICY hr_access_group_permissions_delete ON public.hr_access_group_permissions
    FOR DELETE USING (EXISTS (
        SELECT 1 FROM public.hr_access_groups g
        JOIN public.users u ON u.organization_id = g.organization_id
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE g.id = hr_access_group_permissions.group_id
          AND u.id = auth.uid() AND r.role_level <= 20
    ));

-- 5. hr_appraisal_cycles (org-scoped)
ALTER TABLE public.hr_appraisal_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_appraisal_cycles_select ON public.hr_appraisal_cycles
    FOR SELECT USING (organization_id IN (
        SELECT organization_id FROM public.users WHERE id = auth.uid()
    ));

CREATE POLICY hr_appraisal_cycles_insert ON public.hr_appraisal_cycles
    FOR INSERT WITH CHECK (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
          AND u.organization_id = hr_appraisal_cycles.organization_id
    ));

CREATE POLICY hr_appraisal_cycles_update ON public.hr_appraisal_cycles
    FOR UPDATE USING (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
          AND u.organization_id = hr_appraisal_cycles.organization_id
    ));

CREATE POLICY hr_appraisal_cycles_delete ON public.hr_appraisal_cycles
    FOR DELETE USING (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
          AND u.organization_id = hr_appraisal_cycles.organization_id
    ));

-- 6. hr_review_templates (org-scoped)
ALTER TABLE public.hr_review_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_review_templates_select ON public.hr_review_templates
    FOR SELECT USING (organization_id IN (
        SELECT organization_id FROM public.users WHERE id = auth.uid()
    ));

CREATE POLICY hr_review_templates_insert ON public.hr_review_templates
    FOR INSERT WITH CHECK (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
          AND u.organization_id = hr_review_templates.organization_id
    ));

CREATE POLICY hr_review_templates_update ON public.hr_review_templates
    FOR UPDATE USING (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
          AND u.organization_id = hr_review_templates.organization_id
    ));

CREATE POLICY hr_review_templates_delete ON public.hr_review_templates
    FOR DELETE USING (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
          AND u.organization_id = hr_review_templates.organization_id
    ));

-- 7. hr_performance_reviews (org-scoped; participants may read/update own)
ALTER TABLE public.hr_performance_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_performance_reviews_select ON public.hr_performance_reviews
    FOR SELECT USING (
        organization_id IN (SELECT organization_id FROM public.users WHERE id = auth.uid())
        AND (
            employee_id = auth.uid()
            OR reviewer_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.users u
                JOIN public.roles r ON u.role_code = r.role_code
                WHERE u.id = auth.uid() AND r.role_level <= 20
                  AND u.organization_id = hr_performance_reviews.organization_id
            )
        )
    );

CREATE POLICY hr_performance_reviews_insert ON public.hr_performance_reviews
    FOR INSERT WITH CHECK (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
          AND u.organization_id = hr_performance_reviews.organization_id
    ));

CREATE POLICY hr_performance_reviews_update ON public.hr_performance_reviews
    FOR UPDATE USING (
        organization_id IN (SELECT organization_id FROM public.users WHERE id = auth.uid())
        AND (
            employee_id = auth.uid()
            OR reviewer_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.users u
                JOIN public.roles r ON u.role_code = r.role_code
                WHERE u.id = auth.uid() AND r.role_level <= 20
                  AND u.organization_id = hr_performance_reviews.organization_id
            )
        )
    );

CREATE POLICY hr_performance_reviews_delete ON public.hr_performance_reviews
    FOR DELETE USING (EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON u.role_code = r.role_code
        WHERE u.id = auth.uid() AND r.role_level <= 20
          AND u.organization_id = hr_performance_reviews.organization_id
    ));

COMMIT;

-- ============================================================
-- ROLLBACK (manual; reverse dependency order). Additive migration,
-- so dropping these tables cannot affect any pre-existing data.
-- ------------------------------------------------------------
-- BEGIN;
--   DROP TABLE IF EXISTS public.hr_performance_reviews;
--   DROP TABLE IF EXISTS public.hr_review_templates;
--   DROP TABLE IF EXISTS public.hr_appraisal_cycles;
--   DROP TABLE IF EXISTS public.hr_access_group_permissions;
--   DROP TABLE IF EXISTS public.hr_access_group_members;
--   DROP TABLE IF EXISTS public.hr_access_groups;
--   DROP TABLE IF EXISTS public.hr_permissions;
-- COMMIT;
-- ============================================================
