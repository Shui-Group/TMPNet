import { createHash } from "crypto";
import type { LayoutCacheRecord, LayoutPayload, LayoutPosition } from "./types";

type Primitive = string | number | boolean | null | undefined;

type GraphKeyContext = {
  namespace: string;
  nodeIds: string[];
  edgeIds: string[];
  params: Record<string, Primitive | Primitive[] | Record<string, Primitive>>;
};

export const CURRENT_LAYOUT_VERSION = "2025-11-19-fcose-v4-random-edges";

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([aKey], [bKey]) => aKey.localeCompare(bKey)
  );

  return `{${entries
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
    .join(",")}}`;
};

export const buildGraphKey = ({
  namespace,
  nodeIds,
  edgeIds,
  params,
}: GraphKeyContext): string => {
  const hash = createHash("sha256");
  hash.update(namespace);
  hash.update("\n");
  hash.update(CURRENT_LAYOUT_VERSION);
  hash.update("\n");
  hash.update(stableStringify(nodeIds.slice().sort()));
  hash.update("\n");
  hash.update(stableStringify(edgeIds.slice().sort()));
  hash.update("\n");
  hash.update(stableStringify(params));
  return hash.digest("hex");
};

export const mapLayoutRowsToPositions = (
  rows: LayoutCacheRecord[]
): LayoutPosition[] =>
  rows.map((row) => ({
    nodeId: row.node_id,
    x: row.x,
    y: row.y,
  }));

export const buildLayoutPayload = (
  graphKey: string,
  positions: LayoutPosition[],
  expectedNodes: number
): LayoutPayload => ({
  graphKey,
  layoutVersion: CURRENT_LAYOUT_VERSION,
  positions,
  positionsNeeded: positions.length !== expectedNodes,
});

