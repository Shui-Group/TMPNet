# SQL Setup

This directory contains the base SQL used to bootstrap the Supabase database
for MemPPI-Atlas.

## Files

### `01_create_tables.sql`

Creates the base `nodes` and `edges` tables plus indexes.

### `02_enable_rls.sql`

Enables Row Level Security and grants public read access to the base tables.

### `03_import_data.sql`

Reference import instructions for loading CSV data into Supabase.

### `04_graph_layout_cache.sql`

Creates `graph_layout_cache`, which stores Cytoscape node positions keyed by a
hashed graph signature.

## What Is Not In This Folder

The structure-model expansion is not part of the base SQL sequence. It lives in
the Supabase migration:

- `supabase/migrations/20260409173000_add_structure_models_and_edge_evidence.sql`

That migration:

- adds edge-evidence columns to `edges`
- creates `structure_models`
- adds indexes
- enables RLS for `structure_models`

## Recommended Execution Order

1. Run `npm run prepare:data:20260407`.
2. Apply `01_create_tables.sql`.
3. Import `nodes.csv` and `edges.csv`.
4. Apply `04_graph_layout_cache.sql`.
5. Apply `02_enable_rls.sql`.
6. Apply the structure-model migration from `supabase/migrations/`.
7. Import `structure_models.csv`.

## Prepared CSV Outputs

The preparation script writes:

- `data/supabase-import/20260407_new_web_data/nodes.csv`
- `data/supabase-import/20260407_new_web_data/edges.csv`
- `data/supabase-import/20260407_new_web_data/structure_models.csv`

## Verification Queries

```sql
select tablename
from pg_tables
where schemaname = 'public'
order by tablename;

select 'nodes' as table_name, count(*) from public.nodes
union all
select 'edges' as table_name, count(*) from public.edges
union all
select 'graph_layout_cache' as table_name, count(*) from public.graph_layout_cache
union all
select 'structure_models' as table_name, count(*) from public.structure_models;
```

## Notes

- `structure_models` depends on `edges` and `nodes`.
- Structure assets themselves live in Supabase Storage, not in Postgres.
- The base schema comments still mention older source data names in a few places;
  the live import pipeline is the `20260407_new_web_data` dataset.
