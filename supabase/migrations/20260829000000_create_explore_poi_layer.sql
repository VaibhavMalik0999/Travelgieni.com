-- TravelGinni Explore named-POI storage and read contract.
--
-- The application repository exposes traveller_destination_id only as a string
-- and does not contain the Supabase base-table DDL behind
-- tg_global_destinations_final. It is therefore stored as text here. Add the
-- commented foreign key below only after the canonical base table and key type
-- have been verified in the target Supabase project.

create table public.tg_explore_pois (
  poi_id text primary key,
  overture_poi_id text not null,
  name text not null,
  canonical_category text not null,
  latitude double precision not null,
  longitude double precision not null,
  website_url text,
  source_url text,
  source_metadata jsonb,

  constraint tg_explore_pois_poi_id_not_blank
    check (btrim(poi_id) <> ''),
  constraint tg_explore_pois_overture_id_not_blank
    check (btrim(overture_poi_id) <> ''),
  constraint tg_explore_pois_name_not_blank
    check (btrim(name) <> ''),
  constraint tg_explore_pois_category_not_blank
    check (btrim(canonical_category) <> ''),
  constraint tg_explore_pois_latitude_range
    check (latitude between -90 and 90),
  constraint tg_explore_pois_longitude_range
    check (longitude between -180 and 180),
  constraint tg_explore_pois_overture_id_unique
    unique (overture_poi_id)
);

create index tg_explore_pois_category_idx
  on public.tg_explore_pois (canonical_category);

create table public.tg_explore_destination_pois (
  traveller_destination_id text not null,
  poi_id text not null,
  is_valid_for_destination boolean not null,
  destination_significance double precision not null,

  primary key (traveller_destination_id, poi_id),
  constraint tg_explore_destination_pois_poi_fk
    foreign key (poi_id)
    references public.tg_explore_pois (poi_id)
    on delete cascade,
  constraint tg_explore_destination_id_not_blank
    check (btrim(traveller_destination_id) <> ''),
  constraint tg_explore_destination_significance_range
    check (destination_significance between 0 and 1)
);

-- Intentionally not applied: this repository does not prove the canonical
-- destination base table or the database type of traveller_destination_id.
-- Replace <canonical_destination_table> only after inspecting the live schema:
--
-- alter table public.tg_explore_destination_pois
--   add constraint tg_explore_destination_pois_destination_fk
--   foreign key (traveller_destination_id)
--   references public.<canonical_destination_table> (traveller_destination_id)
--   on delete cascade;

create index tg_explore_destination_pois_valid_lookup_idx
  on public.tg_explore_destination_pois (traveller_destination_id, poi_id)
  where is_valid_for_destination = true;

create table public.tg_explore_poi_intents (
  poi_id text not null,
  intent_key text not null,
  structured_relevance double precision not null,
  semantic_relevance double precision,

  primary key (poi_id, intent_key),
  constraint tg_explore_poi_intents_poi_fk
    foreign key (poi_id)
    references public.tg_explore_pois (poi_id)
    on delete cascade,
  constraint tg_explore_poi_intents_intent_key_check
    check (
      intent_key in (
        'arts_entertainment',
        'bars_evening_drinks',
        'beach_coast',
        'cafe_culture',
        'clubbing_nightlife',
        'culture_history',
        'family_attractions',
        'food_dining',
        'hiking_outdoors',
        'nature_scenery',
        'resort_experience',
        'shopping_markets',
        'sports_recreation',
        'water_activities',
        'wellness'
      )
    ),
  constraint tg_explore_poi_intents_structured_range
    check (structured_relevance between 0 and 1),
  constraint tg_explore_poi_intents_semantic_range
    check (semantic_relevance is null or semantic_relevance between 0 and 1)
);

create index tg_explore_poi_intents_intent_lookup_idx
  on public.tg_explore_poi_intents (intent_key, poi_id);

create or replace function public.get_travelginni_explore_poi_candidates(
  p_traveller_destination_id text
)
returns table (
  poi_id text,
  traveller_destination_id text,
  poi_name text,
  category text,
  latitude double precision,
  longitude double precision,
  is_valid_for_destination boolean,
  destination_significance double precision,
  intent_relevance jsonb,
  semantic_intent_relevance jsonb,
  description text,
  locality text,
  country_code text,
  source_name text,
  source_poi_id text,
  source_url text
)
language sql
stable
set search_path = public
as $$
  select
    p.poi_id,
    dp.traveller_destination_id,
    p.name as poi_name,
    p.canonical_category as category,
    p.latitude,
    p.longitude,
    dp.is_valid_for_destination,
    dp.destination_significance,
    coalesce(
      jsonb_object_agg(i.intent_key, i.structured_relevance)
        filter (where i.intent_key is not null),
      '{}'::jsonb
    ) as intent_relevance,
    coalesce(
      jsonb_object_agg(i.intent_key, i.semantic_relevance)
        filter (where i.intent_key is not null and i.semantic_relevance is not null),
      '{}'::jsonb
    ) as semantic_intent_relevance,
    null::text as description,
    null::text as locality,
    null::text as country_code,
    'overture'::text as source_name,
    p.overture_poi_id as source_poi_id,
    coalesce(p.source_url, p.website_url) as source_url
  from public.tg_explore_destination_pois as dp
  join public.tg_explore_pois as p
    on p.poi_id = dp.poi_id
  left join public.tg_explore_poi_intents as i
    on i.poi_id = p.poi_id
  where dp.traveller_destination_id = p_traveller_destination_id
    and dp.is_valid_for_destination = true
  group by
    p.poi_id,
    p.name,
    p.canonical_category,
    p.latitude,
    p.longitude,
    p.overture_poi_id,
    p.source_url,
    p.website_url,
    dp.traveller_destination_id,
    dp.is_valid_for_destination,
    dp.destination_significance
  order by dp.destination_significance desc, p.poi_id;
$$;

comment on function public.get_travelginni_explore_poi_candidates(text) is
  'Returns precomputed, destination-valid named POI candidates for Explore Ranking V1; performs no request-time semantic or LLM work.';

-- Explore is server-only in the current application. Keep tables and the RPC
-- unavailable to browser roles; the API route calls it with the service role.
revoke all on table public.tg_explore_pois from anon, authenticated;
revoke all on table public.tg_explore_destination_pois from anon, authenticated;
revoke all on table public.tg_explore_poi_intents from anon, authenticated;
grant select on table public.tg_explore_pois to service_role;
grant select on table public.tg_explore_destination_pois to service_role;
grant select on table public.tg_explore_poi_intents to service_role;
revoke all on function public.get_travelginni_explore_poi_candidates(text)
  from public, anon, authenticated;
grant execute on function public.get_travelginni_explore_poi_candidates(text)
  to service_role;
