import { createMocks } from "node-mocks-http";
import handler from "@/pages/api/subgraph";
import { supabase } from "@/lib/supabase";
import type { Edge, Node, StructureVariant } from "@/lib/types";

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

type StructureRow = {
  edge: string;
  model_id: string;
  variant: StructureVariant;
};

type SetupOptions = {
  edgesData?: Edge[] | null;
  nodesData?: Node[] | null;
  structureRows?: StructureRow[];
  nodeInResponses?: Array<{ data: unknown; error: Error | null }>;
  edgesError?: Error | null;
  identifierError?: Error | null;
  nodesFetchError?: Error | null;
  structureError?: Error | null;
};

const fromMock = supabase.from as jest.Mock;

function setupSupabaseMock({
  edgesData = [],
  nodesData = [],
  structureRows = [],
  nodeInResponses,
  edgesError = null,
  identifierError = null,
  nodesFetchError = null,
  structureError = null,
}: SetupOptions = {}) {
  const identifierResolutionData =
    nodesData?.map((node) => ({
      protein: node.protein,
      gene_symbol: node.gene_symbol,
    })) ?? [];

  const nodeQueue = [...(nodeInResponses ?? [])];

  fromMock.mockImplementation((table: string) => {
    if (table === "edges") {
      const chain = {
        eq: jest.fn().mockReturnThis(),
        ilike: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest
          .fn()
          .mockResolvedValue({ data: edgesData, error: edgesError }),
      };

      return {
        select: jest.fn().mockReturnValue(chain),
      };
    }

    if (table === "nodes") {
      return {
        select: jest.fn().mockReturnValue({
          or: jest.fn().mockResolvedValue({
            data: identifierResolutionData,
            error: identifierError,
          }),
          in: jest.fn().mockImplementation(() => {
            if (nodeQueue.length > 0) {
              return Promise.resolve(nodeQueue.shift());
            }

            return Promise.resolve({
              data: nodesData,
              error: nodesFetchError,
            });
          }),
        }),
      };
    }

    if (table === "structure_models") {
      return {
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockResolvedValue({
            data: structureRows,
            error: structureError,
          }),
        }),
      };
    }

    if (table === "graph_layout_cache") {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
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

  it("returns 405 for non-GET requests", async () => {
    const { req, res } = createMocks({ method: "POST" });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData()).error).toBe("Method not allowed");
  });

  it("returns 400 when proteins parameter is missing", async () => {
    const { req, res } = createMocks({
      method: "GET",
      query: {},
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error).toContain(
      "Missing required parameter: proteins"
    );
  });

  it("returns 404 when queried protein does not exist", async () => {
    setupSupabaseMock();

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "NONEXISTENT" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData()).error).toContain(
      "None of the queried identifiers were found"
    );
  });

  it("returns a single-protein subgraph and marks queried nodes", async () => {
    const mockNodes: Node[] = [
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

    const mockEdges: Edge[] = [
      {
        edge: "P12345_Q67890",
        protein1: "P12345",
        protein2: "Q67890",
        fusion_pred_prob: 0.95,
        enriched_tissue: "Brain",
        tissue_enriched_confidence: "high confidence",
        positive_type: "experimental",
        gene_symbol1: "GENE1",
        gene_symbol2: "GENE2",
      },
    ];

    setupSupabaseMock({
      edgesData: mockEdges,
      nodesData: mockNodes,
      structureRows: [
        {
          edge: "P12345_Q67890",
          model_id: "p12345-q67890",
          variant: "plain",
        },
      ],
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "p12345" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());

    expect(payload.query).toEqual(["P12345"]);
    expect(payload.nodes).toHaveLength(2);
    expect(
      payload.nodes.find((node: { id: string }) => node.id === "P12345").isQuery
    ).toBe(true);
    expect(payload.edges[0]).toMatchObject({
      id: "P12345_Q67890",
      structureModelId: "p12345-q67890",
      structureVariant: "plain",
      hasStructureModel: true,
    });
  });

  it("returns a multi-protein subgraph without filtering out matching edges", async () => {
    const mockNodes: Node[] = [
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
    ];

    const mockEdges: Edge[] = [
      {
        edge: "P12345_Q67890",
        protein1: "P12345",
        protein2: "Q67890",
        fusion_pred_prob: 0.95,
        enriched_tissue: "Brain",
        tissue_enriched_confidence: "high confidence",
        positive_type: "experimental",
        gene_symbol1: "GENE1",
        gene_symbol2: "GENE2",
      },
    ];

    setupSupabaseMock({
      edgesData: mockEdges,
      nodesData: mockNodes,
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "P12345,Q67890" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());

    expect(payload.query).toEqual(["P12345", "Q67890"]);
    expect(payload.edges).toHaveLength(1);
    expect(payload.nodes).toHaveLength(2);
  });

  it("returns the isolated queried node when no interactions exist", async () => {
    const mockNodes: Node[] = [
      {
        protein: "P12345",
        entry_name: "PROT1_HUMAN",
        description: "Isolated protein",
        gene_symbol: "GENE1",
        family: "TM",
        expression_tissue: "Brain",
      },
    ];

    setupSupabaseMock({
      edgesData: [],
      nodesData: mockNodes,
      nodeInResponses: [
        { data: [{ protein: "P12345" }], error: null },
        { data: mockNodes, error: null },
      ],
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "P12345" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());

    expect(payload.nodes).toHaveLength(1);
    expect(payload.nodes[0].isQuery).toBe(true);
    expect(payload.edges).toHaveLength(0);
  });

  it("returns 500 when fetching edges fails", async () => {
    setupSupabaseMock({
      nodesData: [
        {
          protein: "P12345",
          entry_name: "PROT1_HUMAN",
          description: "Query protein",
          gene_symbol: "GENE1",
          family: "TM",
          expression_tissue: "Brain",
        },
      ],
      edgesError: new Error("Database connection failed"),
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "P12345" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData()).error).toBe(
      "Failed to fetch edges from database"
    );
  });

  it("returns 500 when fetching nodes fails", async () => {
    setupSupabaseMock({
      edgesData: [
        {
          edge: "P12345_Q67890",
          protein1: "P12345",
          protein2: "Q67890",
          fusion_pred_prob: 0.95,
          enriched_tissue: "Brain",
          tissue_enriched_confidence: "high confidence",
          positive_type: "experimental",
          gene_symbol1: "GENE1",
          gene_symbol2: "GENE2",
        },
      ],
      nodesData: [
        {
          protein: "P12345",
          entry_name: "PROT1_HUMAN",
          description: "Query protein",
          gene_symbol: "GENE1",
          family: "TM",
          expression_tissue: "Brain",
        },
      ],
      nodesFetchError: new Error("Database connection failed"),
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "P12345" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData()).error).toBe(
      "Failed to fetch nodes from database"
    );
  });
});
