## Network Graph: Current Layout, Logic, and Performance Plan

### Scope

This document analyzes how the network graph is assembled, rendered, and controlled across the app, and outlines performance characteristics, bottlenecks, and quick wins. Focus areas:

- Visualization: `src/components/NetworkGraph.tsx`, `src/lib/cytoscape-config.ts`
- Data shaping: `src/lib/graphUtils.ts`, `src/lib/transforms.ts`, `src/lib/types.ts`
- Entry points/UI: `src/pages/index.tsx`, `src/pages/subgraph.tsx`, `src/components/Sidebar.tsx`, `src/components/Legend.tsx`, `src/components/SearchBar.tsx`
- Backend: `src/pages/api/network.ts`, `src/pages/api/subgraph.ts`, `src/pages/api/network/stats.ts`

### Rendering Pipeline (Client)

1. Cytoscape initialization (NetworkGraph)

   - Lazy-imports Cytoscape and registers `fcose` extension.
   - Creates an instance with:
     - Style: `cyStyles`
     - Initial layout: `preset` (fast) then runs a computed layout.
     - Canvas renderer with capped `pixelRatio` and motion blur enabled.
     - Interaction tuned for large graphs (reduced wheel sensitivity, selection tweaks).

2. Progressive element application (NetworkGraph)

   - Splits incoming elements into nodes and edges.
   - For large graphs (`edgeCount > largeGraphThreshold = 75,000`):
     - Seeds the layout with nodes + first 12,000 edges, otherwise 20,000.
     - Runs layout (default `fcoseLayout`, or `cose` fallback).
     - Batches in remaining edges in chunks (5,000 for large graphs, otherwise 10,000) without re-layout.
   - Ensures query nodes (`[?isQuery]`) and their edges stay visually on top via z-index adjustments.

3. Interaction and UX (NetworkGraph)

   - Node tap toggles exclusive selection; background tap unselects.
   - Node hover tooltips: positioned using rendered coordinates and clamped to container bounds.
   - Viewport/drag/resize hide tooltips to avoid stale overlays.

4. Layout profiles (cytoscape-config)

   - `fcoseLayout` (default): draft quality, non-animated, tuned for speed (`nodeRepulsion`, `idealEdgeLength`, `gravity`, `numIter`).
   - `coseLayout` (subgraph page): deterministic, non-animated alternative.

5. Styling (cytoscape-config)
   - Nodes are small by default (8–12px), with labels only for selected/query nodes.
   - Edges are thin, straight, partially transparent; width encodes `fusionPredProb`.
   - Query nodes are larger, labeled, and visually emphasized.

### Data Flow

1. Network page (`/`)

   - UI state lives in `index.tsx`:
     - Sidebar controls: `positiveTypes`, `maxEdges`, `onlyVisibleEdges` (UI-only today).
     - Builds querystring for `/api/network` with `maxEdges` and `positiveType`.
   - Fetches stats from `/api/network/stats` (counts, family distribution).
   - Fetches network from `/api/network` and caches responses by querystring.
   - Transforms to Cytoscape via `toCytoscapeElements` and renders `NetworkGraph`.

2. Subgraph page (`/subgraph`)

   - Reads `proteins` from query (comma-separated UniProt IDs).
   - Calls `/api/subgraph` with truncation caps (`maxEdges <= 20k`, `maxNodes <= 5k`).
   - Uses `coseLayout` for a compact focused view and shows tabular node/edge data.

3. Color and element shaping (`graphUtils.ts`)
   - Node color from `familyColorMap`; query nodes use a fixed dark blue.
   - Edge color by type: experimental, enriched, predicted (blue-cool palette).
   - `toCytoscapeElements` merges `nodesToCy` and `edgesToCy` results.

### Backend Logic and Server-Side Performance

1. `/api/network`

   - Query params: `positiveType`, `minProb` (for predictions), `maxEdges` (hard cap 100k), `nodes` (optional list filter), `format` (json|cyto), `preferExperimental`.
   - Fetches nodes (optionally filtered by `nodes`).
   - Counts edges by type, then page-fetches edges in 10k slices per type, deduping and respecting `maxEdges`.
   - Transforms DB records -> API shapes -> optional Cytoscape element format (`format=cyto`).
   - Returns metadata with timing breakdown (`fetchNodesMs`, `fetchEdgesMs`, `transformMs`, `totalMs`).
   - CDN-friendly cache header: `s-maxage=60, stale-while-revalidate=300`.

2. `/api/subgraph`

   - Inputs: `proteins`, `minProb`, `preferExperimental`, `maxEdges` (<= 20k), `maxNodes` (<= 5k).
   - Phase 1: Fetch edges incident to any query protein (experimental first, then predicted by `fusion_pred_prob`), dedupe, enforce caps.
   - Phase 2: Build node set (query + neighbors), enforce `maxNodes`, filter edges to intra-set; then optionally add more intra-set edges up to remaining capacity (experimental first, then predicted by probability), dedupe again.
   - Phase 3: Fetch node details, mark `isQuery` on matched proteins, return payload with optional truncation flags.

