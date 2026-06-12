describe("structure asset public URLs", () => {
  const originalEnv = process.env;

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = originalEnv;
  });

  it("uses the browser-facing Supabase URL for redirected storage assets", async () => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: "http://host.docker.internal:54321",
      NEXT_PUBLIC_SUPABASE_URL: "https://memppi.example.org/supabase",
      SUPABASE_ANON_KEY: "server-anon-key",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
    };

    jest.doMock("@/lib/supabase", () => ({
      supabase: {
        storage: {
          from: () => ({
            getPublicUrl: () => ({
              data: {
                publicUrl:
                  "http://host.docker.internal:54321/storage/v1/object/public/structure-models/o15303-o00222/model.cif",
              },
            }),
          }),
        },
      },
    }));

    const { buildStructureAssetPublicUrl } = await import(
      "@/lib/structureAssets"
    );
    const publicUrl = buildStructureAssetPublicUrl(
      {
        cif_rel_path:
          "data/raw/20260514_new_web_data/best_structure/o15303-o00222/model.cif",
        summary_confidences_rel_path: "",
        confidences_rel_path: null,
      },
      "cif"
    );

    expect(publicUrl).toBe(
      "https://memppi.example.org/supabase/storage/v1/object/public/structure-models/o15303-o00222/model.cif"
    );
  });
});
