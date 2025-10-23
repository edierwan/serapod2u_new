-- Migration: Add Organization Hierarchy Validation
-- Date: 2025-10-17
-- Description: Enforce proper organization hierarchy relationships

-- Create validation function
CREATE OR REPLACE FUNCTION public.validate_org_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_type TEXT;
  v_has_children INTEGER;
BEGIN
  -- HQ organizations cannot have a parent
  IF NEW.org_type_code = 'HQ' AND NEW.parent_org_id IS NOT NULL THEN
    RAISE EXCEPTION 'Headquarters organizations cannot have a parent organization';
  END IF;

  -- If parent_org_id is set, validate based on org type
  IF NEW.parent_org_id IS NOT NULL THEN
    -- Get parent organization type
    SELECT org_type_code INTO v_parent_type
    FROM public.organizations
    WHERE id = NEW.parent_org_id;

    IF v_parent_type IS NULL THEN
      RAISE EXCEPTION 'Parent organization not found';
    END IF;

    -- Validate based on organization type
    CASE NEW.org_type_code
      WHEN 'MFG' THEN  -- Manufacturer
        -- Can have HQ as parent or be independent (NULL is allowed)
        IF v_parent_type != 'HQ' THEN
          RAISE EXCEPTION 'Manufacturer must report to HQ or be independent';
        END IF;

      WHEN 'DIST' THEN  -- Distributor
        -- Must have HQ as parent
        IF v_parent_type != 'HQ' THEN
          RAISE EXCEPTION 'Distributor must report to HQ';
        END IF;

      WHEN 'WH' THEN  -- Warehouse
        -- Can report to HQ or Distributor
        IF v_parent_type NOT IN ('HQ', 'DIST') THEN
          RAISE EXCEPTION 'Warehouse must report to HQ or Distributor';
        END IF;

      WHEN 'SHOP' THEN  -- Shop
        -- Must report to Distributor
        IF v_parent_type != 'DIST' THEN
          RAISE EXCEPTION 'Shop must report to Distributor';
        END IF;

      ELSE
        -- Unknown org type
        RAISE EXCEPTION 'Unknown organization type: %', NEW.org_type_code;
    END CASE;
  ELSE
    -- parent_org_id is NULL - validate which types can be independent
    IF NEW.org_type_code IN ('DIST', 'SHOP') THEN
      RAISE EXCEPTION '% must have a parent organization', 
        CASE NEW.org_type_code
          WHEN 'DIST' THEN 'Distributor'
          WHEN 'SHOP' THEN 'Shop'
        END;
    END IF;
  END IF;

  -- If changing org type, validate against existing children
  IF TG_OP = 'UPDATE' AND OLD.org_type_code != NEW.org_type_code THEN
    SELECT COUNT(*) INTO v_has_children
    FROM public.organizations
    WHERE parent_org_id = NEW.id AND is_active = true;

    -- If changing to SHOP, cannot have children
    IF NEW.org_type_code = 'SHOP' AND v_has_children > 0 THEN
      RAISE EXCEPTION 'Cannot change to Shop - organization has % child organizations', v_has_children;
    END IF;

    -- If changing to DIST, children must be WH or SHOP
    IF NEW.org_type_code = 'DIST' THEN
      IF EXISTS (
        SELECT 1 FROM public.organizations
        WHERE parent_org_id = NEW.id
        AND org_type_code NOT IN ('WH', 'SHOP')
        AND is_active = true
      ) THEN
        RAISE EXCEPTION 'Cannot change to Distributor - has incompatible child organizations';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to organizations table
DROP TRIGGER IF EXISTS enforce_org_hierarchy ON public.organizations;

CREATE TRIGGER enforce_org_hierarchy
  BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_org_hierarchy();

