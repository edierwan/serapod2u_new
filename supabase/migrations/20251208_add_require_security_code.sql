-- Add require_security_code field to journey_configurations table
-- This field controls whether a journey requires a 2-digit security code for Lucky Draw, Redemption & Games
-- Default is false to ensure all existing journeys continue working without changes (NON-BREAKING)

ALTER TABLE public.journey_configurations
ADD COLUMN IF NOT EXISTS require_security_code boolean NOT NULL DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.journey_configurations.require_security_code IS 
'When true, users must enter the last 2 digits from the product box (printed security code) before accessing Lucky Draw, Redemption, or Games. Enhances anti-fraud protection.';
