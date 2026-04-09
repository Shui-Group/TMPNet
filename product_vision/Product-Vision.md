# Product Vision

## Status

This file is the current product framing for the shipped repository. It replaces
the earlier aspirational version that described the app before the cover page,
structure viewer, and layout cache existed.

## Core Objective

Provide a web experience where a researcher can:

- understand the scale of the MemPPI dataset quickly
- search by UniProt accession or gene symbol
- inspect a global or focused TMP interaction graph
- review tabular evidence alongside the graph
- open available AlphaFold3 interaction models for deeper inspection

## What Exists Today

### Cover Experience

- Hero-style landing page at `/`
- live network statistics from `/api/network/stats`
- search entry point into subgraph analysis
- downloadable public CSV snapshots

### Graph Exploration

- full network page at `/network`
- source filtering for experimental and predicted edges
- max-edge controls for keeping large graphs usable
- persisted layout positions through `graph_layout_cache`

### Focused Analysis

- `/subgraph` resolves both gene symbols and UniProt IDs
- single-protein searches show one-hop neighbors
- multi-protein searches show only direct connections among queried proteins
- node and edge tables support sorting, filtering, pagination, and CSV export

### Structure Inspection

- structure links from subgraph edge rows when a model exists
- structure detail pages at `/structures/[modelId]`
- AlphaFold3 metadata, asset download links, and confidence summaries
- in-browser 3D viewing with NGL

## Product Boundaries

The repository is currently optimized for:

- public read-only exploration
- graph inspection over authoring
- data-backed structure browsing

It does not currently provide:

- authentication or private workspaces
- user-saved analyses
- writable curation workflows
- fully implemented help or contact pages

## Near-Term Product Gaps

- wire `onlyVisibleEdges` into the actual graph request behavior
- replace placeholder citation text on the landing page footer
- reconcile the `experiment` vs `experimental` edge-label inconsistency between
  endpoints
- decide whether the test DB route should stay user-accessible or become
  development-only