3. `/api/network/stats`
   - Counts total nodes and edges via head-count queries.
   - Aggregates family distribution from `nodes.family`.
   - Counts enriched and predicted edges; falls back to batched scans if count queries fail/time out.

### Current Performance Techniques (Effective Today)

- Progressive rendering:
  - Seed a limited edge set for initial layout; append remaining edges without relayout.
  - Batch size adapts for large graphs.
- Render cost control:
  - Canvas renderer with `pixelRatio` cap and motion blur.
  - Minimal labels by default; label only selected/query nodes.
  - Straight edges, low opacity, small nodes.
- Server-side filtering and pagination:
  - `maxEdges` enforced server-side with 10k page windows.
  - Predicted edges ordered by `fusion_pred_prob` to deliver high-signal edges first.
  - Optional `nodes` filter supported by API for subsetting.
- Client caching:
  - Response cache keyed by querystring to avoid recomputation and re-layout when toggling back.

### Fixed Layout Rollout Tasks

1. Backend layout cache foundation
   - Add a `graph_layout_cache` table in Supabase with columns: `graph_key` (PK), `node_id`, `x`, `y`, `layout_version`, `updated_at`.
   - Extend `/api/network` and `/api/subgraph` to compute a deterministic `graph_key` (hash of sorted node and edge ids plus query params) and read cached coordinates in the response payload when available.
   - Expose a new POST endpoint `/api/layout-cache` that accepts `{ graphKey, positions: Array<{ id, x, y }>, layoutVersion }` and upserts rows.
   - Emit structured logs for cache hits/misses and POST writes, ensuring request duration metrics include cache lookup time.

2. Client capture & save pipeline
   - Update `NetworkGraph.tsx` to detect when elements include `position` data and skip running Cytoscape layouts, applying `preset` positions directly.
   - After the first `layoutstop` with uncached graphs, collect node coordinates and POST them to `/api/layout-cache`; include guard rails to avoid duplicate submissions.
   - Set `cy.autolock(true)` and `cy.autoungrabify(true)` once positions are loaded to prevent user dragging while keeping pan/zoom enabled.
   - When cache positions are present, bypass progressive edge batching and add the full edge set immediately to reduce reflow cost.

3. Shared utilities & data flow
   - Extend `graphUtils.ts` (or a new helper) to merge `position` into node definitions when supplied from the API, reusing existing element creation logic.
   - Update transforms or API response assembly to include `positionsNeeded` boolean when cache is cold so the client can decide whether to run layouts.
   - Document the graph key generation and layout versioning scheme in `architecture.md` to aid future migrations.

4. Validation & operations
   - Add Jest tests covering the new API contract (layout cache fetch/write) with Supabase mocks, plus client unit tests ensuring layout skip logic triggers only when all nodes have coordinates.
   - Instrument analytics dashboards or logs to track cache hit rate, average load time before/after rollout, and any `positionsNeeded` fallbacks.
   - Provide a manual invalidation mechanism (e.g., POST `/api/layout-cache` with `refresh=true` or admin UI toggle) documented for data updates.

**Acceptance criteria**
- Cold requests still compute layouts once, then subsequent identical queries reuse cached coordinates without rerunning layouts.
- Nodes stay fixed during interaction; only pan/zoom remains available.
- Cache API endpoints return 2xx responses under load tests (10 concurrent warm requests) and maintain <50 ms overhead on cache hits.
- Automated tests cover cache hit/miss logic and client skip behavior with 100% pass rate in CI.

### Bottlenecks and Risks

- Layout scale limits:
  - `fcose` on very large graphs still has non-trivial compute; initial layout on 12k–20k edges is the pacing step.
- Rendering density:
  - At extreme zoom-out, full edge draws can be fill-rate bound on some GPUs/CPUs even with canvas.
- API fallback scans:
  - `/api/network/stats` may fall back to batch scans for counts; these are slower and can add load.
- Large payloads:
  - Returning up to 100k edges produces multi-MB JSON; parse/GC pressure on clients and higher TTFB.
- Unused UI filter:
  - `onlyVisibleEdges` is currently UI-only; not plumbed into data fetch or client-side subsetting.

### Notes on Maintainability

- Keep layout and style config in `cytoscape-config.ts`; avoid per-component overrides.
- Reuse `toCytoscapeElements` for all graph views to ensure consistent mappings/colors.
- Limit modules to < 500 lines; split if growth continues (tooltips, interactions, and layout tuning can be modularized).
