# ADR 0001: Docker-only VM Data Stack

## Status

Accepted

## Context

The deployment target is a VM where we want the smallest runtime dependency
surface. Previous setup notes mixed local development, manual database import,
and hosted Supabase-style operations.

## Decision

The supported VM deployment path is Docker-only. A local machine with Node.js,
npm, and Docker builds `dist/vm-docker/`. The VM receives that bundle and runs:

```bash
docker load -i memppi-atlas-vm-images.tar
docker compose --env-file .env.vm up -d
```

The VM stack contains:

- Postgres for `nodes`, `edges`, `graph_layout_cache`, and `structure_models`
- PostgREST for the Supabase-compatible table API
- nginx as the Supabase-compatible REST Gateway
- the Next.js app image
- a Structure Asset Volume seeded from local structure files

The VM does not need Node.js, npm, npx, psql, or the Supabase CLI. Storage bucket
upload flows are not a supported deployment path.

## Consequences

- VM setup and updates are repeatable from the Docker bundle.
- Data and structure assets remain local inputs and ignored by Git.
- Hosted Supabase and manual CLI import instructions are not canonical for VM
  deployment.
