# MemPPI-Atlas

MemPPI-Atlas is a Next.js 14 Pages Router application for exploring
endogenous transmembrane protein-protein interaction networks. The app uses
Supabase for the graph dataset and structure metadata, Cytoscape.js for network
visualization, and NGL for 3D structure viewing.

## Current App Surface

- `/` is a cover page with summary stats, search, and dataset downloads.
- `/network` is the full network explorer with filters, graph metadata, and
  layout-cache aware rendering.
- `/subgraph?proteins=...` resolves UniProt IDs and gene symbols, then shows a
  focused neighborhood or intra-query subgraph.
- `/structures/[modelId]` renders AlphaFold3 interaction models with confidence
  summaries and asset downloads.

## Tech Stack

- Next.js 14 (Pages Router) + React 18 + TypeScript
- Supabase Postgres + Supabase Storage
- Cytoscape.js + `cytoscape-fcose`
- Tailwind CSS utilities in a custom global stylesheet
- Jest + React Testing Library

## Repository Layout

```text
src/
  components/           Reusable UI building blocks
  lib/                  Shared types, transforms, graph helpers, Supabase utils
  pages/
    api/                Next.js API routes
    index.tsx           Cover page
    network.tsx         Full network explorer
    subgraph.tsx        Search result / focused graph view
    structures/         Structure detail pages
  styles/               Global CSS
data/
  raw/                  Raw source datasets
  supabase-import/      Generated CSVs ready for import
scripts/                Data preparation and validation utilities
sql/                    Base schema and SQL setup scripts
supabase/               Supabase local config, seeds, and migrations
tests/                  Integration, page, component, and unit tests
docs/                   Current docs plus archived milestone notes
product_vision/         Product framing and current scope summary
```

## Quick Start

### Prerequisites

- Node.js 18.17+ or 20+
- npm
- Supabase project with the MemPPI schema loaded

### Install

```bash
npm install
```

### Environment Variables

Create `.env.local` with:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Optional; defaults to "structure-models"
SUPABASE_STRUCTURE_BUCKET=structure-models
NEXT_PUBLIC_SUPABASE_STRUCTURE_BUCKET=structure-models
```

The app throws during startup if `NEXT_PUBLIC_SUPABASE_URL` or
`NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing.

### Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Scripts

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

`prepare:data:20260407` normalizes the `20260407_new_web_data` dataset and
generates:

- `data/supabase-import/20260407_new_web_data/nodes.csv`
- `data/supabase-import/20260407_new_web_data/edges.csv`
- `data/supabase-import/20260407_new_web_data/structure_models.csv`

## API Summary

- `GET /api/network`
  Returns the filtered network, optional Cytoscape elements, and cached layout
  metadata.
- `GET /api/network/stats`
  Returns total nodes, total edges, family counts, enriched-edge counts, and
  predicted-edge counts.
- `GET /api/subgraph?proteins=EGFR,INSR`
  Resolves identifiers and returns a focused graph plus truncation metadata when
  limits apply.
- `POST /api/layout-cache`
  Persists or invalidates Cytoscape node positions by `graphKey`.
- `GET /api/structures/[modelId]`
  Returns structure, edge, protein, asset-link, and confidence-summary data.
- `GET /api/structures/[modelId]/asset?kind=cif|summary|confidences`
  Redirects to public Supabase Storage assets.
- `GET /api/test-db`
  Simple connectivity check kept in the repo for local verification.

## Data and Schema Notes

- `nodes` stores protein metadata keyed by UniProt accession.
- `edges` stores interaction evidence and filterable edge-level metadata.
- `graph_layout_cache` stores persisted Cytoscape positions keyed by a hashed
  graph signature.
- `structure_models` stores AlphaFold3-derived structure metadata and storage
  paths.

The base schema is in `sql/`, and the structure-model expansion lives in
`supabase/migrations/20260409173000_add_structure_models_and_edge_evidence.sql`.

## Known Current Caveats

- The full network page defaults to showing both `experiment` and `prediction`
  edge types via client filters.
- The `/api/subgraph` route currently queries experimental rows using the
  literal value `experimental`, while `/api/network` uses `experiment`. The test
  suite reflects that current implementation detail.
- The sidebar toggle `onlyVisibleEdges` is present in the UI but is not yet
  wired into the `/api/network` request.

## Documentation Map

- [Architecture](docs/architecture.md)
- [API Reference](docs/api.md)
- [Data Model](docs/data-model.md)
- [UI Specification](docs/ui-spec.md)
- [SQL Setup](sql/README.md)
- [Product Vision and Scope](product_vision/Product-Vision.md)
- [Milestone Notes](docs/milestone/v0/roadmap.md)

The files under `docs/milestone/` are retained as historical planning records.
They are no longer the canonical source for current setup or behavior.
