describe("Supabase environment selection", () => {
  const originalEnv = process.env;

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = originalEnv;
  });

  it("uses server-side Supabase settings when they are provided", async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
      SUPABASE_URL: "http://host.docker.internal:54321",
      SUPABASE_ANON_KEY: "server-anon-key",
    };

    const createClient = jest.fn(() => ({}));
    jest.doMock("@supabase/supabase-js", () => ({ createClient }));

    await import("@/lib/supabase");

    expect(createClient).toHaveBeenCalledWith(
      "http://host.docker.internal:54321",
      "server-anon-key",
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: false }),
      })
    );
  });
});
