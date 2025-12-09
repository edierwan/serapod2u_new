CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.system_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.organizations(id),
    module TEXT NOT NULL,
    key TEXT NOT NULL,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(company_id, module, key)
);

-- Enable RLS
ALTER TABLE core.system_preferences ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Allow read access for users in same company" ON core.system_preferences
    FOR SELECT USING (
        company_id IN (
            SELECT organization_id FROM public.users WHERE id = auth.uid()
        )
    );

CREATE POLICY "Allow all access for admins" ON core.system_preferences
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.users up
            JOIN public.roles r ON up.role_code = r.role_code
            WHERE up.id = auth.uid() 
            AND up.organization_id = core.system_preferences.company_id
            AND r.role_level <= 20
        )
    );

-- Grant usage
GRANT USAGE ON SCHEMA core TO authenticated;
GRANT ALL ON core.system_preferences TO authenticated;
