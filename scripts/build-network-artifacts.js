#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const familyBuckets = require("../src/lib/familyBuckets.json");

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const ARTIFACT_VERSION = "2026-06-27-network-artifact-v1";

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_NODES_PATH = path.join(
  ROOT_DIR,
  "data",
  "supabase-import",
  "20260627_web_data",
  "nodes.csv"
);
const DEFAULT_EDGES_PATH = path.join(
  ROOT_DIR,
  "data",
  "supabase-import",
  "20260627_web_data",
  "edges.csv"
);
const DEFAULT_OUTPUT_DIR = path.join(
  ROOT_DIR,
  "public",
  "generated",
  "network"
);

const familyColorMap = {
  GPCR: "#E8A87C",
  "Ion-channels": "#8B7BC7",
  Transporter: "#4C6FB9",
  "Catalytic receptors": "#B5D4A3",
  "Other TMPs": "#D1D5DB",
  Other: "#D1D5DB",
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const parseArgs = (args = process.argv.slice(2)) => {
  const config = {
    nodesPath: DEFAULT_NODES_PATH,
    edgesPath: DEFAULT_EDGES_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
    overviewLimit: 20000,
    fullLimit: 0,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--nodes" && next) {
      config.nodesPath = path.resolve(ROOT_DIR, next);
      index += 1;
    } else if (arg === "--edges" && next) {
      config.edgesPath = path.resolve(ROOT_DIR, next);
      index += 1;
    } else if (arg === "--output" && next) {
      config.outputDir = path.resolve(ROOT_DIR, next);
      index += 1;
    } else if (arg === "--overview-limit" && next) {
      config.overviewLimit = Number(next);
      index += 1;
    } else if (arg === "--full-limit" && next) {
      config.fullLimit = Number(next);
      index += 1;
    }
  }

  return config;
};

const parseCsvLine = (line) => {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
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
};

const createHeaderIndex = (headerLine) => {
  const header = parseCsvLine(headerLine);
  return header.reduce((acc, value, index) => {
    acc[value.trim()] = index;
    return acc;
  }, {});
};

const getColumnValue = (values, headerIndex, ...columnNames) => {
  for (const columnName of columnNames) {
    const index = headerIndex[columnName];
    if (typeof index === "number") {
      return values[index];
    }
  }
  return "";
};

const getNodeSize = (degree) =>
  clamp(11 + Math.sqrt(Math.max(0, degree)) * 1.4, 12, 24);

const getFamilyColor = (family) =>
  familyColorMap[family] || familyColorMap.Other;

const normalizeFamily = (family) => {
  if (!family) return "Other";
  const trimmed = family.trim();
  if (!trimmed) return "Other";
  return familyBuckets[trimmed] || trimmed;
};

const getEdgeVisualWeight = (positiveType, fusionPredProb) => {
  const probability = Number.isFinite(fusionPredProb) ? fusionPredProb : 0;
  const experimentalBoost = positiveType.includes("experiment") ? 0.18 : 0;
  const width = clamp(0.35 + probability * 0.55 + experimentalBoost, 0.35, 1.2);
  const opacity = clamp(
    (positiveType.includes("experiment") ? 0.2 : 0.08) + probability * 0.2,
    0.08,
    0.4
  );

  return {
    width: Number(width.toFixed(3)),
    opacity: Number(opacity.toFixed(3)),
    layoutPriority: Number(
      (probability + (positiveType.includes("experiment") ? 1 : 0)).toFixed(3)
    ),
  };
};

class MinHeap {
  constructor(limit) {
    this.limit = limit;
    this.items = [];
  }

  compare(left, right) {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.id.localeCompare(right.id);
  }

  push(item) {
    if (this.limit <= 0) return;

    if (this.items.length < this.limit) {
      this.items.push(item);
      this.bubbleUp(this.items.length - 1);
      return;
    }

    if (this.compare(item, this.items[0]) <= 0) {
      return;
    }

    this.items[0] = item;
    this.bubbleDown(0);
  }

