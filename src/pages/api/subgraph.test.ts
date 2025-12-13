/**
 * Unit tests for /api/subgraph endpoint
 * Tests subgraph fetching, filtering, and error handling
 */

import { createMocks } from "node-mocks-http";
import handler from "./subgraph";
import { supabase } from "@/lib/supabase";
import type { Edge, Node, SubgraphData } from "@/lib/types";

// Mock the Supabase client
jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

// Helper to setup Supabase mocks
function setupSupabaseMock(
  edgesData: Edge[] | null,
  nodesData: Node[] | null,
  edgesError: Error | null = null,
  nodesError: Error | null = null
) {
  const mockFrom = supabase.from as jest.Mock;
  mockFrom.mockImplementation((table: string) => {
    if (table === "edges") {
      const mockChain = {
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        limit: jest
          .fn()
          .mockResolvedValue({ data: edgesData, error: edgesError }),
        gte: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
      };
      return {
        select: jest.fn().mockReturnValue(mockChain),
      };
    }
    if (table === "nodes") {
      // Build mock data for identifier resolution (protein + gene_symbol)
      const identifierResolutionData = nodesData?.map((n) => ({
        protein: n.protein,
        gene_symbol: n.gene_symbol,
      })) ?? [];

      return {
        select: jest.fn().mockReturnValue({
          // For identifier resolution queries using .or()
          or: jest.fn().mockResolvedValue({
            data: identifierResolutionData,
            error: nodesError,
          }),
          // For regular node queries using .in()
          in: jest.fn().mockResolvedValue({
            data: nodesData,
            error: nodesError,
          }),
        }),
      };
    }
    return { select: jest.fn() };
  });
}

