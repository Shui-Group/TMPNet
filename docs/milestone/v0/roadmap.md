# Roadmap Status

## Status

This file is now a status snapshot for the legacy milestone plan. The original
task-by-task roadmap is no longer the best source of truth because the app has
evolved beyond those milestones.

## Completed Outcomes

- Next.js 14 + TypeScript + Tailwind project foundation
- Supabase-backed `nodes` and `edges` graph data access
- `/api/network`, `/api/network/stats`, and `/api/subgraph`
- dedicated `/network` explorer page
- cover page at `/`
- filterable subgraph tables
- layout cache persistence
- structure-model metadata support
- structure detail pages and asset redirects

## Added After The Original Plan

- `graph_layout_cache` table and `/api/layout-cache`
- `structure_models` table and storage-backed asset handling
- AlphaFold3 confidence-summary parsing
- downloadable public CSV files from the header
- gene-symbol resolution in `/api/subgraph`

## Still Incomplete Or Partial

- `onlyVisibleEdges` sidebar control is not connected yet
- `Help` and `Contact us` remain placeholders
- cover-page citation text is placeholder content
- terminology for experimental edges is inconsistent between endpoints

## How To Read Older Milestone Docs

- `docs/milestone/v0/milestone2/` explains historical Supabase bootstrap work
  and has been refreshed with current references.
- `docs/milestone/v0/network-performance-plan.md` contains current technical
  notes for graph performance.
- `docs/milestone/v1/m1.md` records the move from a network homepage to a cover
  page plus `/network`.
