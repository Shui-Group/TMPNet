# SQL Scripts for MemPPI-Atlas Database Setup

This directory contains SQL scripts for setting up the Supabase PostgreSQL database.

## Scripts

### 01_create_tables.sql

Creates the `nodes` and `edges` tables with proper schemas, indexes, and foreign key constraints.

**Run first**: This must be executed before importing any data.

**Usage**:

- Open Supabase Dashboard → SQL Editor
- Copy and paste the entire file
- Click "Run"

### 02_import_data.sql

Contains SQL commands and instructions for importing CSV data using PostgreSQL COPY commands.

**Note**: For most users, the Supabase Dashboard import feature (Method A in the setup guide) is easier. This script provides SQL-based alternatives.

### 03_enable_rls.sql

Enables Row Level Security (RLS) on both tables and creates public read-only access policies.

**Run last**: Execute this after all data has been imported successfully.

## Execution Order

1. `01_create_tables.sql` - Create schema
2. Import CSV data (via Dashboard or SQL)
3. `03_enable_rls.sql` - Enable security
4. `04_graph_layout_cache.sql` - Provision layout cache table

## Testing

After running all scripts, verify with:

```sql
-- Check tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Check row counts
SELECT 'nodes' as table, COUNT(*) FROM nodes
UNION ALL
SELECT 'edges' as table, COUNT(*) FROM edges;

-- Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('nodes', 'edges');
```

## Rollback

To start over:

```sql
DROP TABLE IF EXISTS edges CASCADE;
DROP TABLE IF EXISTS graph_layout_cache CASCADE;
DROP TABLE IF EXISTS nodes CASCADE;
```

Then re-run `01_create_tables.sql`.
