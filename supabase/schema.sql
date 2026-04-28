create extension if not exists pgcrypto;

create table if not exists public.merchants (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  owner_name text,
  city text not null,
  whatsapp_phone text not null,
  facebook_page_url text,
  status text not null default 'pending' check (status in ('pending', 'active', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.facebook_connections (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  facebook_page_id text not null,
  facebook_page_name text not null,
  page_access_token text not null,
  token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  last_imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, facebook_page_id)
);

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  source_platform text not null default 'facebook',
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  imported_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.product_drafts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  source_platform text not null default 'facebook',
  source_post_id text,
  source_url text,
  title text not null,
  description text,
  price_lyd numeric(10,2),
  city text not null,
  category text not null default 'غير مصنف',
  store_name text not null,
  whatsapp_phone text not null,
  image_url text,
  sizes text[] not null default '{}',
  colors text[] not null default '{}',
  stock_status text not null default 'متوفر',
  raw_payload jsonb,
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, source_platform, source_post_id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references public.merchants(id) on delete set null,
  draft_id uuid references public.product_drafts(id) on delete set null,
  title text not null,
  description text,
  price_lyd numeric(10,2),
  city text not null,
  category text not null,
  store_name text not null,
  whatsapp_phone text not null,
  image_url text,
  source_url text,
  badge text,
  sizes text[] not null default '{}',
  colors text[] not null default '{}',
  stock_status text not null default 'متوفر',
  status text not null default 'published' check (status in ('published', 'hidden', 'sold')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.product_drafts
  add column if not exists sizes text[] not null default '{}',
  add column if not exists colors text[] not null default '{}',
  add column if not exists stock_status text not null default 'متوفر';

alter table if exists public.products
  add column if not exists sizes text[] not null default '{}',
  add column if not exists colors text[] not null default '{}',
  add column if not exists stock_status text not null default 'متوفر';

create index if not exists idx_products_status on public.products(status);
create index if not exists idx_products_city on public.products(city);
create index if not exists idx_products_category on public.products(category);
create index if not exists idx_product_drafts_status on public.product_drafts(status);
create index if not exists idx_import_jobs_merchant on public.import_jobs(merchant_id);

alter table public.merchants enable row level security;
alter table public.facebook_connections enable row level security;
alter table public.import_jobs enable row level security;
alter table public.product_drafts enable row level security;
alter table public.products enable row level security;

drop policy if exists "Public can read published products" on public.products;
create policy "Public can read published products"
on public.products
for select
using (status = 'published');

drop policy if exists "Public can create merchant applications" on public.merchants;
create policy "Public can create merchant applications"
on public.merchants
for insert
with check (true);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists merchants_touch_updated_at on public.merchants;
create trigger merchants_touch_updated_at
before update on public.merchants
for each row execute function public.touch_updated_at();

drop trigger if exists facebook_connections_touch_updated_at on public.facebook_connections;
create trigger facebook_connections_touch_updated_at
before update on public.facebook_connections
for each row execute function public.touch_updated_at();

drop trigger if exists product_drafts_touch_updated_at on public.product_drafts;
create trigger product_drafts_touch_updated_at
before update on public.product_drafts
for each row execute function public.touch_updated_at();

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
before update on public.products
for each row execute function public.touch_updated_at();

