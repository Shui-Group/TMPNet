#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.vm}"
OUT_DIR="${1:-dist/vm-docker}"
PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
BUILD_METADATA_FLAGS=(--provenance=false --sbom=false)

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.vm.example to $ENV_FILE and edit it first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${NEXT_PUBLIC_SUPABASE_URL:?Set NEXT_PUBLIC_SUPABASE_URL in $ENV_FILE}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?Set NEXT_PUBLIC_SUPABASE_ANON_KEY in $ENV_FILE}"
: "${NEXT_PUBLIC_SUPABASE_STRUCTURE_BUCKET:=structure-models}"
: "${SUPABASE_STRUCTURE_BUCKET:=structure-models}"

mkdir -p "$OUT_DIR"

docker buildx build \
  --platform "$PLATFORM" \
  --load \
  "${BUILD_METADATA_FLAGS[@]}" \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  --build-arg NEXT_PUBLIC_SUPABASE_STRUCTURE_BUCKET="$NEXT_PUBLIC_SUPABASE_STRUCTURE_BUCKET" \
  --build-arg SUPABASE_STRUCTURE_BUCKET="$SUPABASE_STRUCTURE_BUCKET" \
  -t memppi-atlas:local-supabase \
  .

docker buildx build \
  --platform "$PLATFORM" \
  --load \
  "${BUILD_METADATA_FLAGS[@]}" \
  -f docker/db-seed.Dockerfile \
  -t memppi-atlas-db:local \
  .

docker buildx build \
  --platform "$PLATFORM" \
  --load \
  "${BUILD_METADATA_FLAGS[@]}" \
  -f docker/assets.Dockerfile \
  -t memppi-atlas-assets:local \
  .

docker buildx build \
  --platform "$PLATFORM" \
  --load \
  "${BUILD_METADATA_FLAGS[@]}" \
  -f docker/rest.Dockerfile \
  -t memppi-atlas-rest:local \
  .

docker buildx build \
  --platform "$PLATFORM" \
  --load \
  "${BUILD_METADATA_FLAGS[@]}" \
  -f docker/gateway.Dockerfile \
  -t memppi-atlas-gateway:local \
  .

docker save \
  memppi-atlas:local-supabase \
  memppi-atlas-db:local \
  memppi-atlas-assets:local \
  memppi-atlas-rest:local \
  memppi-atlas-gateway:local \
  -o "$OUT_DIR/memppi-atlas-vm-images.tar"

cp docker-compose.local-supabase.yml "$OUT_DIR/docker-compose.yml"
mkdir -p "$OUT_DIR/docker/nginx"
cp docker/nginx/supabase-gateway.conf "$OUT_DIR/docker/nginx/supabase-gateway.conf"
cp "$ENV_FILE" "$OUT_DIR/.env.vm"
cp docs/local-supabase-docker.md "$OUT_DIR/README.md"

cat > "$OUT_DIR/load-and-run.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

docker load -i memppi-atlas-vm-images.tar
docker compose --env-file .env.vm up -d
EOF

chmod +x "$OUT_DIR/load-and-run.sh"

echo "Wrote Docker-only VM bundle to $OUT_DIR"
