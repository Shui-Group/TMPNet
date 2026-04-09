import { createMocks } from "node-mocks-http";
import handler from "./asset";
import { supabase } from "@/lib/supabase";

const pipelineMock = jest.fn(async (_stream, res) => {
  res.write('{"iptm": 0.59}');
  res.end();
});

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock("fs/promises", () => ({
  stat: jest.fn(() => Promise.resolve({ size: 14 })),
  readFile: jest.fn(() => Promise.resolve(Buffer.from('{"iptm": 0.59}'))),
}));

jest.mock("stream/promises", () => ({
  pipeline: (...args: Parameters<typeof pipelineMock>) => pipelineMock(...args),
}));

const fromMock = supabase.from as jest.Mock;

const structureRow = {
  model_id: "o15303-o00222",
  cif_rel_path:
    "data/raw/20260407_new_web_data/best_structure/o15303-o00222/o15303-o00222.cif",
  summary_confidences_rel_path:
    "data/raw/20260407_new_web_data/best_structure/o15303-o00222/summary_confidences.json",
  confidences_rel_path:
    "data/raw/20260407_new_web_data/best_structure/o15303-o00222/confidences.json",
};

describe("/api/structures/[modelId]/asset", () => {
  beforeEach(() => {
    fromMock.mockReset();
    pipelineMock.mockClear();
  });

  it("streams the requested structure asset for a valid model", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "structure_models") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() =>
                Promise.resolve({ data: structureRow, error: null })
              ),
            })),
          })),
        };
      }

      return { select: jest.fn() };
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { modelId: "o15303-o00222", kind: "summary" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res.getHeader("Content-Type")).toBe("application/json; charset=utf-8");
    expect(res._getData().toString()).toContain('"iptm": 0.59');
  });

  it("rejects invalid asset kinds", async () => {
    const { req, res } = createMocks({
      method: "GET",
      query: { modelId: "o15303-o00222", kind: "invalid" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error).toBe("Invalid asset kind");
  });

  it("rejects invalid model ids", async () => {
    const { req, res } = createMocks({
      method: "GET",
      query: { modelId: "../bad", kind: "cif" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error).toBe("Invalid structure model id");
  });
});
