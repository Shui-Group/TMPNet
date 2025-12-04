# Milestone 2: Supabase Setup - Completion Checklist

## Pre-Implementation (Completed ✅)

- ✅ Installed `@supabase/supabase-js` package
- ✅ Created SQL scripts directory (`/sql`)
- ✅ Created Supabase client library (`/src/lib/supabase.ts`)
- ✅ Created TypeScript type definitions (`/src/lib/types.ts`)
- ✅ Created environment template (`.env.local.example`)
- ✅ Created comprehensive setup guide (`/docs/supabase-setup-guide.md`)
- ✅ Created test API route (`/src/pages/api/test-db.ts`)

## Manual Steps (You Need to Complete)

Follow the guide at `/docs/supabase-setup-guide.md`:

### Step 1: Create Supabase Project

- [ ] Sign up/log in to https://supabase.com
- [ ] Create new project named `memppi-atlas`
- [ ] Save database password securely
- [ ] Note Project URL and anon key

### Step 2: Create Database Tables

- [ ] Open Supabase SQL Editor
- [ ] Run `/sql/01_create_tables.sql`
- [ ] Verify tables appear in Table Editor

### Step 3: Import CSV Data

- [ ] Import `/data/node_info_with_exp.csv` → `nodes` table (4,445 rows)
- [ ] Import `/data/edge_info_with_exp.csv` → `edges` table (1,085,072 rows)
- [ ] Verify row counts match expected values

### Step 4: Enable Row Level Security

- [ ] Run `/sql/03_enable_rls.sql`
- [ ] Verify RLS is enabled on both tables

### Step 5: Configure Local Environment

- [ ] Copy `.env.local.example` → `.env.local`
- [ ] Add your Supabase URL and anon key to `.env.local`

### Step 6: Test Database Connection

- [ ] Start dev server: `npm run dev`
- [ ] Visit http://localhost:3000/api/test-db
- [ ] Verify success response with correct row counts

## Acceptance Criteria (From Roadmap)

- [ ] Both tables exist in Supabase with correct schemas
- [ ] Row counts match CSV file line counts (4,445 nodes, 1,085,072 edges)
- [ ] Test query from Supabase dashboard returns data
- [ ] Supabase client connects successfully from Next.js

## Files Created

```
/sql/
  ├── 01_create_tables.sql       # Database schema with indexes
  ├── 02_import_data.sql         # Import instructions (reference)
  ├── 03_enable_rls.sql          # Row Level Security policies
  └── README.md                  # SQL scripts documentation

/src/lib/
  ├── supabase.ts                # Supabase client initialization
  └── types.ts                   # TypeScript type definitions

/src/pages/api/
  └── test-db.ts                 # Database connection test endpoint

/docs/
  ├── supabase-setup-guide.md    # Comprehensive setup guide
  └── milestone-2-checklist.md   # This file

.env.local.example                # Environment template
```

## Verification Queries

Run these in Supabase SQL Editor after import:

```sql
-- Row counts (should match CSV line counts minus headers)
SELECT COUNT(*) FROM nodes;    -- Expected: 4,445
SELECT COUNT(*) FROM edges;    -- Expected: 1,085,072

-- Sample data
SELECT * FROM nodes LIMIT 5;
SELECT * FROM edges LIMIT 5;

-- Check for data integrity
SELECT COUNT(*) FROM edges e
WHERE NOT EXISTS (SELECT 1 FROM nodes n WHERE n.protein = e.protein1);
-- Expected: 0 (no orphaned edges)
```

## Common Issues & Solutions

See "Troubleshooting" section in `/docs/supabase-setup-guide.md`

## Time Estimate

- Supabase project creation: 5 minutes
- Table creation: 2 minutes
- Data import: 10-15 minutes (edges file is large)
- RLS setup: 2 minutes
- Local configuration: 3 minutes
- Testing: 5 minutes

**Total: ~30-35 minutes**

## Next Steps (Milestone 3)

Once Milestone 2 is verified complete:

- Create `/pages/api/network.ts` endpoint
- Implement data transformation utilities
- Test full network data fetch
