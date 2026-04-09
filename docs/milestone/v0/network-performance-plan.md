# Network Performance Notes

## Status

This is the current technical note for graph-rendering behavior. It replaces the
older rollout plan that assumed layout caching had not been implemented yet.

## Current Rendering Pipeline

### Backend

- `/api/network` paginates edge fetches in `10000`-edge slices.
- Default edge cap is `50000`; hard cap is `100000`.
- `/api/subgraph` enforces separate `maxEdges` and `maxNodes` limits and marks
  responses with `truncated` metadata when caps are hit.
- Both graph endpoints attempt to load positions from `graph_layout_cache`.

### Client

- `NetworkGraph` progressively applies large graphs instead of attaching the full
  element set up front.
- Cached positions are converted through `layoutPayloadToPositionMap`.
- When cached positions exist, nodes are locked to those coordinates.
- Tooltip rendering and selection behavior are handled client-side in the graph
  component.

## Performance-Sensitive Files

- `src/components/NetworkGraph.tsx`
- `src/lib/cytoscape-config.ts`
- `src/lib/graphUtils.ts`
- `src/lib/layoutCache.ts`
- `src/pages/api/network.ts`
- `src/pages/api/subgraph.ts`

## What Helps Today

- server-side edge limiting
- experimental/prediction filtering
- timing metadata in `/api/network`
- persisted layout coordinates
- reduced default label density
- progressive edge insertion for large graphs

## Remaining Risks

- large network payloads still create significant JSON transfer and parse costs
- `/api/network/stats` may fall back to slower batched scans
- `onlyVisibleEdges` has no performance benefit yet because it is not wired
- the full network page still depends on client-side Cytoscape rendering for
  large edge sets

## Recommended Next Work

1. Decide whether `onlyVisibleEdges` should be client-side pruning, server-side
   filtering, or both.
2. Measure warm-cache vs cold-cache render times on `/network`.
3. Consider response compression or alternate transport if `maxEdges` must stay
   high.
4. Reconcile the experimental-edge literal mismatch across endpoints before
   further graph-query optimization.
