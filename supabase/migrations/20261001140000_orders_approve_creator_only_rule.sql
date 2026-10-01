-- Order approval: "anyone allowed to approve, except the creator".
--
-- orders_approve required the approver's legacy role level to be above the
-- creator's (a Level 10 creator needed Level 10/20). Owner decision
-- 2026-10-01: drop that comparison; only the creator may never approve.
--
--   * The creator never approves: checked here explicitly (the
--     order-maker-checker S&A rule also enforces it where active).
--   * Where supply_chain.order.approve is S&A-enforced, S&A alone decides
--     who may approve (sa_require_operation at the top of the function).
--   * Otherwise (legacy mode, production today) the approver must be
--     Manager level or above (role_level <= 30) - exactly the legacy roles
--     whose compatibility roles hold supply_chain.order.approve - so staff
--     and guests cannot approve once the level comparison is gone.
--   * Organization rules are unchanged (HQ for H2M/D2H, seller for S2D).
--
-- The function body differs between environments only by runtime-injected
-- guard lines, so this migration patches the live definition in place: it
-- replaces exactly one known line and refuses to run if that line is not
-- present. Idempotent (marker check). One DO statement; no session state.
do $patch$
declare
  v_def text := pg_get_functiondef('public.orders_approve(uuid)'::regprocedure);
  v_old text := '  v_authority:=CASE WHEN v_creator_level=10 THEN v_user_level IN (10,20) ELSE v_user_level<v_creator_level END;';
  v_new text := $new$  /* approval-rule:creator-only - the creator never approves; S&A decides where supply_chain.order.approve is enforced, otherwise Manager level or above. */
  IF v.created_by = auth.uid() THEN
    RAISE EXCEPTION 'sod_violation: Order maker/checker' USING ERRCODE = '42501', DETAIL = 'order-maker-checker';
  END IF;
  v_authority:=CASE WHEN public.sa_is_new_authoritative('supply_chain.order.approve') THEN true ELSE v_user_level<=30 END;$new$;
begin
  if position('approval-rule:creator-only' in v_def) > 0 then
    raise notice 'orders_approve already uses the creator-only rule';
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'orders_approve does not contain the expected level rule; review the live definition before applying';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;
