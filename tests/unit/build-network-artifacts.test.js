const path = require("path");
const {
  DEFAULT_EDGES_PATH,
  DEFAULT_NODES_PATH,
  normalizeFamily,
  parseArgs,
} = require("../../scripts/build-network-artifacts.js");

describe("build-network-artifacts defaults", () => {
  it("uses the 20260407 Supabase import dataset by default", () => {
    expect(DEFAULT_NODES_PATH).toBe(
      path.join(
        process.cwd(),
        "data",
        "supabase-import",
        "20260407_new_web_data",
        "nodes.csv"
      )
    );
    expect(DEFAULT_EDGES_PATH).toBe(
      path.join(
        process.cwd(),
        "data",
        "supabase-import",
        "20260407_new_web_data",
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

  it("normalizes raw dataset family codes into legend buckets", () => {
    expect(normalizeFamily("TM")).toBe("Other TMPs");
    expect(normalizeFamily("TM(Trans)")).toBe("Transporter");
    expect(normalizeFamily("TM(GPCR)")).toBe("GPCR");
    expect(normalizeFamily("TM(IC)")).toBe("Ion-channels");
    expect(normalizeFamily("TM(RTK)")).toBe("Catalytic receptors");
  });
});
