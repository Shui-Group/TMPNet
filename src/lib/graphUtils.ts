// Utilities to convert API responses to Cytoscape element format
// and provide color mappings consistent with Milestone 6 design.

import type {
  EdgeDefinition,
  ElementDefinition,
  NodeDefinition,
} from "cytoscape";
import { EdgeResponse, LayoutPayload, NodeResponse } from "./types";

export type CytoscapeNode = NodeDefinition;
export type CytoscapeEdge = EdgeDefinition;
export type CytoscapeElements = ElementDefinition[];
export type GraphDetailLevel = "full" | "slim";
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// Family color palette matching the design image
export const familyColorMap: Record<string, string> = {
  GPCR: "#E8A87C", // salmon/orange for GPCRs
  "Ion-channels": "#8B7BC7", // purple for Ion-channels
  Transporter: "#4C6FB9", // blue for Transporters
  "Catalytic receptors": "#B5D4A3", // light green for Catalytic receptors
  "Other TMPs": "#D1D5DB", // light gray for Other TMPs
  Other: "#D1D5DB", // fallback
};

// Family labels for display (plural forms)
export const familyLabelMap: Record<string, string> = {
  GPCR: "GPCRs",
  "Ion-channels": "Ion-channels",
  Transporter: "Transporters",
  "Catalytic receptors": "Catalytic receptors",
  "Other TMPs": "Other TMPs",
  Other: "Other",
};

export function getFamilyColor(family?: string | null): string {
  if (!family) return familyColorMap.Other;
  return familyColorMap[family] || familyColorMap.Other;
}

export function getFamilyLabel(family?: string | null): string {
  if (!family) return familyLabelMap.Other;
  return familyLabelMap[family] || family;
}

// Edge color shades (only experimental and predicted)
export const edgeColors = {
  experimental: "#4C6FB9",
  predicted: "#C9DBF8",
};

export type NodeDegreeMap = Record<string, number>;

export function buildNodeDegreeMap(edges: EdgeResponse[]): NodeDegreeMap {
  return edges.reduce<NodeDegreeMap>((acc, edge) => {
    acc[edge.source] = (acc[edge.source] ?? 0) + 1;
    acc[edge.target] = (acc[edge.target] ?? 0) + 1;
    return acc;
  }, {});
}

const getEdgeProbability = (edge: EdgeResponse) =>
  typeof edge.fusionPredProb === "number" &&
  Number.isFinite(edge.fusionPredProb)
    ? edge.fusionPredProb
    : 0;

const isExperimentalEdge = (edge: EdgeResponse) =>
  edge.positiveType?.toLowerCase().includes("experiment");

export function getNodeSize(
  degree: number,
  options: { isQuery?: boolean; showLabel?: boolean } = {}
): number {
  const boundedDegree = Math.max(0, degree);
  const labelBoost = options.showLabel ? 1.5 : 0;

  if (options.isQuery) {
    return clamp(18 + Math.sqrt(boundedDegree) * 2 + labelBoost, 22, 34);
  }

  return clamp(11 + Math.sqrt(boundedDegree) * 1.4 + labelBoost, 12, 24);
}

export function getEdgeVisualWeight(edge: EdgeResponse): {
  width: number;
  opacity: number;
  layoutPriority: number;
} {
  const probability = getEdgeProbability(edge);
  const experimentalBoost = isExperimentalEdge(edge) ? 0.18 : 0;
  const width = clamp(0.35 + probability * 0.55 + experimentalBoost, 0.35, 1.2);
  const opacity = clamp(
    (isExperimentalEdge(edge) ? 0.2 : 0.08) + probability * 0.2,
    0.08,
    0.4
  );
  const layoutPriority = probability + (isExperimentalEdge(edge) ? 1 : 0);

  return {
    width: Number(width.toFixed(3)),
    opacity: Number(opacity.toFixed(3)),
    layoutPriority: Number(layoutPriority.toFixed(3)),
  };
}

export function getEdgeColor(edge: EdgeResponse): string {
  // Check if positiveType contains "experiment" (handles "experiment" and "prediction & experiment")
  if (edge.positiveType?.toLowerCase().includes("experiment"))
    return edgeColors.experimental;
  return edgeColors.predicted;
}

export type LayoutPositionMap = Record<string, { x: number; y: number }>;

export function layoutPayloadToPositionMap(
  layout?: LayoutPayload | null
): LayoutPositionMap | undefined {
  if (!layout || layout.positions.length === 0) return undefined;
  return layout.positions.reduce<LayoutPositionMap>((acc, pos) => {
    acc[pos.nodeId] = { x: pos.x, y: pos.y };
    return acc;
  }, {});
}

