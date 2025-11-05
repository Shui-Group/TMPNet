// API endpoint for fetching subgraph data (query proteins + 1-hop neighbors)
import type { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import type {
  Node,
  Edge,
  SubgraphData,
  LayoutPayload,
  LayoutCacheRecord,
} from "@/lib/types";
import {
  transformNodeToResponse,
  transformEdgeToResponse,
} from "@/lib/transforms";
import {
  buildGraphKey,
  CURRENT_LAYOUT_VERSION,
  buildLayoutPayload,
  mapLayoutRowsToPositions,
} from "@/lib/layoutCache";

/**
 * GET /api/subgraph?proteins=P12345,Q67890
 * Returns subgraph containing query proteins and their 1-hop neighbors
 *
 * Query Parameters:
 * - proteins (required): Comma-separated list of UniProt accessions
 * - minProb (optional): Minimum fusion prediction probability (default: 0.8)
 * - preferExperimental (optional): Prefer experimental edges (default: true)
 * - maxEdges (optional): Maximum edges to return (default: 5000, max: 20000)
 * - maxNodes (optional): Maximum nodes to return (default: 1000, max: 5000)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SubgraphData | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Parse and validate proteins parameter
    const proteinsParam = req.query.proteins as string | undefined;
    if (!proteinsParam || proteinsParam.trim() === "") {
      return res
        .status(400)
        .json({ error: "Missing required parameter: proteins" });
    }

    // Parse query proteins (case-insensitive, convert to uppercase)
    const queryProteins = proteinsParam
      .split(",")
      .map((p) => p.trim().toUpperCase())
      .filter((p) => p.length > 0);

    if (queryProteins.length === 0) {
      return res.status(400).json({
        error:
          "Invalid proteins parameter: must contain at least one protein ID",
      });
    }

    // Parse filtering parameters (same defaults as network endpoint)
    const minProb = parseFloat((req.query.minProb as string) || "0.8");
    const preferExperimental =
      (req.query.preferExperimental as string) !== "false";
    const maxEdges = Math.min(
      parseInt((req.query.maxEdges as string) || "5000", 10),
      20000 // Hard cap
    );
    const maxNodes = Math.min(
      parseInt((req.query.maxNodes as string) || "1000", 10),
      5000 // Hard cap
    );

    const edgeSelect =
      "edge,protein1,protein2,fusion_pred_prob,enriched_tissue,tissue_enriched_confidence,positive_type";

    // Step 1: Query edges where protein1 OR protein2 matches any query protein
    let edges: Edge[] = [];
    let edgesTruncated = false;

    // Build OR condition for Supabase query
    // We need to check if protein1 is in queryProteins OR protein2 is in queryProteins
    if (preferExperimental) {
      // First, get experimental edges
      const { data: expEdges, error: expErr } = await supabase
        .from("edges")
        .select(edgeSelect)
        .eq("positive_type", "experimental")
        .or(
          queryProteins
            .map((p) => `protein1.eq.${p},protein2.eq.${p}`)
            .join(",")
        )
        .limit(maxEdges);

      if (expErr) {
        console.error("Database error fetching experimental edges:", expErr);
        return res
          .status(500)
          .json({ error: "Failed to fetch edges from database" });
      }
      edges = (expEdges ?? []) as Edge[];
    }

    // Add high-probability predicted edges if we haven't hit the limit
    const remaining = Math.max(0, maxEdges - edges.length);
    if (remaining > 0) {
      const { data: predEdges, error: predErr } = await supabase
        .from("edges")
        .select(edgeSelect)
        .gte("fusion_pred_prob", minProb)
        .or(
          queryProteins
            .map((p) => `protein1.eq.${p},protein2.eq.${p}`)
            .join(",")
        )
        .order("fusion_pred_prob", { ascending: false })
        .limit(remaining);

      if (predErr) {
        console.warn("Predicted edges query error:", predErr);
      } else {
        const typedPredEdges = (predEdges ?? []) as Edge[];
        // Deduplicate edges (in case an edge is both experimental and predicted)
        const existingEdgeIds = new Set(edges.map((e) => e.edge));
        const newEdges = typedPredEdges.filter(
          (e) => !existingEdgeIds.has(e.edge)
        );
        edges = edges.concat(newEdges);
      }
    }

    // Check if we truncated edges
    if (edges.length >= maxEdges) {
      edgesTruncated = true;
    }

    // Step 2: Check if any query proteins were found
    if (edges.length === 0) {
      // No edges found - check if any query proteins exist in nodes table
      const { data: existingNodes, error: nodeCheckErr } = await supabase
        .from("nodes")
        .select("protein")
        .in("protein", queryProteins);

      if (nodeCheckErr) {
        console.error("Database error checking nodes:", nodeCheckErr);
        return res
          .status(500)
          .json({ error: "Failed to check proteins in database" });
      }

      if (!existingNodes || existingNodes.length === 0) {
        return res
          .status(404)
          .json({ error: "None of the queried proteins exist in the dataset" });
      }

      // Query proteins exist but have no edges - return them with empty edges
      const { data: nodesData, error: nodesErr } = await supabase
        .from("nodes")
        .select("*")
        .in("protein", queryProteins);

      if (nodesErr) {
        console.error("Database error fetching nodes:", nodesErr);
        return res
          .status(500)
          .json({ error: "Failed to fetch nodes from database" });
      }

      const nodes = (nodesData as Node[]).map((node) => ({
        ...transformNodeToResponse(node),
        isQuery: true,
      }));

      return res.status(200).json({
        query: queryProteins,
        nodes,
        edges: [],
      });
    }

    // Step 3: Extract all unique protein IDs from edges
    const proteinIdsSet = new Set<string>(queryProteins);
    edges.forEach((edge) => {
      proteinIdsSet.add(edge.protein1);
      proteinIdsSet.add(edge.protein2);
    });
    const allProteinIds = Array.from(proteinIdsSet);

    // Apply maxNodes limit
    let nodesTruncated = false;
    let limitedProteinIds = allProteinIds;
    if (allProteinIds.length > maxNodes) {
      // Always include query proteins, then add neighbors up to limit
      const neighborIds = allProteinIds.filter(
        (id) => !queryProteins.includes(id)
      );
      limitedProteinIds = [
        ...queryProteins,
        ...neighborIds.slice(0, maxNodes - queryProteins.length),
      ];
      nodesTruncated = true;

      // Filter edges to only include those connecting limited nodes
      const limitedProteinIdsSet = new Set(limitedProteinIds);
      edges = edges.filter(
        (edge) =>
          limitedProteinIdsSet.has(edge.protein1) &&
          limitedProteinIdsSet.has(edge.protein2)
      );
    }

    // Step 3b: Fetch additional edges where both endpoints are within the limited node set
    const limitedProteinIdsSet = new Set(limitedProteinIds);
    const existingEdgeIds = new Set(edges.map((edge) => edge.edge));
    let remainingEdgeCapacity = Math.max(0, maxEdges - edges.length);

    const addEdges = (edgeList: Edge[] | null | undefined) => {
      if (!edgeList || remainingEdgeCapacity <= 0) return;
      for (const edge of edgeList) {
        if (
          !limitedProteinIdsSet.has(edge.protein1) ||
          !limitedProteinIdsSet.has(edge.protein2)
        ) {
          continue;
        }
        if (existingEdgeIds.has(edge.edge)) {
          continue;
        }
        edges.push(edge);
        existingEdgeIds.add(edge.edge);
        remainingEdgeCapacity -= 1;
        if (remainingEdgeCapacity <= 0) break;
      }
    };

    if (remainingEdgeCapacity > 0) {
      if (preferExperimental) {
        const { data: intraExperimental, error: intraExperimentalErr } =
          await supabase
            .from("edges")
            .select(edgeSelect)
            .eq("positive_type", "experimental")
            .in("protein1", limitedProteinIds)
            .in("protein2", limitedProteinIds)
            .limit(remainingEdgeCapacity);

        if (intraExperimentalErr) {
          console.warn(
            "Experimental intra-subgraph edges query error:",
            intraExperimentalErr
          );
        }

        addEdges(intraExperimental as Edge[] | null | undefined);
      }

      if (remainingEdgeCapacity > 0) {
        const { data: intraPredicted, error: intraPredictedErr } =
          await supabase
            .from("edges")
            .select(edgeSelect)
            .gte("fusion_pred_prob", minProb)
            .in("protein1", limitedProteinIds)
            .in("protein2", limitedProteinIds)
            .order("fusion_pred_prob", { ascending: false })
            .limit(remainingEdgeCapacity);

        if (intraPredictedErr) {
          console.warn(
            "Predicted intra-subgraph edges query error:",
            intraPredictedErr
          );
        }

        addEdges(intraPredicted as Edge[] | null | undefined);
      }
    }

    if (edges.length >= maxEdges) {
      edgesTruncated = true;
      edges = edges.slice(0, maxEdges);
    }

    // Step 4: Query node details for all proteins
    const { data: nodesData, error: nodesErr } = await supabase
      .from("nodes")
      .select("*")
      .in("protein", limitedProteinIds);

    if (nodesErr) {
      console.error("Database error fetching nodes:", nodesErr);
      return res
        .status(500)
        .json({ error: "Failed to fetch nodes from database" });
    }

    // Step 5: Transform and mark nodes
    const queryProteinsSet = new Set(queryProteins);
    const nodes = (nodesData as Node[]).map((node) => ({
      ...transformNodeToResponse(node),
      isQuery: queryProteinsSet.has(node.protein),
    }));

    // Transform edges
    const edgesResp = edges.map(transformEdgeToResponse);

    // Build response with truncation metadata
    const response: SubgraphData = {
      query: queryProteins,
      nodes,
      edges: edgesResp,
    };

    const graphKey = buildGraphKey({
      namespace: "subgraph",
      nodeIds: nodes.map((node) => node.id),
      edgeIds: edgesResp.map((edge) => edge.id),
      params: {
        queryProteins,
        minProb,
        preferExperimental,
        maxEdges,
        maxNodes,
      },
    });

    let layout: LayoutPayload | undefined;
    try {
      const {
        data: layoutRows,
        error: layoutError,
      } = await supabase
        .from("graph_layout_cache")
        .select("graph_key,node_id,x,y,layout_version,updated_at")
        .eq("graph_key", graphKey)
        .eq("layout_version", CURRENT_LAYOUT_VERSION);

      if (layoutError) {
        console.warn("Layout cache lookup error (subgraph):", layoutError);
        layout = buildLayoutPayload(graphKey, [], nodes.length);
      } else if (Array.isArray(layoutRows) && layoutRows.length > 0) {
        const positions = mapLayoutRowsToPositions(
          layoutRows as LayoutCacheRecord[]
        );
        layout = buildLayoutPayload(graphKey, positions, nodes.length);
      } else {
        layout = buildLayoutPayload(graphKey, [], nodes.length);
      }

      if (layout.positions.length === nodes.length) {
        console.info(
          `[layout-cache] hit graph=${graphKey} nodes=${nodes.length} (subgraph)`
        );
      } else {
        console.info(
          `[layout-cache] miss graph=${graphKey} nodes=${nodes.length} (subgraph)`
        );
      }
    } catch (layoutException) {
      console.warn(
        "Unexpected layout cache error (subgraph):",
        layoutException
      );
      layout = buildLayoutPayload(graphKey, [], nodes.length);
    }

    response.layout = layout;

    // Add truncation metadata if applicable
    if (nodesTruncated || edgesTruncated) {
      response.truncated = {
        nodes: nodesTruncated,
        edges: edgesTruncated,
      };
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error("Unexpected error in /api/subgraph:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
