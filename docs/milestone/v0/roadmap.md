# Roadmap

This roadmap breaks down the MemPPI-Atlas implementation into small, incremental milestones. Each milestone delivers one focused feature and can be validated independently.

---

## Milestone 1: Project Initialization

**Goal:** Set up Next.js project with Tailwind CSS and TypeScript.

**Tasks:**

- Initialize Next.js 14 project with TypeScript
- Configure Tailwind CSS with custom color palette
- Set up ESLint and Prettier
- Create basic folder structure (`/pages`, `/components`, `/lib`)
- Add Inter font from Google Fonts
- Create basic `Header` component with logo and title

**Acceptance Criteria:**

- ✅ `npm run dev` starts development server
- ✅ Homepage renders with Header component
- ✅ Tailwind classes work correctly
- ✅ TypeScript compilation has no errors

**Estimated Time:** 2-3 hours

---

## Milestone 2: Supabase Setup and Data Import

**Goal:** Create Supabase project and import CSV data into PostgreSQL tables.

**Tasks:**

- Create Supabase project via dashboard
- Write SQL scripts to create `nodes` and `edges` tables with indexes
- Import `node_info_with_exp.csv` into `nodes` table
- Import `edge_info_with_exp.csv` into `edges` table
- Configure Row Level Security (RLS) for public read access
- Initialize Supabase client in `/lib/supabase.ts`
- Add environment variables to `.env.local`

**Acceptance Criteria:**

- ✅ Both tables exist in Supabase with correct schemas
- ✅ Row counts match CSV file line counts
- ✅ Test query from Supabase dashboard returns data
- ✅ Supabase client connects successfully from Next.js

**Estimated Time:** 3-4 hours

---

## Milestone 3: Network Data API Endpoint

**Goal:** Implement `/api/network` endpoint to fetch all nodes and edges.

**Tasks:**

- Create `/pages/api/network.ts`
- Query Supabase for all nodes and edges
- Transform data to consistent JSON format
- Handle errors with proper HTTP status codes
- Write unit tests for the endpoint

**Acceptance Criteria:**

- ✅ `GET /api/network` returns JSON with `nodes` and `edges` arrays
- ✅ Response includes all required fields per API spec
- ✅ Returns 500 with error message on database failure
- ✅ Tests pass with mocked Supabase client

**Estimated Time:** 2-3 hours

---

## Milestone 4: Network Statistics API Endpoint

**Goal:** Implement `/api/network/stats` endpoint for sidebar metrics.

**Tasks:**

- Create `/pages/api/network/stats.ts`
- Query Supabase for total node and edge counts
- Calculate family distribution counts
- Calculate enriched edge count
- Return aggregated statistics as JSON
- Write unit tests

**Acceptance Criteria:**

- ✅ `GET /api/network/stats` returns correct counts
- ✅ `familyCounts` object has counts per family type
- ✅ `enrichedEdgeCount` excludes NA values
- ✅ Tests verify calculation logic

**Estimated Time:** 2 hours

---

## Milestone 5: Page 1 Layout with Sidebar

**Goal:** Build Page 1 layout with sidebar displaying network statistics.

**Tasks:**

- Create `Sidebar` component with statistics section
- Create `StatCard` component for individual metrics
- Fetch data from `/api/network/stats` on page load
- Display total nodes, total edges, enriched edges, and family distribution
- Style with Tailwind following UI spec
- Make sidebar sticky with scroll
- Handle loading and error states

**Acceptance Criteria:**

- ✅ Page 1 renders with sidebar on the left (320px width on desktop)
- ✅ Statistics display correctly from API data (Total Nodes, Total Edges, Enriched Edges)
- ✅ Family distribution shows all families with counts, sorted by count
- ✅ Responsive layout works on tablet/mobile (stacks vertically)
- ✅ Loading state shows skeleton UI
- ✅ Error state displays error message to user
- ✅ Network visualization placeholder displayed in main area

**Note:** Enriched Edges refers to edges with tissue enrichment (`enriched_tissue` field). The `predictedEdgeCount` from the API is not displayed in this milestone.

**Estimated Time:** 3-4 hours

---

## Milestone 6: Global Network Visualization

**Goal:** Render the full PPI network on Page 1 using Cytoscape.js.

**Tasks:**

