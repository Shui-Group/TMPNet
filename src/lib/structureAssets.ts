import type {
  StructureAssetLinks,
  StructureConfidenceBins,
  StructureConfidenceChainSummary,
  StructureConfidenceSummary,
  StructureModelRecord,
} from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { readFile } from "fs/promises";
import path from "path";

export type StructureAssetKind = "cif" | "summary" | "confidences";

type ConfidenceJson = {
  atom_chain_ids?: unknown;
  atom_plddts?: unknown;
  token_chain_ids?: unknown;
  token_res_ids?: unknown;
};

const STRUCTURE_STORAGE_ROOT = "data/raw/20260627_web_data/best_structure/";
const DEFAULT_STRUCTURE_STORAGE_BUCKET = "structure-models";

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "number")
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function buildStructureAssetLinks(modelId: string): StructureAssetLinks {
  const encodedModelId = encodeURIComponent(modelId);
  return {
    cif: `/api/structures/${encodedModelId}/asset?kind=cif`,
    summary: `/api/structures/${encodedModelId}/asset?kind=summary`,
    confidences: `/api/structures/${encodedModelId}/asset?kind=confidences`,
  };
}

export function getStructureStorageBucketName(): string {
  return (
    process.env.SUPABASE_STRUCTURE_BUCKET ||
    process.env.NEXT_PUBLIC_SUPABASE_STRUCTURE_BUCKET ||
    DEFAULT_STRUCTURE_STORAGE_BUCKET
  );
}

export function getLocalStructureAssetRoot(): string | undefined {
  return process.env.STRUCTURE_ASSET_ROOT;
}

export function getStructureAssetContentType(kind: StructureAssetKind): string {
  return kind === "cif" ? "chemical/x-cif" : "application/json";
}

export function resolveLocalStructureAssetPath(
  record: Pick<
    StructureModelRecord,
    "cif_rel_path" | "summary_confidences_rel_path" | "confidences_rel_path"
  >,
  kind: StructureAssetKind
): string | null {
  const localRoot = getLocalStructureAssetRoot();
  if (!localRoot) {
    return null;
  }

  const objectPath = resolveStructureAssetObjectPath(record, kind);
  const absoluteRoot = path.resolve(localRoot);
  const absolutePath = path.resolve(absoluteRoot, objectPath);
  const relativePath = path.relative(absoluteRoot, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `Resolved local asset path is outside structure root: ${kind}`
    );
  }

  return absolutePath;
}

function getStructureAssetPublicBaseUrl(): string | undefined {
  return (
    process.env.SUPABASE_PUBLIC_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  );
}

function applyPublicSupabaseBase(publicUrl: string): URL {
  const url = new URL(publicUrl);
  const publicBaseUrl = getStructureAssetPublicBaseUrl();

  if (!publicBaseUrl) {
    return url;
  }

  const publicBase = new URL(publicBaseUrl);
  const basePath = publicBase.pathname.replace(/\/$/, "");
  url.protocol = publicBase.protocol;
  url.hostname = publicBase.hostname;
  url.port = publicBase.port;
  url.pathname = `${basePath}${url.pathname}`;

  return url;
}

