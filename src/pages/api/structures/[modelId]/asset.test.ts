import { createMocks } from "node-mocks-http";
import handler from "./asset";
import { supabase } from "@/lib/supabase";

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
    storage: {
      from: jest.fn(),
    },
  },
}));

const fromMock = supabase.from as jest.Mock;
const storageFromMock = supabase.storage.from as jest.Mock;

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
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    fromMock.mockReset();
    storageFromMock.mockReset();
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("redirects the requested structure asset to Supabase Storage", async () => {
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
    storageFromMock.mockReturnValue({
      getPublicUrl: jest.fn(() => ({
        data: {
          publicUrl:
            "https://example.supabase.co/storage/v1/object/public/structure-models/o15303-o00222/summary_confidences.json",
        },
      })),
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { modelId: "o15303-o00222", kind: "summary" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(307);
    expect(res._getRedirectUrl()).toBe(
      "https://example.supabase.co/storage/v1/object/public/structure-models/o15303-o00222/summary_confidences.json"
    );
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

  it("rejects structure asset paths outside the storage root", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "structure_models") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() =>
                Promise.resolve({
                  data: {
                    ...structureRow,
                    cif_rel_path: "data/raw/../secrets/o15303-o00222.cif",
                  },
                  error: null,
                })
              ),
            })),
          })),
        };
      }

      return { select: jest.fn() };
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { modelId: "o15303-o00222", kind: "cif" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error).toBe(
      "Invalid structure asset path"
    );
  });
});
