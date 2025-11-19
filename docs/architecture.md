# Architecture

## Tech Stack

- **Framework:** Next.js 14 (Pages Router)
- **Database:** Supabase (PostgreSQL)
- **Styling:** Tailwind CSS
- **Graph Visualization:** Cytoscape.js
- **Hosting:** Vercel
- **Language:** TypeScript

---

## Module Map

### Frontend (Next.js Pages)

```
/src/pages
├── index.tsx              # Page 1: Global Network View
├── subgraph.tsx          # Page 2: Subgraph View (search results)
├── _app.tsx              # App wrapper with global styles
└── _document.tsx         # Custom document (HTML structure)
```

### API Routes

```
/src/pages/api
├── network.ts            # GET full network data
├── network/
│   └── stats.ts          # GET network statistics
├── subgraph.ts           # GET subgraph for query
├── nodes.ts              # GET node information with filters
└── edges.ts              # GET edge information with filters
```

### Components

```
/src/components
├── Header.tsx            # Site header with logo and title
├── NetworkGraph.tsx      # Cytoscape.js visualization wrapper
├── SubgraphView.tsx      # Focused subgraph visualization
├── Sidebar.tsx           # Statistics sidebar for Page 1
├── SearchBar.tsx         # Bottom search bar component
├── DataTable.tsx         # Reusable table for nodes/edges
├── Legend.tsx            # Color legend for families/enrichment
└── StatCard.tsx          # Individual statistic card
```

### Library/Utilities

```
/src/lib
├── supabase.ts           # Supabase client initialization
├── graphUtils.ts         # Graph data transformation utilities
├── cytoscape-config.ts   # Cytoscape.js styling and layout configs
└── types.ts              # TypeScript type definitions
```

### Styles

```
/src/styles
└── globals.css           # Global styles and Tailwind imports
```

### Data Layer

```
Supabase Tables:
- nodes                   # Imported from node_info_with_exp.csv
- edges                   # Imported from edge_info_with_exp.csv
```

### Static Assets

```
/public
├── favicon.ico           # Site favicon
└── ...                   # Other static files
```

### Data Files

```
/data
├── node_info_with_exp.csv    # Node/protein information
├── edge_info_with_exp.csv    # Edge/interaction information
└── README.md                 # Data documentation
```

---

## Data Flow

### Page 1: Global Network View

1. User navigates to `/` (home page)
2. Page component calls `getServerSideProps` or client-side fetch to:
   - `/api/network` → Get all nodes and edges
   - `/api/network/stats` → Get statistics for sidebar
3. Data is passed to `NetworkGraph` component
4. Cytoscape.js renders the full network with zoom/pan controls
5. User enters protein ID(s) in `SearchBar`
6. On submit, redirect to `/subgraph?proteins=P12345,Q67890`

### Page 2: Subgraph View

1. User arrives from search or direct URL with `?proteins=...`
2. Page component extracts query params
3. Calls `/api/subgraph?proteins=P12345,Q67890`
4. API queries Supabase for:
   - Queried node(s)
   - All neighbors (edges where protein is source or target)
   - Node details for all neighbors
5. Returns filtered subgraph JSON
6. Frontend renders:
   - `SubgraphView` component with Cytoscape.js
   - `DataTable` for top 10 nodes
   - `DataTable` for top 10 edges

### API Layer Data Flow

```
API Route → Supabase Client → PostgreSQL Query → JSON Response
```

### Layout Caching & Versions

- **Graph key generation:** `buildGraphKey` concatenates the cache namespace, the active `CURRENT_LAYOUT_VERSION`, sorted node IDs, sorted edge IDs, and request parameters into a stable SHA-256 hash. Any change to those inputs yields a new key, isolating cache entries per query shape.
- **Layout versioning:** `CURRENT_LAYOUT_VERSION` in `src/lib/layoutCache.ts` is the single bump point for cache invalidation. Updating the string (e.g. after layout tweaks) forces downstream fetches to skip stale coordinates while preserving historical rows for auditing.
- **Payload contract:** API routes return a `layout` object containing the `graphKey`, `layoutVersion`, concrete node positions, and a `positionsNeeded` boolean. When `positionsNeeded` is `true`, the client runs Cytoscape layouts and posts fresh coordinates back to `/api/layout-cache`.
- **Position hydration:** On warm cache hits the API injects cached `{x, y}` positions into each `NodeResponse`. Client utilities (`toCytoscapeElements`) lock those nodes via preset positions, avoiding redundant layout work on repeat views.
- **Manual refresh:** To force a recompute for a specific graph, POST to `/api/layout-cache` with `{ "graphKey": "<hash>", "refresh": true }`. Supplying `layoutVersion` scopes the deletion to that version; omitting it removes every version of the cached layout, letting the next request repopulate coordinates.

---

## Dependencies

### Core

- `next` (^14.0.0): React framework
- `react` (^18.0.0): UI library
- `react-dom` (^18.0.0): React DOM renderer

### Database & Backend

