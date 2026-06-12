#!/usr/bin/env node
/**
 * Normalizes the 20260514 website dataset for database import and builds a
 * manifest for the edge-level structure models in best_structure/.
 */
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const DEFAULT_DATASET = "20260514_new_web_data";
const DEFAULT_RAW_DIR = path.join(
  __dirname,
  "..",
  "data",
  "raw",
  DEFAULT_DATASET
);
const DEFAULT_OUTPUT_DIR = path.join(
  __dirname,
  "..",
  "data",
  "supabase-import",
  DEFAULT_DATASET
);

const NODE_HEADER_MAP = {
  protein: "protein",
  "Entry.Name": "entry_name",
  Description: "description",
  Family: "family",
  gene_symbol: "gene_symbol",
  "Expression.tissue": "expression_tissue",
};

const EDGE_HEADER_MAP = {
  Edge: "edge",
  Protein2: "protein2",
  Protein1: "protein1",
  Fusion_Pred_Prob: "fusion_pred_prob",
  Enriched_tissue: "enriched_tissue",
  Tissue_enriched_confidence: "tissue_enriched_confidence",
  Positive_type: "positive_type",
  gene_symbol1: "gene_symbol1",
  gene_symbol2: "gene_symbol2",
  String_combined_score: "string_combined_score",
  "Biogrid_Experimental.System.Type": "biogrid_experimental_system_type",
  Hitpredict_Confidence: "hitpredict_confidence",
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function parseArgs(args = process.argv.slice(2)) {
  const config = {
    rawDir: DEFAULT_RAW_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    includeStructures: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--raw-dir" && next) {
      config.rawDir = path.resolve(__dirname, "..", next);
      index += 1;
    } else if (arg === "--output-dir" && next) {
      config.outputDir = path.resolve(__dirname, "..", next);
      index += 1;
    } else if (arg === "--skip-structures") {
      config.includeStructures = false;
    }
  }

  return config;
}

