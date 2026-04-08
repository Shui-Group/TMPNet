# MemPPI-Atlas

Interactive web platform for visualizing and exploring protein-protein interaction (PPI) networks. Browse the global network, search for specific proteins, and analyze localized subgraphs with detailed node and edge information.

## Features

- **Global Network View:** Interactive visualization of the entire PPI network with zoom and pan controls
- **Protein Search:** Find proteins by UniProt ID and view their immediate interaction neighborhoods
- **Subgraph Analysis:** Focused visualization of query proteins and 1-hop neighbors
- **Data Tables:** Detailed protein and interaction information with tissue enrichment data
- **Network Statistics:** At-a-glance metrics and family distribution insights

## Tech Stack

- **Framework:** Next.js 14 (Pages Router) with TypeScript
- **Database:** Supabase (PostgreSQL)
- **Styling:** Tailwind CSS
- **Graph Visualization:** Cytoscape.js
- **Hosting:** Vercel

## Project Structure

```
MemPPI-Atlas/
├── src/
│   ├── pages/           # Next.js pages and API routes
│   │   ├── api/         # API endpoints
│   │   ├── index.tsx    # Homepage (global network view)
│   │   └── _app.tsx     # App wrapper
│   ├── components/      # Reusable React components
│   │   ├── Header.tsx
│   │   └── ...
│   ├── lib/             # Utilities and shared code
│   │   └── ...
│   └── styles/          # Global CSS and Tailwind
│       └── globals.css
├── data/                # CSV data files
│   ├── node_info_with_exp.csv
│   └── edge_info_with_exp.csv
├── docs/                # Project documentation
│   ├── architecture.md
│   ├── api-spec.md
│   ├── roadmap.md
│   └── ...
├── public/              # Static assets
└── package.json
```

## Quick Start

### Prerequisites

- Node.js 18.17 or later
- npm 9.0 or later

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd MemPPI-Atlas

# Install dependencies
npm install

# Set up environment variables (for Milestone 2+)
# Create .env.local and add Supabase credentials:
# NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
# NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Development

```bash
# Start development server
npm run dev

# Open http://localhost:3000 in your browser
```

### Data Preparation

```bash
# Normalize the 20260407 website dataset for Supabase import
npm run prepare:data:20260407
```

This generates import-ready files under `data/supabase-import/20260407_new_web_data/`:

- `nodes.csv`
- `edges.csv`
- `structure_models.csv`

### Build

```bash
# Create production build
npm run build

# Start production server
npm start
```

### Code Quality

```bash
# Run ESLint
npm run lint

# Format code with Prettier
npx prettier --write .
```

## Documentation

- **[Product Vision](product_vision/Product-Vision.md)** – Goals, features, and tech stack rationale
- **[Architecture](docs/architecture.md)** – System design, modules, and data flow
- **[API Spec](docs/api-spec.md)** – REST endpoints and request/response schemas
- **[Data](docs/data.md)** – CSV schemas, Supabase tables, and query patterns
- **[UI Spec](docs/ui-spec.md)** – Design system, components, and page layouts
- **[Test Plan](docs/test-plan.md)** – Testing strategy and coverage goals
- **[Roadmap](docs/roadmap.md)** – Implementation milestones
- **[Instructions](docs/instructions.md)** – Canonical functions and patterns
