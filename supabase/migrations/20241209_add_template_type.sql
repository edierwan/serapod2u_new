-- Add template_type column to journey_configurations
-- This allows users to select between different template styles (classic, premium)

ALTER TABLE public.journey_configurations 
ADD COLUMN IF NOT EXISTS template_type text DEFAULT 'classic';

-- Add comment
COMMENT ON COLUMN public.journey_configurations.template_type IS 'Template style for the journey: classic (simple welcome page) or premium (modern app-like interface with bottom navigation)';

-- Add check constraint for valid values
ALTER TABLE public.journey_configurations 
ADD CONSTRAINT journey_configurations_template_type_check 
CHECK (template_type IS NULL OR template_type IN ('classic', 'premium'));
