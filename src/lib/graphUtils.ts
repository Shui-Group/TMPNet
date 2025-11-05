// Utilities to convert API responses to Cytoscape element format
// and provide color mappings consistent with Milestone 6 design.

import type {
  EdgeDefinition,
  ElementDefinition,
  NodeDefinition,
} from "cytoscape";
import { EdgeResponse, NodeResponse } from "./types";

export type CytoscapeNode = NodeDefinition;
export type CytoscapeEdge = EdgeDefinition;
export type CytoscapeElements = ElementDefinition[];

// Cool neutral palette only (no red/green/yellow)
export const familyColorMap: Record<string, string> = {
  TM: "#93B4E5",
  TF: "#A7C5EB",
  Kinase: "#CBD5E1",
  Receptor: "#B6C2D9",
  Other: "#D1D5DB",
};

export function getFamilyColor(family?: string | null): string {
  if (!family) return familyColorMap.Other;
  return familyColorMap[family] || familyColorMap.Other;
}

// Edge color shades (all blue family, translucent-friendly)
export const edgeColors = {
  experimental: "#4C6FB9",
  enriched: "#7DA6E8",
  predicted: "#C9DBF8",
};

export function getEdgeColor(edge: EdgeResponse): string {
  if (edge.positiveType?.toLowerCase() === "experimental")
    return edgeColors.experimental;
  if (edge.enrichedTissue) return edgeColors.enriched;
  return edgeColors.predicted;
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
        description: node.description,
        geneNames: node.geneNames,
        expressionTissue: node.expressionTissue,
        tooltip: [node.label, node.geneNames, node.family]
          .filter(Boolean)
          .join(" · "),
      },
    };
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
  layoutPositions?: Record<string, { x: number; y: number }>;
};

export function toCytoscapeElements(data: GraphLikeData): CytoscapeElements {
  const positions = data.layoutPositions;
  const nodeElements = nodesToCy(data.nodes).map((node) => {
    if (positions && positions[node.data.id]) {
      return {
        ...node,
        position: positions[node.data.id],
        locked: true,
      };
    }
    return node;
  });
  return [...nodeElements, ...edgesToCy(data.edges)];
}
