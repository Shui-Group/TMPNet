# UI Specification

## Purpose

This document describes the UI that is currently implemented, not the original
design target. MemPPI-Atlas now has four user-facing surfaces:

- a cover page at `/`
- a full network explorer at `/network`
- a focused subgraph page at `/subgraph`
- a structure detail page at `/structures/[modelId]`

## Visual System

### Typography

- The app uses locally hosted Geist variable fonts via `src/pages/_app.tsx`.
- Body copy and navigation follow a neutral, utility-first Tailwind style.
- The structure page uses a warmer editorial palette than the graph pages.

### Color

Graph family colors are defined in `src/lib/graphUtils.ts`:

- `GPCR`: `#E8A87C`
- `Ion-channels`: `#8B7BC7`
- `Transporter`: `#4C6FB9`
- `Catalytic receptors`: `#B5D4A3`
- `Other TMPs` / fallback: `#D1D5DB`

Edge colors:

- Experimental: `#4C6FB9`
- Predicted: `#C9DBF8`

### Layout Principles

- Graph pages use a white and gray utility layout with a persistent header.
- The cover page uses a background image with a translucent blue overlay.
- The structure detail page uses large-radius cards, softer green/stone accents,
  and a more presentation-like composition.

## Implemented Pages

## `/`

Purpose:

- Landing page, project framing, quick stats, and search entry point.

Implemented elements:

- top navigation header
- hero background image from `public/background.png`
- protein / interaction counters fetched from `/api/network/stats`
- hardcoded tissue count display (`22`)
- search box with example buttons for `EGFR`, `INSR`, `P43220`, and `P00533`
- footer citation placeholder text

Notes:

- The search box is anchored near the lower-right of the hero region, not fixed
  bottom-center as earlier planning docs described.

## `/network`

Purpose:

- Full network browsing and graph filtering.

Implemented elements:

- `Sidebar` with:
  - edge source toggles
  - max-edge slider and numeric input
  - `onlyVisibleEdges` checkbox
  - live network metadata
  - family distribution list
- `NetworkGraph`
- floating `Legend`
- loading and error states for both stats and graph payloads

Notes:

- `onlyVisibleEdges` is displayed but does not currently affect the request.

## `/subgraph`

Purpose:

- Focused result page for one or more user-supplied identifiers.

Implemented elements:

- back button
- query protein summary cards
- truncation warning state
- graph panel with legend overlay
- node and edge tables with:
  - global search
  - per-column filters
  - sorting
  - pagination
  - CSV export
- structure links in the edge table when a structure model exists

Behavior:

- Single-protein results highlight the query node.
- Multi-protein results show all query labels and suppress query-only coloring in
  the graph payload.

## `/structures/[modelId]`

Purpose:

- Detailed inspection of a single AlphaFold3 interaction model.

Implemented elements:

- editorial hero copy and metadata strip
- NGL-based CIF viewer with reset and fullscreen controls
- download actions for CIF and JSON artifacts
- confidence summary panels
- supporting protein metadata
- linked interaction evidence

## Shared Components

### `Header`

File:
`src/components/Header.tsx`

Current behavior:

- logo/title link to `/`
- link to `/network`
- button that downloads both public CSV files
- disabled `Help` and `Contact us` placeholders

### `SearchBar`

File:
`src/components/SearchBar.tsx`

Current behavior:

- accepts UniProt IDs and gene symbols
- supports comma-separated multi-search
- uppercases terms before navigation
- displays inline validation errors

### `Legend`

File:
`src/components/Legend.tsx`

Current behavior:

- node legend for five TMP family buckets
- edge legend for Experimental and Predicted

### `DataTable`

File:
`src/components/DataTable.tsx`

Current behavior:

- caption bar
- global search
- optional column filters
- sortable headers
- pagination
- CSV export

## Graph Styling

Files:

- `src/lib/cytoscape-config.ts`
- `src/lib/graphUtils.ts`

Current implementation:

- Full-network nodes are larger and mostly unlabeled until selected.
- Subgraph query nodes are red and always labeled.
- Edge width maps to `fusionPredProb`.
- Cached node positions are respected and locked when present.

## Known UI Gaps

- Footer citation content on the cover page is still placeholder text.
- `Help` and `Contact us` are presentational only.
- The sidebar exposes a filter that is not connected to backend behavior yet.
