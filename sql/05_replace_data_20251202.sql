-- MemPPI-Atlas Data Update Script (2024-12-02 version)
-- This script:
--   1. Updates schema to match new CSV structure
--   2. Clears existing data
--   3. Prepares tables for CSV import
-- 
-- IMPORTANT: This is a DESTRUCTIVE operation - all existing data will be deleted!
-- 
-- =============================================================================
-- STEP 1: UPDATE SCHEMA - ADD/MODIFY COLUMNS
-- =============================================================================

-- Drop foreign key constraints first
ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_protein1_fkey;
ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_protein2_fkey;

-- Add gene_symbol column to nodes table 
-- (keeping gene_names for backward compatibility - they can both exist)
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS gene_symbol TEXT;

-- Add gene_symbol1 and gene_symbol2 columns to edges table
ALTER TABLE edges ADD COLUMN IF NOT EXISTS gene_symbol1 TEXT;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS gene_symbol2 TEXT;

-- Add comments for new columns
COMMENT ON COLUMN nodes.gene_symbol IS 'Gene symbol for the protein';
COMMENT ON COLUMN edges.gene_symbol1 IS 'Gene symbol for protein1';
COMMENT ON COLUMN edges.gene_symbol2 IS 'Gene symbol for protein2';

-- =============================================================================
-- STEP 2: CLEAR EXISTING DATA
-- =============================================================================
TRUNCATE TABLE edges CASCADE;
TRUNCATE TABLE nodes CASCADE;

-- =============================================================================
-- STEP 3: IMPORT DATA VIA SUPABASE DASHBOARD
-- =============================================================================
-- 
-- Use the fixed CSV files:
--
-- FOR NODES: public/20251202_node_information_fixed.csv
--   Columns: protein, entry_name, description, family, expression_tissue, gene_symbol
--
-- FOR EDGES: public/20251202_edge_information_fixed.csv  
--   Columns: protein2, protein1, edge, fusion_pred_prob, enriched_tissue, 
--            tissue_enriched_confidence, positive_type, gene_symbol1, gene_symbol2
--
-- =============================================================================
-- STEP 4: RESTORE FOREIGN KEY CONSTRAINTS (Run AFTER import is complete)
-- =============================================================================

-- Uncomment and run these after importing both CSVs:

-- ALTER TABLE edges 
--   ADD CONSTRAINT edges_protein1_fkey 
--   FOREIGN KEY (protein1) REFERENCES nodes(protein) ON DELETE CASCADE;

-- ALTER TABLE edges 
--   ADD CONSTRAINT edges_protein2_fkey 
--   FOREIGN KEY (protein2) REFERENCES nodes(protein) ON DELETE CASCADE;

-- =============================================================================
-- STEP 5: VERIFY IMPORT
-- =============================================================================

-- Uncomment and run after import:

-- SELECT 'nodes' as table_name, COUNT(*) as row_count FROM nodes
-- UNION ALL
-- SELECT 'edges' as table_name, COUNT(*) as row_count FROM edges;