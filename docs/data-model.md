# Data Model

## Overview

The application works with four main persisted datasets:

- `nodes`
- `edges`
- `graph_layout_cache`
- `structure_models`

TypeScript source-of-truth shapes live in `src/lib/types.ts`.

## `nodes`

Primary key: `protein`

Columns:

- `protein`
- `entry_name`
- `description`
- `family`
- `expression_tissue`
- `gene_symbol`

Notes:

- `expression_tissue` is stored as a backslash-delimited string in Postgres and
  split into an array in API responses.
- `gene_symbol` is used by `/api/subgraph` for identifier resolution.

## `edges`

Primary key: `edge`

Columns:

- `edge`
- `protein1`
- `protein2`
- `fusion_pred_prob`
- `enriched_tissue`
- `tissue_enriched_confidence`
- `positive_type`
- `gene_symbol1`
- `gene_symbol2`
- `string_combined_score`
- `biogrid_experimental_system_type`
- `hitpredict_confidence`

Notes:

- `protein1` and `protein2` both reference `nodes(protein)`.
- The codebase currently has two literal conventions for experimental edges:
  `experiment` and `experimental`.

## `graph_layout_cache`

Composite primary key: `(graph_key, node_id)`

Columns:

- `graph_key`
- `node_id`
- `x`
- `y`
- `layout_version`
- `updated_at`

Purpose:

- Persist Cytoscape node positions so large graphs do not need to recompute the
  layout on every request.

## `structure_models`

Primary key: `model_id`

Columns:

- `model_id`
- `edge`
- `protein1`
- `protein2`
- `folder_protein1`
- `folder_protein2`
- `variant`
- `source`
- `cif_rel_path`
- `cif_size_bytes`
- `summary_confidences_rel_path`
- `summary_confidences`
- `summary_iptm`
- `summary_ptm`
- `summary_ranking_score`
- `summary_fraction_disordered`
- `summary_has_clash`
- `confidences_rel_path`
- `confidences_size_bytes`
- `has_confidences`
- `created_at`
- `updated_at`

Notes:

- `variant` is constrained to `plain`, `without_ag`, or `optimize`.
- Structure assets are stored in Supabase Storage, not in the database itself.
- Relative asset paths are expected to live under
  `data/raw/20260407_new_web_data/best_structure/`.

## Response Shapes

### `NodeResponse`

- `id`
- `label`
- `entryName`
- `description`
- `geneSymbol`
- `family`
- `expressionTissue`
- `isQuery`
- `position`

### `EdgeResponse`

- `id`
- `source`
- `target`
- `fusionPredProb`
- `enrichedTissue`
- `tissueEnrichedConfidence`
- `positiveType`
- `geneSymbol1`
- `geneSymbol2`
- `stringCombinedScore`
- `biogridExperimentalSystemType`
- `hitpredictConfidence`
- `structureModelId`
- `structureVariant`
- `hasStructureModel`

### `StructureDetailResponse`

- `model`
- `edge`
- `proteins`
- `assets`
- `confidenceSummary`
