-- מאזן — food database (additive, safe to re-run).
--
-- New, read-only reference data: no existing table, row or policy is changed.
--   mz_foods         ~13k foods per 100 g: curated core + Israeli MoH (Tzameret)
--                    + USDA FoodData Central + Israeli packaged products (Open Food Facts)
--   mz_food_sources  where each dataset came from (licence, attribution, version, counts)
--   mz_norm()        Hebrew/English search normalisation
--   mz_search_foods  ranked, typo-tolerant search (members only)
--
-- Rows are written only by the import workflow (service role / owner); members can
-- only read. Re-running is harmless (IF NOT EXISTS / OR REPLACE everywhere).

create extension if not exists pg_trgm with schema extensions;

-- ── normalisation: lower-case, no niqqud / quotes / geresh, final letters → regular,
--    punctuation → spaces. "קוטג׳ 5%" and "קוטג' 5%" and "קוטג 5%" all become "קוטג 5%".
create or replace function public.mz_norm(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
    translate(
      lower(regexp_replace(regexp_replace(coalesce(t, ''), '[֑-ׇ]', '', 'g'), '[''"`´‘’׳״]', '', 'g')),
      'ךםןףץ', 'כמנפצ'),
    '[^0-9a-zא-ת%.]+', ' ', 'g'))
$$;

create table if not exists public.mz_foods (
  id              text primary key,          -- 'cur:egg' | 'moh:1561' | 'fdc:171077' | 'off:7290112336712'
  source          text not null check (source in ('curated', 'moh', 'usda', 'off')),
  source_ref      text,                      -- record id in the source, or the recipe composition
  source_url      text,
  verification    text not null check (verification in ('official', 'label', 'recipe', 'community', 'estimate')),
  name_he         text,
  name_en         text,
  brand           text,
  barcode         text,
  category        text,
  state           text not null default 'as_sold' check (state in ('raw', 'cooked', 'as_sold')),
  fat_added       boolean not null default false,
  -- per 100 g. carbs_g = AVAILABLE carbohydrate (without fibre), as on Israeli labels.
  kcal            numeric(6, 1) not null check (kcal >= 0 and kcal <= 950),
  protein_g       numeric(5, 1) not null check (protein_g >= 0 and protein_g <= 100),
  fat_g           numeric(5, 1) not null check (fat_g >= 0 and fat_g <= 100),
  carbs_g         numeric(5, 1) not null check (carbs_g >= 0 and carbs_g <= 100),
  -- optional: NULL means "not reported by the source" (never stored as 0)
  fiber_g         numeric(5, 1),
  sugar_g         numeric(5, 1),
  sat_fat_g       numeric(5, 1),
  sodium_mg       numeric(7, 1),
  servings        jsonb not null default '[]'::jsonb,   -- [["פרוסה", 30], ["יחידה", 100]]
  aliases         text not null default '',             -- extra search names, '|'-separated (curated)
  curated_key     text,                                 -- link to the in-app curated table
  quality_flags   text[] not null default '{}',
  rank_boost      real not null default 0,
  source_updated  date,
  imported_at     timestamptz not null default now(),
  search_text     text generated always as (
                    public.mz_norm(coalesce(name_he, '') || ' ' || coalesce(name_en, '') || ' ' || coalesce(brand, '') || ' ' || aliases)
                  ) stored
);

create index if not exists mz_foods_search_trgm on public.mz_foods using gin (search_text extensions.gin_trgm_ops);
create index if not exists mz_foods_barcode on public.mz_foods (barcode) where barcode is not null;
create index if not exists mz_foods_source on public.mz_foods (source);

create table if not exists public.mz_food_sources (
  source       text primary key,
  name         text not null,
  url          text not null,
  license      text not null,
  attribution  text not null,
  version      text,
  row_count    integer not null default 0,
  excluded     jsonb not null default '{}'::jsonb,
  imported_at  timestamptz not null default now()
);

alter table public.mz_foods enable row level security;
alter table public.mz_food_sources enable row level security;

drop policy if exists mz_foods_select_members on public.mz_foods;
create policy mz_foods_select_members on public.mz_foods for select to authenticated
  using ((select public.mz_is_member()));
drop policy if exists mz_food_sources_select_members on public.mz_food_sources;
create policy mz_food_sources_select_members on public.mz_food_sources for select to authenticated
  using ((select public.mz_is_member()));

