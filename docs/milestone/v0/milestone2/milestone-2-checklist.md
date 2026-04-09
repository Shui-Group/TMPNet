# Milestone 2 Checklist

## Status

This is now a historical bootstrap checklist with current references. It no
longer represents the entire database setup, because the repository now also
depends on layout-cache and structure-model assets.

## Current Bootstrap Checklist

- [ ] Run `npm run prepare:data:20260407`
- [ ] Create `nodes` and `edges` with `sql/01_create_tables.sql`
- [ ] Import `nodes.csv` and `edges.csv`
- [ ] Create `graph_layout_cache` with `sql/04_graph_layout_cache.sql`
- [ ] Enable public read access with `sql/02_enable_rls.sql`
- [ ] Apply `supabase/migrations/20260409173000_add_structure_models_and_edge_evidence.sql`
- [ ] Import `structure_models.csv`
- [ ] Upload structure assets to the `structure-models` bucket or the configured
      bucket override
- [ ] Add `.env.local` with Supabase URL and anon key
- [ ] Verify `/api/test-db`
- [ ] Verify `/api/network/stats`
- [ ] Verify a known structure page under `/structures/[modelId]`

## Prepared Files

- `data/supabase-import/20260407_new_web_data/nodes.csv`
- `data/supabase-import/20260407_new_web_data/edges.csv`
- `data/supabase-import/20260407_new_web_data/structure_models.csv`

## Verification Queries

```sql
select count(*) from public.nodes;
select count(*) from public.edges;
select count(*) from public.graph_layout_cache;
select count(*) from public.structure_models;
```

## Notes

- `src/pages/api/test-db.ts` is still present and can be used as a local smoke
  test.
- Earlier checklist items that referenced `.env.local.example` and
  `docs/supabase-setup-guide.md` have been superseded by the files currently in
  this repo.
