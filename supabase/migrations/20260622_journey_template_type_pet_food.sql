-- Allow the Pet Food mobile experience template on journey configurations.
-- Non-destructive: only widens the allowed set; existing rows (NULL / 'classic'
-- / 'premium') remain valid. The interface is auto-detected from the order's
-- Product Category; 'premium' stays the default fallback.
alter table public.journey_configurations
    drop constraint if exists journey_configurations_template_type_check;

alter table public.journey_configurations
    add constraint journey_configurations_template_type_check
    check (
        template_type is null
        or template_type = any (array['classic'::text, 'premium'::text, 'pet_food'::text])
    );
