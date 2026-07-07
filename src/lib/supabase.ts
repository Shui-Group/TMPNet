// Supabase client initialization
import { createClient } from "@supabase/supabase-js";
import { createLocalDataSupabaseClient } from "@/lib/localDataSupabase";

const useLocalFileData = process.env.MEMPPI_DATA_MODE === "file";

if (useLocalFileData) {
  console.info(
    `Using local MemPPI data files from ${
      process.env.MEMPPI_DATA_ROOT ||
      "data/supabase-import/20260627_web_data"
    }`
  );
}

// Validate environment variables
const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!useLocalFileData && (!supabaseUrl || !supabaseAnonKey)) {
  throw new Error(
    "Missing Supabase environment variables. Please add SUPABASE_URL/SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY."
  );
}

/**
 * Supabase client instance
 * Used for all database queries in API routes and pages
 */
// Keep the exported client structurally compatible with the Supabase query
// builder while allowing the optional local-file adapter in VM fallback mode.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = useLocalFileData
  ? createLocalDataSupabaseClient()
  : createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: false, // No authentication needed for public dataset
      },
    });

/**
 * Type-safe helper to check if a Supabase response has an error
 */
export function hasSupabaseError<T>(response: {
  data: T | null;
  error: Error | null;
}): response is { data: null; error: Error } {
  return response.error !== null;
}
