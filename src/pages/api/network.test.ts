/**
 * Unit tests for /api/network endpoint
 * Tests data fetching, transformation, and error handling
 */

import { createMocks } from "node-mocks-http";
import handler from "./network";
import { supabase } from "@/lib/supabase";
import type { Edge, Node } from "@/lib/types";

// Mock the Supabase client
jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

type NodesMockConfig = {
  data?: Node[] | null;
  error?: Error | null;
  count?: number;
};

type EdgesMockConfig = {
  totalCount?: number;
  totalCountError?: Error | null;
  experimentalEdges?: Edge[] | null;
  experimentalError?: Error | null;
  experimentalCount?: number;
  experimentalCountError?: Error | null;
  predictionEdges?: Edge[] | null;
  predictionError?: Error | null;
  predictionCount?: number;
  predictionCountError?: Error | null;
};

type SupabaseMockState = {
  nodes: NodesMockConfig;
  edges: EdgesMockConfig;
};

let currentState: SupabaseMockState = {
  nodes: { data: [], error: null, count: 0 },
  edges: {
    totalCount: undefined,
    totalCountError: null,
    experimentalEdges: [],
    experimentalError: null,
    experimentalCount: undefined,
    experimentalCountError: null,
    predictionEdges: [],
    predictionError: null,
    predictionCount: undefined,
    predictionCountError: null,
  },
};

class MockEdgeCountBuilder {
  private positiveType: "experiment" | "prediction" | null = null;
  private minProb = 0;
  private nodeIds: string[] | null = null;

  constructor(private readonly edgesState: EdgesMockConfig) {}

  eq(column: string, value: string) {
    if (column === "positive_type") {
      const normalized = value === "experimental" ? "experiment" : value;
      if (normalized === "experiment" || normalized === "prediction") {
        this.positiveType = normalized;
      }
    }
    return this;
  }

  ilike(column: string, value: string) {
    if (column === "positive_type") {
      if (value.includes("experiment")) {
        this.positiveType = "experiment";
      } else if (value.includes("prediction")) {
        this.positiveType = "prediction";
      }
    }
    return this;
  }

  gte(column: string, value: number) {
    if (column === "fusion_pred_prob") {
      this.minProb = value;
    }
    return this;
  }

  in(column: string, values: string[] | string) {
    if (column === "protein1" || column === "protein2") {
      const toArray = Array.isArray(values) ? values : values.split(",");
      this.nodeIds = toArray as string[];
    }
    return this;
  }

  private buildResult() {
    const filterByNodes = (edges: Edge[] | null | undefined) => {
      if (!this.nodeIds || !edges) return edges ?? [];
      const nodeSet = new Set(this.nodeIds);
      return edges.filter(
        (edge) => nodeSet.has(edge.protein1) && nodeSet.has(edge.protein2)
      );
    };

    const mergeUniqueEdges = (...groups: Array<Edge[] | null | undefined>) => {
      const byId = new Map<string, Edge>();
      groups
        .flat()
        .filter(Boolean)
        .forEach((edge) => {
          byId.set((edge as Edge).edge, edge as Edge);
        });
      return Array.from(byId.values());
    };

    if (this.positiveType === "experiment") {
      const edges = filterByNodes(this.edgesState.experimentalEdges);
      const count =
        this.nodeIds == null && this.edgesState.experimentalCount !== undefined
          ? this.edgesState.experimentalCount
          : edges.length;
      return {
        data: null,
        error: this.edgesState.experimentalCountError ?? null,
        count,
      };
    }

    if (this.positiveType === "prediction") {
      const filtered = filterByNodes(this.edgesState.predictionEdges).filter(
        (edge) => {
          const prob = edge.fusion_pred_prob ?? 0;
          return prob >= this.minProb;
        }
      );
      const count =
        this.nodeIds == null && this.edgesState.predictionCount !== undefined
          ? this.edgesState.predictionCount
          : filtered.length;
      return {
        data: null,
        error: this.edgesState.predictionCountError ?? null,
        count,
      };
    }

    const combined = mergeUniqueEdges(
      filterByNodes(this.edgesState.experimentalEdges),
      filterByNodes(
        (this.edgesState.predictionEdges ?? []).filter((edge) => {
          const prob = edge.fusion_pred_prob ?? 0;
          return prob >= this.minProb;
        })
      )
    );
    const total =
      this.nodeIds == null && this.edgesState.totalCount !== undefined
        ? this.edgesState.totalCount
        : combined.length;
    return {
      data: null,
      error: this.edgesState.totalCountError ?? null,
      count: total,
    };
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: null;
          error: Error | null;
          count: number;
        }) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): Promise<TResult1 | TResult2> {
    try {
      const result = this.buildResult();
      return Promise.resolve(result).then(onfulfilled, onrejected);
    } catch (error) {
      if (onrejected) {
        return Promise.reject(error).catch(onrejected);
      }
      return Promise.reject(error);
    }
  }

  catch<TResult = never>(
    onrejected?:
      | ((reason: unknown) => TResult | PromiseLike<TResult>)
      | undefined
      | null
  ): Promise<{ data: null; error: Error | null; count: number } | TResult> {
    return this.then(undefined, onrejected);
  }
}

