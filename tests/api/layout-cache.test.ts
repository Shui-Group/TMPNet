import { createMocks } from "node-mocks-http";
import handler from "@/pages/api/layout-cache";
import { CURRENT_LAYOUT_VERSION } from "@/lib/layoutCache";

const upsertMock = jest.fn();
const fromMock = jest.fn(() => ({ upsert: upsertMock }));

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...(args as [string])),
  },
}));

describe("/api/layout-cache", () => {
  beforeEach(() => {
    upsertMock.mockReset();
    fromMock.mockReset();
  });

  it("rejects unsupported methods", async () => {
    const { req, res } = createMocks({ method: "GET" });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res._getJSONData()).toEqual({ error: "Method not allowed" });
  });

  it("returns 400 for invalid payload", async () => {
    const { req, res } = createMocks({ method: "POST", body: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ error: "graphKey is required" });
  });

  it("upserts positions when payload is valid", async () => {
    upsertMock.mockResolvedValue({ error: null });
    const { req, res } = createMocks({
      method: "POST",
      body: {
        graphKey: "test",
        layoutVersion: CURRENT_LAYOUT_VERSION,
        positions: [
          {
            id: "P12345",
            x: 0.5,
            y: -0.1,
          },
        ],
      },
    });

    await handler(req, res);

    expect(fromMock).toHaveBeenCalledWith("graph_layout_cache");
    expect(upsertMock).toHaveBeenCalledWith(
      [
        {
          graph_key: "test",
          node_id: "P12345",
          x: 0.5,
          y: -0.1,
          layout_version: CURRENT_LAYOUT_VERSION,
        },
      ],
      { onConflict: "graph_key,node_id" }
    );
    expect(res._getStatusCode()).toBe(204);
  });
});

