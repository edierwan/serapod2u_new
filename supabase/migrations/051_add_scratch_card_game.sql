-- Migration: 051_add_scratch_card_game.sql

-- 1. Add columns to journey_configurations
ALTER TABLE journey_configurations
ADD COLUMN IF NOT EXISTS enable_scratch_card_game BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS scratch_card_require_otp BOOLEAN DEFAULT FALSE;

-- 2. Create scratch_card_campaigns table
CREATE TABLE IF NOT EXISTS scratch_card_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    description TEXT,
    journey_config_id UUID REFERENCES journey_configurations(id),
    status TEXT CHECK (status IN ('draft', 'active', 'scheduled', 'ended', 'paused')) DEFAULT 'draft',
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    max_plays_per_day INT DEFAULT 1,
    max_plays_total_per_consumer INT,
    max_total_plays INT,
    theme_config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- 3. Create scratch_card_rewards table
CREATE TABLE IF NOT EXISTS scratch_card_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES scratch_card_campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT CHECK (type IN ('points', 'product', 'voucher', 'link', 'no_prize')) NOT NULL,
    value_points INT,
    product_id UUID, -- References products(id) if exists
    product_quantity INT DEFAULT 1,
    voucher_template_id UUID,
    external_link TEXT,
    probability FLOAT NOT NULL DEFAULT 0,
    max_winners INT,
    max_winners_per_day INT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create scratch_card_plays table
CREATE TABLE IF NOT EXISTS scratch_card_plays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES scratch_card_campaigns(id),
    qr_code_id UUID REFERENCES qr_codes(id),
    consumer_phone TEXT,
    consumer_name TEXT,
    reward_id UUID REFERENCES scratch_card_rewards(id),
    is_win BOOLEAN DEFAULT FALSE,
    played_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. RLS Policies
ALTER TABLE scratch_card_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE scratch_card_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE scratch_card_plays ENABLE ROW LEVEL SECURITY;

-- Policies for scratch_card_campaigns
CREATE POLICY "Users can view campaigns of their organization" ON scratch_card_campaigns
    FOR SELECT USING (org_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));

CREATE POLICY "Users can insert campaigns for their organization" ON scratch_card_campaigns
    FOR INSERT WITH CHECK (org_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));

CREATE POLICY "Users can update campaigns of their organization" ON scratch_card_campaigns
    FOR UPDATE USING (org_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));

CREATE POLICY "Users can delete campaigns of their organization" ON scratch_card_campaigns
    FOR DELETE USING (org_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));

-- Policies for scratch_card_rewards
CREATE POLICY "Users can view rewards of their organization's campaigns" ON scratch_card_rewards
    FOR SELECT USING (campaign_id IN (
        SELECT id FROM scratch_card_campaigns WHERE org_id IN (
            SELECT organization_id FROM users WHERE id = auth.uid()
        )
    ));

CREATE POLICY "Users can manage rewards of their organization's campaigns" ON scratch_card_rewards
    FOR ALL USING (campaign_id IN (
        SELECT id FROM scratch_card_campaigns WHERE org_id IN (
            SELECT organization_id FROM users WHERE id = auth.uid()
        )
    ));

-- Policies for scratch_card_plays
CREATE POLICY "Users can view plays of their organization's campaigns" ON scratch_card_plays
    FOR SELECT USING (campaign_id IN (
        SELECT id FROM scratch_card_campaigns WHERE org_id IN (
            SELECT organization_id FROM users WHERE id = auth.uid()
        )
    ));
