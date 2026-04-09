import type { NextApiRequest, NextApiResponse } from "next";
import { createReadStream } from "fs";
import { readFile, stat } from "fs/promises";
import { pipeline } from "stream/promises";
import { supabase } from "@/lib/supabase";
import type { StructureModelRecord } from "@/lib/types";
import { parseStructureModelId } from "@/lib/structureModels";
import {
  resolveStructureAssetPath,
  type StructureAssetKind,
} from "@/lib/structureAssets";

const structureSelect =
  "model_id,cif_rel_path,summary_confidences_rel_path,confidences_rel_path";

type ErrorResponse = { error: string };
type AssetResponse = ErrorResponse | Buffer | string;

const CONTENT_TYPES: Record<StructureAssetKind, string> = {
  cif: "chemical/x-cif",
  summary: "application/json; charset=utf-8",
  confidences: "application/json; charset=utf-8",
};

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

  let filePath: string;

  try {
    filePath = resolveStructureAssetPath(
      structureData as Pick<
        StructureModelRecord,
        "cif_rel_path" | "summary_confidences_rel_path" | "confidences_rel_path"
      >,
      kindParam
    );
  } catch (assetError) {
    console.error("Invalid structure asset path:", assetError);
    return res.status(400).json({ error: "Invalid structure asset path" });
  }

  try {
    const fileStat = await stat(filePath);
    const shouldDownload =
      (Array.isArray(req.query.download)
        ? req.query.download[0]
        : req.query.download) === "1";

    res.setHeader("Content-Type", CONTENT_TYPES[kindParam]);
    res.setHeader("Content-Length", String(fileStat.size));
    res.setHeader(
      "Content-Disposition",
      `${shouldDownload ? "attachment" : "inline"}; filename="${FILE_NAMES[
        kindParam
      ](parsedModelId.modelId)}"`
    );

    if (kindParam === "summary") {
      const contents = await readFile(filePath);
      return res.status(200).send(contents);
    }

    await pipeline(createReadStream(filePath), res);
    return;
  } catch (fileError) {
    console.error("Failed to stream structure asset:", fileError);
    if (!res.headersSent) {
      return res.status(404).json({ error: "Structure asset not found" });
    }
  }
}
