import { promises as fs } from "fs";
import path from "path";
import type {
  StructureAssetLinks,
  StructureConfidenceBins,
  StructureConfidenceChainSummary,
  StructureConfidenceSummary,
  StructureModelRecord,
} from "@/lib/types";

export type StructureAssetKind = "cif" | "summary" | "confidences";

type ConfidenceJson = {
  atom_chain_ids?: unknown;
  atom_plddts?: unknown;
  token_chain_ids?: unknown;
  token_res_ids?: unknown;
};

const STRUCTURE_ASSET_ROOT = path.join(
  process.cwd(),
  "data",
  "raw",
  "20260407_new_web_data",
  "best_structure"
);

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function buildStructureAssetLinks(modelId: string): StructureAssetLinks {
  const encodedModelId = encodeURIComponent(modelId);
  return {
    cif: `/api/structures/${encodedModelId}/asset?kind=cif`,
    summary: `/api/structures/${encodedModelId}/asset?kind=summary`,
    confidences: `/api/structures/${encodedModelId}/asset?kind=confidences`,
  };
}

export function resolveStructureAssetPath(
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

  const absolutePath = path.resolve(process.cwd(), relativePath);
  const normalizedRoot = `${STRUCTURE_ASSET_ROOT}${path.sep}`;

  if (
    absolutePath !== STRUCTURE_ASSET_ROOT &&
    !absolutePath.startsWith(normalizedRoot)
  ) {
    throw new Error(`Resolved asset path is outside structure root: ${kind}`);
  }

  return absolutePath;
}

export async function readStructureConfidenceSummary(
  record: Pick<StructureModelRecord, "confidences_rel_path" | "has_confidences">
): Promise<StructureConfidenceSummary | null> {
  if (!record.has_confidences || !record.confidences_rel_path) {
    return null;
  }

  const confidencePath = resolveStructureAssetPath(
    {
      cif_rel_path: "",
      summary_confidences_rel_path: "",
      confidences_rel_path: record.confidences_rel_path,
    },
    "confidences"
  );

  const raw = await fs.readFile(confidencePath, "utf8");
  const parsed = JSON.parse(raw) as ConfidenceJson;

  const atomPlddts = isNumberArray(parsed.atom_plddts) ? parsed.atom_plddts : [];
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

  const chainSums = new Map<string, { atomCount: number; plddtTotal: number }>();
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
    const current = chainSums.get(chainId) ?? { atomCount: 0, plddtTotal: 0 };
    current.atomCount += 1;
    current.plddtTotal += plddt;
    chainSums.set(chainId, current);
  });

  const chains: StructureConfidenceChainSummary[] = Array.from(chainSums.entries())
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
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
