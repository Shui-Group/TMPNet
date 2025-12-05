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

// Family color palette matching the design image
export const familyColorMap: Record<string, string> = {
  GPCR: "#E8A87C", // salmon/orange for GPCRs
  "Ion-channels": "#8B7BC7", // purple for Ion-channels
  Transporter: "#4C6FB9", // blue for Transporters
  "Catalytic receptors": "#B5D4A3", // light green for Catalytic receptors
  "Other TMPs": "#D1D5DB", // light gray for Other TMPs
  Other: "#D1D5DB", // fallback
};

export function getFamilyColor(family?: string | null): string {
  if (!family) return familyColorMap.Other;
  return familyColorMap[family] || familyColorMap.Other;
}

// Edge color shades (only experimental and predicted)
export const edgeColors = {
  experimental: "#4C6FB9",
  predicted: "#C9DBF8",
};

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

export function nodesToCy(nodes: NodeResponse[]): CytoscapeNode[] {
  return nodes.map((node) => {
    const isQuery = Boolean(node.isQuery);
    const nodeDef: CytoscapeNode = {
      data: {
        id: node.id,
        label: node.label,
        family: node.family || "Other",
        color: isQuery ? "#1E3A8A" : getFamilyColor(node.family),
        isQuery,
        entryName: node.entryName,
        description: node.description,
        geneSymbol: node.geneSymbol,
        expressionTissue: node.expressionTissue,
        tooltip: [node.label, node.geneSymbol, node.family]
          .filter(Boolean)
          .join(" · "),
      },
    };
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
    const edgeDef: CytoscapeEdge = {
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        fusionPredProb: edge.fusionPredProb,
        enrichedTissue: edge.enrichedTissue,
        positiveType: edge.positiveType,
        color: getEdgeColor(edge),
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

export function toCytoscapeElements(data: GraphLikeData): CytoscapeElements {
  const positions = data.layoutPositions;
  const nodeElements = nodesToCy(data.nodes).map((node) => {
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
