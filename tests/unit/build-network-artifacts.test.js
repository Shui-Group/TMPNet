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

  it("writes 20260713-versioned network artifacts", () => {
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
        "P2_P1,P2,P1,0.80,heart,experiment",
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
          "2",
        ],
        { stdio: "pipe" }
      );

      const stats = JSON.parse(
        fs.readFileSync(path.join(outputDir, "stats.json"), "utf8")
      );
      const overview = JSON.parse(
        fs.readFileSync(path.join(outputDir, "overview.cyto.json"), "utf8")
      );

      expect(stats.version).toBe("2026-07-13-network-artifact-v1");
      expect(overview.version).toBe("2026-07-13-network-artifact-v1");
      expect(overview.meta.artifactVersion).toBe(
        "2026-07-13-network-artifact-v1"
      );
      expect(overview.layout.graphKey).toBe(
        "artifact:overview:2026-07-13-network-artifact-v1"
      );
      const edgeColors = Object.fromEntries(
        overview.elements
          .filter((element) => element.data.source && element.data.target)
          .map((element) => [element.data.positiveType, element.data.color])
      );
      expect(edgeColors.prediction).toBe("#4C6FB9");
      expect(edgeColors.experiment).toBe("#C9DBF8");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("retains both association source categories in a skewed limited overview", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "memppi-network-artifacts-skewed-")
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
        "A1,P1,P2,0.99,brain,experiment",
        "A2,P1,P2,0.98,brain,experiment/prediction",
        "A3,P1,P2,0.97,brain,experiment",
        "T1,P1,P2,0.96,brain,prediction",
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
          "3",
        ],
        { stdio: "pipe" }
      );

      const overview = JSON.parse(
        fs.readFileSync(path.join(outputDir, "overview.cyto.json"), "utf8")
      );
      const overviewEdges = overview.elements.filter(
        (element) => element.data.source && element.data.target
      );

      expect(overviewEdges).toHaveLength(3);
      expect(overviewEdges.map((element) => element.data.color)).toEqual(
        expect.arrayContaining(["#C9DBF8", "#4C6FB9"])
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
