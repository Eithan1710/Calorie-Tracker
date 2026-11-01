-- Body weight to 0.01 kg on the profile too (mz_weights already keeps numeric(5,2)).
-- A weigh-in of 59.65 was stored on the profile as 59.7; widening keeps every existing value as is.
alter table public.mz_profiles alter column weight_kg type numeric(5, 2);
