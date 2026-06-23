-- H2M is HQ-only and may be created by role level 40 or higher privilege.
-- D2H and S2D retain the existing orders_insert conditions unchanged.
drop policy if exists orders_insert on public.orders;

create policy orders_insert
on public.orders
for insert
to authenticated
with check (
    (
        buyer_org_id = public.current_user_org_id()
        or seller_org_id = public.current_user_org_id()
        or (
            public.get_org_type(public.current_user_org_id()) = 'HQ'
            and public.is_power_user()
            and company_id = public.get_company_id(public.current_user_org_id())
        )
    )
    and (
        order_type <> 'H2M'
        or (
            public.get_org_type(public.current_user_org_id()) = 'HQ'
            and public.current_user_role_level() <= 40
        )
    )
);

comment on policy orders_insert on public.orders is
    'Preserves existing D2H/S2D insert rules; H2M additionally requires an HQ user with role_level <= 40.';
