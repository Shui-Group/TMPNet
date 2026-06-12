import { createMocks } from "node-mocks-http";
import handler from "@/pages/api/subgraph";

const fromMock = jest.fn();

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...(args as [string])),
  },
}));

describe("/api/subgraph integration", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns nodes marked with isQuery flag for matching proteins", async () => {
    const edgesData = [
      {
        edge: "P12345_Q67890",
        protein1: "P12345",
        protein2: "Q67890",
        fusion_pred_prob: 0.9,
        enriched_tissue: "Brain",
        tissue_enriched_confidence: "high",
        positive_type: "experimental",
      },
    ];

    const nodesData = [
      {
        protein: "P12345",
        entry_name: "PROT1",
        description: "Query protein",
        gene_names: "GENE1",
        family: "TM",
        expression_tissue: "Brain",
      },
      {
        protein: "Q67890",
        entry_name: "PROT2",
        description: "Neighbor protein",
        gene_names: "GENE2",
        family: "TF",
        expression_tissue: "Liver",
      },
    ];

    let nodeSelectCounter = 0;

    fromMock.mockImplementation((table: string) => {
      if (table === "edges") {
        const chain = {
          eq: jest.fn().mockReturnThis(),
          ilike: jest.fn().mockReturnThis(),
          or: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: edgesData, error: null }),
        };
        return {
          select: jest.fn().mockReturnValue(chain),
        };
      }

      if (table === "nodes") {
        // Build identifier resolution data
        const identifierData = nodesData.map((n: any) => ({
          protein: n.protein,
          gene_symbol: n.gene_names || n.gene_symbol,
        }));

        return {
          select: jest.fn((columns: string) => {
            // For identifier resolution queries using .or()
            if (columns === "protein, gene_symbol") {
              return {
                or: jest.fn().mockResolvedValue({
                  data: identifierData,
                  error: null,
                }),
              };
            }

            if (columns === "protein") {
              return {
                in: jest.fn().mockResolvedValue({
                  data: [{ protein: "P12345" }],
                  error: null,
                }),
              };
            }

            const result = nodeSelectCounter === 0 ? nodesData : nodesData;
            nodeSelectCounter += 1;

            return {
              in: jest.fn().mockResolvedValue({
                data: result,
                error: null,
              }),
            };
          }),
        };
      }

      if (table === "graph_layout_cache") {
        const chain: any = {
          eq: jest.fn(() => chain),
          data: [],
          error: null,
        };

        return {
          select: jest.fn(() => chain),
        };
      }

      if (table === "structure_models") {
        return {
          select: jest.fn(() => ({
            in: jest.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          })),
        };
      }

      return { select: jest.fn().mockResolvedValue({ data: [], error: null }) };
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { proteins: "P12345" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());
    const queryNode = payload.nodes.find((node: any) => node.id === "P12345");
    const neighborNode = payload.nodes.find(
      (node: any) => node.id === "Q67890"
    );

    expect(queryNode?.isQuery).toBe(true);
    expect(neighborNode?.isQuery).toBe(false);
    expect(payload.edges).toHaveLength(1);
    expect(payload.layout.graphKey).toBeDefined();
    expect(payload.layout.positionsNeeded).toBe(true);
  });
});
