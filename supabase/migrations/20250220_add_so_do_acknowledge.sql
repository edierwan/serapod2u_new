CREATE OR REPLACE FUNCTION public.so_acknowledge(p_document_id uuid)
 RETURNS public.documents
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE 
  d public.documents; 
BEGIN
  SELECT * INTO d FROM public.documents
   WHERE id = p_document_id AND doc_type = 'SO'
   FOR UPDATE;
   
  IF NOT FOUND THEN 
    RAISE EXCEPTION 'SO document not found'; 
  END IF;

  IF d.status = 'acknowledged' THEN
    RETURN d;
  END IF;

  UPDATE public.documents
     SET status = 'acknowledged', 
         acknowledged_by = auth.uid(),
         acknowledged_at = NOW(), 
         updated_at = NOW()
   WHERE id = p_document_id
   RETURNING * INTO d;

  RETURN d;
END;
$function$;

CREATE OR REPLACE FUNCTION public.do_acknowledge(p_document_id uuid)
 RETURNS public.documents
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE 
  d public.documents; 
BEGIN
  SELECT * INTO d FROM public.documents
   WHERE id = p_document_id AND doc_type = 'DO'
   FOR UPDATE;
   
  IF NOT FOUND THEN 
    RAISE EXCEPTION 'DO document not found'; 
  END IF;

  IF d.status = 'acknowledged' THEN
    RETURN d;
  END IF;

  UPDATE public.documents
     SET status = 'acknowledged', 
         acknowledged_by = auth.uid(),
         acknowledged_at = NOW(), 
         updated_at = NOW()
   WHERE id = p_document_id
   RETURNING * INTO d;

  RETURN d;
END;
$function$;
