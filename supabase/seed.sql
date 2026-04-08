-- Seed data is intentionally handled outside repo-tracked SQL because the
-- network and structure source files live under data/raw/ and are normalized
-- into data/supabase-import/20260407_new_web_data/.
--
-- Use:
--   npm run prepare:data:20260407
--
-- Then import the generated artifacts with the remote workflow for this repo.
select 1;
