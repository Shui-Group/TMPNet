const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const {
  DEFAULT_EDGES_PATH,
  DEFAULT_NODES_PATH,
  normalizeFamily,
  parseArgs,
} = require("../../scripts/build-network-artifacts.js");

describe("build-network-artifacts defaults", () => {
  it("uses the 20260627 Supabase import dataset by default", () => {
    expect(DEFAULT_NODES_PATH).toBe(
      path.join(
        process.cwd(),
        "data",
        "supabase-import",
        "20260627_web_data",
        "nodes.csv"
      )
    );
    expect(DEFAULT_EDGES_PATH).toBe(
      path.join(
        process.cwd(),
        "data",
        "supabase-import",
        "20260627_web_data",
        "edges.csv"
      )
    );
  });

  it("parses CLI overrides on top of the import-dataset defaults", () => {
    const config = parseArgs([
      "--overview-limit",
      "500",
      "--full-limit",
      "1000",
    ]);

    expect(config.nodesPath).toBe(DEFAULT_NODES_PATH);
    expect(config.edgesPath).toBe(DEFAULT_EDGES_PATH);
    expect(config.overviewLimit).toBe(500);
    expect(config.fullLimit).toBe(1000);
  });

  it("writes 20260627-versioned network artifacts", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "memppi-network-artifacts-")
    );
    const nodesPath = path.join(tempDir, "nodes.csv");
    const edgesPath = path.join(tempDir, "edges.csv");
    const outputDir = path.join(tempDir, "network");

    fs.writeFileSync(
      nodesPath,
      [
        "protein,entry_name,description,gene_symbol,family,expression_tissue",
        "P1,P1_HUMAN,Protein 1,GENE1,TM,brain",
        "P2,P2_HUMAN,Protein 2,GENE2,TM(GPCR),heart",
      ].join("\n")
    );
    fs.writeFileSync(
      edgesPath,
      [
        "edge,protein1,protein2,fusion_pred_prob,enriched_tissue,positive_type",
        "P1_P2,P1,P2,0.95,brain,prediction",
      ].join("\n")
    );

    try {
      execFileSync(
        process.execPath,
        [
          path.join(process.cwd(), "scripts", "build-network-artifacts.js"),
          "--nodes",
          nodesPath,
          "--edges",
          edgesPath,
          "--output",
          outputDir,
          "--overview-limit",
          "1",
        ],
        { stdio: "pipe" }
      );

      const stats = JSON.parse(
        fs.readFileSync(path.join(outputDir, "stats.json"), "utf8")
      );
      const overview = JSON.parse(
        fs.readFileSync(path.join(outputDir, "overview.cyto.json"), "utf8")
      );

      expect(stats.version).toBe("2026-06-27-network-artifact-v1");
      expect(overview.version).toBe("2026-06-27-network-artifact-v1");
      expect(overview.meta.artifactVersion).toBe(
        "2026-06-27-network-artifact-v1"
      );
      expect(overview.layout.graphKey).toBe(
        "artifact:overview:2026-06-27-network-artifact-v1"
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("normalizes raw dataset family codes into legend buckets", () => {
    expect(normalizeFamily("TM")).toBe("Other TMPs");
    expect(normalizeFamily("TM(Trans)")).toBe("Transporter");
    expect(normalizeFamily("TM(GPCR)")).toBe("GPCR");
    expect(normalizeFamily("TM(IC)")).toBe("Ion-channels");
    expect(normalizeFamily("TM(RTK)")).toBe("Catalytic receptors");
  });
});
