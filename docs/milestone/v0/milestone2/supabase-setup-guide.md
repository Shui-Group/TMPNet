# Supabase Setup Guide

## Status

This guide reflects the current repository layout and data pipeline. It
supersedes the earlier version that only covered `nodes` and `edges`.

## 1. Prepare Import Files

Run:

```bash
npm run prepare:data:20260407
```

This generates:

- `data/supabase-import/20260407_new_web_data/nodes.csv`
- `data/supabase-import/20260407_new_web_data/edges.csv`
- `data/supabase-import/20260407_new_web_data/structure_models.csv`

## 2. Create Base Tables

Apply:

1. `sql/01_create_tables.sql`
2. `sql/04_graph_layout_cache.sql`
3. `sql/02_enable_rls.sql`

The base SQL sequence creates:

- `nodes`
- `edges`
- `graph_layout_cache`

## 3. Import Base CSVs

Import these files into Supabase:

- `nodes.csv` into `nodes`
- `edges.csv` into `edges`

Use header rows during import. Empty strings from the preparation script
represent null-like source values.

## 4. Apply Structure Migration

Run:

`supabase/migrations/20260409173000_add_structure_models_and_edge_evidence.sql`

This:

- adds evidence columns to `edges`
- creates `structure_models`
- adds indexes
- enables RLS on `structure_models`

## 5. Import `structure_models.csv`

Import:

- `data/supabase-import/20260407_new_web_data/structure_models.csv`
  into `structure_models`

## 6. Upload Structure Assets

The app expects structure files in the Supabase Storage bucket:

- default bucket: `structure-models`

Expected object paths are relative to:

- `data/raw/20260407_new_web_data/best_structure/`

The code validates that asset paths stay inside that root before constructing
public URLs.

## 7. Configure Local Environment

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Optional
SUPABASE_STRUCTURE_BUCKET=structure-models
NEXT_PUBLIC_SUPABASE_STRUCTURE_BUCKET=structure-models
```

## 8. Verify

Run locally:

```bash
npm run dev
```

Check:

- `/api/test-db`
- `/api/network/stats`
- `/network`
- `/subgraph?proteins=EGFR`
- `/structures/<known-model-id>`

## Useful SQL Checks

```sql
select 'nodes' as table_name, count(*) from public.nodes
union all
select 'edges' as table_name, count(*) from public.edges
union all
select 'graph_layout_cache' as table_name, count(*) from public.graph_layout_cache
union all
select 'structure_models' as table_name, count(*) from public.structure_models;
```

## Current Caveats

- The public app uses anon credentials; RLS must allow read access for the
  required tables.
- The structure routes depend on both database metadata and Storage objects; one
  without the other is not enough.
