-- Nullable staging column preserves all existing RoadTour events and QR behavior.
-- NULL is intentionally interpreted by the application as the Vape experience.
alter table public.roadtour_runs
    add column if not exists product_category_id uuid null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'roadtour_runs_product_category_id_fkey'
          and conrelid = 'public.roadtour_runs'::regclass
    ) then
        alter table public.roadtour_runs
            add constraint roadtour_runs_product_category_id_fkey
            foreign key (product_category_id)
            references public.product_categories(id)
            on delete set null;
    end if;
end $$;

create index if not exists idx_roadtour_runs_product_category_id
    on public.roadtour_runs(product_category_id)
    where product_category_id is not null;

comment on column public.roadtour_runs.product_category_id is
    'Product Master Data category selecting the RoadTour participant mobile experience. NULL falls back to Vape.';
