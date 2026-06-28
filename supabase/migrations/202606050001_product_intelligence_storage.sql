create extension if not exists vector;

create table if not exists public.product_intelligence_records (
  id uuid primary key,
  canonical_product_key text not null unique,
  product_url text not null,
  retailer_domain text not null,
  page_fingerprint text not null,
  raw_payload jsonb not null,
  normalised_product jsonb not null,
  analysis jsonb not null,
  public_evidence jsonb not null default '[]'::jsonb,
  external_evidence_pack jsonb,
  scores jsonb not null,
  verdict jsonb not null,
  image_urls text[] not null default '{}',
  source_confidence_score numeric not null,
  source_confidence_label text not null,
  model_config jsonb not null,
  extension_version text not null,
  prompt_schema_version text not null,
  embedding_text text not null,
  embedding vector(1536),
  matched_approved_example_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_analysed_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.approved_product_examples (
  id text primary key,
  category text not null,
  material_family text not null,
  brand_tier text not null,
  price_band text not null,
  brand text not null default '',
  title text not null,
  url text not null default '',
  price_display text not null default '',
  image_url text,
  expected_scores jsonb not null,
  recommendation text not null,
  reasoning text not null default '',
  style_tags text[] not null default '{}',
  confidence numeric not null default 0,
  embedding_text text not null,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_intelligence_records_key_idx
  on public.product_intelligence_records (canonical_product_key);

create index if not exists product_intelligence_records_category_idx
  on public.product_intelligence_records ((normalised_product->>'category'));

create index if not exists product_intelligence_records_confidence_idx
  on public.product_intelligence_records (source_confidence_score);

create index if not exists product_intelligence_records_expires_idx
  on public.product_intelligence_records (expires_at);

create index if not exists product_intelligence_records_embedding_idx
  on public.product_intelligence_records
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100)
  where embedding is not null;

create index if not exists approved_product_examples_category_idx
  on public.approved_product_examples (category);

create index if not exists approved_product_examples_embedding_idx
  on public.approved_product_examples
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50)
  where embedding is not null;

create or replace function public.scouted_match_recommendation_candidates(
  query_embedding vector(1536),
  query_category text,
  query_product_type text,
  query_material_family text,
  query_price numeric,
  query_canonical_product_key text,
  match_count int default 12
)
returns table (
  id text,
  source text,
  title text,
  brand text,
  url text,
  image_url text,
  price_display text,
  scores jsonb,
  recommendation text,
  match_reason text,
  similarity double precision
)
language sql
stable
as $$
  with analysed as (
    select
      r.canonical_product_key as id,
      'analysed_product'::text as source,
      coalesce(r.analysis->'product'->>'title', r.normalised_product->>'title', '') as title,
      r.normalised_product->>'brand' as brand,
      r.product_url as url,
      nullif(r.image_urls[1], '') as image_url,
      r.normalised_product->>'price' as price_display,
      r.scores,
      r.verdict->>'recommendation' as recommendation,
      concat_ws(
        ', ',
        r.normalised_product->>'category',
        r.normalised_product->>'material_family',
        r.normalised_product->>'use_case',
        r.embedding_text
      ) as match_reason,
      1 - (r.embedding <=> query_embedding) as similarity
    from public.product_intelligence_records r
    where r.canonical_product_key <> query_canonical_product_key
      and r.normalised_product->>'category' = query_category
      and r.source_confidence_score >= 0.45
      and query_embedding is not null
      and r.embedding is not null
      and r.expires_at > now()
  ),
  approved as (
    select
      e.id,
      'approved_example'::text as source,
      e.title,
      e.brand,
      e.url,
      nullif(e.image_url, '') as image_url,
      e.price_display,
      e.expected_scores as scores,
      e.recommendation,
      concat_ws(', ', e.category, e.material_family, array_to_string(e.style_tags, ', '), e.embedding_text) as match_reason,
      1 - (e.embedding <=> query_embedding) as similarity
    from public.approved_product_examples e
    where e.category = query_category
      and e.confidence >= 0.45
      and query_embedding is not null
      and e.embedding is not null
  )
  select *
  from (
    select * from analysed
    union all
    select * from approved
  ) candidates
  order by similarity desc
  limit greatest(match_count, 1);
$$;
