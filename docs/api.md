# API Reference

## Conventions

- All routes are implemented as Next.js API routes under `src/pages/api`.
- Error responses use `{ "error": "..." }`.
- Supabase is queried with the public anon key; these routes expect read access
  to be enabled in the target project.

## `GET /api/network`

Returns the full network or a filtered subset of it.

### Query Parameters

- `positiveType`
  Comma-separated list of `experiment` and/or `prediction`.
- `minProb`
  Minimum `fusion_pred_prob` for prediction edges. Default: `0.8`.
- `maxEdges`
  Maximum number of edges returned. Default: `50000`, hard cap `100000`.
- `nodes`
  Optional comma-separated UniProt accessions to scope both nodes and edges.
- `edges`
  Boolean-like flag. When false, nodes are returned without edge payloads.
- `format`
  `json` or `cyto`. `cyto` returns Cytoscape elements.
- `preferExperimental`
  Defaults to `true`. When no `positiveType` is supplied, this causes the API
  default to be `experiment` only.

### Response Shape

`format=json`

```json
{
  "nodes": [],
  "edges": [],
  "meta": {
    "totalNodes": 0,
    "totalEdges": 0,
    "filteredEdges": 0,
    "timings": {
      "fetchNodesMs": 0,
      "fetchEdgesMs": 0,
      "transformMs": 0,
      "totalMs": 0
    }
  },
  "layout": {
    "graphKey": "sha256...",
    "layoutVersion": "v1",
    "positions": [],
    "positionsNeeded": true
  }
}
```

`format=cyto`

```json
{
  "elements": [],
  "meta": {},
  "layout": {}
}
```

### Notes

- The `/network` page passes both `experiment` and `prediction` by default.
- Cache headers are set to `public, s-maxage=60, stale-while-revalidate=300`.

## `GET /api/network/stats`

Returns aggregate network statistics.

### Response Fields

- `totalNodes`
- `totalEdges`
- `familyCounts`
- `enrichedEdgeCount`
- `predictedEdgeCount`

### Notes

- When exact count queries fail or time out, the implementation falls back to a
  batched scan for enriched and predicted edge counts.

## `GET /api/subgraph`

Returns a focused graph for one or more identifiers.

### Required Query Parameter

- `proteins`
  Comma-separated UniProt accessions or gene symbols.

### Optional Query Parameters

- `minProb`
  Minimum prediction probability. Default: `0.8`.
- `preferExperimental`
  Default: `true`.
- `maxEdges`
  Default implementation fallback: `100000`, hard cap `500000`.
- `maxNodes`
  Default implementation fallback: `10000`, hard cap `50000`.

### Search Modes

- Single identifier:
  query node plus one-hop neighbors.
- Multiple identifiers:
  only queried proteins plus edges directly connecting them.

### Response Fields

- `query`
  Resolved UniProt IDs.
- `searchedIdentifiers`
  Original user-supplied search terms.
- `queryProteins`
  Resolved protein metadata for each search term.
- `nodes`
- `edges`
- `truncated`
  Included when node or edge caps are hit.
- `layout`

### Current Caveat

The current implementation filters experimental rows using
`positive_type = 'experimental'`. This differs from `/api/network`, which uses
`experiment`.

## `POST /api/layout-cache`

Stores or invalidates cached Cytoscape positions.

### Store Request

```json
{
  "graphKey": "sha256...",
  "layoutVersion": "v1",
  "positions": [{ "id": "P12345", "x": 10, "y": 20 }]
}
```

Successful writes return `204 No Content`.

### Refresh Request

```json
{
  "graphKey": "sha256...",
  "layoutVersion": "v1",
  "refresh": true
}
```

Successful invalidation returns the number of removed rows.

## `GET /api/structures/[modelId]`

Returns structure detail for a single model.

### Response Fields

- `model`
  Transformed `structure_models` record.
- `edge`
  Associated interaction edge with structure metadata attached.
- `proteins`
  Two protein records in model order.
- `assets`
  Internal asset routes for CIF, summary, and confidences.
- `confidenceSummary`
  Derived pLDDT aggregates parsed from `confidences.json`.

## `GET /api/structures/[modelId]/asset`

Serves a structure asset from the local structure asset volume when
`STRUCTURE_ASSET_ROOT` is configured. Non-VM deployments can still fall back to
a public storage URL.

### Query Parameters

- `kind`
  One of `cif`, `summary`, or `confidences`.
- `download`
  Set to `1` to return the asset with a download filename.

## `GET /api/test-db`

Small connectivity check used for local verification.

### Response Fields

- `success`
- `nodeCount`
- `edgeCount`
- `message`
- `error` when the query fails
