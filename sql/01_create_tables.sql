-- MemPPI-Atlas Database Schema
-- Based on 20251202 CSV data structure

-- Drop tables if they exist (for clean reinstall)
DROP TABLE IF EXISTS edges CASCADE;
DROP TABLE IF EXISTS nodes CASCADE;

-- =============================================================================
-- NODES TABLE
-- Columns: protein, entry_name, description, family, expression_tissue, gene_symbol
-- =============================================================================
CREATE TABLE nodes (
  protein TEXT PRIMARY KEY,
  entry_name TEXT,
  description TEXT,
  family TEXT,
  expression_tissue TEXT,
  gene_symbol TEXT
);

-- Performance indexes for nodes
CREATE INDEX idx_nodes_family ON nodes(family);
CREATE INDEX idx_nodes_entry_name ON nodes(entry_name);
CREATE INDEX idx_nodes_gene_symbol ON nodes(gene_symbol);

COMMENT ON TABLE nodes IS 'Protein nodes with annotations and expression data';
COMMENT ON COLUMN nodes.protein IS 'Primary key: UniProt accession';
COMMENT ON COLUMN nodes.entry_name IS 'UniProt entry name (e.g., PROT1_HUMAN)';
COMMENT ON COLUMN nodes.description IS 'Functional description';
COMMENT ON COLUMN nodes.family IS 'Protein family';
COMMENT ON COLUMN nodes.expression_tissue IS 'Backslash-delimited list of expression tissues';
COMMENT ON COLUMN nodes.gene_symbol IS 'Gene symbol for the protein';

-- =============================================================================
-- EDGES TABLE
-- Columns: protein2, protein1, edge, fusion_pred_prob, enriched_tissue, 
--          tissue_enriched_confidence, positive_type, gene_symbol1, gene_symbol2
-- =============================================================================
CREATE TABLE edges (
  edge TEXT PRIMARY KEY,
  protein1 TEXT NOT NULL,
  protein2 TEXT NOT NULL,
  fusion_pred_prob REAL,
  enriched_tissue TEXT,
  tissue_enriched_confidence TEXT,
  positive_type TEXT,
  gene_symbol1 TEXT,
  gene_symbol2 TEXT,
  
  -- Foreign key constraints
  FOREIGN KEY (protein1) REFERENCES nodes(protein) ON DELETE CASCADE,
  FOREIGN KEY (protein2) REFERENCES nodes(protein) ON DELETE CASCADE
);

-- Performance indexes for edges
CREATE INDEX idx_edges_protein1 ON edges(protein1);
CREATE INDEX idx_edges_protein2 ON edges(protein2);
CREATE INDEX idx_edges_enriched_tissue ON edges(enriched_tissue) WHERE enriched_tissue IS NOT NULL;
CREATE INDEX idx_edges_positive_type ON edges(positive_type);
CREATE INDEX idx_edges_fusion_prob ON edges(fusion_pred_prob);
CREATE INDEX idx_edges_gene_symbol1 ON edges(gene_symbol1);
CREATE INDEX idx_edges_gene_symbol2 ON edges(gene_symbol2);

COMMENT ON TABLE edges IS 'Protein-protein interactions with enrichment data';
COMMENT ON COLUMN edges.edge IS 'Primary key: Protein1_Protein2 format';
COMMENT ON COLUMN edges.protein1 IS 'Source protein (UniProt accession)';
COMMENT ON COLUMN edges.protein2 IS 'Target protein (UniProt accession)';
COMMENT ON COLUMN edges.fusion_pred_prob IS 'Fusion prediction probability (0-1)';
COMMENT ON COLUMN edges.enriched_tissue IS 'Tissue where interaction is enriched';
COMMENT ON COLUMN edges.tissue_enriched_confidence IS 'Confidence level (high confidence, low confidence)';
COMMENT ON COLUMN edges.positive_type IS 'Source type (prediction, experiment)';
COMMENT ON COLUMN edges.gene_symbol1 IS 'Gene symbol for protein1';
COMMENT ON COLUMN edges.gene_symbol2 IS 'Gene symbol for protein2';