-- Create validation view for admin dashboard
CREATE OR REPLACE VIEW public.v_org_hierarchy_validation AS
SELECT 
  o.id,
  o.org_code,
  o.org_name,
  o.org_type_code,
  ot.type_name as org_type_name,
  o.parent_org_id,
  p.org_name as parent_org_name,
  p.org_type_code as parent_org_type,
  CASE 
    -- HQ validation
    WHEN o.org_type_code = 'HQ' AND o.parent_org_id IS NULL THEN '✅ Valid'
    WHEN o.org_type_code = 'HQ' AND o.parent_org_id IS NOT NULL THEN '❌ HQ cannot have parent'
    
    -- Manufacturer validation
    WHEN o.org_type_code = 'MFG' AND o.parent_org_id IS NULL THEN '✅ Valid (Independent)'
    WHEN o.org_type_code = 'MFG' AND p.org_type_code = 'HQ' THEN '✅ Valid'
    WHEN o.org_type_code = 'MFG' THEN '❌ Invalid parent type'
    
    -- Distributor validation
    WHEN o.org_type_code = 'DIST' AND o.parent_org_id IS NULL THEN '❌ Must have HQ parent'
    WHEN o.org_type_code = 'DIST' AND p.org_type_code = 'HQ' THEN '✅ Valid'
    WHEN o.org_type_code = 'DIST' THEN '❌ Must report to HQ'
    
    -- Warehouse validation
    WHEN o.org_type_code = 'WH' AND o.parent_org_id IS NULL THEN '❌ Must have parent'
    WHEN o.org_type_code = 'WH' AND p.org_type_code IN ('HQ', 'DIST') THEN '✅ Valid'
    WHEN o.org_type_code = 'WH' THEN '❌ Must report to HQ or Distributor'
    
    -- Shop validation
    WHEN o.org_type_code = 'SHOP' AND o.parent_org_id IS NULL THEN '❌ Must have Distributor parent'
    WHEN o.org_type_code = 'SHOP' AND p.org_type_code = 'DIST' THEN '✅ Valid'
    WHEN o.org_type_code = 'SHOP' THEN '❌ Must report to Distributor'
    
    ELSE '⚠️ Unknown'
  END as validation_status,
  CASE
    WHEN o.org_type_code = 'HQ' AND o.parent_org_id IS NOT NULL THEN 'Remove parent organization'
    WHEN o.org_type_code = 'MFG' AND o.parent_org_id IS NOT NULL AND p.org_type_code != 'HQ' THEN 'Change parent to HQ or remove parent'
    WHEN o.org_type_code = 'DIST' AND o.parent_org_id IS NULL THEN 'Select an HQ as parent'
    WHEN o.org_type_code = 'DIST' AND p.org_type_code != 'HQ' THEN 'Change parent to HQ'
    WHEN o.org_type_code = 'WH' AND o.parent_org_id IS NULL THEN 'Select HQ or Distributor as parent'
    WHEN o.org_type_code = 'WH' AND p.org_type_code NOT IN ('HQ', 'DIST') THEN 'Change parent to HQ or Distributor'
    WHEN o.org_type_code = 'SHOP' AND o.parent_org_id IS NULL THEN 'Select a Distributor as parent'
    WHEN o.org_type_code = 'SHOP' AND p.org_type_code != 'DIST' THEN 'Change parent to Distributor'
    ELSE NULL
  END as suggested_fix,
  o.is_active,
  o.created_at,
  o.updated_at
FROM public.organizations o
LEFT JOIN public.organizations p ON o.parent_org_id = p.id
LEFT JOIN public.organization_types ot ON o.org_type_code = ot.type_code
ORDER BY 
  CASE 
    WHEN o.org_type_code = 'HQ' THEN 1
    WHEN o.org_type_code = 'MFG' THEN 2
    WHEN o.org_type_code = 'DIST' THEN 3
    WHEN o.org_type_code = 'WH' THEN 4
    WHEN o.org_type_code = 'SHOP' THEN 5
  END,
  o.org_name;

-- Add helpful comments
COMMENT ON FUNCTION public.validate_org_hierarchy() IS 'Enforces organization hierarchy rules:
- HQ: No parent (root level)
- Manufacturer: Optional HQ parent or independent
- Distributor: Required HQ parent
- Warehouse: Required HQ or Distributor parent
- Shop: Required Distributor parent';

COMMENT ON VIEW public.v_org_hierarchy_validation IS 'Shows all organizations with hierarchy validation status and suggested fixes for invalid configurations';

-- Grant permissions
GRANT SELECT ON public.v_org_hierarchy_validation TO authenticated;
