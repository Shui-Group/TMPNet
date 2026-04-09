/**
 * Unit tests for /api/network/stats endpoint
 * Tests aggregate statistics calculation and error handling
 */

import { createMocks } from "node-mocks-http";
import handler from "./stats";
import { supabase } from "@/lib/supabase";
import { readNetworkStatsArtifact } from "@/lib/networkArtifacts";

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock("@/lib/networkArtifacts", () => ({
  readNetworkStatsArtifact: jest.fn(async () => null),
}));

const fromMock = supabase.from as jest.Mock;

type CountResult = {
  count?: number;
  error?: Error | null;
  data?: unknown;
};

type CountOverrides = {
  eq?: (value: string) => CountResult;
  neq?: () => CountResult;
};

type CountBuilder = CountResult & {
  eq: jest.Mock<CountBuilder, [string, string]>;
  ilike: jest.Mock<CountBuilder, [string, string]>;
  gte: jest.Mock<CountBuilder, []>;
  in: jest.Mock<CountBuilder, []>;
  order: jest.Mock<CountBuilder, []>;
  not: jest.Mock<{ neq: jest.Mock<CountBuilder, []> }, []>;
  range: jest.Mock<Promise<{ data: unknown[]; error: Error | null }>, []>;
  then: <TResult1 = CountResult, TResult2 = never>(
    onFulfilled?:
      | ((value: CountResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => Promise<TResult1 | TResult2>;
  catch: <TResult = CountResult>(
    onRejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ) => Promise<CountResult | TResult>;
};

const createCountBuilder = (
  result: CountResult,
  overrides: CountOverrides = {}
) => {
  const buildNext = (next: CountResult) => createCountBuilder(next, overrides);

  const builder = { ...result } as CountBuilder;

  builder.eq = jest.fn((_column: string, value: string) => {
    if (overrides.eq) {
      return buildNext(overrides.eq(value));
    }
    return builder;
  });
  builder.ilike = jest.fn((_column: string, value: string) => {
    if (overrides.eq) {
      return buildNext(overrides.eq(value));
    }
    return builder;
  });
  builder.gte = jest.fn(() => builder);
  builder.in = jest.fn(() => builder);
  builder.order = jest.fn(() => builder);
  builder.not = jest.fn(() => ({
    neq: jest.fn(() => buildNext(overrides.neq ? overrides.neq() : result)),
  }));
  builder.range = jest.fn(async () => ({
    data: [],
    error: result.error ?? null,
  }));
  builder.then = (onFulfilled, onRejected) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  builder.catch = (onRejected) => Promise.resolve(result).catch(onRejected);

  return builder;
};

describe("/api/network/stats", () => {
  beforeEach(() => {
    fromMock.mockReset();
    (readNetworkStatsArtifact as jest.Mock).mockResolvedValue(null);
  });

  it("returns precomputed stats when an artifact is available", async () => {
    (readNetworkStatsArtifact as jest.Mock).mockResolvedValue({
      totalNodes: 111,
      totalEdges: 222,
      familyCounts: { GPCR: 12 },
      enrichedEdgeCount: 33,
      predictedEdgeCount: 44,
    });

    const { req, res } = createMocks({ method: "GET" });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      totalNodes: 111,
      totalEdges: 222,
      familyCounts: { GPCR: 12 },
      enrichedEdgeCount: 33,
      predictedEdgeCount: 44,
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns aggregate counts and family distribution", async () => {
    const families = [
      { family: "TM" },
      { family: "TM" },
      { family: "TF" },
      { family: "Other" },
    ];

    fromMock.mockImplementation((table: string) => {
      if (table === "nodes") {
        return {
          select: jest.fn(
            (_cols: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.count === "exact") {
                return Promise.resolve({ count: families.length, error: null });
              }
              return Promise.resolve({ data: families, error: null });
            }
          ),
        };
      }

      if (table === "edges") {
        return {
          select: jest.fn(
            (_cols: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.head) {
                return createCountBuilder(
                  { count: 500, error: null },
                  {
                    eq: (value) =>
                      value.includes("prediction")
                        ? { count: 320, error: null }
                        : { count: 180, error: null },
                    neq: () => ({ count: 210, error: null }),
                  }
                );
              }
              return {
                range: jest.fn(async () => ({ data: [], error: null })),
              };
            }
          ),
        };
      }

      return { select: jest.fn() };
    });

    const { req, res } = createMocks({ method: "GET" });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());

    expect(payload.totalNodes).toBe(families.length);
    expect(payload.totalEdges).toBe(500);
    expect(payload.familyCounts).toEqual({ TM: 2, TF: 1, Other: 1 });
    expect(payload.enrichedEdgeCount).toBe(210);
    expect(payload.predictedEdgeCount).toBe(320);
  });

  it("returns 500 when node counting fails", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "nodes") {
        return {
          select: jest.fn(
            (_cols: string, opts?: { count?: string; head?: boolean }) =>
              opts?.count === "exact"
                ? Promise.resolve({ count: null, error: new Error("db down") })
                : Promise.resolve({ data: [], error: null })
          ),
        };
      }
      return {
        select: jest.fn(() => Promise.resolve({ count: 0, error: null })),
      };
    });

    const { req, res } = createMocks({ method: "GET" });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData()).error).toBe("Failed to count nodes");
  });

  it("returns 500 when enriched edge count fails", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "nodes") {
        return {
          select: jest.fn(
            (_cols: string, opts?: { count?: string; head?: boolean }) =>
              opts?.count === "exact"
                ? Promise.resolve({ count: 10, error: null })
                : Promise.resolve({ data: [], error: null })
          ),
        };
      }

      if (table === "edges") {
        return {
          select: jest.fn(
            (_cols: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.head) {
                return createCountBuilder(
                  { count: 100, error: null },
                  {
                    eq: () => ({ count: 60, error: null }),
                    neq: () => ({
                      count: undefined,
                      error: new Error("timeout"),
                    }),
                  }
                );
              }
              return {
                range: jest.fn(async () => ({
                  data: [],
                  error: new Error("range fail"),
                })),
              };
            }
          ),
        };
      }

      return { select: jest.fn() };
    });

    const { req, res } = createMocks({ method: "GET" });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData()).error).toBe(
      "Failed to count enriched edges"
    );
  });
});
