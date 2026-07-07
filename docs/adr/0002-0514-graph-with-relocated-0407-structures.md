# ADR 0002: 20260627 Graph With Relocated 0407 Structures

## Status

Accepted

## Context

The current runtime graph data comes from the 20260627 dataset. The available
structure model metadata and files remain valid from the 0407 structure
generation, but deployment needs one coherent 20260627 data layout.

## Decision

Use the 20260627 Graph Dataset for runtime nodes and edges:

- `data/supabase-import/20260627_web_data/nodes.csv`
- `data/supabase-import/20260627_web_data/edges.csv`

Use the 0407-derived Structure Model Dataset relocated under the 20260627 paths:

- `data/supabase-import/20260627_web_data/structure_models.csv`
- `data/raw/20260627_web_data/best_structure/`

Docs and deployment checks should refer to these paths as the current data
contract. The files remain local and ignored by Git.

## Consequences

- Graph and structure data can be bundled together under a single deployment
  dataset name.
- The structure model provenance remains explicit: the content is
  0407-derived, even though the deployment paths are 20260627.
- Older 0407 paths are historical references unless explicitly marked as legacy.