- `@supabase/supabase-js` (^2.0.0): Supabase client
- `@supabase/auth-helpers-nextjs` (^0.8.0): Next.js auth helpers (if needed later)

### UI & Styling

- `tailwindcss` (^3.4.0): Utility-first CSS
- `autoprefixer` (^10.0.0): PostCSS plugin
- `postcss` (^8.0.0): CSS processor

### Graph Visualization

- `cytoscape` (^3.28.0): Core graph library
- `cytoscape-fcose` (^2.2.0): Force-directed layout
- `react-cytoscapejs` (^2.0.0): React wrapper (optional)

### Development

- `typescript` (^5.0.0): Type safety
- `@types/react` (^18.0.0): React types
- `@types/node` (^20.0.0): Node types
- `eslint` (^8.0.0): Linting
- `eslint-config-next` (^14.0.0): Next.js ESLint config

### Testing

- `jest` (^29.0.0): Test runner
- `@testing-library/react` (^14.0.0): React component testing
- `@testing-library/jest-dom` (^6.0.0): Jest matchers
- `@testing-library/user-event` (^14.0.0): User interaction testing

---

## Component Communication

### Global Network Page

```
index.tsx
  ├── Sidebar (receives stats data)
  │   └── StatCard[] (displays individual metrics)
  ├── NetworkGraph (receives nodes + edges)
  │   └── Cytoscape.js instance
  ├── Legend (static family color mapping)
  └── SearchBar (handles form submission)
```

### Subgraph Page

```
subgraph.tsx
  ├── SubgraphView (receives filtered nodes + edges)
  │   ├── Cytoscape.js instance
  │   └── Legend
  ├── DataTable (nodes, top 10)
  └── DataTable (edges, top 10)
```

---

## Database Schema (Supabase)

### Table: `nodes`

```sql
CREATE TABLE nodes (
  protein TEXT PRIMARY KEY,
  entry_name TEXT,
  description TEXT,
  gene_names TEXT,
  family TEXT,
  expression_tissue TEXT
);

CREATE INDEX idx_nodes_family ON nodes(family);
CREATE INDEX idx_nodes_gene_names ON nodes USING gin(to_tsvector('english', gene_names));
```

### Table: `edges`

```sql
CREATE TABLE edges (
  edge TEXT PRIMARY KEY,
  protein1 TEXT REFERENCES nodes(protein),
  protein2 TEXT REFERENCES nodes(protein),
  fusion_pred_prob REAL,
  enriched_tissue TEXT,
  tissue_enriched_confidence REAL,
  positive_type TEXT
);

CREATE INDEX idx_edges_protein1 ON edges(protein1);
CREATE INDEX idx_edges_protein2 ON edges(protein2);
CREATE INDEX idx_edges_enriched_tissue ON edges(enriched_tissue);
CREATE INDEX idx_edges_positive_type ON edges(positive_type);
```

---

## Cytoscape.js Integration

### Layout Strategy

- **Global Network (Page 1):** Use `fcose` (force-directed) layout for organic clustering
- **Subgraph (Page 2):** Use `cose` or `circle` layout for clarity with fewer nodes

### Styling Strategy

- **Nodes:**
  - Color by `family` (TM = blue, TF = green, etc.)
  - Size: fixed or based on degree centrality
  - Label: Show on zoom or hover
- **Edges:**
  - Color: Red if `enrichedTissue` is not NA, gray otherwise
  - Width: Proportional to `fusionPredProb`
  - Length: Shorter for experimental positives, scaled by `fusionPredProb` for predictions

### Performance Considerations

- Lazy-load Cytoscape.js client-side only (not in SSR)
- For large networks (>5000 nodes), implement viewport culling or progressive loading
- Use `headless: false` for rendering, `headless: true` for analysis only

---

## Must-Not-Change Decisions

1. **UniProt accession is the canonical identifier** across all components and API responses
2. **Server-side data fetching** for initial page loads to improve SEO and performance
3. **CSV → Supabase migration** is one-time; app reads from Supabase, not CSV files
4. **Edge dataset requires server-side filtering** due to size; no client-side full download
5. **Cytoscape.js is the graph library**; switching would require complete visualization rewrite
6. **Pages Router** (not App Router) for Next.js to maintain compatibility with existing patterns

---

## Deployment Strategy

### Vercel Deployment

1. Connect GitHub repository to Vercel
2. Configure environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Auto-deploy on push to `main` branch
4. Preview deployments for pull requests

### Supabase Setup

1. Create Supabase project
2. Run table creation SQL scripts
3. Import CSV data using Supabase dashboard or CLI
4. Configure Row Level Security (RLS) policies for public read access
5. Note API keys for Vercel environment variables

---

## Future Enhancements (Out of Scope for MVP)

- User authentication for saving favorite proteins
- Real-time collaboration features
- Export to image (PNG/SVG) for visualizations
- Advanced filtering UI (multi-select tissues, probability sliders)
- Full-text search with ranking
- Network analysis metrics (betweenness, clustering coefficient)