function csvEscape(value) {
  const normalized =
    value === null || typeof value === "undefined" ? "" : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function normalizeValue(value) {
  if (value === "NA") {
    return "";
  }
  return value;
}

function pairKey(protein1, protein2) {
  return [protein1, protein2]
    .map((protein) => protein.trim().toUpperCase())
    .sort((left, right) => left.localeCompare(right))
    .join("::");
}

function parseModelId(modelId) {
  const match = modelId.match(
    /^([a-z0-9]+)-([a-z0-9]+?)(?:_(without_ag|optimize))?$/i
  );

  if (!match) {
    throw new Error(`Invalid structure model id: ${modelId}`);
  }

  return {
    folderProtein1: match[1].toUpperCase(),
    folderProtein2: match[2].toUpperCase(),
    variant: match[3] || "plain",
  };
}

async function readCsvRows(filePath) {
  const rows = [];
  const readStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: readStream,
    crlfDelay: Infinity,
  });

  let header = null;

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    const values = parseCsvLine(line);
    const row = {};
    header.forEach((columnName, index) => {
      row[columnName] = values[index] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

async function normalizeCsv(inputFile, outputFile, headerMap) {
  const sourceRows = await readCsvRows(inputFile);
  const inputHeaders = Object.keys(sourceRows[0] || {}).length
    ? Object.keys(sourceRows[0])
    : Object.keys(headerMap);
  const mappedHeaders = inputHeaders.map((header) => headerMap[header]);

  if (mappedHeaders.some((header) => !header)) {
    throw new Error(
      `Unmapped headers found in ${path.basename(inputFile)}: ${inputHeaders
        .filter((header) => !headerMap[header])
        .join(", ")}`
    );
  }

  const output = fs.createWriteStream(outputFile);
  output.write(`${mappedHeaders.map(csvEscape).join(",")}\n`);

  for (const sourceRow of sourceRows) {
    const values = inputHeaders.map((header) =>
      normalizeValue(sourceRow[header])
    );
    output.write(`${values.map(csvEscape).join(",")}\n`);
  }

  output.end();
  return sourceRows;
}

async function buildStructureManifest(
  edgeRows,
  nodeRows,
  structureDir,
  outputDir
) {
  const edgeByPair = new Map();
  const nodeSet = new Set(nodeRows.map((row) => row.protein.toUpperCase()));

  for (const edgeRow of edgeRows) {
    const key = pairKey(edgeRow.Protein1, edgeRow.Protein2);
    if (edgeByPair.has(key)) {
      throw new Error(`Duplicate edge pair detected for ${key}`);
    }
    edgeByPair.set(key, edgeRow);
  }

  const structureDirs = fs
    .readdirSync(structureDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const outputFile = path.join(outputDir, "structure_models.csv");
  const output = fs.createWriteStream(outputFile);

  const headers = [
    "model_id",
    "edge",
    "protein1",
    "protein2",
    "folder_protein1",
    "folder_protein2",
    "variant",
    "source",
    "cif_rel_path",
    "cif_size_bytes",
    "summary_confidences_rel_path",
    "summary_confidences",
    "summary_iptm",
    "summary_ptm",
    "summary_ranking_score",
    "summary_fraction_disordered",
    "summary_has_clash",
    "confidences_rel_path",
    "confidences_size_bytes",
    "has_confidences",
  ];

  output.write(`${headers.map(csvEscape).join(",")}\n`);

  for (const dirName of structureDirs) {
    const parsed = parseModelId(dirName);
    const edgeRow = edgeByPair.get(
      pairKey(parsed.folderProtein1, parsed.folderProtein2)
    );

    if (!edgeRow) {
      throw new Error(`No edge found for structure model ${dirName}`);
    }

    if (
      !nodeSet.has(parsed.folderProtein1) ||
      !nodeSet.has(parsed.folderProtein2)
    ) {
      throw new Error(`Missing node metadata for structure model ${dirName}`);
    }

    const baseDir = path.join(structureDir, dirName);
    const cifPath = path.join(baseDir, `${dirName}.cif`);
    const confidencesPath = path.join(baseDir, "confidences.json");
    const summaryPath = path.join(baseDir, "summary_confidences.json");
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));

    const record = [
      dirName,
      edgeRow.Edge,
      edgeRow.Protein1,
      edgeRow.Protein2,
      parsed.folderProtein1,
      parsed.folderProtein2,
      parsed.variant,
      "alphafold3",
      path.relative(path.join(__dirname, ".."), cifPath),
      fs.statSync(cifPath).size,
      path.relative(path.join(__dirname, ".."), summaryPath),
      JSON.stringify(summary),
      summary.iptm ?? "",
      summary.ptm ?? "",
      summary.ranking_score ?? "",
      summary.fraction_disordered ?? "",
      Boolean(summary.has_clash),
      path.relative(path.join(__dirname, ".."), confidencesPath),
      fs.statSync(confidencesPath).size,
      true,
    ];

    output.write(`${record.map(csvEscape).join(",")}\n`);
  }

  output.end();

  return structureDirs.length;
}

async function main() {
  const config = parseArgs();
  const structureDir = path.join(config.rawDir, "best_structure");

  ensureDir(config.outputDir);

  const nodes = await normalizeCsv(
    path.join(config.rawDir, "node_info.csv"),
    path.join(config.outputDir, "nodes.csv"),
    NODE_HEADER_MAP
  );

  const edges = await normalizeCsv(
    path.join(config.rawDir, "edge_info.csv"),
    path.join(config.outputDir, "edges.csv"),
    EDGE_HEADER_MAP
  );

  const nodeSet = new Set(nodes.map((node) => node.protein));
  const orphanEdges = edges.filter(
    (edge) => !nodeSet.has(edge.Protein1) || !nodeSet.has(edge.Protein2)
  );

  if (orphanEdges.length > 0) {
    throw new Error(`Found ${orphanEdges.length} orphan edges in raw data`);
  }

  let structureCount = null;
  if (config.includeStructures) {
    if (!fs.existsSync(structureDir)) {
      throw new Error(
        `Structure directory not found: ${structureDir}. Pass --skip-structures for node/edge-only imports.`
      );
    }
    structureCount = await buildStructureManifest(
      edges,
      nodes,
      structureDir,
      config.outputDir
    );
  }

  console.log(`Prepared ${nodes.length} nodes for import`);
  console.log(`Prepared ${edges.length} edges for import`);
  if (structureCount !== null) {
    console.log(`Prepared ${structureCount} structure models for import`);
  }
  console.log(`Output directory: ${config.outputDir}`);
}

main().catch((error) => {
  console.error("Failed to prepare Supabase import files:", error);
  process.exit(1);
});
