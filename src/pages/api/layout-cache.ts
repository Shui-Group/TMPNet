import type { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { CURRENT_LAYOUT_VERSION } from "@/lib/layoutCache";

type PositionPayload = {
  id: string;
  x: number;
  y: number;
};

type LayoutCacheRequestBody = {
  graphKey?: string;
  layoutVersion?: string;
  positions?: PositionPayload[];
  refresh?: boolean;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body as LayoutCacheRequestBody | undefined;

  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const { graphKey, layoutVersion, positions, refresh } = body;

  if (!graphKey || typeof graphKey !== "string") {
    return res.status(400).json({ error: "graphKey is required" });
  }

  const wantsRefresh = Boolean(refresh);

  if (wantsRefresh) {
    try {
      let deleteQuery = supabase
        .from("graph_layout_cache")
        // @ts-expect-error Runtime chaining provided by Supabase client
        .delete()
        .eq("graph_key", graphKey);

      if (layoutVersion) {
        // @ts-expect-error Runtime chaining provided by Supabase client
        deleteQuery = deleteQuery.eq("layout_version", layoutVersion);
      }

      const { error, count } = await deleteQuery.select("node_id", {
        count: "exact",
      });

      if (error) {
        console.error("Layout cache refresh error:", error);
        return res.status(500).json({ error: "Failed to refresh layout cache" });
      }

      console.info(
        `[layout-cache] invalidated graph=${graphKey} version=${layoutVersion ?? "*"} removed=${count ?? 0}`
      );

      return res.status(200).json({
        graphKey,
        layoutVersion: layoutVersion ?? null,
        removed: count ?? 0,
      });
    } catch (err) {
      console.error("Unexpected layout cache refresh error:", err);
      return res.status(500).json({ error: "Unexpected error" });
    }
  }

  if (!layoutVersion || layoutVersion !== CURRENT_LAYOUT_VERSION) {
    return res.status(400).json({ error: "Unsupported layout version" });
  }

  if (!Array.isArray(positions) || positions.length === 0) {
    return res.status(400).json({ error: "positions must be a non-empty array" });
  }

  const records = positions
    .map((position) => {
      if (!position || typeof position !== "object") return null;
      if (!position.id || typeof position.id !== "string") return null;
      if (!isFiniteNumber(position.x) || !isFiniteNumber(position.y)) return null;
      return {
        graph_key: graphKey,
        node_id: position.id,
        x: position.x,
        y: position.y,
        layout_version: layoutVersion,
      };
    })
    .filter((value): value is {
      graph_key: string;
      node_id: string;
      x: number;
      y: number;
      layout_version: string;
    } => value !== null);

  if (records.length === 0) {
    return res.status(400).json({ error: "No valid positions provided" });
  }

  try {
    const { error } = await supabase
      .from("graph_layout_cache")
      .upsert(records, { onConflict: "graph_key,node_id" });

    if (error) {
      console.error("Layout cache write error:", error);
      return res.status(500).json({ error: "Failed to persist layout cache" });
    }

    console.info(
      `[layout-cache] stored ${records.length} positions for graph=${graphKey}`
    );

    return res.status(204).end();
  } catch (err) {
    console.error("Unexpected layout cache write error:", err);
    return res.status(500).json({ error: "Unexpected error" });
  }
}

