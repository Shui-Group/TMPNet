// Type definitions for MemPPI-Atlas data structures

/**
 * Node (Protein) data structure from database
 */
export interface Node {
  protein: string; // UniProt accession (primary key)
  entry_name: string | null; // UniProt entry name
  description: string | null; // Functional description
  family: string | null; // Protein family (TM, TF, etc.)
  expression_tissue: string | null; // Backslash-delimited tissue list
  gene_symbol: string | null; // Gene symbol for the protein
}

/**
 * Edge (Interaction) data structure from database
 */
export interface Edge {
  edge: string; // Edge ID (Protein1_Protein2)
  protein1: string; // Source protein accession
  protein2: string; // Target protein accession
  fusion_pred_prob: number | null; // Fusion prediction probability (0-1)
  enriched_tissue: string | null; // Tissue where interaction is enriched
  tissue_enriched_confidence: string | null; // Confidence level (high confidence, low confidence)
  positive_type: string | null; // Source type (prediction, experiment)
  gene_symbol1: string | null; // Gene symbol for protein1
  gene_symbol2: string | null; // Gene symbol for protein2
}

/**
 * Node transformed for API responses and graph visualization
 */
export interface NodeResponse {
  id: string; // UniProt accession (matches protein)
  label: string; // Display label (entry_name or protein)
  entryName: string; // UniProt entry name
  description: string; // Functional description
  geneSymbol: string; // Gene symbol
  family: string; // Protein family
  expressionTissue: string[]; // Parsed tissue array
  isQuery?: boolean; // Flag for queried nodes in subgraph
  position?: {
    x: number;
    y: number;
  };
}

/**
 * Edge transformed for API responses and graph visualization
 */
export interface EdgeResponse {
  id: string; // Edge ID (Protein1_Protein2)
  source: string; // Source protein accession
  target: string; // Target protein accession
  fusionPredProb: number; // Fusion prediction probability
  enrichedTissue: string | null; // Tissue enrichment
  tissueEnrichedConfidence: string | null; // Confidence level (high/low confidence)
  positiveType: string; // Source type
}

/**
 * Network statistics for sidebar
 */
export interface NetworkStats {
  totalNodes: number;
  totalEdges: number;
  familyCounts: Record<string, number>;
  enrichedEdgeCount: number;
  predictedEdgeCount: number;
}

/**
 * Full network data response
 */
export interface NetworkTimings {
  fetchNodesMs?: number;
  fetchEdgesMs?: number;
  transformMs?: number;
  totalMs?: number;
}

export interface NetworkMeta {
  totalNodes: number;
  totalEdges: number;
  filteredEdges: number;
  timings?: NetworkTimings;
}

export interface NetworkData {
  nodes: NodeResponse[];
  edges: EdgeResponse[];
  meta?: NetworkMeta;
  layout?: LayoutPayload;
}

/**
 * Subgraph data response
 */
export interface SubgraphData {
  query: string[]; // Queried protein IDs
  nodes: NodeResponse[];
  edges: EdgeResponse[];
  truncated?: {
    // Optional truncation metadata
    nodes: boolean;
    edges: boolean;
  };
  layout?: LayoutPayload;
}

/**
 * Utility type for Supabase query responses
 */
export type SupabaseResponse<T> = {
  data: T | null;
  error: Error | null;
};

export interface LayoutPosition {
  nodeId: string;
  x: number;
  y: number;
}

export interface LayoutPayload {
  graphKey: string;
  layoutVersion: string;
  positions: LayoutPosition[];
  positionsNeeded: boolean;
}

export interface LayoutCacheRecord {
  graph_key: string;
  node_id: string;
  x: number;
  y: number;
  layout_version: string;
  updated_at: string;
}
