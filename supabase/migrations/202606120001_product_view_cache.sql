-- Cache for Gemini-generated product turnaround views.
-- Keyed by sha256(image_url + angle + model + prompt version), so a given
-- photo's views are generated once and reused across checks.

create table if not exists public.product_view_cache (
  cache_key text primary key,
  image_url text not null,
  angle integer not null,
  mime_type text not null,
  data text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create index if not exists product_view_cache_image_url_idx
  on public.product_view_cache (image_url);

alter table public.product_view_cache enable row level security;

-- Service-role access only; no anon policies on purpose.
