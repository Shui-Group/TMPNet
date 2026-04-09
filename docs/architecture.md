# Architecture

## Overview

MemPPI-Atlas is a monolithic Next.js 14 Pages Router app with three main
runtime concerns:

1. Supabase-backed graph APIs for proteins, interactions, and structure models.
2. Client-side Cytoscape rendering for large network views and focused
   subgraphs.
3. Structure inspection via an NGL viewer backed by public Supabase Storage
   assets.

## Runtime Flow

### Cover Page

- `src/pages/index.tsx` fetches `/api/network/stats`.
- The page renders summary metrics, a search box, and static dataset downloads.
- Search navigates to `/subgraph?proteins=...`.

### Full Network

- `src/pages/network.tsx` builds a query string from UI filters.
- It calls `/api/network` and `/api/network/stats`.
- Returned `nodes`, `edges`, and optional `layout` are converted to Cytoscape
  elements by `src/lib/graphUtils.ts`.
- `src/components/NetworkGraph.tsx` handles Cytoscape setup, progressive
  rendering, and layout persistence.

### Subgraph Search

- `src/pages/subgraph.tsx` reads `proteins` from the router query.
- `/api/subgraph` resolves each search term as either a UniProt accession or a
  gene symbol.
- Single-protein searches return the query node plus one-hop neighbors.
- Multi-protein searches return only the queried proteins plus edges between
  them.
- The page also renders sortable/filterable/exportable data tables.

### Structure Detail

- `src/pages/structures/[modelId].tsx` calls `/api/structures/[modelId]`.
- The response includes:
  - transformed `structure_models` metadata
  - the associated edge
  - both proteins
  - public asset links
  - a derived confidence summary parsed from `confidences.json`
- `src/components/StructureViewer.tsx` lazy-loads NGL from a CDN and colors the
  model by residue confidence.

## Data Pipeline

### Preparation

`scripts/prepare-csvs-for-import.js` normalizes the `20260407_new_web_data` raw
dataset into importable CSVs and builds `structure_models.csv`.

Outputs:

- `nodes.csv`
- `edges.csv`
- `structure_models.csv`

### Storage

- `nodes` and `edges` are created by `sql/01_create_tables.sql`.
- `graph_layout_cache` is created by `sql/04_graph_layout_cache.sql`.
- `structure_models` and extra edge-evidence columns are added by
  `supabase/migrations/20260409173000_add_structure_models_and_edge_evidence.sql`.

### Query Transform Layer

`src/lib/transforms.ts` converts raw Supabase rows to the frontend response
shapes in `src/lib/types.ts`.

## Layout Cache Design

- Graph layouts are keyed by a deterministic hash from `src/lib/layoutCache.ts`.
- Both `/api/network` and `/api/subgraph` attempt to read cached node positions.
- When cached positions are missing, the API returns `positionsNeeded: true`.
- The client computes the layout and posts it back to `/api/layout-cache`.
- `CURRENT_LAYOUT_VERSION` is the invalidation switch for all cached layouts.

## Important Current Behaviors

- `/api/network` accepts `format=json|cyto`, `positiveType`, `minProb`,
  `maxEdges`, `nodes`, `edges`, and `preferExperimental`.
- `/api/subgraph` also accepts `minProb`, `preferExperimental`, `maxEdges`, and
  `maxNodes`, but its implementation currently filters experimental edges using
  the stored value `experimental`.
- The network page keeps a local response cache keyed by the serialized filter
  query.
- The `onlyVisibleEdges` control is surfaced in the UI but is not yet used in
  the API request.

## Frontend Composition

Core shared components:

- `src/components/Header.tsx`
- `src/components/SearchBar.tsx`
- `src/components/Sidebar.tsx`
- `src/components/Legend.tsx`
- `src/components/DataTable.tsx`
- `src/components/NetworkGraph.tsx`
- `src/components/StructureViewer.tsx`

## Environment

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Optional:

- `SUPABASE_STRUCTURE_BUCKET`
- `NEXT_PUBLIC_SUPABASE_STRUCTURE_BUCKET`

If the structure bucket vars are omitted, the app defaults to
`structure-models`.
