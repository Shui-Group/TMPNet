import { createMocks } from "node-mocks-http";
import handler from "@/pages/api/network";
import type { Node } from "@/lib/types";

const fromMock = jest.fn();

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...(args as [string])),
  },
}));

const sampleNode: Node = {
  protein: "P12345",
  entry_name: "PROT1_HUMAN",
  description: "Test protein",
  gene_symbol: "GENE1",
  family: "TM",
  expression_tissue: "Brain",
};

const createCountChain = (count: number) => {
  const chain: any = {
    count,
    error: null,
    data: null,
  };

  chain.eq = jest.fn(() => chain);
  chain.ilike = jest.fn(() => chain);
  chain.gte = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.not = jest.fn(() => ({
    neq: jest.fn(() => chain),
  }));
  chain.range = jest.fn(async () => ({ data: [], error: null }));
  chain.then = (onFulfilled?: any, onRejected?: any) =>
    Promise.resolve({ count, error: null }).then(onFulfilled, onRejected);
  chain.catch = (onRejected?: any) =>
    Promise.resolve({ count, error: null }).catch(onRejected);

  return chain;
};

describe("/api/network integration (cyto format)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns Cytoscape elements with tooltip metadata", async () => {
    const totalEdgesCount = 5;

    fromMock.mockImplementation((table: string) => {
      if (table === "nodes") {
        return {
          select: jest.fn(() =>
            Promise.resolve({
              data: [sampleNode],
              error: null,
              count: 1,
            })
          ),
        };
      }

      if (table === "edges") {
        return {
          select: jest.fn((columns: string, options?: { head?: boolean }) => {
            if (columns === "edge" && options?.head) {
              return createCountChain(totalEdgesCount);
            }

            return createCountChain(totalEdgesCount);
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

      return {
        select: jest.fn(() => Promise.resolve({ data: null, error: null })),
      };
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { format: "cyto", edges: "false" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());

    expect(Array.isArray(payload.elements)).toBe(true);
    const nodeElement = payload.elements.find(
      (el: any) => el.data?.id === "P12345"
    );
    expect(nodeElement).toBeDefined();
    expect(nodeElement.data.tooltip).toContain("PROT1_HUMAN");
    expect(payload.meta.totalNodes).toBe(1);
    expect(payload.layout.graphKey).toBeDefined();
    expect(payload.layout.positionsNeeded).toBe(true);
  });
});
