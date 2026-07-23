-- Vape product variant KKM approval references and private certificates.
-- Keep manual_sku for compatibility with Returns/inventory integrations while
-- widening it so it can safely hold full KKM approval/reference numbers.

alter table public.product_variants
  alter column manual_sku type text;

comment on column public.product_variants.manual_sku is
  'Compatibility field used as the KKM approval/reference number for variants whose product category is marked is_vape.';

create table if not exists public.variant_kkm_certificates (
  id uuid primary key default gen_random_uuid(),
  product_variant_id uuid not null unique
    references public.product_variants(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  uploaded_by uuid not null default auth.uid() references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.variant_kkm_certificates is
  'One active private KKM approval certificate per Vape product variant.';

drop trigger if exists set_variant_kkm_certificates_updated_at on public.variant_kkm_certificates;
create trigger set_variant_kkm_certificates_updated_at
  before update on public.variant_kkm_certificates
  for each row execute function public.update_updated_at();

alter table public.variant_kkm_certificates enable row level security;

drop policy if exists variant_kkm_certificates_read on public.variant_kkm_certificates;
create policy variant_kkm_certificates_read
  on public.variant_kkm_certificates
  for select to authenticated
  using (
    exists (
      select 1
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      join public.product_categories pc on pc.id = p.category_id
      where pv.id = product_variant_id
        and pc.is_vape is true
        and (p.is_active is true or public.is_hq_admin())
    )
  );

drop policy if exists variant_kkm_certificates_admin_insert on public.variant_kkm_certificates;
create policy variant_kkm_certificates_admin_insert
  on public.variant_kkm_certificates
  for insert to authenticated
  with check (
    public.is_hq_admin()
    and uploaded_by = auth.uid()
    and exists (
      select 1
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      join public.product_categories pc on pc.id = p.category_id
      where pv.id = product_variant_id and pc.is_vape is true
    )
  );

drop policy if exists variant_kkm_certificates_admin_update on public.variant_kkm_certificates;
create policy variant_kkm_certificates_admin_update
  on public.variant_kkm_certificates
  for update to authenticated
  using (public.is_hq_admin())
  with check (
    public.is_hq_admin()
    and exists (
      select 1
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      join public.product_categories pc on pc.id = p.category_id
      where pv.id = product_variant_id and pc.is_vape is true
    )
  );

drop policy if exists variant_kkm_certificates_admin_delete on public.variant_kkm_certificates;
create policy variant_kkm_certificates_admin_delete
  on public.variant_kkm_certificates
  for delete to authenticated
  using (public.is_hq_admin());

grant select, insert, update, delete on public.variant_kkm_certificates to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kkm-certificates',
  'kkm-certificates',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists kkm_certificates_storage_read on storage.objects;
create policy kkm_certificates_storage_read
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'kkm-certificates'
    and exists (
      select 1
      from public.variant_kkm_certificates cert
      where cert.storage_path = name
    )
  );

drop policy if exists kkm_certificates_storage_insert on storage.objects;
create policy kkm_certificates_storage_insert
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'kkm-certificates'
    and public.is_hq_admin()
    and exists (
      select 1
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      join public.product_categories pc on pc.id = p.category_id
      where pv.id::text = (storage.foldername(name))[1]
        and pc.is_vape is true
    )
  );

drop policy if exists kkm_certificates_storage_update on storage.objects;
create policy kkm_certificates_storage_update
  on storage.objects
  for update to authenticated
  using (bucket_id = 'kkm-certificates' and public.is_hq_admin())
  with check (bucket_id = 'kkm-certificates' and public.is_hq_admin());

drop policy if exists kkm_certificates_storage_delete on storage.objects;
create policy kkm_certificates_storage_delete
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'kkm-certificates'
    and public.is_hq_admin()
    and exists (
      select 1
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      join public.product_categories pc on pc.id = p.category_id
      where pv.id::text = (storage.foldername(name))[1]
        and pc.is_vape is true
    )
  );
