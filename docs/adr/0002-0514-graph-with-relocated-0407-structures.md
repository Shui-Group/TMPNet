# ADR 0002: 0514 Graph With Relocated 0407 Structures

## Status

Accepted

## Context

The current runtime graph data comes from the 0514 dataset. The available
structure model metadata and files remain valid from the 0407 structure
generation, but deployment needs one coherent 0514 data layout.

## Decision

Use the 0514 Graph Dataset for runtime nodes and edges:

- `data/supabase-import/20260514_new_web_data/nodes.csv`
- `data/supabase-import/20260514_new_web_data/edges.csv`

Use the 0407-derived Structure Model Dataset relocated under the 0514 paths:

- `data/supabase-import/20260514_new_web_data/structure_models.csv`
- `data/raw/20260514_new_web_data/best_structure/`

Docs and deployment checks should refer to these paths as the current data
contract. The files remain local and ignored by Git.

## Consequences

- Graph and structure data can be bundled together under a single deployment
  dataset name.
- The structure model provenance remains explicit: the content is
  0407-derived, even though the deployment paths are 0514.
- Older 0407 paths are historical references unless explicitly marked as legacy.