class MockEdgeDataBuilder {
  private positiveType: "experiment" | "prediction" | null = null;
  private minProb = 0;
  private limitValue: number | null = null;
  private nodeIds: string[] | null = null;
  private useRange = false;
  private rangeStart = 0;
  private rangeEnd = Number.MAX_SAFE_INTEGER;

  constructor(private readonly edgesState: EdgesMockConfig) {}

  eq(column: string, value: string) {
    if (column === "positive_type") {
      const normalized = value === "experimental" ? "experiment" : value;
      if (normalized === "experiment" || normalized === "prediction") {
        this.positiveType = normalized;
      }
    }
    return this;
  }

  ilike(column: string, value: string) {
    if (column === "positive_type") {
      if (value.includes("experiment")) {
        this.positiveType = "experiment";
      } else if (value.includes("prediction")) {
        this.positiveType = "prediction";
      }
    }
    return this;
  }

  gte(column: string, value: number) {
    if (column === "fusion_pred_prob") {
      this.minProb = value;
    }
    return this;
  }

  order() {
    return this;
  }

  in(column: string, values: string[] | string) {
    if (column === "protein1" || column === "protein2") {
      const toArray = Array.isArray(values) ? values : values.split(",");
      this.nodeIds = toArray as string[];
    }
    return this;
  }

  private filterEdges(edges: Edge[] | null | undefined): Edge[] {
    if (!edges) return [];
    const probFiltered = edges.filter((edge) => {
      const prob = edge.fusion_pred_prob ?? 0;
      return this.positiveType === "prediction" ? prob >= this.minProb : true;
    });
    if (!this.nodeIds) return probFiltered;
    const nodeSet = new Set(this.nodeIds);
    return probFiltered.filter(
      (edge) => nodeSet.has(edge.protein1) && nodeSet.has(edge.protein2)
    );
  }

  private getEdges(): Edge[] {
    if (this.positiveType === "experiment") {
      return this.filterEdges(this.edgesState.experimentalEdges);
    }
    if (this.positiveType === "prediction") {
      return this.filterEdges(this.edgesState.predictionEdges);
    }
    const byId = new Map<string, Edge>();
    [
      ...this.filterEdges(this.edgesState.experimentalEdges),
      ...this.filterEdges(this.edgesState.predictionEdges),
    ].forEach((edge) => {
      byId.set(edge.edge, edge);
    });
    return Array.from(byId.values());
  }

  private buildResult() {
    const edges = this.getEdges();
    const start = this.useRange ? this.rangeStart : 0;
    const end = this.useRange
      ? this.rangeEnd + 1
      : this.limitValue ?? Number.MAX_SAFE_INTEGER;
    const slice = edges.slice(start, Math.min(end, edges.length));

    let error: Error | null = null;
    if (this.positiveType === "experiment") {
      error = this.edgesState.experimentalError ?? null;
    } else if (this.positiveType === "prediction") {
      error = this.edgesState.predictionError ?? null;
    }

    return {
      data: slice,
      error,
    };
  }

  limit(value: number) {
    this.limitValue = value;
    this.useRange = false;
    return Promise.resolve(this.buildResult());
  }

  range(start: number, end: number) {
    this.useRange = true;
    this.rangeStart = start;
    this.rangeEnd = end;
    return Promise.resolve(this.buildResult());
  }
}

class TableMock {
  constructor(
    private readonly table: string,
    private readonly state: SupabaseMockState
  ) {}