describe("/api/subgraph", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 405 for non-GET requests", async () => {
    const { req, res } = createMocks({ method: "POST" });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    const data = JSON.parse(res._getData());
    expect(data.error).toBe("Method not allowed");
  });

  it("should return 400 when proteins parameter is missing", async () => {
    const { req, res } = createMocks({
      method: "GET",
      query: {},
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.error).toContain("Missing required parameter: proteins");
  });

  it("should return 400 when proteins parameter is empty", async () => {
    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "" },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.error).toContain("Missing required parameter: proteins");
  });

  it("should return 400 when proteins parameter contains only whitespace/commas", async () => {
    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: " , , " },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.error).toContain("Invalid proteins parameter");
  });

  it("should return 404 when queried protein does not exist", async () => {
    setupSupabaseMock([], []);

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "NONEXISTENT" },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    const data = JSON.parse(res._getData());
    expect(data.error).toContain("None of the queried identifiers were found");
  });

  it("should return 200 with subgraph for single protein", async () => {
    const mockNodes = [
      {
        protein: "P12345",
        entry_name: "PROT1_HUMAN",
        description: "Query protein",
        gene_symbol: "GENE1",
        family: "TM",
        expression_tissue: "Brain",
      },
      {
        protein: "Q67890",
        entry_name: "PROT2_HUMAN",
        description: "Neighbor protein",
        gene_symbol: "GENE2",
        family: "TF",
        expression_tissue: "Kidney",
      },
    ];

    const mockEdges = [
      {
        edge: "P12345_Q67890",
        protein1: "P12345",
        protein2: "Q67890",
        fusion_pred_prob: 0.95,
        enriched_tissue: "Brain",
        tissue_enriched_confidence: "high confidence",
        positive_type: "experimental", gene_symbol1: null, gene_symbol2: null,
      },
    ];

    setupSupabaseMock(mockEdges, mockNodes);

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "P12345" },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data).toHaveProperty("query");
    expect(data).toHaveProperty("nodes");
    expect(data).toHaveProperty("edges");
    expect(data.query).toEqual(["P12345"]);
    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(1);
  });

  it("should return 200 with subgraph for multiple proteins", async () => {
    const mockNodes = [
      {
        protein: "P12345",
        entry_name: "PROT1_HUMAN",
        description: "Query protein 1",
        gene_symbol: "GENE1",
        family: "TM",
        expression_tissue: "Brain",
      },
      {
        protein: "Q67890",
        entry_name: "PROT2_HUMAN",
        description: "Query protein 2",
        gene_symbol: "GENE2",
        family: "TF",
        expression_tissue: "Kidney",
      },
      {
        protein: "R11111",
        entry_name: "PROT3_HUMAN",
        description: "Neighbor protein",
        gene_symbol: "GENE3",
        family: "TM",
        expression_tissue: "Liver",
      },
    ];

    const mockEdges = [
      {
        edge: "P12345_Q67890",
        protein1: "P12345",
        protein2: "Q67890",
        fusion_pred_prob: 0.95,
        enriched_tissue: "Brain",
        tissue_enriched_confidence: "high confidence",
        positive_type: "experimental", gene_symbol1: null, gene_symbol2: null,
      },
      {
        edge: "Q67890_R11111",
        protein1: "Q67890",
        protein2: "R11111",
        fusion_pred_prob: 0.88,
        enriched_tissue: "Kidney",
        tissue_enriched_confidence: "low confidence",
        positive_type: "prediction", gene_symbol1: null, gene_symbol2: null,
      },
    ];

    setupSupabaseMock(mockEdges, mockNodes);

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "P12345,Q67890" },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.query).toEqual(["P12345", "Q67890"]);
    expect(data.nodes).toHaveLength(3);
    expect(data.edges).toHaveLength(2);
  });

  it("should correctly mark queried nodes with isQuery: true", async () => {
    const mockNodes = [
      {
        protein: "P12345",
        entry_name: "PROT1_HUMAN",
        description: "Query protein",
        gene_symbol: "GENE1",
        family: "TM",
        expression_tissue: "Brain",
      },
      {
        protein: "Q67890",
        entry_name: "PROT2_HUMAN",
        description: "Neighbor protein",
        gene_symbol: "GENE2",
        family: "TF",
        expression_tissue: "Kidney",
      },
    ];

    const mockEdges = [
      {
        edge: "P12345_Q67890",
        protein1: "P12345",
        protein2: "Q67890",
        fusion_pred_prob: 0.95,
        enriched_tissue: "Brain",
        tissue_enriched_confidence: "high confidence",
        positive_type: "experimental", gene_symbol1: null, gene_symbol2: null,
      },
    ];

    setupSupabaseMock(mockEdges, mockNodes);

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "P12345" },
    });
    await handler(req, res);

    const data = JSON.parse(res._getData()) as SubgraphData;
    const queryNode = data.nodes.find((n) => n.id === "P12345");
    const neighborNode = data.nodes.find((n) => n.id === "Q67890");

    expect(queryNode.isQuery).toBe(true);
    expect(neighborNode.isQuery).toBe(false);
  });

  it("should handle case-insensitive protein IDs and return uppercase", async () => {
    const mockNodes = [
      {
        protein: "P12345",
        entry_name: "PROT1_HUMAN",
        description: "Query protein",
        gene_symbol: "GENE1",
        family: "TM",
        expression_tissue: "Brain",
      },
      {
        protein: "Q67890",
        entry_name: "PROT2_HUMAN",
        description: "Neighbor protein",
        gene_symbol: "GENE2",
        family: "TF",
        expression_tissue: "Kidney",
      },
    ];

    const mockEdges = [
      {
        edge: "P12345_Q67890",
        protein1: "P12345",
        protein2: "Q67890",
        fusion_pred_prob: 0.95,
        enriched_tissue: "Brain",
        tissue_enriched_confidence: "high confidence",
        positive_type: "experimental", gene_symbol1: null, gene_symbol2: null,
      },
    ];

    setupSupabaseMock(mockEdges, mockNodes);

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "p12345" }, // lowercase input
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.query).toEqual(["P12345"]); // uppercase output
  });

  it("should return 200 with single node and empty edges when protein has no interactions", async () => {
    const mockNodes = [
      {
        protein: "P12345",
        entry_name: "PROT1_HUMAN",
        description: "Isolated protein",
        gene_symbol: "GENE1",
        family: "TM",
        expression_tissue: "Brain",
      },
    ];

    // Setup mock: identifier resolution returns the protein, edges are empty, then full node data is fetched
    const mockFrom = supabase.from as jest.Mock;
    let nodesCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "edges") {
        const mockChain = {
          eq: jest.fn().mockReturnThis(),
          or: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
          gte: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
        };
        return {
          select: jest.fn().mockReturnValue(mockChain),
        };
      }
      if (table === "nodes") {
        return {
          select: jest.fn().mockReturnValue({
            // For identifier resolution (first call uses .or())
            or: jest.fn().mockResolvedValue({
              data: [{ protein: "P12345", gene_symbol: "GENE1" }],
              error: null,
            }),
            // For node data fetching (uses .in())
            in: jest.fn().mockResolvedValue({
              data:
                nodesCallCount++ === 0 ? [{ protein: "P12345" }] : mockNodes,
              error: null,
            }),
          }),
        };
      }
      return { select: jest.fn() };
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "P12345" },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0].isQuery).toBe(true);
    expect(data.edges).toHaveLength(0);
  });

  it("should handle database error when fetching edges", async () => {
    // Setup: identifier resolution succeeds, but edges fetch fails
    const mockFrom = supabase.from as jest.Mock;
    mockFrom.mockImplementation((table: string) => {
      if (table === "edges") {
        const mockChain = {
          eq: jest.fn().mockReturnThis(),
          or: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: null, error: new Error("Database connection failed") }),
          gte: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
        };
        return {
          select: jest.fn().mockReturnValue(mockChain),
        };
      }
      if (table === "nodes") {
        return {
          select: jest.fn().mockReturnValue({
            or: jest.fn().mockResolvedValue({
              data: [{ protein: "P12345", gene_symbol: "GENE1" }],
              error: null,
            }),
            in: jest.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        };
      }
      return { select: jest.fn() };
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "P12345" },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    const data = JSON.parse(res._getData());
    expect(data.error).toBe("Failed to fetch edges from database");
  });

  it("should handle database error when fetching nodes", async () => {
    // Setup: identifier resolution succeeds, edges return data, 
    // but the final node data fetch fails
    const mockEdges = [
      {
        edge: "P12345_Q67890",
        protein1: "P12345",
        protein2: "Q67890",
        fusion_pred_prob: 0.95,
        enriched_tissue: "Brain",
        tissue_enriched_confidence: "high confidence",
        positive_type: "experimental", gene_symbol1: null, gene_symbol2: null,
      },
    ];

    const mockFrom = supabase.from as jest.Mock;
    mockFrom.mockImplementation((table: string) => {
      if (table === "edges") {
        const mockChain = {
          eq: jest.fn().mockReturnThis(),
          or: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: mockEdges, error: null }),
          gte: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
        };
        return {
          select: jest.fn().mockReturnValue(mockChain),
        };
      }
      if (table === "nodes") {
        return {
          select: jest.fn().mockReturnValue({
            // Identifier resolution succeeds
            or: jest.fn().mockResolvedValue({
              data: [{ protein: "P12345", gene_symbol: "GENE1" }],
              error: null,
            }),
            // But node data fetch fails
            in: jest.fn().mockResolvedValue({
              data: null,
              error: new Error("Database connection failed"),
            }),
          }),
        };
      }
      return { select: jest.fn() };
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "P12345" },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    const data = JSON.parse(res._getData());
    expect(data.error).toBe("Failed to fetch nodes from database");
  });

  it("should transform snake_case to camelCase correctly", async () => {
    const mockNodes = [
      {
        protein: "P12345",
        entry_name: "PROT1_HUMAN",
        description: "Test protein",
        gene_symbol: "GENE1",
        family: "TM",
        expression_tissue: "Brain\\Kidney",
      },
      {
        protein: "Q67890",
        entry_name: "PROT2_HUMAN",
        description: "Neighbor protein",
        gene_symbol: "GENE2",
        family: "TF",
        expression_tissue: "Liver",
      },
    ];

    const mockEdges = [
      {
        edge: "P12345_Q67890",
        protein1: "P12345",
        protein2: "Q67890",
        fusion_pred_prob: 0.87,
        enriched_tissue: "Brain",
        tissue_enriched_confidence: "high confidence",
        positive_type: "prediction", gene_symbol1: null, gene_symbol2: null,
      },
    ];

    setupSupabaseMock(mockEdges, mockNodes);

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "P12345" },
    });
    await handler(req, res);

    const data = JSON.parse(res._getData());

    // Check node transformation
    expect(data.nodes[0]).toMatchObject({
      id: "P12345",
      label: "PROT1_HUMAN",
      geneSymbol: "GENE1",
      expressionTissue: ["Brain", "Kidney"],
    });

    // Check edge transformation
    expect(data.edges[0]).toMatchObject({
      id: "P12345_Q67890",
      source: "P12345",
      target: "Q67890",
      fusionPredProb: 0.87,
      enrichedTissue: "Brain",
      tissueEnrichedConfidence: "high confidence",
      positiveType: "prediction",
    });
  });

  it("should handle mixed case: some query proteins exist, some do not", async () => {
    const mockNodes = [
      {
        protein: "P12345",
        entry_name: "PROT1_HUMAN",
        description: "Existing protein",
        gene_symbol: "GENE1",
        family: "TM",
        expression_tissue: "Brain",
      },
      {
        protein: "Q67890",
        entry_name: "PROT2_HUMAN",
        description: "Neighbor protein",
        gene_symbol: "GENE2",
        family: "TF",
        expression_tissue: "Kidney",
      },
    ];

    const mockEdges = [
      {
        edge: "P12345_Q67890",
        protein1: "P12345",
        protein2: "Q67890",
        fusion_pred_prob: 0.95,
        enriched_tissue: "Brain",
        tissue_enriched_confidence: "high confidence",
        positive_type: "experimental", gene_symbol1: null, gene_symbol2: null,
      },
    ];

    setupSupabaseMock(mockEdges, mockNodes);

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "P12345,NONEXISTENT" },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    // Only the resolved protein ID is in the query (NONEXISTENT was not found)
    expect(data.query).toEqual(["P12345"]);
    expect(data.nodes.length).toBeGreaterThan(0);
  });
});
