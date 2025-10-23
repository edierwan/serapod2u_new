-- =====================================================
-- Function: hard_delete_organization
-- Purpose: Hard delete an organization and all related data
-- Author: System
-- Date: 2025-10-23
-- =====================================================

-- Drop function if exists (for redeployment)
DROP FUNCTION IF EXISTS public.hard_delete_organization(uuid);

-- Create the hard delete function
CREATE OR REPLACE FUNCTION public.hard_delete_organization(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_type TEXT;
  v_org_name TEXT;
  v_org_code TEXT;
  v_has_orders BOOLEAN := FALSE;
  v_order_count INTEGER := 0;
  v_child_count INTEGER := 0;
  v_user_count INTEGER := 0;
  v_deleted_shop_distributors INTEGER := 0;
  v_deleted_distributor_products INTEGER := 0;
  v_deleted_inventory INTEGER := 0;
  v_deleted_users INTEGER := 0;
BEGIN
  -- Get organization details
  SELECT org_type_code, org_name, org_code
  INTO v_org_type, v_org_name, v_org_code
  FROM public.organizations
  WHERE id = p_org_id;

  -- Check if organization exists
  IF v_org_type IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organization not found',
      'error_code', 'ORG_NOT_FOUND'
    );
  END IF;

  -- Check if organization has any orders (as buyer or seller)
  SELECT 
    EXISTS (
      SELECT 1 FROM public.orders 
      WHERE buyer_org_id = p_org_id OR seller_org_id = p_org_id
    ),
    COUNT(*) 
  INTO v_has_orders, v_order_count
  FROM public.orders 
  WHERE buyer_org_id = p_org_id OR seller_org_id = p_org_id;

  IF v_has_orders THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('%s (%s) cannot be deleted because it has %s order(s) in the system', 
        v_org_name, v_org_code, v_order_count),
      'error_code', 'HAS_ORDERS',
      'order_count', v_order_count,
      'org_name', v_org_name,
      'org_code', v_org_code
    );
  END IF;

  -- Check if organization has child organizations
  SELECT COUNT(*) INTO v_child_count
  FROM public.organizations
  WHERE parent_org_id = p_org_id AND is_active = true;

  IF v_child_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('%s (%s) cannot be deleted because it has %s active child organization(s)', 
        v_org_name, v_org_code, v_child_count),
      'error_code', 'HAS_CHILDREN',
      'child_count', v_child_count,
      'org_name', v_org_name,
      'org_code', v_org_code
    );
  END IF;

  -- Get count of users before deletion
  SELECT COUNT(*) INTO v_user_count
  FROM public.users
  WHERE organization_id = p_org_id;

  -- Begin deletion process
  -- Note: Many tables have ON DELETE CASCADE, so they'll be auto-deleted
  -- We'll track what we explicitly delete

  -- 1. Delete shop_distributors entries (if SHOP)
  IF v_org_type = 'SHOP' THEN
    DELETE FROM public.shop_distributors
    WHERE shop_id = p_org_id;
    GET DIAGNOSTICS v_deleted_shop_distributors = ROW_COUNT;
  END IF;

  -- 2. Delete shop_distributors entries (if DIST - where this org is the distributor)
  IF v_org_type = 'DIST' THEN
    DELETE FROM public.shop_distributors
    WHERE distributor_id = p_org_id;
    GET DIAGNOSTICS v_deleted_shop_distributors = ROW_COUNT;
  END IF;

  -- 3. Delete distributor_products entries (if DIST)
  IF v_org_type = 'DIST' THEN
    DELETE FROM public.distributor_products
    WHERE distributor_id = p_org_id;
    GET DIAGNOSTICS v_deleted_distributor_products = ROW_COUNT;
  END IF;

  -- 4. Delete product inventory (CASCADE will handle this, but we count it)
  SELECT COUNT(*) INTO v_deleted_inventory
  FROM public.product_inventory
  WHERE organization_id = p_org_id;

  -- 5. Delete users (important to do before org deletion)
  DELETE FROM public.users
  WHERE organization_id = p_org_id;
  GET DIAGNOSTICS v_deleted_users = ROW_COUNT;

  -- 6. Delete notification settings
  DELETE FROM public.org_notification_settings
  WHERE org_id = p_org_id;

  -- 7. Delete message templates
  DELETE FROM public.message_templates
  WHERE org_id = p_org_id;

  -- 8. Delete journey configurations
  DELETE FROM public.journey_configurations
  WHERE org_id = p_org_id;

  -- 9. Delete points rules
  DELETE FROM public.points_rules
  WHERE org_id = p_org_id;

  -- 10. Finally, delete the organization itself
  -- This will CASCADE delete many related records:
  -- - product_inventory (ON DELETE CASCADE)
  -- - distributor_products (ON DELETE CASCADE)
  -- - shop_distributors (ON DELETE CASCADE)
  -- - child organizations (parent_org_id references)
  DELETE FROM public.organizations
  WHERE id = p_org_id;

  -- Return success with deletion summary
  RETURN jsonb_build_object(
    'success', true,
    'message', format('%s (%s) has been permanently deleted', v_org_name, v_org_code),
    'deleted_organization', jsonb_build_object(
      'id', p_org_id,
      'name', v_org_name,
      'code', v_org_code,
      'type', v_org_type
    ),
    'deleted_related_records', jsonb_build_object(
      'users', v_deleted_users,
      'shop_distributors', v_deleted_shop_distributors,
      'distributor_products', v_deleted_distributor_products,
      'inventory_records', v_deleted_inventory
    )
  );

EXCEPTION
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot delete organization due to foreign key constraint. There may be related records that need to be deleted first.',
      'error_code', 'FOREIGN_KEY_VIOLATION',
      'org_name', v_org_name,
      'org_code', v_org_code
    );
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Unexpected error: %s', SQLERRM),
      'error_code', 'UNEXPECTED_ERROR',
      'org_name', v_org_name,
      'org_code', v_org_code
    );
END;
$$;

-- Add comment
COMMENT ON FUNCTION public.hard_delete_organization(uuid) IS 
'Hard deletes an organization and all related data. 
Prevents deletion if:
- Organization has any orders (as buyer or seller)
- Organization has active child organizations
Returns JSON with success status and deletion details.
Automatically removes:
- Users
- Shop-distributor relationships
- Distributor-product relationships  
- Product inventory
- Notification settings
- Message templates
- Journey configurations
- Points rules';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.hard_delete_organization(uuid) TO authenticated;

-- Example usage:
-- SELECT public.hard_delete_organization('org-uuid-here');
