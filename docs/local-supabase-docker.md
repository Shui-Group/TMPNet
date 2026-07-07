# Docker-only VM Deployment

This flow prepares one Docker image bundle locally and moves it to the VM. The
VM does not need Node.js, npm, npx, psql, a local database, or the Supabase CLI.

## What The Bundle Contains

- `memppi-atlas:file-data`: the prebuilt Next.js standalone app with the 20260627
  graph CSVs and relocated structure assets copied into the image.
- `docker-compose.yml`: a single-service Compose file that starts the app.
- `.env.vm`: runtime port and file-mode data paths.
- `load-and-run.sh`: loads the image tar and starts Compose.

The app reads graph and structure metadata through `MEMPPI_DATA_MODE=file`.
Structure asset API routes serve files from the image path configured by
`STRUCTURE_ASSET_ROOT`.

## Data Contract

The runtime graph dataset is the 20260627 import dataset:

- `data/supabase-import/20260627_web_data/nodes.csv`
- `data/supabase-import/20260627_web_data/edges.csv`

The structure model dataset remains 0407-derived, but it is relocated under the
20260627 paths used by the Docker bundle:

- `data/supabase-import/20260627_web_data/structure_models.csv`
- `data/raw/20260627_web_data/best_structure/`

These files are local deployment inputs and remain ignored by Git.

## Local Build

Build the VM bundle locally:

```bash
npm run docker:vm:bundle
```

This writes:

```text
vm-docker-bundle/
├── .env.vm
├── README.md
├── docker-compose.yml
├── load-and-run.sh
└── memppi-atlas-vm-images.tar
```

Copy `vm-docker-bundle/` to the VM by whatever transfer method is available.

## VM Run

On the VM, from inside the copied `vm-docker-bundle` directory:

```bash
./load-and-run.sh
```

Equivalent explicit commands:

```bash
docker load -i memppi-atlas-vm-images.tar
docker compose --env-file .env.vm up -d
```

The app listens on `APP_PORT`, defaulting to `3000`.

## Updates

For app or data updates:

1. Rebuild the bundle locally with `npm run docker:vm:bundle`.
2. Copy the new `vm-docker-bundle/` contents to the VM.
3. Run `./load-and-run.sh` on the VM.

The supported VM deployment path is the Docker bundle. Do not run npm, npx,
psql, Supabase CLI commands, database import commands, or storage bucket upload
commands on the VM.