  bubbleUp(index) {
    let currentIndex = index;

    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);
      if (
        this.compare(this.items[currentIndex], this.items[parentIndex]) >= 0
      ) {
        break;
      }
      [this.items[currentIndex], this.items[parentIndex]] = [
        this.items[parentIndex],
        this.items[currentIndex],
      ];
      currentIndex = parentIndex;
    }
  }

  bubbleDown(index) {
    let currentIndex = index;

    while (true) {
      const leftIndex = currentIndex * 2 + 1;
      const rightIndex = currentIndex * 2 + 2;
      let smallestIndex = currentIndex;

      if (
        leftIndex < this.items.length &&
        this.compare(this.items[leftIndex], this.items[smallestIndex]) < 0
      ) {
        smallestIndex = leftIndex;
      }

      if (
        rightIndex < this.items.length &&
        this.compare(this.items[rightIndex], this.items[smallestIndex]) < 0
      ) {
        smallestIndex = rightIndex;
      }

      if (smallestIndex === currentIndex) {
        break;
      }

      [this.items[currentIndex], this.items[smallestIndex]] = [
        this.items[smallestIndex],
        this.items[currentIndex],
      ];
      currentIndex = smallestIndex;
    }
  }

  values() {
    return [...this.items];
  }
}

const loadNodes = async (nodesPath) => {
  const input = fs.createReadStream(nodesPath, "utf8");
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let headerIndex = null;
  const nodes = [];
  const familyCounts = {};

  for await (const line of rl) {
    if (!headerIndex) {
      headerIndex = createHeaderIndex(line);
      continue;
    }

    if (!line.trim()) continue;

    const values = parseCsvLine(line);
    const protein = getColumnValue(values, headerIndex, "protein", "Protein");
    const entryName =
      getColumnValue(values, headerIndex, "entry_name", "Entry.Name") ||
      protein;
    const description = getColumnValue(
      values,
      headerIndex,
      "description",
      "Description"
    );
    const geneSymbol = getColumnValue(
      values,
      headerIndex,
      "gene_symbol",
      "Gene.Names"
    )
      .split(" ")[0]
      .trim();
    const family = normalizeFamily(
      getColumnValue(values, headerIndex, "family", "Family") || "Other"
    );
    const expressionTissueValue = getColumnValue(
      values,
      headerIndex,
      "expression_tissue",
      "Expression.tissue"
    );
    const expressionTissue = expressionTissueValue
      ? expressionTissueValue.split("\\").filter(Boolean)
      : [];

    nodes.push({
      id: protein,
      label: entryName,
      entryName,
      description,
      geneSymbol,
      family,
      expressionTissue,
    });

    if (family && family.trim() !== "") {
      familyCounts[family] = (familyCounts[family] || 0) + 1;
    }
  }

  return { nodes, familyCounts };
};

