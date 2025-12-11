-- Add banner_config to journey_configurations
ALTER TABLE journey_configurations
ADD COLUMN banner_config JSONB DEFAULT '{"enabled": false, "template": "grid", "items": []}'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN journey_configurations.banner_config IS 'Configuration for the announcement banner module including enabled status, template type, and banner items';
