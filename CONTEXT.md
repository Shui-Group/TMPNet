# MemPPI-Atlas Context

## Domain Terms

### Graph Dataset

The protein-protein interaction graph loaded into Postgres for runtime network
queries. The current deployment contract uses:

- `data/supabase-import/20260514_new_web_data/nodes.csv`
- `data/supabase-import/20260514_new_web_data/edges.csv`

### Structure Model Dataset

AlphaFold3-derived interaction model metadata and files linked from graph
edges. The current dataset is 0407-derived and relocated under the 0514
deployment layout:

- `data/supabase-import/20260514_new_web_data/structure_models.csv`
- `data/raw/20260514_new_web_data/best_structure/`

### Docker-only VM Deployment

The supported VM deployment mode. A local machine builds the Docker image bundle
and copies it to the VM. The VM only runs docker/docker compose and does not
need Node.js, npm, npx, psql, or the Supabase CLI.

### Supabase-compatible REST Gateway

The local REST endpoint exposed by nginx in front of PostgREST. It provides the
`/rest/v1` API shape expected by the app without requiring a hosted Supabase
project on the VM.

### Structure Asset Volume

The Docker volume seeded with structure model files from
`data/raw/20260514_new_web_data/best_structure/`. Structure asset API routes
serve files from this volume instead of a storage bucket service.