const scanEdges = async (edgesPath, overviewLimit, fullLimit) => {
  const input = fs.createReadStream(edgesPath, "utf8");
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let headerIndex = null;
  const degreeMap = {};
  const overviewHeap = new MinHeap(overviewLimit);
  let bestAdditionalEdge = null;
  let bestTmpnetEdge = null;
  const fullEdges = fullLimit > 0 ? [] : null;

  let totalEdges = 0;
  let predictedEdgeCount = 0;
  let enrichedEdgeCount = 0;

  for await (const line of rl) {
    if (!headerIndex) {
      headerIndex = createHeaderIndex(line);
      continue;
    }

    if (!line.trim()) continue;

    const values = parseCsvLine(line);
    const edgeId = getColumnValue(values, headerIndex, "edge", "Edge");
    const source = getColumnValue(values, headerIndex, "protein1", "Protein1");
    const target = getColumnValue(values, headerIndex, "protein2", "Protein2");
    const fusionPredProb = Number(
      getColumnValue(
        values,
        headerIndex,
        "fusion_pred_prob",
        "Fusion_Pred_Prob"
      ) || 0
    );
    const enrichedTissue =
      getColumnValue(
        values,
        headerIndex,
        "enriched_tissue",
        "Enriched_tissue"
      ) || null;
    const positiveType = (
      getColumnValue(values, headerIndex, "positive_type", "Positive_type") ||
      "prediction"
    ).toLowerCase();

    totalEdges += 1;
    degreeMap[source] = (degreeMap[source] || 0) + 1;
    degreeMap[target] = (degreeMap[target] || 0) + 1;

    if (positiveType.includes("prediction")) {
      predictedEdgeCount += 1;
    }

    if (enrichedTissue && enrichedTissue !== "NA") {
      enrichedEdgeCount += 1;
    }

    const overviewEdge = {
      id: edgeId,
      source,
      target,
      fusionPredProb,
      positiveType,
      enrichedTissue: enrichedTissue === "NA" ? null : enrichedTissue,
      priority: fusionPredProb + (positiveType.includes("experiment") ? 1 : 0),
    };

    overviewHeap.push(overviewEdge);
    if (positiveType.includes("experiment")) {
      if (
        !bestAdditionalEdge ||
        overviewHeap.compare(overviewEdge, bestAdditionalEdge) > 0
      ) {
        bestAdditionalEdge = overviewEdge;
      }
    } else if (
      !bestTmpnetEdge ||
      overviewHeap.compare(overviewEdge, bestTmpnetEdge) > 0
    ) {
      bestTmpnetEdge = overviewEdge;
    }

    if (fullEdges && fullEdges.length < fullLimit) {
      fullEdges.push({
        id: edgeId,
        source,
        target,
        fusionPredProb,
        positiveType,
        enrichedTissue: enrichedTissue === "NA" ? null : enrichedTissue,
      });
    }
  }

  const overviewEdges = overviewHeap.values();
  if (
    overviewLimit >= 2 &&
    overviewEdges.length === overviewLimit &&
    bestAdditionalEdge &&
    bestTmpnetEdge
  ) {
    const selectedCategories = new Set(
      overviewEdges.map((edge) =>
        edge.positiveType.includes("experiment") ? "additional" : "tmpnet"
      )
    );
    const missingCategoryEdge = !selectedCategories.has("additional")
      ? bestAdditionalEdge
      : !selectedCategories.has("tmpnet")
      ? bestTmpnetEdge
      : null;

    if (missingCategoryEdge) {
      let lowestPriorityIndex = 0;
      for (let index = 1; index < overviewEdges.length; index += 1) {
        if (
          overviewHeap.compare(
            overviewEdges[index],
            overviewEdges[lowestPriorityIndex]
          ) < 0
        ) {
          lowestPriorityIndex = index;
        }
      }
      overviewEdges[lowestPriorityIndex] = missingCategoryEdge;
    }
  }

  return {
    degreeMap,
    totalEdges,
    predictedEdgeCount,
    enrichedEdgeCount,
    overviewEdges: overviewEdges.sort((left, right) =>
      overviewHeap.compare(right, left)
    ),
    fullEdges,
  };
};

const buildInitialPositionMap = (nodes, degreeMap) => {
  const families = Array.from(
    new Set(nodes.map((node) => node.family || "Other"))
  ).sort();
  const familyOffsetMap = families.reduce((acc, family, index) => {
    acc[family] = (index / Math.max(1, families.length)) * Math.PI * 2;
    return acc;
  }, {});

  const sortedNodes = [...nodes].sort((left, right) => {
    const degreeDelta = (degreeMap[right.id] || 0) - (degreeMap[left.id] || 0);
    if (degreeDelta !== 0) {
      return degreeDelta;
    }
    return left.id.localeCompare(right.id);
  });

  return sortedNodes.reduce((acc, node, index) => {
    const familyOffset = familyOffsetMap[node.family || "Other"] || 0;
    const angle = index * GOLDEN_ANGLE + familyOffset * 0.18;
    const radius = 24 + Math.sqrt(index) * 14;
    acc[node.id] = {
      x: Number((Math.cos(angle) * radius).toFixed(3)),
      y: Number((Math.sin(angle) * radius).toFixed(3)),
    };
    return acc;
  }, {});
};

