-- Marketing Capabilities Tables

-- 1. Marketing Campaigns
CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) NOT NULL,
    name TEXT NOT NULL,
    objective TEXT CHECK (objective IN ('Promo', 'Announcement', 'Product Update', 'Event', 'Winback', 'Loyalty Reminder')),
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'completed', 'paused', 'failed', 'archived')),
    
    -- Audience Filters Snapshot (JSONB stores the exact filter config used)
    audience_filters JSONB DEFAULT '{}'::jsonb,
    estimated_count INTEGER DEFAULT 0,
    
    -- Message Content
    template_id UUID, -- Optional link to template
    message_body TEXT NOT NULL,
    media_url TEXT,
    
    -- Schedule & Config
    scheduled_at TIMESTAMPTZ,
    quiet_hours_enabled BOOLEAN DEFAULT true,
    quiet_hours_start TIME DEFAULT '22:00',
    quiet_hours_end TIME DEFAULT '09:00',
    
    -- Stats
    total_recipients INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    read_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Marketing Templates
CREATE TABLE IF NOT EXISTS marketing_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    body TEXT NOT NULL,
    variables JSONB DEFAULT '[]'::jsonb, -- e.g. ["name", "points"]
    is_system BOOLEAN DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Campaign Recipients (Logs)
CREATE TABLE IF NOT EXISTS marketing_campaign_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    phone TEXT NOT NULL,
    name TEXT,
    
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'skipped')),
    failure_reason TEXT,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Unsubscribes / Opt-outs
CREATE TABLE IF NOT EXISTS marketing_opt_outs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id),
    phone TEXT NOT NULL, -- Phone is the key for WhatsApp
    user_id UUID REFERENCES users(id), -- Optional link if known user
    source TEXT DEFAULT 'keyword' CHECK (source IN ('keyword', 'admin', 'user_preference')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, phone)
);

-- Indexes for performance
CREATE INDEX idx_campaigns_org ON marketing_campaigns(org_id);
CREATE INDEX idx_campaigns_status ON marketing_campaigns(status);
CREATE INDEX idx_recipients_campaign ON marketing_campaign_recipients(campaign_id);
CREATE INDEX idx_recipients_status ON marketing_campaign_recipients(status);
CREATE INDEX idx_opt_outs_phone ON marketing_opt_outs(phone);

-- Seed some templates
INSERT INTO marketing_templates (org_id, name, category, body, variables, is_system) 
SELECT 
    id as org_id, 
    'Standard Promo', 
    'Promo', 
    'Hello {name}! We have a special offer just for you. Get 20% off your next order. Visit {short_link}', 
    '["name", "short_link"]'::jsonb,
    true
FROM organizations WHERE org_type_code = 'HQ' LIMIT 1
ON CONFLICT DO NOTHING;

-- RLS Policies (Simplified for development, adjust for prod)
ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_opt_outs ENABLE ROW LEVEL SECURITY;

-- Allow HQ admins full access (Assuming checking auth.uid() -> user -> org relation via app logic or simple policy)
-- For this agent task, I'll create a permissive policy for authenticated users belonging to the org
CREATE POLICY "Enable access for users based on org_id" ON marketing_campaigns
    USING (auth.uid() IN (SELECT id FROM users WHERE organization_id = marketing_campaigns.org_id));

CREATE POLICY "Enable access for users based on org_id" ON marketing_templates
    USING (auth.uid() IN (SELECT id FROM users WHERE organization_id = marketing_templates.org_id));
    
-- (Add more policies as needed for rigorous security)