export function resolveStructureAssetObjectPath(
  record: Pick<
    StructureModelRecord,
    "cif_rel_path" | "summary_confidences_rel_path" | "confidences_rel_path"
  >,
  kind: StructureAssetKind
): string {
  const relativePath =
    kind === "cif"
      ? record.cif_rel_path
      : kind === "summary"
      ? record.summary_confidences_rel_path
      : record.confidences_rel_path;

  if (!relativePath) {
    throw new Error(`Missing ${kind} asset path`);
  }

  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalizedPath.startsWith(STRUCTURE_STORAGE_ROOT)) {
    throw new Error(`Resolved asset path is outside structure root: ${kind}`);
  }

  const objectPath = normalizedPath.slice(STRUCTURE_STORAGE_ROOT.length);
  const segments = objectPath.split("/");

  if (
    !objectPath ||
    objectPath.startsWith("/") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Resolved asset path is outside structure root: ${kind}`);
  }

  return objectPath;
}

export function buildStructureAssetPublicUrl(
  record: Pick<
    StructureModelRecord,
    "cif_rel_path" | "summary_confidences_rel_path" | "confidences_rel_path"
  >,
  kind: StructureAssetKind,
  options?: { downloadFileName?: string }
): string {
  const objectPath = resolveStructureAssetObjectPath(record, kind);
  const bucketName = getStructureStorageBucketName();
  const {
    data: { publicUrl },
  } = supabase.storage.from(bucketName).getPublicUrl(objectPath);

  const url = applyPublicSupabaseBase(publicUrl);
  if (options?.downloadFileName) {
    url.searchParams.set("download", options.downloadFileName);
  }

  return url.toString();
}

export async function readStructureConfidenceSummary(
  record: Pick<StructureModelRecord, "confidences_rel_path" | "has_confidences">
): Promise<StructureConfidenceSummary | null> {
  if (!record.has_confidences || !record.confidences_rel_path) {
    return null;
  }

  try {
    const confidencePath = resolveStructureAssetObjectPath(
      {
        cif_rel_path: "",
        summary_confidences_rel_path: "",
        confidences_rel_path: record.confidences_rel_path,
      },
      "confidences"
    );

    const localRoot = getLocalStructureAssetRoot();
    const raw = localRoot
      ? await readFile(path.resolve(localRoot, confidencePath), "utf8")
      : await downloadStructureConfidencePayload(confidencePath);

    if (!raw) return null;

    const parsed = JSON.parse(raw) as ConfidenceJson;

    const atomPlddts = isNumberArray(parsed.atom_plddts)
      ? parsed.atom_plddts
      : [];
    const atomChainIds = isStringArray(parsed.atom_chain_ids)
      ? parsed.atom_chain_ids
      : [];
    const tokenResidues = Array.isArray(parsed.token_res_ids)
      ? parsed.token_res_ids
      : [];

    if (atomPlddts.length === 0) {
      return null;
    }

    const bins: StructureConfidenceBins = {
      veryHigh: 0,
      confident: 0,
      low: 0,
      veryLow: 0,
    };

    const chainSums = new Map<
      string,
      { atomCount: number; plddtTotal: number }
    >();
    let minPlddt = Number.POSITIVE_INFINITY;
    let maxPlddt = Number.NEGATIVE_INFINITY;
    let totalPlddt = 0;

    atomPlddts.forEach((plddt, index) => {
      totalPlddt += plddt;
      minPlddt = Math.min(minPlddt, plddt);
      maxPlddt = Math.max(maxPlddt, plddt);

      if (plddt > 90) {
        bins.veryHigh += 1;
      } else if (plddt > 70) {
        bins.confident += 1;
      } else if (plddt > 50) {
        bins.low += 1;
      } else {
        bins.veryLow += 1;
      }

      const chainId = atomChainIds[index] ?? "Unknown";
      const current = chainSums.get(chainId) ?? {
        atomCount: 0,
        plddtTotal: 0,
      };
      current.atomCount += 1;
      current.plddtTotal += plddt;
      chainSums.set(chainId, current);
    });

    const chains: StructureConfidenceChainSummary[] = Array.from(
      chainSums.entries()
    )
      .map(([chainId, summary]) => ({
        chainId,
        atomCount: summary.atomCount,
        meanPlddt: roundToTwo(summary.plddtTotal / summary.atomCount),
      }))
      .sort((left, right) => left.chainId.localeCompare(right.chainId));

    return {
      atomCount: atomPlddts.length,
      residueCount: tokenResidues.length,
      meanPlddt: roundToTwo(totalPlddt / atomPlddts.length),
      minPlddt: roundToTwo(minPlddt),
      maxPlddt: roundToTwo(maxPlddt),
      plddtBins: bins,
      chains,
    };
  } catch (error) {
    console.error("Failed to parse structure confidence payload:", error);
    return null;
  }
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

async function downloadStructureConfidencePayload(
  confidencePath: string
): Promise<string | null> {
  const bucketName = getStructureStorageBucketName();
  const { data, error } = await supabase.storage
    .from(bucketName)
    .download(confidencePath);

  if (error || !data) {
    console.error("Failed to download structure confidence payload:", error);
    return null;
  }

  return data.text();
}
