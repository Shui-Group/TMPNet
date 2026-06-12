# Docker-only VM Deployment

This flow prepares everything locally and moves a Docker image bundle to the VM.
The VM does not need Node.js, npm, npx, psql, or the Supabase CLI.

## What The Bundle Contains

- `memppi-atlas:local-supabase`: the prebuilt Next.js standalone app.
- `memppi-atlas-db:local`: Postgres with schema migrations and CSV seed data.
- `memppi-atlas-assets:local`: structure files copied into a Docker volume.
- `memppi-atlas-rest:local`: Supabase-compatible REST API for database reads
  and layout cache writes, based on PostgREST.
- `memppi-atlas-gateway:local`: a small gateway exposing `/rest/v1`, based on
  nginx.

The structure asset API serves files from the Docker volume through the Next.js
API route, so the VM does not need a storage bucket service.

## Data Contract

The runtime graph dataset is the 0514 Supabase import dataset:

- `data/supabase-import/20260514_new_web_data/nodes.csv`
- `data/supabase-import/20260514_new_web_data/edges.csv`

The structure model dataset remains 0407-derived, but it is relocated under the
0514 paths used by the Docker bundle:

- `data/supabase-import/20260514_new_web_data/structure_models.csv`
- `data/raw/20260514_new_web_data/best_structure/`

These files are local deployment inputs and remain ignored by Git.

## Local Build

Create the VM environment file locally:

```bash
cp .env.vm.example .env.vm
```

Edit `.env.vm` before building. Set `NEXT_PUBLIC_SUPABASE_URL` to the
browser-facing Supabase-compatible gateway URL on the VM, for example:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://203.0.113.10:54321
```

Build the full VM bundle locally:

```bash
npm run docker:vm:bundle
```

This writes:

```text
dist/vm-docker/
├── .env.vm
├── README.md
├── docker-compose.yml
├── docker/nginx/supabase-gateway.conf
├── load-and-run.sh
└── memppi-atlas-vm-images.tar
```

Copy `dist/vm-docker/` to the VM by whatever transfer method is available.

## VM Run

On the VM, from inside the copied `vm-docker` directory:

```bash
./load-and-run.sh
```

Equivalent explicit commands:

```bash
docker load -i memppi-atlas-vm-images.tar
docker compose --env-file .env.vm up -d
```

The app listens on `APP_PORT`, defaulting to `3000`. The local
Supabase-compatible REST gateway listens on `SUPABASE_PORT`, defaulting to
`54321`.

## Updates

For app, database, or structure asset updates:

1. Rebuild the bundle locally with `npm run docker:vm:bundle`.
2. Copy the new `dist/vm-docker/` contents to the VM.
3. Run `./load-and-run.sh` on the VM.

If the database seed changed and you want to reseed from scratch:

```bash
docker compose --env-file .env.vm down -v
./load-and-run.sh
```

`down -v` deletes the local Postgres and structure asset volumes.

## Notes

The default `.env.vm.example` key material is for local/private deployments.
Replace it before exposing the VM publicly.

The supported VM deployment path is the Docker bundle. Do not run npm, npx,
psql, Supabase CLI commands, or storage bucket upload commands on the VM.
