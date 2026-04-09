import { access, readFile } from "fs/promises";
import path from "path";
import type {
  LayoutPayload,
  NetworkElementsResponse,
  NetworkMeta,
  NetworkStats,
} from "./types";

type NetworkArtifactView = "overview" | "full";

type NetworkArtifactPayload = Omit<NetworkElementsResponse, "meta"> & {
  meta: NetworkMeta;
  version: string;
};

type StatsArtifactPayload = {
  version: string;
  stats: NetworkStats;
};

const ARTIFACTS_DIR = path.join(
  process.cwd(),
  "public",
  "generated",
  "network"
);

const networkArtifactCache = new Map<
  NetworkArtifactView,
  Promise<NetworkArtifactPayload | null>
>();
const networkArtifactExistsCache = new Map<NetworkArtifactView, Promise<boolean>>();
let statsArtifactCache: Promise<NetworkStats | null> | null = null;

const isArtifactEnabled = () => process.env.NODE_ENV !== "test";

const readJsonArtifact = async <T>(fileName: string): Promise<T | null> => {
  if (!isArtifactEnabled()) return null;

  try {
    const filePath = path.join(ARTIFACTS_DIR, fileName);
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

export const readNetworkArtifact = async (
  view: NetworkArtifactView
): Promise<NetworkArtifactPayload | null> => {
  const cached = networkArtifactCache.get(view);
  if (cached) {
    return cached;
  }

  const loader = readJsonArtifact<NetworkArtifactPayload>(`${view}.cyto.json`);
  networkArtifactCache.set(view, loader);
  return loader;
};

export const hasNetworkArtifact = async (
  view: NetworkArtifactView
): Promise<boolean> => {
  if (!isArtifactEnabled()) return false;

  const cached = networkArtifactExistsCache.get(view);
  if (cached) {
    return cached;
  }

  const loader = access(path.join(ARTIFACTS_DIR, `${view}.cyto.json`))
    .then(() => true)
    .catch((error) => {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return false;
      }
      throw error;
    });

  networkArtifactExistsCache.set(view, loader);
  return loader;
};

export const readNetworkStatsArtifact =
  async (): Promise<NetworkStats | null> => {
    if (statsArtifactCache) {
      return statsArtifactCache;
    }

    statsArtifactCache = readJsonArtifact<StatsArtifactPayload>(
      "stats.json"
    ).then((artifact) => artifact?.stats ?? null);

    return statsArtifactCache;
  };

export const buildArtifactLayoutPayload = (
  layoutVersion: string
): LayoutPayload => ({
  graphKey: `artifact:${layoutVersion}`,
  layoutVersion,
  positions: [],
  positionsNeeded: false,
});
