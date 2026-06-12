# SQL Setup

This directory contains base SQL for the MemPPI-Atlas Postgres schema. The
supported VM deployment path builds a Docker database image locally; the VM only
runs docker/docker compose.

## Files

### `01_create_tables.sql`

Creates the base `nodes` and `edges` tables plus indexes.

### `02_enable_rls.sql`

Enables Row Level Security and grants public read access to the base tables.

### `04_graph_layout_cache.sql`

Creates `graph_layout_cache`, which stores Cytoscape node positions keyed by a
hashed graph signature.

## Docker-Owned Schema

The supported Docker database image uses schema/init files in
`docker/postgres-init/`:

- `010_core_network_schema.sql`
- `020_structure_models.sql`
- `030_import.sql`

Those files:

- adds edge-evidence columns to `edges`
- creates `structure_models`
- adds indexes
- enables RLS for `structure_models`
- imports the 0514 graph CSVs and relocated structure metadata

## Reference Execution Order

1. Run `npm run prepare:data`.
2. Build the Docker database seed image.
3. Start the VM stack with Docker Compose.

## Prepared CSV Outputs

The preparation script writes:

- `data/supabase-import/20260514_new_web_data/nodes.csv`
- `data/supabase-import/20260514_new_web_data/edges.csv`

The structure model metadata is 0407-derived and relocated under:

- `data/supabase-import/20260514_new_web_data/structure_models.csv`

The corresponding structure assets live under:

- `data/raw/20260514_new_web_data/best_structure/`

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
- Structure assets live in the local structure asset volume, not in Postgres.
- The current Docker VM data contract uses the 0514 graph dataset plus
  0407-derived relocated structure model data.
- Supabase CLI and storage bucket upload flows are not supported VM deployment
  paths.
