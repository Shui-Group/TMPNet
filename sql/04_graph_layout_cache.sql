-- Layout cache table for precomputed Cytoscape node positions
CREATE TABLE IF NOT EXISTS graph_layout_cache (
    graph_key TEXT NOT NULL,
    node_id TEXT NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    layout_version TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (graph_key, node_id)
);

CREATE INDEX IF NOT EXISTS graph_layout_cache_updated_at_idx
    ON graph_layout_cache (updated_at DESC);

