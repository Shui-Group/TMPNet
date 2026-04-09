// API endpoint for network statistics
import type { NextApiRequest, NextApiResponse } from "next";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { NetworkStats } from "@/lib/types";
import { readNetworkStatsArtifact } from "@/lib/networkArtifacts";

const EDGE_COUNT_BATCH_INITIAL = 50000;
const EDGE_COUNT_BATCH_MIN = 5000;
const STATS_CACHE_CONTROL_HEADER =
  "public, s-maxage=3600, stale-while-revalidate=86400";

type EdgeColumn = "enriched_tissue" | "positive_type";

async function countEdgesByScanning(
  column: EdgeColumn,
  predicate: (value: string | null) => boolean
): Promise<number> {
  let offset = 0;
  let batchSize = EDGE_COUNT_BATCH_INITIAL;
  let total = 0;

  while (true) {
    const to = offset + batchSize - 1;
    const { data, error } = await supabase
      .from("edges")
      .select(column)
      .range(offset, to);

    if (error) {
      if (
        (error as PostgrestError).code === "57014" &&
        batchSize > EDGE_COUNT_BATCH_MIN
      ) {
        batchSize = Math.max(EDGE_COUNT_BATCH_MIN, Math.floor(batchSize / 2));
        console.warn(
          `Edge scan for column "${column}" timed out at offset ${offset}; retrying with batchSize=${batchSize}`
        );
        continue;
      }
      throw error;
    }

    const rows = (data as { [key in EdgeColumn]: string | null }[]) || [];
    if (rows.length === 0) {
      break;
    }

    rows.forEach((row) => {
      if (predicate(row[column] ?? null)) {
        total += 1;
      }
    });

    offset += rows.length;
    if (rows.length < batchSize) {
      break;
    }
  }

  return total;
}

async function countEnrichedEdges(): Promise<number> {
  const query = supabase
    .from("edges")
    .select("*", { count: "exact", head: true })
    .not("enriched_tissue", "is", null)
    .neq("enriched_tissue", "NA");

  const { count, error } = await query;
  if (!error && typeof count === "number") {
    return count;
  }

  console.warn("Falling back to batch scan for enriched edge count", error);
  return countEdgesByScanning(
    "enriched_tissue",
    (value) => !!value && value !== "NA"
  );
}

async function countPredictedEdges(): Promise<number> {
  const query = supabase
    .from("edges")
    .select("*", { count: "exact", head: true })
    .ilike("positive_type", "%prediction%");

  const { count, error } = await query;
  if (!error && typeof count === "number") {
    return count;
  }

  console.warn("Falling back to batch scan for predicted edge count", error);
  return countEdgesByScanning("positive_type", (value) =>
    (value || "").toLowerCase().includes("prediction")
  );
}

/**
 * GET /api/network/stats
 * Returns aggregate statistics about the network:
 * - Total node and edge counts
 * - Family distribution (count per family type)
 * - Enriched edge count (edges with non-null enriched_tissue)
 * - Predicted edge count (edges whose positive_type includes 'prediction')
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<NetworkStats | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const artifactStats = await readNetworkStatsArtifact();
    if (artifactStats) {
      res.setHeader("Cache-Control", STATS_CACHE_CONTROL_HEADER);
      return res.status(200).json(artifactStats);
    }

    // Count total nodes
    const { count: nodeCount, error: nodeError } = await supabase
      .from("nodes")
      .select("*", { count: "exact", head: true });

    if (nodeError) {
      console.error("Database error counting nodes:", nodeError);
      return res.status(500).json({ error: "Failed to count nodes" });
    }

    // Count total edges
    const { count: edgeCount, error: edgeError } = await supabase
      .from("edges")
      .select("*", { count: "exact", head: true });

    if (edgeError) {
      console.error("Database error counting edges:", edgeError);
      return res.status(500).json({ error: "Failed to count edges" });
    }

    // Fetch all family values for aggregation (only ~2K rows, fetch family column only)
    const { data: familyData, error: familyError } = await supabase
      .from("nodes")
      .select("family");

    if (familyError) {
      console.error("Database error fetching families:", familyError);
      return res.status(500).json({ error: "Failed to fetch family data" });
    }

    // Aggregate family counts (exclude null/empty values)
    const familyCounts: Record<string, number> = {};
    familyData?.forEach((node) => {
      const family = node.family;
      if (family && family.trim() !== "") {
        familyCounts[family] = (familyCounts[family] || 0) + 1;
      }
    });

    // Count enriched edges (enriched_tissue IS NOT NULL)
    let enrichedEdgeCount = 0;
    try {
      enrichedEdgeCount = await countEnrichedEdges();
    } catch (enrichedError) {
      console.error("Database error counting enriched edges:", enrichedError);
      return res.status(500).json({ error: "Failed to count enriched edges" });
    }

    let predictedEdgeCount = 0;
    try {
      predictedEdgeCount = await countPredictedEdges();
    } catch (predictedError) {
      console.error("Database error counting predicted edges:", predictedError);
      return res.status(500).json({ error: "Failed to count predicted edges" });
    }

    const stats: NetworkStats = {
      totalNodes: nodeCount || 0,
      totalEdges: edgeCount || 0,
      familyCounts,
      enrichedEdgeCount: enrichedEdgeCount || 0,
      predictedEdgeCount: predictedEdgeCount || 0,
    };

    res.setHeader("Cache-Control", STATS_CACHE_CONTROL_HEADER);
    return res.status(200).json(stats);
  } catch (error) {
    console.error("Unexpected error in /api/network/stats:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
