-- Add warranty_bonus column to organizations table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS warranty_bonus NUMERIC(5, 2);

-- Add comment
COMMENT ON COLUMN organizations.warranty_bonus IS 'Percentage of order value allocated for warranty bonus';
