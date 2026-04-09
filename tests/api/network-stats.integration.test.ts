import { createMocks } from "node-mocks-http";
import handler from "@/pages/api/network/stats";

const fromMock = jest.fn();

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...(args as [string])),
  },
}));

describe("/api/network/stats integration", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns aggregated statistics with family counts", async () => {
    let edgesSelectCall = 0;

    fromMock.mockImplementation((table: string) => {
      if (table === "nodes") {
        return {
          select: jest.fn((columns: string, options?: { head?: boolean }) => {
            if (columns === "*" && options?.head) {
              return Promise.resolve({ count: 200, error: null });
            }
            if (columns === "family") {
              return Promise.resolve({
                data: [{ family: "TM" }, { family: "TF" }, { family: null }],
                error: null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          }),
        };
      }

      if (table === "edges") {
        return {
          select: jest.fn((columns: string, options?: { head?: boolean }) => {
            if (columns === "*" && options?.head) {
              edgesSelectCall += 1;
              if (edgesSelectCall === 1) {
                return Promise.resolve({ count: 500, error: null });
              }
              if (edgesSelectCall === 2) {
                return {
                  not: jest.fn(() => ({
                    neq: jest.fn(() =>
                      Promise.resolve({ count: 80, error: null })
                    ),
                  })),
                };
              }
              if (edgesSelectCall === 3) {
                return {
                  ilike: jest.fn(() =>
                    Promise.resolve({ count: 120, error: null })
                  ),
                };
              }
            }
            return Promise.resolve({ data: [], error: null });
          }),
        };
      }

      return {
        select: jest.fn(() => Promise.resolve({ data: [], error: null })),
      };
    });

    const { req, res } = createMocks({ method: "GET" });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());

    expect(payload.totalNodes).toBe(200);
    expect(payload.totalEdges).toBe(500);
    expect(payload.familyCounts).toEqual({ TM: 1, TF: 1 });
    expect(payload.enrichedEdgeCount).toBe(80);
    expect(payload.predictedEdgeCount).toBe(120);
  });
});