- Install Cytoscape.js and fcose layout extension
- Create `NetworkGraph` component wrapper
- Create `/lib/graphUtils.ts` for data transformations
- Create `/lib/cytoscape-config.ts` for styling configs
- Fetch data from `/api/network` on page load
- Transform API data to Cytoscape.js format
- Render network with fcose layout
- Implement zoom and pan controls
- Add node color based on protein family
- Add edge color based on enrichment status
- Create `Legend` component and display it

**Acceptance Criteria:**

- ✅ Full network renders in main content area (75% width)
- ✅ Nodes colored by family (TM=blue, TF=green, etc.)
- ✅ Edges colored by enrichment (red=enriched, gray=normal)
- ✅ Zoom in/out works with mouse wheel
- ✅ Pan works with click and drag
- ✅ Legend shows family colors correctly

**Notes (Performance and scope):**

- Decision: Use Option A — server-side edge filtering for performance.
  - Goal: Initial render under 10 seconds on typical desktop.
- Visualization: Dense force-directed “hairball” (fcose) with all nodes shown.
  - Nodes: uniform size; cool neutral palette only (light blues/slates/grays; no red/green/yellow).
  - Edges: translucent blue hues; subtle width by probability.
  - Labels: hidden by default; shown on node click only.
- Scope for M6: Show network view only (no tabs/download).
- TODO: Add Download/Export control (PNG/SVG) in a later milestone.

**Estimated Time:** 6-8 hours

---

## Milestone 7: Search Bar with Navigation

**Goal:** Implement bottom search bar that navigates to subgraph page.

**Tasks:**

- Create `SearchBar` component
- Position fixed at bottom center of viewport
- Handle form submission
- Parse comma-separated protein IDs
- Validate input format
- Navigate to `/subgraph?proteins=...` on submit
- Add styling with shadow and rounded corners

**Acceptance Criteria:**

- ✅ Search bar visible at bottom of Page 1
- ✅ Accepts single protein ID (e.g., "P12345")
- ✅ Accepts multiple IDs (e.g., "P12345,Q67890")
- ✅ Navigation works with correct query params
- ✅ Input validation shows error for invalid format

**Estimated Time:** 2-3 hours

---

## Milestone 8: Subgraph API Endpoint ✅ COMPLETED

**Goal:** Implement `/api/subgraph` endpoint to fetch query proteins and neighbors.

**Tasks:**

- ✅ Create `/pages/api/subgraph.ts`
- ✅ Parse `proteins` query parameter (case-insensitive, comma-separated)
- ✅ Query edges where protein1 OR protein2 matches any query protein
- ✅ Extract unique neighbor protein IDs from edges
- ✅ Query node details for all proteins in subgraph
- ✅ Mark queried proteins with `isQuery: true`
- ✅ Return filtered nodes and edges
- ✅ Handle 404 when proteins not found
- ✅ Handle 400 for missing/invalid parameters
- ✅ Write unit tests (14 tests, all passing)
- ✅ Add filtering parameters (minProb, preferExperimental, maxEdges, maxNodes)
- ✅ Include truncation metadata when limits exceeded
- ✅ Update API spec documentation
- ✅ Update type definitions (SubgraphData interface)

**Acceptance Criteria:**

- ✅ `GET /api/subgraph?proteins=P12345` returns subgraph
- ✅ Response includes query protein + all 1-hop neighbors
- ✅ Queried nodes have `isQuery: true` flag
- ✅ Returns 404 if protein doesn't exist
- ✅ Returns 400 if `proteins` param missing
- ✅ Tests cover single and multiple protein queries
- ✅ Case-insensitive protein ID handling
- ✅ Handles proteins with no interactions (returns 200 with empty edges)
- ✅ Filtering parameters match `/api/network` defaults for consistency

**Completed:** All acceptance criteria met

---

## Milestone 9: Subgraph Visualization Page

**Goal:** Create Page 2 with focused subgraph visualization.

**Tasks:**

- Create `/pages/subgraph.tsx`
- Extract `proteins` from URL query params
- Fetch data from `/api/subgraph`
- Create `SubgraphView` component (reuses NetworkGraph logic)
- Use cose layout for subgraph (not fcose)
- Highlight queried nodes with red border
- Display page title with query proteins
- Add Legend component
- Handle loading and error states
- Show error message if proteins not found

