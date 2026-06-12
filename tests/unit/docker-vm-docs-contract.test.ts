import fs from "fs";
import path from "path";

const repoRoot = path.resolve(__dirname, "../..");

const readDoc = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("Docker-only VM documentation contract", () => {
  it("documents VM operation as Docker-only with no supported Supabase upload path", () => {
    const docs = [
      "README.md",
      "docs/local-supabase-docker.md",
      "docs/architecture.md",
      "docs/data-model.md",
      "sql/README.md",
    ]
      .map(readDoc)
      .join("\n");

    const vmDocs = ["README.md", "docs/local-supabase-docker.md"]
      .map(readDoc)
      .join("\n");

    expect(vmDocs).toContain("Docker-only VM");
    const noRemoteToolsStatement =
      vmDocs.match(/The VM does not need[^\n]+/g)?.join(" ") ?? "";
    expect(noRemoteToolsStatement).toContain("Node.js");
    expect(noRemoteToolsStatement).toContain("npm");
    expect(noRemoteToolsStatement).toContain("npx");
    expect(noRemoteToolsStatement).toContain("psql");
    expect(noRemoteToolsStatement).toContain("Supabase CLI");

    expect(docs).not.toMatch(/npx\s+supabase/i);
    expect(docs).not.toMatch(/supabase\s+storage\s+upload/i);
    expect(docs).not.toMatch(/Supabase Storage upload/i);
  });

  it("documents the 0514 graph and relocated structure data contract", () => {
    const docs = [
      "README.md",
      "docs/local-supabase-docker.md",
      "docs/architecture.md",
      "docs/data-model.md",
      "sql/README.md",
    ]
      .map(readDoc)
      .join("\n");

    expect(docs).toContain(
      "data/supabase-import/20260514_new_web_data/nodes.csv"
    );
    expect(docs).toContain(
      "data/supabase-import/20260514_new_web_data/edges.csv"
    );
    expect(docs).toContain(
      "data/supabase-import/20260514_new_web_data/structure_models.csv"
    );
    expect(docs).toContain("data/raw/20260514_new_web_data/best_structure");
    expect(docs).toMatch(/0407-derived/i);
  });

  it("defines the shared domain vocabulary and records the deployment ADRs", () => {
    const context = readDoc("CONTEXT.md");
    const adrNames = fs.readdirSync(path.join(repoRoot, "docs/adr"));

    for (const term of [
      "Graph Dataset",
      "Structure Model Dataset",
      "Docker-only VM Deployment",
      "Local File Data Mode",
      "Structure Asset Root",
    ]) {
      expect(context).toContain(term);
    }

    expect(adrNames).toEqual(
      expect.arrayContaining([
        "0001-docker-only-vm-data-stack.md",
        "0002-0514-graph-with-relocated-0407-structures.md",
      ])
    );
  });
});