  select(columns: string, options?: { count?: "exact"; head?: boolean }) {
    if (this.table === "nodes") {
      const nodesState = this.state.nodes;
      const data = nodesState.data ?? null;
      const error = nodesState.error ?? null;
      const count = nodesState.count ?? (data ? data.length : 0);
      return Promise.resolve({ data, error, count });
    }

    if (this.table === "edges") {
      if (options?.head) {
        return new MockEdgeCountBuilder(this.state.edges);
      }
      return new MockEdgeDataBuilder(this.state.edges);
    }

    return Promise.resolve({ data: null, error: null });
  }
}

const setupSupabaseMock = (config: Partial<SupabaseMockState>) => {
  currentState = {
    nodes: {
      data: [],
      error: null,
      count: undefined,
      ...config.nodes,
    },
    edges: {
      totalCount: 0,
      totalCountError: null,
      experimentalEdges: [],
      experimentalError: null,
      experimentalCount: undefined,
      experimentalCountError: null,
      predictionEdges: [],
      predictionError: null,
      predictionCount: undefined,
      predictionCountError: null,
      ...config.edges,
    },
  };

  const mockFrom = supabase.from as jest.Mock;
  mockFrom.mockImplementation(
    (table: string) => new TableMock(table, currentState)
  );
};

describe("/api/network", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 200 with nodes and edges arrays", async () => {
    const mockNodes: Node[] = [
      {
        protein: "P12345",
        entry_name: "PROT1_HUMAN",
        description: "Test protein 1",
        gene_symbol: "GENE1 ALIAS1",
        family: "TM",
        expression_tissue: "Brain\\Kidney\\Liver",
      },
      {
        protein: "Q67890",
        entry_name: "PROT2_HUMAN",
        description: "Test protein 2",
        gene_symbol: "GENE2",
        family: "TF",
        expression_tissue: "Brain",
      },
    ];

    const mockEdges: Edge[] = [
      {
        edge: "P12345_Q67890",
        protein1: "P12345",
        protein2: "Q67890",
        fusion_pred_prob: 0.95,
        enriched_tissue: "Brain",
        tissue_enriched_confidence: "high confidence",
        positive_type: "experiment",
        gene_symbol1: null,
        gene_symbol2: null,
      },
    ];

    setupSupabaseMock({
      nodes: {
        data: mockNodes,
        count: mockNodes.length,
      },
      edges: {
        totalCount: 100,
        experimentalEdges: mockEdges,
        experimentalCount: mockEdges.length,
      },
    });

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data).toHaveProperty("nodes");
    expect(data).toHaveProperty("edges");
    expect(data).toHaveProperty("meta");
    expect(data.meta).toMatchObject({
      totalNodes: mockNodes.length,
      totalEdges: 100,
      filteredEdges: mockEdges.length,
    });
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.edges)).toBe(true);
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
    ];

    const mockEdges = [
      {
        edge: "P12345_Q67890",
        protein1: "P12345",
        protein2: "Q67890",
        fusion_pred_prob: 0.85,
        enriched_tissue: "Brain",
        tissue_enriched_confidence: "high confidence",
        positive_type: "experiment",
        gene_symbol1: null,
        gene_symbol2: null,
      },
    ];

    setupSupabaseMock({
      nodes: {
        data: mockNodes,
      },
      edges: {
        experimentalEdges: mockEdges,
      },
    });

    const { req, res } = createMocks({ method: "GET" });
    await handler(req, res);

    const data = JSON.parse(res._getData());

    // Check node transformation
    expect(data.nodes[0]).toMatchObject({
      id: "P12345",
      label: "PROT1_HUMAN",
      geneSymbol: "GENE1",
    });

    // Check edge transformation
    expect(data.edges[0]).toMatchObject({
      id: "P12345_Q67890",
      source: "P12345",
      target: "Q67890",
      fusionPredProb: 0.85,
      enrichedTissue: "Brain",
      tissueEnrichedConfidence: "high confidence",
      positiveType: "experiment",
    });
  });

  it("should parse tissue arrays correctly", async () => {
    const mockNodes = [
      {
        protein: "P12345",
        entry_name: "PROT1_HUMAN",
        description: "Test protein",
        gene_symbol: "GENE1",
        family: "TM",
        expression_tissue: "Brain\\Kidney\\Liver",
      },
    ];

    setupSupabaseMock({
      nodes: {
        data: mockNodes,
      },
      edges: {
        experimentalEdges: [],
        predictionEdges: [],
      },
    });

    const { req, res } = createMocks({ method: "GET" });
    await handler(req, res);

    const data = JSON.parse(res._getData());
    expect(data.nodes[0].expressionTissue).toEqual([
      "Brain",
      "Kidney",
      "Liver",
    ]);
  });

  it("should handle NA tissue values as empty array", async () => {
    const mockNodes = [
      {
        protein: "P12345",
        entry_name: "PROT1_HUMAN",
        description: "Test protein",
        gene_symbol: "GENE1",
        family: "TM",
        expression_tissue: "NA",
      },
    ];

    setupSupabaseMock({
      nodes: {
        data: mockNodes,
      },
      edges: {
        experimentalEdges: [],
        predictionEdges: [],
      },
    });

    const { req, res } = createMocks({ method: "GET" });
    await handler(req, res);

    const data = JSON.parse(res._getData());
    expect(data.nodes[0].expressionTissue).toEqual([]);
  });

  it("should return 500 on database error when fetching nodes", async () => {
    const mockNodes = [
      {
        protein: "P12345",
        entry_name: "PROT1_HUMAN",
        description: "Test protein",
        gene_symbol: "GENE1",
        family: "TM",
        expression_tissue: "Brain",
      },
    ];

    setupSupabaseMock({
      nodes: {
        data: mockNodes,
        error: new Error("Database connection failed"),
      },
    });

    const { req, res } = createMocks({ method: "GET" });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    const data = JSON.parse(res._getData());
    expect(data).toHaveProperty("error");
    expect(data.error).toBe("Failed to fetch nodes from database");
  });

  it("should return 500 on database error when fetching edges", async () => {
    const mockNodes = [
      {
        protein: "P12345",
        entry_name: "PROT1_HUMAN",
        description: "Test protein",
        gene_symbol: "GENE1",
        family: "TM",
        expression_tissue: "Brain",
      },
    ];

    setupSupabaseMock({
      nodes: {
        data: mockNodes,
      },
      edges: {
        totalCount: 1,
        experimentalCount: 1,
        experimentalEdges: null,
        experimentalError: new Error("Database connection failed"),
      },
    });

    const { req, res } = createMocks({ method: "GET" });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    const data = JSON.parse(res._getData());
    expect(data).toHaveProperty("error");
    expect(data.error).toBe("Internal server error");
  });

  it("should handle null values in node fields gracefully", async () => {
    const mockNodes = [
      {
        protein: "P12345",
        entry_name: null,
        description: null,
        gene_symbol: null,
        family: null,
        expression_tissue: null,
      },
    ];

    setupSupabaseMock({
      nodes: {
        data: mockNodes,
      },
      edges: {
        experimentalEdges: [],
        predictionEdges: [],
      },
    });

    const { req, res } = createMocks({ method: "GET" });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.nodes[0]).toMatchObject({
      id: "P12345",
      label: "P12345", // Falls back to protein ID when entry_name is null
      description: "",
      geneSymbol: "",
      family: "",
      expressionTissue: [],
    });
  });

  it("should return 405 for non-GET requests", async () => {
    const { req, res } = createMocks({ method: "POST" });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    const data = JSON.parse(res._getData());
    expect(data.error).toBe("Method not allowed");
  });

  it("returns both experimental and prediction edges when no positiveType is provided", async () => {
    const mockNodes: Node[] = [
      {
        protein: "P00001",
        entry_name: "NODE1",
        description: null,
        gene_symbol: null,
        family: null,
        expression_tissue: null,
      },
    ];

    const experimentalEdge: Edge = {
      edge: "EXP1",
      protein1: "P00001",
      protein2: "P00001",
      fusion_pred_prob: 0.1,
      enriched_tissue: null,
      tissue_enriched_confidence: null,
      positive_type: "experiment",
      gene_symbol1: null,
      gene_symbol2: null,
    };

    const predictionEdge: Edge = {
      edge: "PRED1",
      protein1: "P00001",
      protein2: "P00001",
      fusion_pred_prob: 0.95,
      enriched_tissue: null,
      tissue_enriched_confidence: null,
      positive_type: "prediction",
      gene_symbol1: null,
      gene_symbol2: null,
    };

    setupSupabaseMock({
      nodes: { data: mockNodes, count: mockNodes.length },
      edges: {
        totalCount: 2,
        experimentalEdges: [experimentalEdge],
        experimentalCount: 1,
        predictionEdges: [predictionEdge],
        predictionCount: 1,
      },
    });

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.edges).toHaveLength(2);
    expect(data.edges.map((edge: { id: string }) => edge.id).sort()).toEqual([
      "EXP1",
      "PRED1",
    ]);
    expect(data.meta.filteredEdges).toBe(2);
  });

  it("does not cap returned edges when maxEdges is omitted", async () => {
    const mockNodes: Node[] = [
      {
        protein: "P00001",
        entry_name: "NODE1",
        description: null,
        gene_symbol: null,
        family: null,
        expression_tissue: null,
      },
    ];

    const experimentalEdges: Edge[] = Array.from(
      { length: 50001 },
      (_, index) => ({
        edge: `EXP${index + 1}`,
        protein1: "P00001",
        protein2: "P00001",
        fusion_pred_prob: 0.9,
        enriched_tissue: null,
        tissue_enriched_confidence: null,
        positive_type: "experiment",
        gene_symbol1: null,
        gene_symbol2: null,
      })
    );

    setupSupabaseMock({
      nodes: { data: mockNodes, count: mockNodes.length },
      edges: {
        totalCount: experimentalEdges.length,
        experimentalEdges,
        experimentalCount: experimentalEdges.length,
      },
    });

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.edges).toHaveLength(50001);
    expect(data.meta.filteredEdges).toBe(50001);
    expect(data.meta.totalEdges).toBe(50001);
  });

  it("clamps maxEdges and reports filteredEdges", async () => {
    const mockNodes: Node[] = [
      {
        protein: "P00001",
        entry_name: "NODE1",
        description: null,
        gene_symbol: null,
        family: null,
        expression_tissue: null,
      },
    ];

    const experimentalEdges: Edge[] = [
      {
        edge: "E1",
        protein1: "P00001",
        protein2: "P00001",
        fusion_pred_prob: 0.9,
        enriched_tissue: null,
        tissue_enriched_confidence: null,
        positive_type: "experiment",
        gene_symbol1: null,
        gene_symbol2: null,
      },
      {
        edge: "E2",
        protein1: "P00001",
        protein2: "P00001",
        fusion_pred_prob: 0.8,
        enriched_tissue: null,
        tissue_enriched_confidence: null,
        positive_type: "experiment",
        gene_symbol1: null,
        gene_symbol2: null,
      },
    ];

    setupSupabaseMock({
      nodes: { data: mockNodes, count: mockNodes.length },
      edges: {
        totalCount: experimentalEdges.length,
        experimentalEdges,
        experimentalCount: experimentalEdges.length,
      },
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { maxEdges: "1" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.edges).toHaveLength(1);
    expect(data.meta.filteredEdges).toBe(1);
    expect(res.getHeader("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300"
    );
  });

  it("filters edges by positiveType=prediction", async () => {
    const mockNodes: Node[] = [
      {
        protein: "P00001",
        entry_name: "NODE1",
        description: null,
        gene_symbol: null,
        family: null,
        expression_tissue: null,
      },
    ];

    const experimentalEdges: Edge[] = [
      {
        edge: "EXP1",
        protein1: "P00001",
        protein2: "P00001",
        fusion_pred_prob: 0.1,
        enriched_tissue: null,
        tissue_enriched_confidence: null,
        positive_type: "experiment",
        gene_symbol1: null,
        gene_symbol2: null,
      },
    ];

    const predictionEdges: Edge[] = [
      {
        edge: "PRED1",
        protein1: "P00001",
        protein2: "P00001",
        fusion_pred_prob: 0.95,
        enriched_tissue: null,
        tissue_enriched_confidence: null,
        positive_type: "prediction",
        gene_symbol1: null,
        gene_symbol2: null,
      },
    ];

    setupSupabaseMock({
      nodes: { data: mockNodes },
      edges: {
        totalCount: experimentalEdges.length + predictionEdges.length,
        experimentalEdges,
        experimentalCount: experimentalEdges.length,
        predictionEdges,
        predictionCount: predictionEdges.length,
      },
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { positiveType: "prediction" },
    });

    await handler(req, res);

    const data = JSON.parse(res._getData());
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].positiveType).toBe("prediction");
    expect(data.meta.filteredEdges).toBe(1);
  });

  it("returns cytoscape elements when format=cyto", async () => {
    const mockNodes: Node[] = [
      {
        protein: "P00001",
        entry_name: "NODE1",
        description: null,
        gene_symbol: null,
        family: null,
        expression_tissue: null,
      },
    ];

    const predictionEdges: Edge[] = [
      {
        edge: "PRED1",
        protein1: "P00001",
        protein2: "P00001",
        fusion_pred_prob: 0.95,
        enriched_tissue: null,
        tissue_enriched_confidence: null,
        positive_type: "prediction",
        gene_symbol1: null,
        gene_symbol2: null,
      },
    ];

    setupSupabaseMock({
      nodes: { data: mockNodes, count: mockNodes.length },
      edges: {
        totalCount: predictionEdges.length,
        predictionEdges,
        predictionCount: predictionEdges.length,
      },
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { format: "cyto", positiveType: "prediction" },
    });

    await handler(req, res);

    const data = JSON.parse(res._getData());
    expect(Array.isArray(data.elements)).toBe(true);
    expect(data.elements).toHaveLength(2); // one node + one edge
    expect(data.meta.totalNodes).toBe(mockNodes.length);
  });

  it("returns zero filteredEdges when edges=false", async () => {
    const mockNodes: Node[] = [
      {
        protein: "P00001",
        entry_name: "NODE1",
        description: null,
        gene_symbol: null,
        family: null,
        expression_tissue: null,
      },
    ];

    const predictionEdges: Edge[] = [
      {
        edge: "PRED1",
        protein1: "P00001",
        protein2: "P00001",
        fusion_pred_prob: 0.95,
        enriched_tissue: null,
        tissue_enriched_confidence: null,
        positive_type: "prediction",
        gene_symbol1: null,
        gene_symbol2: null,
      },
    ];

    setupSupabaseMock({
      nodes: { data: mockNodes, count: mockNodes.length },
      edges: {
        totalCount: predictionEdges.length,
        predictionEdges,
        predictionCount: predictionEdges.length,
      },
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { edges: "false" },
    });

    await handler(req, res);

    const data = JSON.parse(res._getData());
    expect(data.edges).toHaveLength(0);
    expect(data.meta.filteredEdges).toBe(0);
  });

  it("clamps minProb between 0 and 1", async () => {
    const mockNodes: Node[] = [
      {
        protein: "P00001",
        entry_name: "NODE1",
        description: null,
        gene_symbol: null,
        family: null,
        expression_tissue: null,
      },
    ];

    const predictionEdges: Edge[] = [
      {
        edge: "PRED1",
        protein1: "P00001",
        protein2: "P00001",
        fusion_pred_prob: 1,
        enriched_tissue: null,
        tissue_enriched_confidence: null,
        positive_type: "prediction",
        gene_symbol1: null,
        gene_symbol2: null,
      },
    ];

    setupSupabaseMock({
      nodes: { data: mockNodes },
      edges: {
        totalCount: predictionEdges.length,
        predictionEdges,
        predictionCount: predictionEdges.length,
      },
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { minProb: "5", positiveType: "prediction" },
    });

    await handler(req, res);

    const data = JSON.parse(res._getData());
    expect(data.edges).toHaveLength(1);
  });

  it("includes combined-source edges in prediction filters and fills past overlaps", async () => {
    const mockNodes: Node[] = [
      {
        protein: "P00001",
        entry_name: "NODE1",
        description: null,
        gene_symbol: null,
        family: null,
        expression_tissue: null,
      },
    ];

    const combinedEdge: Edge = {
      edge: "COMBO1",
      protein1: "P00001",
      protein2: "P00001",
      fusion_pred_prob: 0.99,
      enriched_tissue: null,
      tissue_enriched_confidence: null,
      positive_type: "prediction & experiment",
      gene_symbol1: null,
      gene_symbol2: null,
    };

    const predictionOnlyEdge: Edge = {
      edge: "PRED2",
      protein1: "P00001",
      protein2: "P00001",
      fusion_pred_prob: 0.98,
      enriched_tissue: null,
      tissue_enriched_confidence: null,
      positive_type: "prediction",
      gene_symbol1: null,
      gene_symbol2: null,
    };

    setupSupabaseMock({
      nodes: { data: mockNodes, count: mockNodes.length },
      edges: {
        totalCount: 2,
        experimentalEdges: [combinedEdge],
        experimentalCount: 1,
        predictionEdges: [combinedEdge, predictionOnlyEdge],
        predictionCount: 2,
      },
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { positiveType: "experiment,prediction", maxEdges: "2" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.edges).toHaveLength(2);
    expect(data.edges.map((edge: { id: string }) => edge.id).sort()).toEqual([
      "COMBO1",
      "PRED2",
    ]);
  });
});