**Acceptance Criteria:**

- ✅ Page loads from `/subgraph?proteins=P12345`
- ✅ Subgraph renders with query protein + neighbors
- ✅ Queried nodes highlighted with red border
- ✅ Layout is centered and readable
- ✅ Edge styling follows same rules as Page 1
- ✅ Legend displays correctly
- ✅ Error message shown for invalid proteins

**Estimated Time:** 4-5 hours

---

## Milestone 10: Data Tables on Page 2

**Goal:** Display node and edge information tables below subgraph.

**Tasks:**

- Create `DataTable` component with props for columns and data
- Define column configs for node table (protein, entry_name, description, gene_names, family, expression_tissue)
- Define column configs for edge table (edge, protein1, protein2, fusion_pred_prob, enriched_tissue, positive_type)
- Display top 10 nodes and top 10 edges
- Add zebra striping and borders
- Make tables responsive with horizontal scroll
- Parse expression_tissue backslash-delimited string for display
- Add table captions

**Acceptance Criteria:**

- ✅ Node table shows up to 10 rows with correct columns
- ✅ Edge table shows up to 10 rows with correct columns
- ✅ Tables have zebra striping (alternating row colors)
- ✅ Expression tissues displayed as comma-separated list
- ✅ Tables scroll horizontally on mobile
- ✅ Captions show "Node Information (Top 10)" and "Edge Information (Top 10)"

**Estimated Time:** 3-4 hours

---

## Milestone 11: Testing and Polish

**Goal:** Add comprehensive tests and polish UI/UX.

**Tasks:**

- Write unit tests for all utility functions (`graphUtils`, `cytoscape-config`)
- Write integration tests for all API routes
- Write component tests for `NetworkGraph`, `SearchBar`, `DataTable`, `Sidebar`, `Legend`
- Write page tests for index and subgraph pages
- Add loading spinners for async operations
- Add error boundaries for graceful error handling
- Optimize Cytoscape.js performance for large networks
- Add hover tooltips on nodes
- Test responsive layouts on all screen sizes
- Fix any linter errors or warnings

**Acceptance Criteria:**

- ✅ Test coverage >80% for critical paths
- ✅ All tests pass (`npm test`)
- ✅ No ESLint errors or warnings
- ✅ Loading states display correctly
- ✅ Error boundaries catch and display errors
- ✅ Responsive design works on mobile, tablet, desktop
- ✅ Node tooltips show protein info on hover

**Estimated Time:** 6-8 hours

---

## Milestone 12: Deployment to Vercel

**Goal:** Deploy application to production on Vercel.

**Tasks:**

- Create Vercel account and link GitHub repository
- Configure environment variables in Vercel dashboard
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Test production build locally (`npm run build`)
- Deploy to Vercel
- Verify all features work in production
- Set up automatic deployments on push to main
- Configure custom domain (optional)
- Update README with live URL

**Acceptance Criteria:**

- ✅ Application accessible at Vercel URL
- ✅ Both pages load and function correctly
- ✅ API endpoints return data
- ✅ Network visualization renders
- ✅ Search functionality works end-to-end
- ✅ Auto-deploy triggers on Git push
- ✅ README documents deployment URL

**Estimated Time:** 2-3 hours

---

## Total Estimated Time

**Core Development (Milestones 1-10):** 30-40 hours  
**Testing & Deployment (Milestones 11-12):** 8-11 hours  
**Total:** 38-51 hours (~5-7 working days)

---

## Success Metrics

After completing all milestones:

1. ✅ Users can view the global PPI network with statistics
2. ✅ Users can zoom and pan the network visualization
3. ✅ Users can search for proteins by ID
4. ✅ Users can view subgraphs with immediate neighbors
5. ✅ Users can see detailed node and edge information in tables
6. ✅ Application is responsive on all devices
7. ✅ Application is deployed and publicly accessible
8. ✅ Code is well-tested with >80% coverage

---

## Future Enhancements (Post-MVP)

- Advanced filtering UI with multi-select dropdowns
- Full-text search across gene names and descriptions
- Export network/subgraph as PNG/SVG
- Protein detail modal with expanded information
- User authentication for saving favorite proteins
- Network analysis metrics (centrality, clustering)
- Dark mode toggle
- Performance optimizations for networks >10K nodes
