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
