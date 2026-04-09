// Cytoscape styling and layout configs for Milestone 6

import type cytoscape from "cytoscape";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const subgraphStyles: any[] = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      width: 10,
      height: 10,
      label: "",
      "font-size": 3,
      "text-valign": "center",
      "text-halign": "center",
      "overlay-opacity": 0,
    },
  },
  {
    selector: "node[?showLabel]",
    style: {
      label: "data(label)",
      "font-size": 3,
    },
  },
  {
    selector: "node:selected",
    style: {
      label: "data(label)",
      "font-size": 10,
      color: "#1F2937",
      "text-background-color": "#FFFFFF",
      "text-background-opacity": 0.9,
      "text-background-shape": "roundrectangle",
      "text-background-padding": 2,
      "border-width": 1,
      "border-color": "#64748B",
      width: 14,
      height: 14,
    },
  },
  {
    selector: "node[?isQuery]",
    style: {
      "background-color": "#DC2626", // Red color for query node to stand out
      width: 14,
      height: 14,
      label: "data(label)",
      "font-size": 12,
      "font-weight": "bold",
      color: "#0F172A",
      "text-background-color": "#FFFFFF",
      "text-background-opacity": 1,
      "text-background-padding": 3,
      "text-background-shape": "roundrectangle",
      "text-outline-width": 2,
      "text-outline-color": "#FFFFFF",
      "text-wrap": "none",
      "text-margin-y": -18,
      "text-halign": "center",
      "text-valign": "top",
      "min-zoomed-font-size": 0, // Always show label regardless of zoom
      "border-width": 2,
      "border-color": "#991B1B",
      "z-index-compare": "manual",
      "z-index": 10000, // Extremely high z-index to ensure it's on top
    },
  },
  {
    selector: "node[?isQuery]:selected",
    style: {
      label: "data(label)",
      "font-size": 12,
      "border-width": 3,
      "border-color": "#7F1D1D",
      width: 18,
      height: 18,
      "z-index": 10000,
    },
  },
  {
    selector: "edge",
    style: {
      width: "mapData(fusionPredProb, 0, 1, 0.5, 1.5)",
      "line-color": "data(color)",
      "curve-style": "straight",
      opacity: 0.6, // Higher opacity for subgraph edges
      "line-cap": "round",
      "target-arrow-shape": "none",
      "source-arrow-shape": "none",
    },
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cyStyles: any[] = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      width: 24,
      height: 24,
      label: "",
      "overlay-opacity": 0,
    },
  },
  {
    selector: "node:selected",
    style: {
      label: "data(label)",
      "font-size": 12,
      color: "#1F2937",
      "text-background-color": "#FFFFFF",
      "text-background-opacity": 0.9,
      "text-background-shape": "roundrectangle",
      "text-background-padding": 2,
      "border-width": 2,
      "border-color": "#64748B",
      width: 28,
      height: 28,
    },
  },
  {
    selector: "node[?isQuery]",
    style: {
      "background-color": "#1E3A8A",
      width: 32,
      height: 32,
      label: "data(label)",
      "font-size": 14,
      color: "#0F172A",
      "text-background-color": "#FFFFFF",
      "text-background-opacity": 1,
      "text-background-padding": 4,
      "text-background-shape": "roundrectangle",
      "text-outline-width": 2,
      "text-outline-color": "#FFFFFF",
      "text-wrap": "none",
      "text-margin-y": -46,
      "text-halign": "center",
      "text-valign": "top",
      "border-width": 3,
      "border-color": "#1E40AF",
      "z-index-compare": "manual",
      "z-index": 1000,
    },
  },
  {
    selector: "node[?isQuery]:selected",
    style: {
      label: "data(label)",
      "font-size": 14,
      "border-width": 3,
      "border-color": "#1D4ED8",
      width: 36,
      height: 36,
      "z-index": 1001,
    },
  },
  {
    selector: "edge",
    style: {
      width: "mapData(fusionPredProb, 0, 1, 0.5, 1.5)",
      "line-color": "data(color)",
      "curve-style": "straight",
      opacity: 0.35,
      "line-cap": "round",
      "target-arrow-shape": "none",
      "source-arrow-shape": "none",
    },
  },
];

export const concentricLayout: cytoscape.LayoutOptions = {
  name: "concentric",
  animate: false,
  fit: true,
  padding: 10,
  startAngle: (3 / 2) * Math.PI, // Start at top
  sweep: undefined, // Full circle
  clockwise: true,
  equidistant: false, // Allow different distances between levels
  minNodeSpacing: 10, // Minimum spacing between nodes
  boundingBox: undefined, // Constrain layout bounds; { x1, y1, x2, y2 } or { x1, y1, w, h }
  avoidOverlap: true, // Prevent node overlap
  nodeDimensionsIncludeLabels: false, // Exclude labels from node dimensions
  concentric: function (node: cytoscape.NodeSingular) {
    return node.degree(false);
  },
  levelWidth: function (nodes: cytoscape.NodeCollection) {
    // Heuristic: more nodes = more levels.
    // This function returns the variation in "concentric" value for each level.
    return nodes.maxDegree() / 10;
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fcoseLayout: any = {
  name: "fcose",
  quality: "draft",
  randomize: true,
  animate: false,
  nodeDimensionsIncludeLabels: true,
  fit: true,
  padding: 30,
  nodeRepulsion: 9000,
  idealEdgeLength: () => 150 + Math.random() * 300,
  gravity: 0.1,
  numIter: 2500,
  tile: true, // Allow tile to separate unconnected components
  tilingPaddingVertical: 20,
  tilingPaddingHorizontal: 20,
};

export const coseLayout: cytoscape.LayoutOptions = {
  name: "cose",
  animate: false,
  nodeDimensionsIncludeLabels: true,
  fit: true,
  padding: 50,
  nodeRepulsion: 10000,
  idealEdgeLength: 200,
  gravity: 0.25,
  numIter: 1000,
  randomize: false,
};

export const largeGraphThreshold = 75000;

export const rendererOptions = {
  name: "canvas",
  pixelRatio: 1,
};
