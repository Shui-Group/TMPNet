#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.vm}"
OUT_DIR="${1:-vm-docker-bundle}"
PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
BUILD_METADATA_FLAGS=(--provenance=false --sbom=false)

APP_PORT="${APP_PORT:-3000}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [ "$OUT_DIR" = "." ] || [ "$OUT_DIR" = "/" ]; then
  echo "Refusing to write bundle into $OUT_DIR" >&2
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

docker buildx build \
  --platform "$PLATFORM" \
  --load \
  "${BUILD_METADATA_FLAGS[@]}" \
  -t memppi-atlas:file-data \
  .

docker save \
  memppi-atlas:file-data \
  -o "$OUT_DIR/memppi-atlas-vm-images.tar"

cp docker-compose.local-supabase.yml "$OUT_DIR/docker-compose.yml"
cp docs/local-supabase-docker.md "$OUT_DIR/README.md"

cat > "$OUT_DIR/.env.vm" <<EOF
APP_PORT=${APP_PORT:-3000}
MEMPPI_DATA_MODE=file
MEMPPI_DATA_ROOT=/app/data/supabase-import/20260514_new_web_data
STRUCTURE_ASSET_ROOT=/app/data/raw/20260514_new_web_data/best_structure
NEXT_PUBLIC_SUPABASE_STRUCTURE_BUCKET=structure-models
SUPABASE_STRUCTURE_BUCKET=structure-models
EOF

cat > "$OUT_DIR/load-and-run.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

docker load -i memppi-atlas-vm-images.tar
docker compose --env-file .env.vm up -d
EOF

chmod +x "$OUT_DIR/load-and-run.sh"

echo "Wrote Docker-only VM bundle to $OUT_DIR"
