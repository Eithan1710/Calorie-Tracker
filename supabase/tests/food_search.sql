-- Search-quality checks for public.mz_search_foods (run by CI on a plain Postgres
-- after local_stubs.sql + the migration + a full import). Fails loudly on regressions.
insert into public.mz_members values ('00000000-0000-0000-0000-0000000000aa', 'ci') on conflict do nothing;

create or replace function pg_temp.top(q text, n int default 1, st text default null) returns text[] language sql as $$
  select array_agg(id) from (select id from public.mz_search_foods(q, n, st)) s
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);

do $$
declare
  checks text[][] := array[
    -- query, state, expected id among the top 3
    array['קוסקוס מבושל', 'cooked', 'cur:couscous_cooked'],
    array['חזה עוף', '', 'cur:chicken_breast_cooked'],
    array['חזה עוף נא', 'raw', 'cur:chicken_breast_raw'],
    array['קוטג', '', 'cur:cottage_5'],
    array['קוטג׳ 3%', '', 'cur:cottage_3'],
    array['קוטק', '', 'cur:cottage_5'],                 -- typo
    array['דנונה פרו', '', 'cur:protein_yogurt'],
    array['פיתה', '', 'cur:pita'],
    array['לאפה', '', 'cur:laffa'],
    array['חומוס', '', 'cur:hummus'],
    array['טחינה גולמית', '', 'cur:tahini_raw'],
    array['שניצל', '', 'cur:schnitzel'],
    array['סביח', '', 'cur:sabich'],
    array['במבה', '', 'cur:bamba'],
    array['אורז', 'cooked', 'cur:rice_white_cooked'],
    array['מלאווח', '', 'cur:malawach'],
    array['chicken breast', 'cooked', 'cur:chicken_breast_cooked'],
    array['chiken brest', '', 'cur:chicken_breast_raw'],  -- English typo
    array['cottage cheese', '', 'cur:cottage_5']
  ];
  c text[];
  got text[];
begin
  foreach c slice 1 in array checks loop
    got := pg_temp.top(c[1], 3, nullif(c[2], ''));
    if got is null or not (c[3] = any(got)) then
      raise exception 'search "%" (%): expected % in top 3, got %', c[1], c[2], c[3], got;
    end if;
  end loop;

  -- a community entry never beats the official/curated record of the same food
  got := pg_temp.top('במבה', 1);
  if got[1] like 'off:%' then raise exception 'community row ranked first for במבה: %', got; end if;

  -- raw/cooked preference flips the order
  if (pg_temp.top('חזה עוף', 1, 'raw'))[1] <> 'cur:chicken_breast_raw' then raise exception 'raw preference ignored'; end if;
  if (pg_temp.top('חזה עוף', 1, 'cooked'))[1] <> 'cur:chicken_breast_cooked' then raise exception 'cooked preference ignored'; end if;

  -- category filter
  if exists (select 1 from public.mz_search_foods('חלב', 20, null, 'dairy') where category is distinct from 'dairy') then
    raise exception 'category filter leaked other categories';
  end if;

  -- data invariants
  if exists (select 1 from public.mz_foods where protein_g + fat_g + carbs_g > 101) then raise exception 'macros over 100 g'; end if;
  if exists (select 1 from public.mz_foods where source = 'off' and cardinality(quality_flags) > 0) then raise exception 'flagged community rows imported'; end if;
  if (select count(*) from public.mz_foods where source = 'moh') < 4000 then raise exception 'MoH import incomplete'; end if;
  if (select count(*) from public.mz_foods where source = 'usda') < 7000 then raise exception 'USDA import incomplete'; end if;
  raise notice 'food search checks passed';
end $$;

-- non-members and anonymous users get nothing
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', false);
do $$ begin
  if exists (select 1 from public.mz_search_foods('חזה עוף', 5)) then raise exception 'non-member could search'; end if;
  if exists (select 1 from public.mz_foods) then raise exception 'non-member could read mz_foods'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform public.mz_search_foods('חזה עוף', 5);
    raise exception 'anon could call mz_search_foods';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