export function buildInitialPositionMap(
  nodes: NodeResponse[],
  degreeMap: NodeDegreeMap = {}
): LayoutPositionMap {
  const families = Array.from(
    new Set(nodes.map((node) => node.family || "Other"))
  ).sort();
  const familyOffsetMap = families.reduce<Record<string, number>>(
    (acc, family, index) => {
      acc[family] = (index / Math.max(1, families.length)) * Math.PI * 2;
      return acc;
    },
    {}
  );

  const sortedNodes = [...nodes].sort((left, right) => {
    const degreeDelta = (degreeMap[right.id] ?? 0) - (degreeMap[left.id] ?? 0);
    if (degreeDelta !== 0) {
      return degreeDelta;
    }

    return left.id.localeCompare(right.id);
  });

  return sortedNodes.reduce<LayoutPositionMap>((acc, node, index) => {
    const familyOffset = familyOffsetMap[node.family || "Other"] ?? 0;
    const angle = index * GOLDEN_ANGLE + familyOffset * 0.18;
    const radius = 24 + Math.sqrt(index) * 14;

    acc[node.id] = {
      x: Number((Math.cos(angle) * radius).toFixed(3)),
      y: Number((Math.sin(angle) * radius).toFixed(3)),
    };

    return acc;
  }, {});
}

export function nodesToCy(
  nodes: NodeResponse[],
  showAllLabels = false,
  degreeMap: NodeDegreeMap = {},
  detailLevel: GraphDetailLevel = "full"
): CytoscapeNode[] {
  return nodes.map((node) => {
    const isQuery = Boolean(node.isQuery);
    const degree = degreeMap[node.id] ?? 0;
    const showLabel = showAllLabels || isQuery;
    const nodeDef: CytoscapeNode = {
      data: {
        id: node.id,
        label: node.geneSymbol || node.label || node.id,
        family: node.family || "Other",
        color: isQuery ? "#1E3A8A" : getFamilyColor(node.family),
        isQuery,
        showLabel,
        degree,
        size: getNodeSize(degree, { isQuery, showLabel }),
        geneSymbol: node.geneSymbol,
      },
    };
    if (detailLevel === "full") {
      nodeDef.data = {
        ...nodeDef.data,
        entryName: node.entryName,
        description: node.description,
        expressionTissue: node.expressionTissue,
        tooltip: [node.label, node.geneSymbol, node.family]
          .filter(Boolean)
          .join(" · "),
      };
    }
    const position = node.position;
    if (
      position &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y)
    ) {
      nodeDef.position = position;
      nodeDef.locked = true;
    }
    return nodeDef;
  });
}

export function edgesToCy(edges: EdgeResponse[]): CytoscapeEdge[] {
  return edges.map((edge) => {
    const visualWeight = getEdgeVisualWeight(edge);
    const edgeDef: CytoscapeEdge = {
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        fusionPredProb: edge.fusionPredProb,
        enrichedTissue: edge.enrichedTissue,
        positiveType: edge.positiveType,
        color: getEdgeColor(edge),
        width: visualWeight.width,
        opacity: visualWeight.opacity,
        layoutPriority: visualWeight.layoutPriority,
      },
    };
    return edgeDef;
  });
}

type GraphLikeData = {
  nodes: NodeResponse[];
  edges: EdgeResponse[];
  layoutPositions?: LayoutPositionMap;
};

type ToCytoscapeOptions = {
  showAllLabels?: boolean;
  detailLevel?: GraphDetailLevel;
};

export function toCytoscapeElements(
  data: GraphLikeData,
  options: boolean | ToCytoscapeOptions = false
): CytoscapeElements {
  const showAllLabels =
    typeof options === "boolean" ? options : Boolean(options.showAllLabels);
  const detailLevel =
    typeof options === "boolean" ? "full" : options.detailLevel ?? "full";
  const degreeMap = buildNodeDegreeMap(data.edges);
  const positions =
    data.layoutPositions ?? buildInitialPositionMap(data.nodes, degreeMap);
  const nodeElements = nodesToCy(
    data.nodes,
    showAllLabels,
    degreeMap,
    detailLevel
  ).map((node) => {
    const hasPreset =
      Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y);
    if (hasPreset || !positions) {
      return node;
    }
    const nodeId = node.data.id;
    if (typeof nodeId !== "string") {
      return node;
    }
    const position = positions[nodeId];
    if (position) {
      return {
        ...node,
        position,
        locked: true,
      };
    }
    return node;
  });
  return [...nodeElements, ...edgesToCy(data.edges)];
}
