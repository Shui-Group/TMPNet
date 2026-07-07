# MemPPI-Atlas Context

## Domain Terms

### Graph Dataset

The protein-protein interaction graph loaded from local CSV files for runtime
network queries in file-mode deployment. The current deployment contract uses:

- `data/supabase-import/20260627_web_data/nodes.csv`
- `data/supabase-import/20260627_web_data/edges.csv`

### Structure Model Dataset

AlphaFold3-derived interaction model metadata and files linked from graph
edges. The current dataset is 0407-derived and relocated under the 20260627
deployment layout:

- `data/supabase-import/20260627_web_data/structure_models.csv`
- `data/raw/20260627_web_data/best_structure/`

### Docker-only VM Deployment

The supported VM deployment mode. A local machine builds the Docker image bundle
and copies it to the VM. The VM only runs docker/docker compose and does not
need Node.js, npm, npx, psql, or the Supabase CLI.

### Local File Data Mode

The VM data adapter selected by `MEMPPI_DATA_MODE=file`. It reads the 20260627 graph
CSVs and 0407-derived structure model metadata directly from the image instead
of using a hosted Supabase project or local database service.

### Structure Asset Root

The filesystem root for structure model files. In Docker-only VM deployment this
is `/app/data/raw/20260627_web_data/best_structure` inside the app image.
Structure asset API routes serve files from this root instead of a storage
bucket service.
