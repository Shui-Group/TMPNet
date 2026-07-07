import fs from "fs";
import path from "path";

const repoRoot = path.resolve(__dirname, "../..");

const readCsvHeader = (csvPath: string) =>
  fs
    .readFileSync(csvPath, "utf8")
    .split(/\r?\n/, 1)[0]
    .split(",")
    .map((column) => column.replaceAll('"', ""));

const copyColumnsFor = (sql: string, tableName: string) => {
  const match = sql.match(new RegExp(`public\\.${tableName} \\(([^)]+)\\)`));

  if (!match) {
    throw new Error(`Could not find COPY columns for ${tableName}`);
  }

  return match[1].split(",").map((column) => column.trim());
};

describe("Docker VM file-mode deployment", () => {
  it("imports 20260627 nodes through the Docker database seed", () => {
    const dockerfilePath = path.join(repoRoot, "docker/db-seed.Dockerfile");
    const importSqlPath = path.join(
      repoRoot,
      "docker/postgres-init/030_import.sql"
    );
    const nodesCsvPath = path.join(
      repoRoot,
      "data/supabase-import/20260627_web_data/nodes.csv"
    );

    const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
    const importSql = fs.readFileSync(importSqlPath, "utf8");
    const nodesHeader = readCsvHeader(nodesCsvPath);

    expect(dockerfile).toContain(
      "COPY data/supabase-import/20260627_web_data /seed/data/supabase-import/20260627_web_data"
    );
    expect(importSql).toContain(
      "FROM '/seed/data/supabase-import/20260627_web_data/nodes.csv'"
    );
    expect(copyColumnsFor(importSql, "nodes")).toEqual(nodesHeader);
  });

  it("imports 20260627 edges through the Docker database seed", () => {
    const importSqlPath = path.join(
      repoRoot,
      "docker/postgres-init/030_import.sql"
    );
    const edgesCsvPath = path.join(
      repoRoot,
      "data/supabase-import/20260627_web_data/edges.csv"
    );

    const importSql = fs.readFileSync(importSqlPath, "utf8");
    const edgesHeader = readCsvHeader(edgesCsvPath);

    expect(importSql).toContain(
      "FROM '/seed/data/supabase-import/20260627_web_data/edges.csv'"
    );
    expect(copyColumnsFor(importSql, "edges")).toEqual(edgesHeader);
  });

  it("imports relocated 20260627 structure models through the Docker database seed", () => {
    const importSqlPath = path.join(
      repoRoot,
      "docker/postgres-init/030_import.sql"
    );
    const structureModelsPath = path.join(
      repoRoot,
      "data/supabase-import/20260627_web_data/structure_models.csv"
    );

    expect(fs.existsSync(structureModelsPath)).toBe(true);

    const importSql = fs.readFileSync(importSqlPath, "utf8");
    const structureModels = fs.readFileSync(structureModelsPath, "utf8");
    const retiredDataset = ["2026", "0407_new_web_data"].join("");
    const retiredStructureRoot = [
      "data/raw",
      retiredDataset,
      "best_structure",
    ].join("/");

    expect(importSql).toContain(
      "FROM '/seed/data/supabase-import/20260627_web_data/structure_models.csv'"
    );
    expect(copyColumnsFor(importSql, "structure_models")).toEqual(
      readCsvHeader(structureModelsPath)
    );
    expect(structureModels).not.toContain(`${retiredStructureRoot}/`);
  });

  it("packages relocated 20260627 structure assets in the Docker assets image", () => {
    const dockerfilePath = path.join(repoRoot, "docker/assets.Dockerfile");
    const dockerignorePath = path.join(
      repoRoot,
      "docker/assets.Dockerfile.dockerignore"
    );
    const structureAssetsPath = path.join(
      repoRoot,
      "data/raw/20260627_web_data/best_structure"
    );

    const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
    const dockerignore = fs.readFileSync(dockerignorePath, "utf8");

    expect(fs.existsSync(structureAssetsPath)).toBe(true);
    expect(dockerfile).toContain(
      "COPY data/raw/20260627_web_data/best_structure /seed/structure-assets"
    );
    expect(dockerignore).toContain(
      "!data/raw/20260627_web_data/best_structure/**"
    );
  });

  it("keeps the Docker database seed independent from Supabase CLI inputs", () => {
    const dockerfilePath = path.join(repoRoot, "docker/db-seed.Dockerfile");
    const dockerignorePath = path.join(
      repoRoot,
      "docker/db-seed.Dockerfile.dockerignore"
    );

    const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
    const dockerignore = fs.readFileSync(dockerignorePath, "utf8");

    expect(dockerfile).toContain(
      "COPY docker/postgres-init/010_core_network_schema.sql /docker-entrypoint-initdb.d/010_core_network_schema.sql"
    );
    expect(dockerfile).toContain(
      "COPY docker/postgres-init/020_structure_models.sql /docker-entrypoint-initdb.d/020_structure_models.sql"
    );
    expect(`${dockerfile}\n${dockerignore}`).not.toContain("supabase/");
    expect(`${dockerfile}\n${dockerignore}`).not.toContain("storage");
  });

  it("provides a Docker-only Compose entrypoint for the app and file data stack", () => {
    const composePath = path.join(
      repoRoot,
      "docker-compose.local-supabase.yml"
    );
    const envExamplePath = path.join(repoRoot, ".env.vm.example");

    expect(fs.existsSync(composePath)).toBe(true);
    expect(fs.existsSync(envExamplePath)).toBe(true);

    const compose = fs.readFileSync(composePath, "utf8");
    const envExample = fs.readFileSync(envExamplePath, "utf8");

    expect(compose).toContain("memppi-atlas:");
    expect(compose).toContain("memppi-atlas:file-data");
    expect(compose).toContain("MEMPPI_DATA_MODE: file");
    expect(compose).toContain(
      "MEMPPI_DATA_ROOT: /app/data/supabase-import/20260627_web_data"
    );
    expect(compose).toContain(
      "STRUCTURE_ASSET_ROOT: /app/data/raw/20260627_web_data/best_structure"
    );
    expect(compose).not.toContain("db:");
    expect(compose).not.toContain("rest:");
    expect(compose).not.toContain("supabase-gateway:");
    expect(compose).not.toContain("asset-seed:");
    expect(compose).not.toContain("SUPABASE_URL");
    expect(compose).not.toContain("build:");
    expect(compose).not.toContain("host.docker.internal");
    expect(envExample).toContain("MEMPPI_DATA_MODE=file");
    expect(envExample).toContain(
      "MEMPPI_DATA_ROOT=/app/data/supabase-import/20260627_web_data"
    );
  });

  it("packages file-mode data in the app image", () => {
    const dockerfilePath = path.join(repoRoot, "Dockerfile");
    const dockerignorePath = path.join(repoRoot, ".dockerignore");

    const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
    const dockerignore = fs.readFileSync(dockerignorePath, "utf8");

    expect(dockerfile).toContain("ENV MEMPPI_DATA_MODE=file");
    expect(dockerfile).toContain(
      "COPY --from=builder --chown=nextjs:nodejs /app/data/supabase-import/20260627_web_data ./data/supabase-import/20260627_web_data"
    );
    expect(dockerfile).toContain(
      "COPY --from=builder --chown=nextjs:nodejs /app/data/raw/20260627_web_data/best_structure ./data/raw/20260627_web_data/best_structure"
    );
    expect(dockerignore).toContain(
      "!data/supabase-import/20260627_web_data/**"
    );
    expect(dockerignore).toContain(
      "!data/raw/20260627_web_data/best_structure/**"
    );
  });

  it("provides schema and import entrypoints for the local Supabase database", () => {
    const coreSchemaPath = path.join(
      repoRoot,
      "docker/postgres-init/010_core_network_schema.sql"
    );
    const structureSchemaPath = path.join(
      repoRoot,
      "docker/postgres-init/020_structure_models.sql"
    );

    expect(fs.existsSync(coreSchemaPath)).toBe(true);
    expect(fs.existsSync(structureSchemaPath)).toBe(true);

    const migration = fs.readFileSync(coreSchemaPath, "utf8");
    const importSql = fs.readFileSync(
      path.join(repoRoot, "docker/postgres-init/030_import.sql"),
      "utf8"
    );

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.nodes");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.edges");
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.graph_layout_cache"
    );

    expect(importSql).toContain(
      "data/supabase-import/20260627_web_data/nodes.csv"
    );
    expect(importSql).toContain(
      "data/supabase-import/20260627_web_data/edges.csv"
    );
    expect(importSql).toContain(
      "data/supabase-import/20260627_web_data/structure_models.csv"
    );
  });

  it("does not keep the retired Supabase Storage upload path", () => {
    const envExamplePath = path.join(repoRoot, ".env.local-supabase.example");
    const uploadScriptPath = path.join(
      repoRoot,
      "scripts/upload-structure-assets.mjs"
    );

    expect(fs.existsSync(envExamplePath)).toBe(false);
    expect(fs.existsSync(uploadScriptPath)).toBe(false);
  });

  it("documents file-mode Docker deployment through npm scripts", () => {
    const packageJsonPath = path.join(repoRoot, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    expect(packageJson.scripts["docker:vm:bundle"]).toContain(
      "scripts/build-vm-docker-bundle.sh"
    );
    expect(packageJson.scripts["docker:file-mode"]).toContain(
      "docker-compose.local-supabase.yml"
    );
    expect(packageJson.scripts["docker:file-mode"]).not.toContain("--build");
    expect(packageJson.scripts["docker:local-supabase"]).toBeUndefined();
  });

  it("builds a VM bundle that can be run without remote npm or npx", () => {
    const scriptPath = path.join(repoRoot, "scripts/build-vm-docker-bundle.sh");
    const docsPath = path.join(repoRoot, "docs/local-supabase-docker.md");

    const script = fs.readFileSync(scriptPath, "utf8");
    const docs = fs.readFileSync(docsPath, "utf8");

    expect(script).toContain("docker save");
    expect(script).toContain("memppi-atlas:file-data");
    expect(script).not.toContain("docker/rest.Dockerfile");
    expect(script).not.toContain("docker/gateway.Dockerfile");
    expect(script).not.toContain("memppi-atlas-rest:local");
    expect(script).not.toContain("memppi-atlas-gateway:local");
    expect(script).not.toContain("memppi-atlas-db:local");
    expect(script).not.toContain("docker pull --platform");
    expect(script).toContain("--provenance=false");
    expect(script).toContain("--sbom=false");
    expect(script).toContain("docker load -i memppi-atlas-vm-images.tar");
    expect(script).toContain("load-and-run.sh");
    expect(docs).toContain("docker load");
    expect(docs).not.toContain("npx supabase");
  });
});
