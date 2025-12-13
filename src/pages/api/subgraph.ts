// API endpoint for fetching subgraph data (query proteins + 1-hop neighbors)
import type { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import type {
  Node,
  Edge,
  SubgraphData,
  LayoutPayload,
  LayoutCacheRecord,
  QueryProteinInfo,
} from "@/lib/types";
import {
  transformNodeToResponse,
  transformEdgeToResponse,
} from "@/lib/transforms";
import { layoutPayloadToPositionMap } from "@/lib/graphUtils";
import {
  buildGraphKey,
  CURRENT_LAYOUT_VERSION,
  buildLayoutPayload,
  mapLayoutRowsToPositions,
} from "@/lib/layoutCache";

/**
 * Resolution result for a single identifier
 */
interface IdentifierResolution {
  proteinId: string;
  wasGeneSymbolSearch: boolean;
}

/**
 * Resolves identifiers (UniProt IDs or gene symbols) to UniProt protein IDs.
 * Returns a mapping from original identifier to resolved protein ID with metadata.
 */
async function resolveIdentifiersToProteins(
  identifiers: string[]
): Promise<{
  resolved: Map<string, IdentifierResolution>;
  notFound: string[];
}> {
  const resolved = new Map<string, IdentifierResolution>();
  const notFound: string[] = [];

  if (identifiers.length === 0) {
    return { resolved, notFound };
  }

  // Query nodes table to find matches by protein (UniProt ID) or gene_symbol
  const { data: nodes, error } = await supabase
    .from("nodes")
    .select("protein, gene_symbol")
    .or(
      identifiers
        .map((id) => `protein.eq.${id},gene_symbol.eq.${id}`)
        .join(",")
    );

  if (error) {
    console.error("Error resolving identifiers:", error);
    return { resolved, notFound: identifiers };
  }

  // Build lookup maps for fast resolution
  const proteinSet = new Set<string>();
  const geneSymbolToProtein = new Map<string, string>();

  for (const node of nodes ?? []) {
    if (node.protein) {
      proteinSet.add(node.protein.toUpperCase());
      if (node.gene_symbol) {
        geneSymbolToProtein.set(node.gene_symbol.toUpperCase(), node.protein);
      }
    }
  }

  // Resolve each identifier
  for (const id of identifiers) {
    const upperCaseId = id.toUpperCase();
    if (proteinSet.has(upperCaseId)) {
      // Direct UniProt ID match
      resolved.set(id, { proteinId: upperCaseId, wasGeneSymbolSearch: false });
    } else if (geneSymbolToProtein.has(upperCaseId)) {
      // Gene symbol match - map to protein ID
      resolved.set(id, {
        proteinId: geneSymbolToProtein.get(upperCaseId)!,
        wasGeneSymbolSearch: true,
      });
    } else {
      notFound.push(id);
    }
  }

  return { resolved, notFound };
}


/**
 * GET /api/subgraph?proteins=P12345,Q67890
 * Returns subgraph containing query proteins and their 1-hop neighbors
 *
 * Query Parameters:
 * - proteins (required): Comma-separated list of UniProt accessions or gene symbols
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

    // Parse query identifiers (case-insensitive, convert to uppercase)
    const queryIdentifiers = proteinsParam
      .split(",")
      .map((p) => p.trim().toUpperCase())
      .filter((p) => p.length > 0);

    if (queryIdentifiers.length === 0) {
      return res.status(400).json({
        error:
          "Invalid proteins parameter: must contain at least one protein ID or gene symbol",
      });
    }

    // Resolve identifiers to UniProt protein IDs
    const { resolved, notFound } = await resolveIdentifiersToProteins(queryIdentifiers);

    if (resolved.size === 0) {
      return res.status(404).json({
        error: `None of the queried identifiers were found in the dataset: ${notFound.join(", ")}`,
      });
    }

    // Log any identifiers that weren't found
    if (notFound.length > 0) {
      console.warn(`Some identifiers not found: ${notFound.join(", ")}`);
    }

    // Get unique resolved protein IDs and store search metadata
    const searchedIdentifiers = Array.from(resolved.keys());
    const queryProteins = Array.from(
      new Set(Array.from(resolved.values()).map((r) => r.proteinId))
    );

    // Parse filtering parameters (same defaults as network endpoint)
    const minProb = parseFloat((req.query.minProb as string) || "0.8");
    const preferExperimental =
      (req.query.preferExperimental as string) !== "false";
    const maxEdges = Math.min(
      parseInt((req.query.maxEdges as string) || "100000", 10),
      500000 // Hard cap
    );
    const maxNodes = Math.min(
      parseInt((req.query.maxNodes as string) || "10000", 10),
      50000 // Hard cap
    );

    const edgeSelect =
      "edge,protein1,protein2,fusion_pred_prob,enriched_tissue,tissue_enriched_confidence,positive_type,gene_symbol1,gene_symbol2";

    // Helper to chunk arrays for batching queries
    const chunkArray = <T>(arr: T[], size: number): T[][] => {
      const chunks: T[][] = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    };
    const BATCH_SIZE = 200;

    // Determine search mode: single protein vs multiple proteins
    // Single protein: show protein + 1-hop neighbors (star topology)
    // Multiple proteins: only show searched proteins and edges between them
    const isSingleProteinSearch = queryProteins.length === 1;

    // Step 1: Query edges based on search mode
    let edges: Edge[] = [];
    let edgesTruncated = false;

    if (isSingleProteinSearch) {
      // Single protein search: Get all edges connected to the query protein (1-hop neighbors)
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
    } else {
      // Multiple proteins search: Only get edges that connect query proteins to each other
      // Both endpoints must be in queryProteins

      if (preferExperimental) {
        // First, get experimental edges connecting query proteins
        const { data: expEdges, error: expErr } = await supabase
          .from("edges")
          .select(edgeSelect)
          .eq("positive_type", "experimental")
          .in("protein1", queryProteins)
          .in("protein2", queryProteins)
          .limit(maxEdges);

        if (expErr) {
          console.error("Database error fetching experimental edges:", expErr);
          return res
            .status(500)
            .json({ error: "Failed to fetch edges from database" });
        }
        edges = (expEdges ?? []) as Edge[];
      }

      // Add high-probability predicted edges between query proteins
      const remaining = Math.max(0, maxEdges - edges.length);
      if (remaining > 0) {
        const { data: predEdges, error: predErr } = await supabase
          .from("edges")
          .select(edgeSelect)
          .gte("fusion_pred_prob", minProb)
          .in("protein1", queryProteins)
          .in("protein2", queryProteins)
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

      // Build query protein info for the response
      const queryProteinsInfo: QueryProteinInfo[] = searchedIdentifiers.map((id) => {
        const resolution = resolved.get(id)!;
        const nodeData = nodes.find((n) => n.id === resolution.proteinId);
        return {
          searchedTerm: id,
          proteinId: resolution.proteinId,
          geneSymbol: nodeData?.geneSymbol ?? "",
          entryName: nodeData?.entryName ?? "",
          description: nodeData?.description ?? "",
          wasGeneSymbolSearch: resolution.wasGeneSymbolSearch,
        };
      });

      return res.status(200).json({
        query: queryProteins,
        searchedIdentifiers,
        queryProteins: queryProteinsInfo,
        nodes,
        edges: [],
      });
    }

    // Step 3: Determine which nodes to include based on search mode
    let nodesTruncated = false;
    let limitedProteinIds: string[];

    if (isSingleProteinSearch) {
      // Single protein search: Extract all unique protein IDs from edges (query + neighbors)
      const proteinIdsSet = new Set<string>(queryProteins);
      edges.forEach((edge) => {
        proteinIdsSet.add(edge.protein1);
        proteinIdsSet.add(edge.protein2);
      });
      const allProteinIds = Array.from(proteinIdsSet);

      // Apply maxNodes limit
      limitedProteinIds = allProteinIds;
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
    } else {
      // Multiple proteins search: Only include query proteins as nodes
      // Edges are already filtered to only connect query proteins
      limitedProteinIds = queryProteins;
    }

    // Step 3b: Fetch additional edges where both endpoints are within the limited node set
    // Skipped to show "star-like" topology where only edges connected to query nodes are shown.
    /*
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
        const chunks = chunkArray(limitedProteinIds, BATCH_SIZE);
        const experimentalPromises = chunks.map((chunk) =>
          supabase
            .from("edges")
            .select(edgeSelect)
            .eq("positive_type", "experimental")
            .in("protein1", chunk)
            // We omit .in("protein2", limitedProteinIds) to avoid URL overflow
            // We will filter the results in memory.
            .limit(remainingEdgeCapacity) 
        );

        const experimentalResults = await Promise.all(experimentalPromises);
        
        // Flatten and process results
        let allExperimentalEdges: Edge[] = [];
        for (const { data, error } of experimentalResults) {
            if (error) {
                console.warn("Experimental intra-subgraph batch error:", error);
                continue;
            }
            if (data) {
                allExperimentalEdges = allExperimentalEdges.concat(data as Edge[]);
            }
        }
        // Now filter for P2 in limitedProteinIds
        const validExperimental = allExperimentalEdges.filter(e => limitedProteinIdsSet.has(e.protein2));
        addEdges(validExperimental);
      }

      if (remainingEdgeCapacity > 0) {
         // Same strategy for predicted edges
         const chunks = chunkArray(limitedProteinIds, BATCH_SIZE);
         const predictedPromises = chunks.map((chunk) =>
          supabase
            .from("edges")
            .select(edgeSelect)
            .gte("fusion_pred_prob", minProb)
            .in("protein1", chunk)
            .order("fusion_pred_prob", { ascending: false })
            .limit(remainingEdgeCapacity)
        );

        const predictedResults = await Promise.all(predictedPromises);
        
        let allPredictedEdges: Edge[] = [];
        for (const { data, error } of predictedResults) {
            if (error) {
                console.warn("Predicted intra-subgraph batch error:", error);
                continue;
            }
            if (data) {
                allPredictedEdges = allPredictedEdges.concat(data as Edge[]);
            }
        }
        const validPredicted = allPredictedEdges.filter(e => limitedProteinIdsSet.has(e.protein2));
        addEdges(validPredicted);
      }
    }
    */

    if (edges.length >= maxEdges) {
      edgesTruncated = true;
      edges = edges.slice(0, maxEdges);
    }

    // Step 4: Query node details for all proteins (Batched)
    const nodeChunks = chunkArray(limitedProteinIds, BATCH_SIZE);
    const nodePromises = nodeChunks.map((chunk) =>
      supabase.from("nodes").select("*").in("protein", chunk)
    );

    const nodeResults = await Promise.all(nodePromises);
    let nodesData: Node[] = [];

    for (const { data, error } of nodeResults) {
      if (error) {
        console.error("Database error fetching nodes batch:", error);
        return res
          .status(500)
          .json({ error: "Failed to fetch nodes from database" });
      }
      if (data) {
        nodesData = nodesData.concat(data as Node[]);
      }
    }

    // Step 5: Transform and mark nodes
    const queryProteinsSet = new Set(queryProteins);
    const nodeResponses = (nodesData as Node[]).map((node) => ({
      ...transformNodeToResponse(node),
      isQuery: queryProteinsSet.has(node.protein),
    }));

    // Sort nodes so that query proteins are at the top of the array
    nodeResponses.sort((a, b) => {
      if (a.isQuery && !b.isQuery) return -1;
      if (!a.isQuery && b.isQuery) return 1;
      return 0;
    });

    // Transform edges
    const edgesResp = edges.map(transformEdgeToResponse);

    // Build query protein info for the response
    const queryProteinsInfo: QueryProteinInfo[] = searchedIdentifiers.map((id) => {
      const resolution = resolved.get(id)!;
      const nodeData = nodeResponses.find((n) => n.id === resolution.proteinId);
      return {
        searchedTerm: id,
        proteinId: resolution.proteinId,
        geneSymbol: nodeData?.geneSymbol ?? "",
        entryName: nodeData?.entryName ?? "",
        description: nodeData?.description ?? "",
        wasGeneSymbolSearch: resolution.wasGeneSymbolSearch,
      };
    });

    // Build response with truncation metadata
    const response: SubgraphData = {
      query: queryProteins,
      searchedIdentifiers,
      queryProteins: queryProteinsInfo,
      nodes: nodeResponses,
      edges: edgesResp,
    };

    const graphKey = buildGraphKey({
      namespace: "subgraph",
      nodeIds: nodeResponses.map((node) => node.id),
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
        layout = buildLayoutPayload(graphKey, [], nodeResponses.length);
      } else if (Array.isArray(layoutRows) && layoutRows.length > 0) {
        const positions = mapLayoutRowsToPositions(
          layoutRows as LayoutCacheRecord[]
        );
        layout = buildLayoutPayload(graphKey, positions, nodeResponses.length);
      } else {
        layout = buildLayoutPayload(graphKey, [], nodeResponses.length);
      }

      if (layout.positions.length === nodeResponses.length) {
        console.info(
          `[layout-cache] hit graph=${graphKey} nodes=${nodeResponses.length} (subgraph)`
        );
      } else {
        console.info(
          `[layout-cache] miss graph=${graphKey} nodes=${nodeResponses.length} (subgraph)`
        );
      }
    } catch (layoutException) {
      console.warn(
        "Unexpected layout cache error (subgraph):",
        layoutException
      );
      layout = buildLayoutPayload(graphKey, [], nodeResponses.length);
    }

    const layoutPositionMap = layoutPayloadToPositionMap(layout);
    if (layoutPositionMap) {
      response.nodes = nodeResponses.map((node) =>
        layoutPositionMap[node.id]
          ? {
            ...node,
            position: layoutPositionMap[node.id],
          }
          : node
      );
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
