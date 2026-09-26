# Phase 0B — privileged RPC inventory

Generated 2026-09-27 from read-only catalog queries against production
(`serapod-prd-db`, KVM8) and staging (`serapod-stg-db`, KVM2), plus a static
scan of every `.rpc()` / string-literal reference in `origin/main` and
`origin/staging` application code (app, moltbot, baileys-gateway, shared, scripts).

Columns: signature, tier after Phase 0B, before (anon/authenticated EXECUTE in
production), caller evidence.

| Function | Tier | Before anon | Before auth | Evidence |
|---|---|---|---|---|
| `can_access_org(uuid)` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.distributor_products.dist_products_read_related[authenticated], public.d2h_order_submit_idempotency.d2h_submit_idempotency_read[authenticated] |
| `check_serapod_user_phone(text)` | PUBLIC | t | t | Anonymous consumer journey template (PremiumLoyaltyTemplate) |
| `current_user_org_id()` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.documents.documents_select[authenticated], public.document_files.document_files_select[authenticated] |
| `current_user_role_level()` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.orders.orders_insert[authenticated] |
| `get_auth_user_context()` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.hr_attendance_audit.hr_attendance_audit_read[public], public.hr_attendance_audit.hr_attendance_audit_write[public] |
| `get_auth_user_info()` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.users.Users can view hierarchy including independents[authenticated] |
| `get_email_by_phone(text)` | PUBLIC | t | t | Anonymous phone login (LoginForm, LoginPageClient, public journey + RoadTour scan pages) |
| `get_public_branding()` | PUBLIC | t | t | Anonymous login / forgot-password pages |
| `get_user_company_id()` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.gl_document_postings.HQ Admins can insert document postings[authenticated], public.fiscal_periods.HQ Admins can insert fiscal periods[authenticated] |
| `has_role_level(integer)` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.document_signatures.power_user_view_company_signatures[authenticated] |
| `is_admin()` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.support_messages.Admins can insert messages[public], public.support_thread_reads.Admins can manage own read status[public] |
| `is_hq_admin()` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.gl_document_postings.HQ Admins can insert document postings[authenticated], public.fiscal_periods.HQ Admins can insert fiscal periods[authenticated] |
| `is_org_admin_or_super(uuid)` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.whatsapp_bot_settings.whatsapp_bot_settings_org_admin_select[public], public.whatsapp_bot_settings.whatsapp_bot_settings_org_admin_update[public] |
| `is_power_user()` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.documents.documents_select[authenticated], public.document_files.document_files_select[authenticated] |
| `is_super_admin()` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.gl_accounts.Super Admins can view all accounts[authenticated], public.documents.Super Admins can view all documents[authenticated] |
| `is_support_admin()` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.support_conversation_events.Admins can insert events[public], public.support_conversation_messages.Admins can insert messages[public] |
| `play_scratch_card_turn(uuid,text,uuid,uuid)` | PUBLIC | t | t | Anonymous consumer scratch-card game (PremiumLoyaltyTemplate, /api/scratch-card/play) |
| `return_current_user_is_manager()` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.return_case_items.return_case_items_all[authenticated], public.return_cases.return_cases_select[authenticated] |
| `return_current_user_org_id()` | PUBLIC | t | t | RLS/storage policy helper (evaluated for anon/authenticated): public.return_case_items.return_case_items_all[authenticated], public.return_cases.return_cases_select[authenticated] |
| `validate_roadtour_qr_token(text)` | PUBLIC | t | t | Anonymous RoadTour scan page (RoadtourScanPage) |
| `_auto_post_document_to_gl_internal(text,uuid,date)` | SERVER | t | t | Only called from SECURITY DEFINER functions: auto_post_document_to_gl(SD), auto_post_payment_to_gl(SD) |
| `_stock_transfer_assert_reservation_integrity(stock_transfers)` | SERVER | f | f | Only called from SECURITY DEFINER functions: approve_stock_transfer(SD), dispatch_stock_transfer(SD) |
| `_stock_transfer_release_reservations(stock_transfers)` | SERVER | f | f | Only called from SECURITY DEFINER functions: cancel_stock_transfer(SD), dispatch_stock_transfer(SD), reject_stock_transfer(SD) |
| `_stock_transfer_reserve_items(stock_transfers)` | SERVER | f | f | Only called from SECURITY DEFINER functions: submit_stock_transfer_for_approval(SD) |
| `add_conversation_note(uuid,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `adjust_inventory_quantity(uuid,uuid,integer)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `admin_blast_message(text,jsonb)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `apply_inventory_ship_adjustment(uuid,uuid,integer,integer,timestamp with time zone)` | SERVER | t | t | Only called from SECURITY DEFINER functions: wms_deduct_and_summarize(SD) |
| `apply_inventory_ship_adjustment_deprecated_56910(uuid,uuid,integer,integer,timestamp with time zone)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `archive_old_audit_logs(integer)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `archive_stock_count_draft(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: discard_stock_count_drafts(SD) |
| `assert_h2m_receipt_allowed_after_cutoff(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: trg_warehouse_receipt_h2m_excluded_guard(SD) |
| `assign_conversation(uuid,uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `batch_post_documents(text,date,date,integer)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `batch_regenerate_doc_numbers(uuid,integer)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `can_collect_point_reward(uuid,uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: collect_point_reward(SD) |
| `check_whatsapp_admin(uuid,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `claim_point_redeem_pool(uuid,uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `cleanup_old_audit_logs()` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `cleanup_old_notifications(integer)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `clear_whatsapp_draft(uuid,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `close_fiscal_period(uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `collect_point_reward(uuid,uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `compute_payroll_item(uuid,uuid,date,date)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `consumer_claim_gift(text,uuid,text)` | SERVER | t | t | Only called through service-role clients |
| `consumer_claim_gift(text,uuid,text,text,text)` | SERVER | t | t | Only called through service-role clients |
| `consumer_collect_points(text,text,numeric)` | SERVER | t | t | Only called through service-role clients |
| `consumer_collect_points(text,text,numeric,text)` | SERVER | t | t | Only called through service-role clients |
| `consumer_collect_points(text,text,numeric,text,boolean)` | SERVER | t | t | Only called through service-role clients |
| `consumer_lucky_draw_enter(text,text,text,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `create_new_user(text,text,text,uuid,text,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `create_support_conversation(text,text,jsonb)` | SERVER | t | t | Only called through service-role clients |
| `deactivate_legacy_stock_configs(boolean)` | SERVER | f | f | No application, policy, view, trigger or function caller found (legacy/unused) |
| `delete_all_transactions_with_inventory()` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `delete_all_transactions_with_inventory_v3()` | SERVER | t | t | /api/admin/delete-transactions-v2 now calls through admin client after destructive-ops guard |
| `delete_scratch_campaign(uuid,uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `ellbow_apply_points_core(uuid,uuid,uuid,text,bigint,text,text,text,text,uuid,uuid,uuid,uuid,uuid,jsonb,uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: ellbow_admin_adjust_points(SD), ellbow_award_roadtour_scan(SD), ellbow_redeem_reward(SD) |
| `ellbow_has_active_user_membership(uuid,uuid,uuid,text)` | SERVER | t | t | Only called from SECURITY DEFINER functions: ellbow_apply_points_core(SD), ellbow_redeem_reward(SD) |
| `evaluate_user_registration_bonus(uuid,uuid)` | SERVER | t | t | Only called through service-role clients |
| `execute_legacy_config_cutover(uuid,boolean,uuid,text[])` | SERVER | f | f | Only called from SECURITY DEFINER functions: deactivate_legacy_stock_configs(SD), legacy_config_cutover_preflight(SD) |
| `fn_consumer_analytics_daily(uuid,timestamp with time zone,timestamp with time zone)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `fn_consumer_analytics_hourly(uuid,timestamp with time zone,timestamp with time zone)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `fn_consumer_analytics_products(uuid,timestamp with time zone,timestamp with time zone)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `fn_consumer_analytics_summary(uuid,timestamp with time zone,timestamp with time zone)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `fn_consumer_analytics_top_consumers(uuid,timestamp with time zone,timestamp with time zone,integer)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `fulfill_order_inventory(uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: orders_approve(SD) |
| `generate_order_referenced_doc_number(uuid,uuid,text,integer)` | SERVER | t | t | Only called from SECURITY DEFINER functions: auto_generate_display_doc_no(SD), regenerate_order_doc_numbers(SD) |
| `generate_po_number(uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `generate_signature_hash(uuid,uuid,timestamp with time zone)` | SERVER | t | t | Only called from SECURITY DEFINER functions: add_document_signature(SD) |
| `get_admin_support_unread_count()` | SERVER | t | t | Only called through service-role clients |
| `get_balance_request_posting_details(uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: get_posting_preview(SD) |
| `get_hq_consolidated_warehouse_inventory(uuid)` | SERVER | f | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `get_login_hero_banners()` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `get_my_role_level()` | SERVER | t | t | Only called from SECURITY DEFINER functions: approve_stock_transfer(SD), is_hq_admin(SD), is_super_admin(SD) |
| `get_next_doc_sub_sequence(uuid,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `get_notification_stats(uuid,integer)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `get_or_create_announcement_thread(uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: admin_blast_message(SD) |
| `get_payment_posting_details(uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: get_posting_preview(SD) |
| `get_payroll_ready_work_minutes(uuid,date,date)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `get_pending_notifications(integer)` | SERVER | t | t | Only called through service-role clients |
| `get_prepared_codes_count(uuid,uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `get_receipt_posting_details(uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `get_scratch_campaign_stats(uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `get_shop_available_products(uuid,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `get_statutory_config(uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: compute_payroll_item(SD) |
| `get_storage_url(text,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `get_whatsapp_bot_settings(uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `handle_social_login(uuid,text,text,text,text,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `hard_delete_order(uuid)` | SERVER | f | f | Only called through service-role clients |
| `hard_delete_order_phase4_legacy(uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: hard_delete_order(SD) |
| `hard_delete_organization(uuid)` | SERVER | t | t | Only called through service-role clients |
| `inventory_cutoff_active(uuid)` | SERVER | f | f | No application, policy, view, trigger or function caller found (legacy/unused) |
| `inventory_cutoff_assert_not_frozen(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: inventory_cutoff_inventory_guard(SD), inventory_cutoff_movement_guard(SD), post_warehouse_receipt(SD) |
| `inventory_cutoff_d2h_scoped_orders(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: apply_inventory_cutoff_d2h_policy(SD), inventory_cutoff_d2h_policy_preflight(SD), inventory_cutoff_preview_pre_h2m_policy(SD) |
| `inventory_cutoff_h2m_excluded_blocks_receipt(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: assert_h2m_receipt_allowed_after_cutoff(SD) |
| `inventory_cutoff_h2m_scoped_orders(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: apply_inventory_cutoff_h2m_policy(SD), inventory_cutoff_h2m_policy_preflight(SD), inventory_cutoff_preview_pre_transactions_policy(SD) |
| `inventory_cutoff_is_hq_admin()` | SERVER | f | f | Only called from SECURITY DEFINER functions: apply_inventory_cutoff_d2h_policy(SD), apply_inventory_cutoff_h2m_bulk(SD), apply_inventory_cutoff_h2m_policy(SD) |
| `inventory_cutoff_preview_h2m_unscoped_legacy(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_stock_adjustment_eligibility(SD) |
| `inventory_cutoff_preview_pre_blocker_details(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: inventory_cutoff_preview(SD) |
| `inventory_cutoff_preview_pre_d2h_policy(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_h2m_policy(SD) |
| `inventory_cutoff_preview_pre_h2m_policy(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_transactions_policy(SD) |
| `inventory_cutoff_preview_pre_stock_adjustment_detail(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_d2h_policy(SD) |
| `inventory_cutoff_preview_pre_stock_adjustment_eligibility(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_stock_adjustment_detail(SD) |
| `inventory_cutoff_preview_pre_transactions_policy(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_blocker_details(SD) |
| `inventory_cutoff_snapshot_hash(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: bind_inventory_cutoff_verification_snapshot(SD), verify_and_post_inventory_opening_cutoff_scoped_legacy(SD) |
| `inventory_cutoff_transactions_scoped(uuid)` | SERVER | f | f | Only called from SECURITY DEFINER functions: inventory_cutoff_preview_pre_blocker_details(SD), inventory_cutoff_transactions_policy_preflight(SD), verify_and_post_inventory_opening_cutoff(SD) |
| `is_active_stock_count_warehouse(uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: prepare_stock_count_verification(SD), start_inventory_opening_cutoff(SD), stock_count_unified_opening_balance_guard(SD) |
| `is_document_posted(text,uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: _auto_post_document_to_gl_internal(SD), auto_post_document_to_gl(SD), auto_post_payment_to_gl(SD) |
| `is_platform_super_admin()` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `is_product_available_for_shop(uuid,uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `legacy_config_cutover_preflight(integer)` | SERVER | f | t | Only called from SECURITY DEFINER functions: deactivate_legacy_stock_configs(SD), execute_legacy_config_cutover(SD) |
| `log_conversation_event(uuid,text,uuid,support_event_type,jsonb,jsonb,jsonb)` | SERVER | t | t | Only called from SECURITY DEFINER functions: add_conversation_note(SD), assign_conversation(SD), create_support_conversation(SD) |
| `log_notification_attempt(uuid,text,text,text,jsonb)` | SERVER | t | t | Only called through service-role clients |
| `log_qr_receive_movement(uuid,uuid,integer,numeric,uuid,text,uuid,uuid,text)` | SERVER | f | f | No application, policy, view, trigger or function caller found (legacy/unused) |
| `log_qr_shipment_movement(uuid,uuid,integer,numeric,uuid,text,uuid,uuid,text)` | SERVER | f | f | No application, policy, view, trigger or function caller found (legacy/unused) |
| `loyalty_program_current_admin_owner()` | SERVER | t | t | Only called from SECURITY DEFINER functions: loyalty_program_admin_update_user_membership(SD), loyalty_program_admin_upsert_organization_membership(SD), loyalty_program_admin_upsert_user_membership(SD) |
| `loyalty_program_upsert_organization_membership(text,uuid,text,uuid,uuid,uuid,uuid,text)` | SERVER | f | f | Only called through service-role clients |
| `loyalty_program_upsert_user_membership(text,uuid,text,text,uuid,uuid,uuid,uuid,uuid,text)` | SERVER | f | f | Only called through service-role clients |
| `manual_stock_addition_user_can_post(uuid,uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: post_manual_stock_addition(SD) |
| `mark_conversation_read(uuid,text,uuid)` | SERVER | t | t | Only called through service-role clients |
| `orders_submit(uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `post_customer_receipt_to_gl(uuid,date)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `post_payroll_payment_to_gl(uuid,date)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `post_stock_transfer_configured(text,uuid,uuid,uuid,jsonb,text,uuid)` | SERVER | f | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `recycle_doc_number(uuid,text,text,uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `refresh_all_materialized_views()` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `refresh_product_catalog()` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `refresh_shop_products()` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `regenerate_order_doc_numbers(uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: batch_regenerate_doc_numbers(SD) |
| `render_template(text,uuid,jsonb)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `repack_stock(uuid,uuid,uuid,uuid,integer,text,uuid)` | SERVER | f | f | No application, policy, view, trigger or function caller found (legacy/unused) |
| `repack_stock_v2(uuid,uuid,uuid,uuid,uuid,integer,text,uuid)` | SERVER | f | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `resolve_inventory_cutoff_d2h_carry_forward(uuid,uuid[])` | SERVER | f | t | Only called through service-role clients |
| `reverse_gl_journal(uuid,text,date)` | SERVER | t | t | Only called from SECURITY DEFINER functions: reverse_payroll_gl_posting(SD) |
| `search_eligible_references(text,integer)` | SERVER | t | t | Only caller is /api/reference/search via admin client (narrowed in commit C) |
| `search_shops(text,integer)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `send_admin_support_message(uuid,text,jsonb)` | SERVER | t | t | Only called through service-role clients |
| `send_announcement_blast(text,text,jsonb)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `send_support_message(uuid,text,jsonb)` | SERVER | t | t | Only called through service-role clients |
| `set_order_item_stock_config(uuid,uuid)` | SERVER | f | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `set_skip_ship_trigger(boolean)` | SERVER | t | t | Only called through service-role clients |
| `set_whatsapp_draft(uuid,text,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `stock_count_carry_classification_allocations(uuid,uuid,uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: verify_and_post_stock_classification(SD) |
| `stock_count_user_can_post(uuid,uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: prepare_stock_count_verification(SD), verify_and_post_stock_classification(SD), verify_and_post_stock_count(SD) |
| `submit_referral_claim(uuid,integer,uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `sync_user_profile(uuid,text,text,uuid,text,text)` | SERVER | f | f | Only called through service-role clients |
| `update_admin_activity(uuid,text,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `update_conversation_priority(uuid,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `update_conversation_status(uuid,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `update_master_status_skip_trigger(uuid[],uuid,timestamp with time zone)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `update_redemption_fulfillment(uuid,text,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `update_scratch_winner_details(uuid,text,text,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `update_whatsapp_conversation_mode(uuid,text,whatsapp_conversation_mode,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `validate_reference_eligibility(uuid)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `verify_and_post_inventory_opening_cutoff_pre_transactions_polic(uuid,text)` | SERVER | f | f | No application, policy, view, trigger or function caller found (legacy/unused) |
| `verify_and_post_inventory_opening_cutoff_scoped_legacy(uuid,text)` | SERVER | f | f | Only called from SECURITY DEFINER functions: verify_and_post_inventory_opening_cutoff_pre_transactions_polic(SD) |
| `verify_and_post_stock_classification(uuid,text)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `wms_deduct_and_summarize(uuid,uuid,uuid,integer,uuid,timestamp with time zone)` | SERVER | t | t | Only called from SECURITY DEFINER functions: wms_from_master(SD) |
| `wms_from_master(uuid)` | SERVER | t | t | Only called from SECURITY DEFINER functions: wms_from_mixed(SD) |
| `wms_from_mixed(uuid,uuid[],uuid,uuid,uuid,timestamp with time zone)` | SERVER | t | t | No application, policy, view, trigger or function caller found (legacy/unused) |
| `wms_from_unique_codes(uuid[],uuid,uuid,uuid,timestamp with time zone)` | SERVER | t | t | Only called from SECURITY DEFINER functions: wms_from_mixed(SD), wms_ship_unique_auto(SD) |
| `wms_record_movement_from_summary(jsonb)` | SERVER | f | f | Only called from SECURITY DEFINER functions: wms_record_movements_from_items(SD) |
| `wms_record_movements_from_items(jsonb)` | SERVER | f | f | Only called from SECURITY DEFINER functions: trg_qr_unique_shipdeduct_stmt(SD), wms_ship_unique_auto(SD) |
| `wms_ship_manual(uuid,uuid,uuid,uuid,integer,uuid,text,text)` | SERVER | f | f | No application, policy, view, trigger or function caller found (legacy/unused) |
| `wms_ship_unique_auto(uuid[],uuid,uuid,uuid,timestamp with time zone)` | SERVER | t | t | Only called through service-role clients |
| `accrue_referral_from_scan()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `accrue_referral_from_transaction()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `audit_trigger_func()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `auto_create_stock_adjustment_from_movement()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `auto_generate_display_doc_no()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `auto_post_document_to_gl()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `auto_post_payment_to_gl()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `create_default_stock_config_for_variant()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `documents_ensure_company_id()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `fn_auto_create_hr_employee()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `handle_new_user()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `inventory_cutoff_category_decision_guard()` | TRIGGER | f | f | Trigger function; triggers do not need caller EXECUTE |
| `inventory_cutoff_excluded_transaction_guard()` | TRIGGER | f | f | Trigger function; triggers do not need caller EXECUTE |
| `inventory_cutoff_inventory_guard()` | TRIGGER | f | f | Trigger function; triggers do not need caller EXECUTE |
| `inventory_cutoff_movement_guard()` | TRIGGER | f | f | Trigger function; triggers do not need caller EXECUTE |
| `prepare_product_variant_product_code()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `prevent_self_service_access_field_update()` | TRIGGER | f | f | Trigger function; triggers do not need caller EXECUTE |
| `return_cases_validate_source()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `revert_inventory_on_movement_delete()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `stock_count_discard_posting_started_guard()` | TRIGGER | f | f | Trigger function; triggers do not need caller EXECUTE |
| `stock_count_opening_category_scope_guard()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `stock_count_unified_opening_balance_guard()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `stock_movements_apply_to_inventory()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `sync_product_variant_product_code_brand()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `sync_roadtour_event_reward_rule_version()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `sync_variant_default_media()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `trg_on_purchase_receive_create_balance_request()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `trg_qr_unique_shipdeduct()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `trg_qr_unique_shipdeduct_stmt()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `trg_qrmaster_shipdeduct()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `trg_warehouse_receipt_h2m_excluded_guard()` | TRIGGER | f | f | Trigger function; triggers do not need caller EXECUTE |
| `trigger_document_notification()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `trigger_order_notification()` | TRIGGER | t | t | Trigger function; triggers do not need caller EXECUTE |
| `_enable_variant_stock_configurations_core(uuid,text)` | USER | t | t | Authenticated caller(s): dynamic rpc name |
| `add_document_signature(uuid,uuid,text)` | USER | t | t | Authenticated caller(s): ADMIN, SESSION |
| `allocate_inventory_for_order(uuid)` | USER | f | t | Authenticated caller(s): BROWSER |
| `apply_inventory_cutoff_d2h_policy(uuid,text,uuid[],text,uuid)` | USER | f | t | Authenticated caller(s): dynamic rpc name |
| `apply_inventory_cutoff_h2m_bulk(uuid,text,uuid[],text,uuid)` | USER | f | t | Authenticated caller(s): dynamic rpc name |
| `apply_inventory_cutoff_h2m_policy(uuid,text,uuid[],text,uuid)` | USER | f | t | Authenticated caller(s): dynamic rpc name |
| `apply_inventory_cutoff_transactions_policy(uuid,text,jsonb,text,uuid)` | USER | f | t | Authenticated caller(s): dynamic rpc name |
| `approve_payment_request(uuid)` | USER | t | t | Authenticated caller(s): SESSION |
| `approve_reference_change(uuid,text,uuid,text)` | USER | t | t | Authenticated caller(s): BROWSER |
| `approve_stock_transfer(uuid,uuid)` | USER | f | t | Authenticated caller(s): BROWSER |
| `archive_product_variant(uuid)` | USER | f | t | Authenticated caller(s): dynamic rpc name |
| `backfill_display_doc_numbers(uuid)` | USER | t | t | Authenticated caller(s): BROWSER, SESSION |
| `bind_inventory_cutoff_verification_snapshot(uuid,uuid)` | USER | f | t | Authenticated caller(s): UNK(file-has-admin) |
| `bulk_enable_variant_stock_configurations(uuid[])` | USER | t | t | Authenticated caller(s): UNK |
| `bulk_reassign_reference(uuid,uuid,uuid,boolean)` | USER | t | t | Authenticated caller(s): BROWSER |
| `cancel_inventory_opening_cutoff(uuid,text)` | USER | f | t | Authenticated caller(s): BROWSER |
| `cancel_stock_transfer(uuid,uuid,text)` | USER | f | t | Authenticated caller(s): BROWSER |
| `check_organization_dependencies(uuid)` | USER | t | t | Authenticated caller(s): ADMIN, BROWSER |
| `check_phone_exists(text,uuid)` | USER | t | t | Authenticated caller(s): ADMIN?, BROWSER, UNK(file-has-admin) |
| `discard_stock_count_drafts(uuid[])` | USER | f | t | Authenticated caller(s): BROWSER |
| `dispatch_stock_transfer(uuid,uuid)` | USER | f | t | Authenticated caller(s): BROWSER |
| `ellbow_admin_adjust_points(uuid,text,bigint,text,text)` | USER | t | t | Authenticated caller(s): UNK |
| `ellbow_award_roadtour_scan(uuid,uuid,uuid,uuid)` | USER | f | f | Authenticated caller(s): UNK(file-has-admin) |
| `ellbow_redeem_reward(uuid,text)` | USER | t | t | Authenticated caller(s): UNK |
| `ellbow_update_redemption_status(uuid,text,text)` | USER | t | t | Authenticated caller(s): UNK |
| `enable_variant_stock_configurations(uuid)` | USER | t | t | Authenticated caller(s): UNK |
| `enable_variant_stock_configurations_with_profile(uuid,text)` | USER | t | t | Authenticated caller(s): UNK |
| `finalize_stock_count_verification_delivery(uuid,boolean)` | USER | f | t | Authenticated caller(s): UNK(file-has-admin) |
| `find_or_create_whatsapp_conversation(text,text,text)` | USER | t | t | Authenticated caller(s): UNK |
| `fn_consumer_activity_stats(uuid,uuid,text)` | USER | t | t | Authenticated caller(s): BROWSER |
| `fn_consumer_unique_list(uuid,uuid,text)` | USER | t | t | Authenticated caller(s): BROWSER |
| `fn_create_balance_payment_request(uuid)` | USER | t | t | Session caller /api/manufacturer/complete-production (guard not added: also fired from receipt trigger) |
| `generate_display_doc_number(uuid,text,integer)` | USER | t | t | Called by INVOKER trigger orders_before_insert |
| `generate_doc_number(uuid,text,text)` | USER | t | t | Authenticated caller(s): BROWSER, SESSION |
| `generate_fiscal_periods(uuid,text)` | USER | t | t | Authenticated caller(s): SESSION |
| `generate_journal_number(uuid)` | USER | t | t | Called by INVOKER hr_post_*_to_gl functions |
| `generate_journal_number(uuid,text)` | USER | t | t | Called by INVOKER hr_post_*_to_gl functions |
| `get_batch_variant_counts(uuid,text)` | USER | t | t | Authenticated caller(s): ADMIN, UNK(file-has-admin) |
| `get_consumer_scan_stats(uuid)` | USER | t | t | Authenticated caller(s): SESSION |
| `get_department_hierarchy(uuid)` | USER | t | t | Authenticated caller(s): SESSION |
| `get_doc_migration_status(uuid)` | USER | t | t | Authenticated caller(s): BROWSER, SESSION |
| `get_doc_sequences(uuid)` | USER | t | t | Authenticated caller(s): BROWSER, SESSION |
| `get_document_gl_status(uuid)` | USER | t | t | Authenticated caller(s): UNK |
| `get_document_signatures(uuid)` | USER | t | t | Authenticated caller(s): SESSION, UNK |
| `get_journey_qr_count(uuid)` | USER | t | t | Authenticated caller(s): BROWSER |
| `get_next_approver(uuid)` | USER | t | t | Authenticated caller(s): SESSION |
| `get_pending_receives_for_warehouse(uuid)` | USER | t | t | Authenticated caller(s): SESSION |
| `get_posting_preview(text,uuid)` | USER | t | t | Authenticated caller(s): UNK |
| `get_reference_assigned_shops(uuid)` | USER | t | t | Authenticated caller(s): BROWSER |
| `get_user_by_email(text)` | USER | t | t | Authenticated caller(s): BROWSER |
| `get_user_org_chart(uuid,uuid)` | USER | t | t | Authenticated caller(s): SESSION |
| `get_user_support_unread_count()` | USER | t | t | Authenticated caller(s): ADMIN, SESSION |
| `get_valid_batch_ids_for_journey(uuid[],text[])` | USER | t | t | Authenticated caller(s): BROWSER |
| `insert_whatsapp_message(uuid,text,text,uuid,uuid,text,text,text,text,jsonb)` | USER | t | t | Authenticated caller(s): UNK |
| `inventory_cutoff_d2h_policy_preflight(uuid,text,uuid[])` | USER | f | t | Authenticated caller(s): dynamic rpc name |
| `inventory_cutoff_h2m_bulk_preflight(uuid,text,uuid[])` | USER | f | t | Authenticated caller(s): dynamic rpc name |
| `inventory_cutoff_h2m_policy_preflight(uuid,text,uuid[])` | USER | f | t | Authenticated caller(s): dynamic rpc name |
| `inventory_cutoff_preview(uuid)` | USER | f | t | Authenticated caller(s): BROWSER, UNK(file-has-admin) |
| `inventory_cutoff_transactions_policy_preflight(uuid,text,jsonb)` | USER | f | t | Authenticated caller(s): dynamic rpc name |
| `invoice_acknowledge(uuid,text)` | USER | t | t | Authenticated caller(s): SESSION |
| `loyalty_program_admin_update_user_membership(uuid,text,uuid,text,text)` | USER | t | t | Authenticated caller(s): UNK |
| `loyalty_program_admin_upsert_organization_membership(uuid,text,text,text)` | USER | t | t | Authenticated caller(s): UNK |
| `loyalty_program_admin_upsert_user_membership(uuid,text,uuid,text,text,text)` | USER | t | t | Authenticated caller(s): UNK |
| `manufacturer_acknowledge_adjustment(uuid,text)` | USER | t | t | Authenticated caller(s): SESSION |
| `mark_batch_as_printed(uuid)` | USER | t | t | Authenticated caller(s): BROWSER |
| `orders_approve(uuid)` | USER | t | t | Authenticated caller(s): BROWSER |
| `payment_acknowledge(uuid)` | USER | t | t | Authenticated caller(s): UNK(file-has-admin) |
| `po_acknowledge(uuid)` | USER | t | t | Authenticated caller(s): SESSION |
| `post_document_to_gl(text,uuid,date)` | USER | t | t | Authenticated caller(s): UNK |
| `post_manual_stock_addition(uuid,uuid,jsonb,text,text,uuid,text,text,uuid,uuid)` | USER | t | t | Authenticated caller(s): BROWSER |
| `post_payroll_run_to_gl(uuid,date)` | USER | t | t | Authenticated caller(s): SESSION |
| `post_return_case_inventory(uuid)` | USER | f | t | Authenticated caller(s): UNK |
| `post_warehouse_receipt(uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,text,text)` | USER | t | t | Authenticated caller(s): SESSION |
| `prepare_stock_count_verification(uuid,uuid,text,jsonb,jsonb)` | USER | f | t | Authenticated caller(s): UNK(file-has-admin) |
| `process_reference_change(uuid,text,uuid,text)` | USER | t | t | Authenticated caller(s): BROWSER |
| `process_referral_claim(uuid,text,uuid,text,text)` | USER | t | t | Authenticated caller(s): BROWSER |
| `propagate_warehouse_to_master_codes(uuid)` | USER | t | t | Authenticated caller(s): SESSION |
| `queue_notification(uuid,text,text,text,text,text,jsonb,text,timestamp with time zone)` | USER | t | t | Authenticated caller(s): UNK |
| `receive_stock_transfer(uuid,uuid)` | USER | f | t | Authenticated caller(s): BROWSER |
| `record_roadtour_reward(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,uuid,text,text)` | USER | t | t | Authenticated caller(s): UNK(file-has-admin) |
| `record_stock_movement(text,uuid,uuid,integer,numeric,uuid,text,text,text,text,uuid,text,uuid,uuid,text[],uuid)` | USER | t | t | Authenticated caller(s): ADMIN, BROWSER, SESSION |
| `reject_stock_transfer(uuid,uuid,text)` | USER | f | t | Authenticated caller(s): BROWSER |
| `release_allocation_for_order(uuid)` | USER | f | t | Authenticated caller(s): ADMIN, ADMIN?, UNK |
| `release_worker_lease(text,text)` | USER | f | f | Authenticated caller(s): UNK |
| `resolve_inventory_cutoff_allocation(uuid,uuid,uuid,text,uuid,integer,integer,text,uuid)` | USER | f | t | Authenticated caller(s): UNK |
| `resolve_inventory_cutoff_h2m_incoming(uuid,uuid[])` | USER | f | t | Authenticated caller(s): dynamic rpc name |
| `reverse_payroll_gl_posting(uuid,text,date)` | USER | t | t | Authenticated caller(s): SESSION |
| `roadtour_create_participant_mission(uuid,uuid,uuid,text,uuid,uuid,uuid)` | USER | t | t | Authenticated caller(s): UNK |
| `roadtour_record_product_qr_milestone_progress(uuid)` | USER | t | t | Authenticated caller(s): UNK |
| `save_stock_transfer_draft(uuid,uuid,uuid,jsonb,text,date,uuid,uuid)` | USER | f | t | Authenticated caller(s): BROWSER |
| `seed_hr_gl_accounts(uuid)` | USER | t | t | Authenticated caller(s): SESSION |
| `seed_payroll_components(uuid)` | USER | t | t | Authenticated caller(s): SESSION |
| `seed_payroll_gl_mappings(uuid)` | USER | t | t | Authenticated caller(s): SESSION |
| `set_inventory_cutoff_decision(uuid,uuid,text)` | USER | f | t | Authenticated caller(s): BROWSER |
| `start_inventory_opening_cutoff(uuid,timestamp with time zone)` | USER | f | t | Authenticated caller(s): BROWSER |
| `stock_count_snapshot_hash(uuid)` | USER | t | t | Authenticated caller(s): dynamic rpc name |
| `submit_and_allocate_d2h_order(uuid,uuid,uuid,uuid,jsonb,text,uuid,text,date)` | USER | f | t | Authenticated caller(s): BROWSER, UNK(file-has-admin) |
| `submit_stock_transfer_for_approval(uuid,uuid)` | USER | f | t | Authenticated caller(s): BROWSER |
| `try_acquire_worker_lease(text,text,integer)` | USER | f | f | Authenticated caller(s): UNK |
| `update_last_login(uuid)` | USER | t | t | Authenticated caller(s): BROWSER |
| `upsert_whatsapp_conversation(uuid,text,whatsapp_conversation_mode,text,text)` | USER | t | t | Authenticated caller(s): UNK(file-has-admin) |
| `verify_and_post_inventory_opening_cutoff(uuid,text)` | USER | f | t | Authenticated caller(s): dynamic rpc name |
| `verify_and_post_stock_count(uuid,text)` | USER | t | t | Authenticated caller(s): dynamic rpc name |
| `wms_reverse_manual_movement(uuid,text,uuid)` | USER | t | t | Authenticated caller(s): BROWSER |
| `wms_ship_master_auto(uuid)` | USER | t | t | Authenticated caller(s): SESSION |
| `wms_ship_mixed(uuid,uuid,uuid,uuid,integer,jsonb,uuid,text,text)` | USER | t | t | Authenticated caller(s): BROWSER |

## Guards added

- `delete_all_transactions_with_inventory_v3()` — `PERFORM public.sa_assert_service_role();`
- `delete_all_transactions_with_inventory()` — `PERFORM public.sa_assert_service_role();`
- `hard_delete_organization(uuid)` — `PERFORM public.sa_assert_service_role();`
- `adjust_inventory_quantity(uuid,uuid,integer)` — `PERFORM public.sa_assert_service_role();`
- `approve_payment_request(uuid)` — `PERFORM public.sa_assert_staff_actor(20, true);`
- `post_payroll_run_to_gl(uuid,date)` — `PERFORM public.sa_assert_staff_actor(20);`
- `post_payroll_payment_to_gl(uuid,date)` — `PERFORM public.sa_assert_staff_actor(20);`
- `reverse_payroll_gl_posting(uuid,text,date)` — `PERFORM public.sa_assert_staff_actor(20);`
- `seed_hr_gl_accounts(uuid)` — `PERFORM public.sa_assert_staff_actor(20);`
- `seed_payroll_components(uuid)` — `PERFORM public.sa_assert_staff_actor(20);`
- `seed_payroll_gl_mappings(uuid)` — `PERFORM public.sa_assert_staff_actor(20);`
- `generate_fiscal_periods(uuid,text)` — `PERFORM public.sa_assert_staff_actor(20);`
- `backfill_display_doc_numbers(uuid)` — `PERFORM public.sa_assert_staff_actor(10);`
- `process_referral_claim(uuid,text,uuid,text,text)` — `PERFORM public.sa_assert_staff_actor(20, false, p_reviewer_id);`
- `approve_reference_change(uuid,text,uuid,text)` — `PERFORM public.sa_assert_staff_actor(20, false, p_reviewer_id);`
- `bulk_reassign_reference(uuid,uuid,uuid,boolean)` — `PERFORM public.sa_assert_staff_actor(20, false, p_admin_id);`
- `propagate_warehouse_to_master_codes(uuid)` — `PERFORM public.sa_assert_staff_actor(40);`
- `mark_batch_as_printed(uuid)` — `PERFORM public.sa_assert_staff_actor(40);`
- `update_last_login(uuid)` — `PERFORM public.sa_assert_actor(user_id);`
- `wms_ship_master_auto(uuid)` — `PERFORM public.sa_assert_warehouse_shipment_actor(v_master.warehouse_org_id);`
- `get_user_by_email(text)` — rewritten as plpgsql with a staff guard
- `get_reference_assigned_shops(uuid)` — rewritten as plpgsql with a staff guard
- `fn_consumer_unique_list(uuid,uuid,text)` — rewritten as plpgsql with a staff guard
