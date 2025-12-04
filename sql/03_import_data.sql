-- MemPPI-Atlas Data Import Instructions
-- 
-- Use Supabase Dashboard to import the fixed CSV files:
--
-- =============================================================================
-- IMPORT NODES FIRST
-- =============================================================================
-- File: public/20251202_node_information_fixed.csv
-- Columns: protein, entry_name, description, family, expression_tissue, gene_symbol
--
-- 1. Go to Table Editor -> nodes table
-- 2. Click "Insert" -> "Import data from CSV"
-- 3. Upload 20251202_node_information_fixed.csv
-- 4. Columns should auto-match
-- 5. Import
--
-- =============================================================================
-- IMPORT EDGES SECOND
-- =============================================================================
-- File: public/20251202_edge_information_fixed.csv
-- Columns: protein2, protein1, edge, fusion_pred_prob, enriched_tissue,
--          tissue_enriched_confidence, positive_type, gene_symbol1, gene_symbol2
--
-- 1. Go to Table Editor -> edges table
-- 2. Click "Insert" -> "Import data from CSV"
-- 3. Upload 20251202_edge_information_fixed.csv
-- 4. Columns should auto-match
-- 5. Import
--
-- =============================================================================
-- VERIFY IMPORT
-- =============================================================================

SELECT 'nodes' as table_name, COUNT(*) as row_count FROM nodes
UNION ALL
SELECT 'edges' as table_name, COUNT(*) as row_count FROM edges;

-- Sample data check
SELECT * FROM nodes LIMIT 5;
SELECT * FROM edges LIMIT 5;