revoke all on public.mz_foods, public.mz_food_sources from anon;
grant select on public.mz_foods, public.mz_food_sources to authenticated;

-- ── ranked search ────────────────────────────────────────────────────────────
-- relevance (trigram word similarity + share of query words found) plus a
-- reliability bonus: curated > MoH > USDA > product labels > community.
-- A community entry can only win on clearly better relevance, never on a tie.
create or replace function public.mz_search_foods(
  q text,
  lim integer default 20,
  want_state text default null,
  want_category text default null
)
returns table (
  id text, source text, verification text, name_he text, name_en text, brand text, barcode text,
  category text, state text, fat_added boolean,
  kcal numeric, protein_g numeric, fat_g numeric, carbs_g numeric,
  fiber_g numeric, sugar_g numeric, sat_fat_g numeric, sodium_mg numeric,
  servings jsonb, source_ref text, source_url text, source_updated date, curated_key text,
  quality_flags text[], score real
)
language plpgsql stable security definer
set search_path = public, extensions
set pg_trgm.word_similarity_threshold = 0.3
as $fn$
begin
  -- SECURITY DEFINER because row-level security would stop Postgres from using the
  -- trigram index (its operators are not "leakproof"). Access is checked here instead:
  -- members only, plus the edge function's service role.
  if not (coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.mz_is_member()) then
    return;
  end if;
  -- dynamic SQL so every call is planned with the actual search text: the GIN
  -- trigram index then answers in a few ms (a generic plan falls back to a seq scan)
  return query execute $q$
  with qn as (select public.mz_norm($1) as t),
  toks as (
    select coalesce(array_agg(w), '{}') as ws
    from qn, regexp_split_to_table(qn.t, ' ') as w
    where length(w) >= 2
  ),
  cand as (
    select f.*,
           word_similarity(qn.t, f.search_text) as sim,
           (select count(*) from unnest(toks.ws) w where position(w in f.search_text) > 0)::real
             / greatest(cardinality(toks.ws), 1) as cov
    from public.mz_foods f, qn, toks
    where length(qn.t) >= 2
      and f.search_text %> public.mz_norm($1)   -- GIN-indexable (column on the left)
      and ($4 is null or f.category = $4)
  )
  select c.id, c.source, c.verification, c.name_he, c.name_en, c.brand, c.barcode, c.category, c.state, c.fat_added,
         c.kcal, c.protein_g, c.fat_g, c.carbs_g, c.fiber_g, c.sugar_g, c.sat_fat_g, c.sodium_mg,
         c.servings, c.source_ref, c.source_url, c.source_updated, c.curated_key, c.quality_flags,
         (0.55 * c.sim + 0.45 * c.cov
          + case c.source when 'curated' then 0.12 when 'moh' then 0.06 when 'usda' then 0.03 else 0 end
          + case c.verification when 'community' then -0.08 when 'estimate' then -0.10 else 0 end
          + case when c.search_text like (select t from qn) || '%' then 0.10 else 0 end
          -- the query IS this food's name or one of its aliases ("אורז", "מלאווח")
          + case when c.sim < 0.99 then 0
                 when public.mz_norm(c.name_he) = (select t from qn) or public.mz_norm(c.name_en) = (select t from qn)
                   or exists (select 1 from unnest(string_to_array(c.aliases, '|')) a where public.mz_norm(a) = (select t from qn))
                 then case when c.verification = 'community' then 0.04 else 0.15 end
                 else 0 end
          + case when $3 is null or c.state = 'as_sold' then 0
                 when c.state = $3 then 0.08 else -0.12 end
          -- prefer concise generic names over long product descriptions
          - 0.0015 * greatest(least(coalesce(length(c.name_he), 999), coalesce(length(c.name_en), 999)) - 24, 0)
          - case when cardinality(c.quality_flags) > 0 then 0.15 else 0 end
          + c.rank_boost)::real as score
  from cand c
  order by score desc, c.id
  limit least(greatest(coalesce($2, 20), 1), 50)
  $q$ using q, lim, want_state, want_category;
end
$fn$;

revoke all on function public.mz_search_foods(text, integer, text, text) from public, anon;
grant execute on function public.mz_search_foods(text, integer, text, text) to authenticated, service_role;
revoke all on function public.mz_norm(text) from anon;
