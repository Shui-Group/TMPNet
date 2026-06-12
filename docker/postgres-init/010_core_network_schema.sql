CREATE TABLE IF NOT EXISTS public.nodes (
  protein text PRIMARY KEY,
  entry_name text,
  description text,
  family text,
  expression_tissue text,
  gene_symbol text
);

CREATE INDEX IF NOT EXISTS idx_nodes_family ON public.nodes(family);
CREATE INDEX IF NOT EXISTS idx_nodes_entry_name ON public.nodes(entry_name);
CREATE INDEX IF NOT EXISTS idx_nodes_gene_symbol ON public.nodes(gene_symbol);

CREATE TABLE IF NOT EXISTS public.edges (
  edge text PRIMARY KEY,
  protein1 text NOT NULL REFERENCES public.nodes(protein) ON DELETE CASCADE,
  protein2 text NOT NULL REFERENCES public.nodes(protein) ON DELETE CASCADE,
  fusion_pred_prob real,
  enriched_tissue text,
  tissue_enriched_confidence text,
  positive_type text,
  gene_symbol1 text,
  gene_symbol2 text
);

CREATE INDEX IF NOT EXISTS idx_edges_protein1 ON public.edges(protein1);
CREATE INDEX IF NOT EXISTS idx_edges_protein2 ON public.edges(protein2);
CREATE INDEX IF NOT EXISTS idx_edges_enriched_tissue
  ON public.edges(enriched_tissue)
  WHERE enriched_tissue IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_edges_positive_type ON public.edges(positive_type);
CREATE INDEX IF NOT EXISTS idx_edges_fusion_prob ON public.edges(fusion_pred_prob);
CREATE INDEX IF NOT EXISTS idx_edges_gene_symbol1 ON public.edges(gene_symbol1);
CREATE INDEX IF NOT EXISTS idx_edges_gene_symbol2 ON public.edges(gene_symbol2);

CREATE TABLE IF NOT EXISTS public.graph_layout_cache (
  graph_key text NOT NULL,
  node_id text NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  layout_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (graph_key, node_id)
);

CREATE INDEX IF NOT EXISTS graph_layout_cache_updated_at_idx
  ON public.graph_layout_cache(updated_at DESC);

ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edges ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'nodes'
      AND policyname = 'Allow public read access on nodes'
  ) THEN
    CREATE POLICY "Allow public read access on nodes"
      ON public.nodes FOR SELECT
      TO anon
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'edges'
      AND policyname = 'Allow public read access on edges'
  ) THEN
    CREATE POLICY "Allow public read access on edges"
      ON public.edges FOR SELECT
      TO anon
      USING (true);
  END IF;
END
$$;

GRANT SELECT ON public.nodes TO anon, authenticated;
GRANT SELECT ON public.edges TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.graph_layout_cache
  TO anon, authenticated;
