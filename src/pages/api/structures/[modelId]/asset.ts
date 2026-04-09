import type { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import type { StructureModelRecord } from "@/lib/types";
import { parseStructureModelId } from "@/lib/structureModels";
import {
  buildStructureAssetPublicUrl,
  type StructureAssetKind,
} from "@/lib/structureAssets";

const structureSelect =
  "model_id,cif_rel_path,summary_confidences_rel_path,confidences_rel_path";

type ErrorResponse = { error: string };
type AssetResponse = ErrorResponse;

const FILE_NAMES: Record<StructureAssetKind, (modelId: string) => string> = {
  cif: (modelId) => `${modelId}.cif`,
  summary: () => "summary_confidences.json",
  confidences: () => "confidences.json",
};

function isAssetKind(value: string): value is StructureAssetKind {
  return value === "cif" || value === "summary" || value === "confidences";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AssetResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const modelParam = req.query.modelId;
  const rawModelId = Array.isArray(modelParam) ? modelParam[0] : modelParam;
  const parsedModelId = parseStructureModelId(rawModelId ?? "");

  if (!parsedModelId) {
    return res.status(400).json({ error: "Invalid structure model id" });
  }

  const kindParam = Array.isArray(req.query.kind)
    ? req.query.kind[0]
    : req.query.kind;

  if (!kindParam || !isAssetKind(kindParam)) {
    return res.status(400).json({ error: "Invalid asset kind" });
  }

  const { data: structureData, error } = await supabase
    .from("structure_models")
    .select(structureSelect)
    .eq("model_id", parsedModelId.modelId)
    .maybeSingle();

  if (error) {
    console.error("Database error fetching structure asset:", error);
    return res.status(500).json({ error: "Failed to fetch structure model" });
  }

  if (!structureData) {
    return res.status(404).json({ error: "Structure model not found" });
  }

  try {
    const shouldDownload =
      (Array.isArray(req.query.download)
        ? req.query.download[0]
        : req.query.download) === "1";
    const redirectUrl = buildStructureAssetPublicUrl(
      structureData as Pick<
        StructureModelRecord,
        "cif_rel_path" | "summary_confidences_rel_path" | "confidences_rel_path"
      >,
      kindParam,
      {
        downloadFileName: shouldDownload
          ? FILE_NAMES[kindParam](parsedModelId.modelId)
          : undefined,
      }
    );

    res.redirect(307, redirectUrl);
    return;
  } catch (assetError) {
    console.error("Invalid structure asset path:", assetError);
    return res.status(400).json({ error: "Invalid structure asset path" });
  }
}
