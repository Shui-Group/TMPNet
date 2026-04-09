# CLAUDE.md

This file summarizes the current repository state for agent tooling.

## Project Summary

MemPPI-Atlas is a Next.js 14 Pages Router app for exploring endogenous
transmembrane protein-protein interaction networks. It combines Supabase-backed
graph APIs, Cytoscape-based network rendering, and an NGL-powered structure
viewer for AlphaFold3 interaction models.

## Commands

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run format
npm run format:check
npm test
npm run test:watch
npm run test:coverage
npm run prepare:data:20260407
```

## Live Routes

- `/` cover page
- `/network` full network explorer
- `/subgraph?proteins=...` search result graph
- `/structures/[modelId]` structure detail page

## Key API Routes

- `/api/network`
- `/api/network/stats`
- `/api/subgraph`
- `/api/layout-cache`
- `/api/structures/[modelId]`
- `/api/structures/[modelId]/asset`
- `/api/test-db`

## Data Flow

1. Raw dataset in `data/raw/20260407_new_web_data`
2. `scripts/prepare-csvs-for-import.js` generates import-ready CSVs
3. Base SQL creates `nodes`, `edges`, and `graph_layout_cache`
4. Supabase migration creates `structure_models` and extra edge columns
5. API routes transform rows into frontend response types
6. Frontend pages render Cytoscape graphs or NGL structure views

## Important Files

- `src/lib/types.ts`
- `src/lib/transforms.ts`
- `src/lib/graphUtils.ts`
- `src/lib/layoutCache.ts`
- `src/lib/structureAssets.ts`
- `src/lib/structureModels.ts`
- `src/pages/network.tsx`
- `src/pages/subgraph.tsx`
- `src/pages/structures/[modelId].tsx`
- `src/pages/api/network.ts`
- `src/pages/api/subgraph.ts`
- `src/pages/api/layout-cache.ts`

## Environment Variables

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Optional:

- `SUPABASE_STRUCTURE_BUCKET`
- `NEXT_PUBLIC_SUPABASE_STRUCTURE_BUCKET`

## Testing Notes

- Jest is configured via `next/jest`.
- Coverage threshold is 70% globally.
- Tests are split across `tests/` and a few co-located source tests.
- Mock Supabase boundaries instead of using a live project in tests.

## Current Caveats

- `/api/subgraph` uses `positive_type = 'experimental'` for experimental-edge
  lookups, while `/api/network` uses `experiment`.
- `onlyVisibleEdges` exists in the `/network` sidebar but is not currently wired
  into the backend request.
- `src/pages/api/test-db.ts` remains in the repo as a convenience verification
  route.

## Canonical Docs

- `README.md`
- `docs/architecture.md`
- `docs/api.md`
- `docs/data-model.md`
- `docs/ui-spec.md`
- `sql/README.md`
