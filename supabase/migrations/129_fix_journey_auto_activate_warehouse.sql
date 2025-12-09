-- Fix auto_activate_journeys_on_ship to hardcode activation at received_warehouse status
-- This migration updates the trigger function to activate journeys when products reach received_warehouse status

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS trigger_auto_activate_journeys ON public.qr_master_codes;
DROP FUNCTION IF EXISTS public.auto_activate_journeys_on_ship();

-- Create updated function that activates at received_warehouse status
CREATE OR REPLACE FUNCTION public.auto_activate_journeys_on_ship() 
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_journey_record record;
  v_order_id uuid;
BEGIN
  -- Only process if status changed to received_warehouse
  IF NEW.status = 'received_warehouse' AND (OLD.status IS NULL OR OLD.status != 'received_warehouse') THEN
    
    -- Get the order_id from the batch
    SELECT qb.order_id INTO v_order_id
    FROM public.qr_batches qb
    WHERE qb.id = NEW.batch_id;
    
    IF v_order_id IS NULL THEN
      RETURN NEW;
    END IF;
    
    -- Find journeys linked to this order that are pending activation
    FOR v_journey_record IN
      SELECT jc.id, jc.name
      FROM public.journey_configurations jc
      INNER JOIN public.journey_order_links jol ON jol.journey_config_id = jc.id
      WHERE jol.order_id = v_order_id
        AND jc.is_active = false
        AND jc.activation_status = 'pending_ship'
    LOOP
      -- Auto-activate the journey
      UPDATE public.journey_configurations
      SET 
        is_active = true,
        activation_status = 'auto_activated'
      WHERE id = v_journey_record.id;
      
      RAISE NOTICE 'Auto-activated journey % (%) for order % at received_warehouse status', 
        v_journey_record.name, v_journey_record.id, v_order_id;
    END LOOP;
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- Re-create trigger
CREATE TRIGGER trigger_auto_activate_journeys 
  AFTER UPDATE OF status 
  ON public.qr_master_codes 
  FOR EACH ROW 
  EXECUTE FUNCTION public.auto_activate_journeys_on_ship();

-- Update function comment
COMMENT ON FUNCTION public.auto_activate_journeys_on_ship() IS 
  'Automatically activate journeys when products reach received_warehouse status';

-- Update trigger comment  
COMMENT ON TRIGGER trigger_auto_activate_journeys ON public.qr_master_codes IS 
  'Trigger to auto-activate journeys when QR codes reach received_warehouse status';