const buildNodeElements = (nodes, degreeMap, positions) =>
  nodes.map((node) => ({
    data: {
      id: node.id,
      label: node.geneSymbol || node.label || node.id,
      family: node.family || "Other",
      color: getFamilyColor(node.family),
      isQuery: false,
      showLabel: false,
      degree: degreeMap[node.id] || 0,
      size: getNodeSize(degreeMap[node.id] || 0),
      geneSymbol: node.geneSymbol || "",
    },
    position: positions[node.id],
    locked: true,
  }));

const buildEdgeElements = (edges) =>
  edges.map((edge) => {
    const visualWeight = getEdgeVisualWeight(
      edge.positiveType,
      edge.fusionPredProb
    );
    return {
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        fusionPredProb: edge.fusionPredProb,
        positiveType: edge.positiveType,
        color: edge.positiveType.includes("experiment") ? "#C9DBF8" : "#4C6FB9",
        width: visualWeight.width,
        opacity: visualWeight.opacity,
        layoutPriority: visualWeight.layoutPriority,
      },
    };
  });

const writeJson = async (filePath, payload) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(payload), "utf8");
};

const buildArtifactPayload = ({
  view,
  version,
  nodeElements,
  edgeElements,
  totalNodes,
  totalEdges,
}) => ({
  version,
  elements: [...nodeElements, ...edgeElements],
  meta: {
    totalNodes,
    totalEdges,
    renderedEdges: edgeElements.length,
    view,
    artifactVersion: version,
  },
  layout: {
    graphKey: `artifact:${view}:${version}`,
    layoutVersion: version,
    positions: [],
    positionsNeeded: false,
  },
});

const main = async () => {
  const config = parseArgs();

  console.log(
    `Reading nodes from ${path.relative(ROOT_DIR, config.nodesPath)}`
  );
  const { nodes, familyCounts } = await loadNodes(config.nodesPath);

  console.log(
    `Reading edges from ${path.relative(ROOT_DIR, config.edgesPath)}`
  );
  const {
    degreeMap,
    totalEdges,
    predictedEdgeCount,
    enrichedEdgeCount,
    overviewEdges,
    fullEdges,
  } = await scanEdges(config.edgesPath, config.overviewLimit, config.fullLimit);

  const positions = buildInitialPositionMap(nodes, degreeMap);
  const nodeElements = buildNodeElements(nodes, degreeMap, positions);
  const overviewArtifact = buildArtifactPayload({
    view: "overview",
    version: ARTIFACT_VERSION,
    nodeElements,
    edgeElements: buildEdgeElements(overviewEdges),
    totalNodes: nodes.length,
    totalEdges,
  });

  await writeJson(
    path.join(config.outputDir, "overview.cyto.json"),
    overviewArtifact
  );

  const statsArtifact = {
    version: ARTIFACT_VERSION,
    stats: {
      totalNodes: nodes.length,
      totalEdges,
      familyCounts,
      enrichedEdgeCount,
      predictedEdgeCount,
    },
  };

  await writeJson(path.join(config.outputDir, "stats.json"), statsArtifact);

  if (fullEdges && fullEdges.length > 0) {
    const fullArtifact = buildArtifactPayload({
      view: "full",
      version: ARTIFACT_VERSION,
      nodeElements,
      edgeElements: buildEdgeElements(fullEdges),
      totalNodes: nodes.length,
      totalEdges,
    });

    await writeJson(
      path.join(config.outputDir, "full.cyto.json"),
      fullArtifact
    );
  }

  console.log(
    `Wrote overview artifact with ${overviewEdges.length.toLocaleString()} edges and stats for ${totalEdges.toLocaleString()} total edges`
  );
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_EDGES_PATH,
  DEFAULT_NODES_PATH,
  DEFAULT_OUTPUT_DIR,
  normalizeFamily,
  parseArgs,
};
