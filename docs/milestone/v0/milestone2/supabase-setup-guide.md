# Supabase Setup and Data Import Guide

This guide walks you through creating a Supabase project, setting up the database schema, and importing the MemPPI-Atlas CSV data.

---

## Step 1: Create Supabase Project

1. **Sign up / Log in to Supabase**

   - Go to https://supabase.com
   - Create an account or log in

2. **Create a new project**

   - Click "New Project"
   - Choose your organization (or create one)
   - Fill in project details:
     - **Name**: `memppi-atlas` (or your preferred name)
     - **Database Password**: Generate a strong password (save this securely!)
     - **Region**: Choose closest to your users
     - **Pricing Plan**: Free tier is sufficient for development
   - Click "Create new project"
   - Wait 2-3 minutes for project initialization

3. **Note your project credentials**
   - Go to **Project Settings** (gear icon in sidebar) → **API**
   - Copy these values (you'll need them later):
     - **Project URL**: `https://eopwpiccxxzhxwzevmrm.supabase.co`
     - **anon/public key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvcHdwaWNjeHh6aHh3emV2bXJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNDU5NDgsImV4cCI6MjA3NjcyMTk0OH0.eLrjfzz4TjP1h5lrouwhNKFa2X2OalNpmxyWDJaXVM0` (long string)

---

## Step 2: Create Database Tables

1. **Open SQL Editor**

   - In Supabase Dashboard, click **SQL Editor** in the left sidebar
   - Click "New query"

2. **Run table creation script**
   - Copy the contents of `/sql/01_create_tables.sql`
   - Paste into the SQL Editor
   - Click "Run" or press Ctrl+Enter
   - You should see: `Success. No rows returned`
   - Verify tables exist: Go to **Table Editor** → You should see `nodes` and `edges` tables

---

## Step 3: Prepare CSV Files for Import

**Important**: The original CSV files have headers with dots (e.g., `Entry.Name`) that don't match our database column names (e.g., `entry_name`). We need to convert them first.

### Convert CSV Headers:

Run this command in your project directory:

```bash
node scripts/prepare-csvs-for-import.js
```

This will create new CSV files with corrected headers in `/data/supabase-import/`:

- `nodes.csv` - Ready to import (4,445 rows)
- `edges.csv` - Ready to import (1,085,072 rows)

---

## Step 4: Import CSV Data

### Method A: Using Supabase Dashboard (Recommended)

#### Import Nodes:

1. Go to **Table Editor** → Select `nodes` table
2. Click **Insert** dropdown → **Import data from CSV**
3. Select `/data/supabase-import/nodes.csv` (**not** the original file)
4. Headers should now match automatically:
   - `protein`, `entry_name`, `description`, `gene_names`, `family`, `expression_tissue`
5. **Important**: Check "First row is header"
6. Click "Import data"
7. Wait for import to complete (~4,445 rows)
8. Verify: Run in SQL Editor:
   ```sql
   SELECT COUNT(*) FROM nodes;
   -- Expected: 4445
   ```

#### Import Edges:

1. Go to **Table Editor** → Select `edges` table
2. Click **Insert** dropdown → **Import data from CSV**
3. Select `/data/supabase-import/edges.csv` (**not** the original file)
4. Headers should now match automatically:
   - `edge`, `protein1`, `protein2`, `fusion_pred_prob`, `enriched_tissue`, `tissue_enriched_confidence`, `positive_type`
5. Check "First row is header"
6. **Important**: Enable "Convert NA to NULL" if available
7. Click "Import data"
8. **Warning**: This file is large (~1M rows). Import may take 5-10 minutes. Be patient!
9. Verify: Run in SQL Editor:
   ```sql
   SELECT COUNT(*) FROM edges;
   -- Expected: 1085072
   ```

### Method B: Using SQL COPY (Fastest, but requires file upload)

**Note**: This method requires uploading CSV files to Supabase Storage first, which can be complex. Use Method A unless you need the performance.

1. Go to **Storage** → Create a new bucket called `imports`
2. Upload both CSV files to the bucket
3. Get the public URLs for the files
4. Run the import SQL (modified from `/sql/02_import_data.sql`)

---

## Step 5: Handle NA to NULL Conversion

If your import didn't automatically convert "NA" strings to NULL:

```sql
-- Convert NA strings to NULL for numeric columns in edges
UPDATE edges
SET fusion_pred_prob = NULL
WHERE fusion_pred_prob IS NOT NULL
  AND fusion_pred_prob::TEXT = 'NaN';

UPDATE edges
SET tissue_enriched_confidence = NULL
WHERE tissue_enriched_confidence IS NOT NULL
  AND tissue_enriched_confidence::TEXT = 'NaN';

-- Convert NA strings to NULL for text columns (optional)
UPDATE edges SET enriched_tissue = NULL WHERE enriched_tissue = 'NA';
UPDATE nodes SET entry_name = NULL WHERE entry_name = 'NA';
UPDATE nodes SET description = NULL WHERE description = 'NA';
UPDATE nodes SET gene_names = NULL WHERE gene_names = 'NA';
UPDATE nodes SET family = NULL WHERE family = 'NA';
UPDATE nodes SET expression_tissue = NULL WHERE expression_tissue = 'NA';
```

---

## Step 6: Enable Row Level Security

1. **Open SQL Editor**
2. Copy the contents of `/sql/03_enable_rls.sql`
3. Paste and run
4. Verify RLS is enabled:
   ```sql
   SELECT tablename, rowsecurity
   FROM pg_tables
   WHERE tablename IN ('nodes', 'edges');
   -- Both should show rowsecurity = true
   ```

---

## Step 7: Verify Data Import

Run these verification queries in SQL Editor:

```sql
-- Check row counts
SELECT 'nodes' as table_name, COUNT(*) as count FROM nodes
UNION ALL
SELECT 'edges' as table_name, COUNT(*) as count FROM edges;

-- Sample data
SELECT * FROM nodes LIMIT 5;
SELECT * FROM edges LIMIT 5;

-- Check for orphaned edges (should return 0)
SELECT COUNT(*)
FROM edges e
WHERE NOT EXISTS (SELECT 1 FROM nodes n WHERE n.protein = e.protein1)
   OR NOT EXISTS (SELECT 1 FROM nodes n WHERE n.protein = e.protein2);

-- Check enriched tissue distribution
SELECT enriched_tissue, COUNT(*)
FROM edges
WHERE enriched_tissue IS NOT NULL
GROUP BY enriched_tissue
ORDER BY COUNT(*) DESC
LIMIT 10;

-- Check family distribution
SELECT family, COUNT(*)
FROM nodes
WHERE family IS NOT NULL
GROUP BY family
ORDER BY COUNT(*) DESC;
```

Expected results:

- Nodes: 4,445 rows
- Edges: 1,085,072 rows
- Zero orphaned edges
- Various families and enriched tissues

---

## Step 8: Configure Local Environment

1. **Copy environment template**

   ```bash
   cp .env.local.example .env.local
   ```

2. **Add your Supabase credentials**
   Edit `.env.local` and replace the placeholder values:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

3. **Verify connection**
   Start the dev server and check for errors:
   ```bash
   npm run dev
   ```

---

## Step 9: Test Database Connection

Create a simple test API route to verify everything works:

```typescript
// pages/api/test-db.ts
import { supabase } from "@/lib/supabase";

export default async function handler(req, res) {
  const { data: nodes, error: nodesError } = await supabase
    .from("nodes")
    .select("count", { count: "exact", head: true });

  const { data: edges, error: edgesError } = await supabase
    .from("edges")
    .select("count", { count: "exact", head: true });

  if (nodesError || edgesError) {
    return res.status(500).json({
      error: nodesError || edgesError,
    });
  }

  res.status(200).json({
    nodes: nodes,
    edges: edges,
    message: "Database connection successful!",
  });
}
```

Visit http://localhost:3000/api/test-db and you should see:

```json
{
  "nodes": 4445,
  "edges": 1085072,
  "message": "Database connection successful!"
}
```

---

## Troubleshooting

### Issue: "relation 'nodes' does not exist"

- **Solution**: Make sure you ran `/sql/01_create_tables.sql` in the SQL Editor

### Issue: "permission denied for table nodes"

- **Solution**: Run `/sql/03_enable_rls.sql` to enable RLS and public read policies

### Issue: Import takes too long or times out

- **Solution**:
  - The edges CSV is large (1M+ rows). Be patient.
  - Try importing in smaller chunks using SQL filters
  - Use command line tools like `psql` for faster imports

### Issue: Foreign key constraint violations

- **Solution**: Import nodes BEFORE edges (nodes must exist first)

### Issue: "NA" values not converted to NULL

- **Solution**: Run the UPDATE queries from Step 4

### Issue: Can't connect from Next.js app

- **Solution**:
  - Verify `.env.local` has correct values
  - Restart dev server after editing `.env.local`
  - Check that RLS policies are enabled
  - Verify anon key (not service_role key) is being used

---

## Next Steps

Once data is imported and verified:

- ✅ Milestone 2 is complete!
- Move to Milestone 3: Create `/api/network` endpoint
- Test API routes locally before building UI components

---

## Reference

- **Supabase Docs**: https://supabase.com/docs
- **PostgreSQL COPY**: https://www.postgresql.org/docs/current/sql-copy.html
- **Supabase RLS**: https://supabase.com/docs/guides/auth/row-level-security
