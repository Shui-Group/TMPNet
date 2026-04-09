import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import path from "path";

const STRUCTURE_ROOT = path.join(
  process.cwd(),
  "data",
  "raw",
  "20260407_new_web_data",
  "best_structure"
);
const DEFAULT_BUCKET = "structure-models";
const DEFAULT_CONCURRENCY = 1;
const RESUMABLE_CHUNK_SIZE = 6 * 1024 * 1024;
const NETWORK_RETRY_DELAYS_MS = [0, 1000, 3000];

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function inferContentType(filePath) {
  if (filePath.endsWith(".cif")) {
    return "chemical/x-cif";
  }

  return "application/json";
}

async function listFiles(rootDir) {
  const pending = [rootDir];
  const files = [];

  while (pending.length > 0) {
    const currentDir = pending.pop();
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function uploadOne({ supabase, bucketName, absolutePath, rootDir }) {
  const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, "/");
  const fileBuffer = await fs.readFile(absolutePath);
  const contentType = inferContentType(relativePath);
  let result = null;
  let lastError = null;

  for (const delayMs of NETWORK_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    result =
      fileBuffer.length > RESUMABLE_CHUNK_SIZE
        ? await uploadResumable({
            bucketName,
            fileBuffer,
            objectName: relativePath,
            contentType,
            supabaseUrl: getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
            supabaseAnonKey: getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
          })
        : await supabase.storage
            .from(bucketName)
            .upload(relativePath, fileBuffer, {
              contentType,
              upsert: true,
              cacheControl: "3600",
            });

    if (!result.error) {
      break;
    }

    lastError = result.error;
  }

  const error = result?.error ?? lastError;

  if (!error) {
    return { status: "uploaded", relativePath };
  }

  if (
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("already exists")
  ) {
    return { status: "skipped", relativePath };
  }

  if (
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("maximum size exceeded")
  ) {
    return { status: "skipped", relativePath };
  }

  throw new Error(`${relativePath}: ${error.message}`);
}

function toBase64(value) {
  return Buffer.from(String(value)).toString("base64");
}

function buildStorageOrigin(supabaseUrl) {
  const url = new URL(supabaseUrl);
  url.hostname = url.hostname.replace(".supabase.co", ".storage.supabase.co");
  return url.origin;
}

async function fetchWithRetries(input, init) {
  let lastError = null;

  for (const delayMs of NETWORK_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function buildTusMetadata({ bucketName, objectName, contentType }) {
  return [
    ["bucketName", bucketName],
    ["objectName", objectName],
    ["contentType", contentType],
    ["cacheControl", "3600"],
  ]
    .map(([key, value]) => `${key} ${toBase64(value)}`)
    .join(",");
}

async function uploadResumable({
  bucketName,
  fileBuffer,
  objectName,
  contentType,
  supabaseUrl,
  supabaseAnonKey,
}) {
  const endpoints = [
    `${buildStorageOrigin(supabaseUrl)}/storage/v1/upload/resumable`,
    `${new URL(supabaseUrl).origin}/storage/v1/upload/resumable`,
  ];
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const createResponse = await fetchWithRetries(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
          "x-upsert": "true",
          "tus-resumable": "1.0.0",
          "upload-length": String(fileBuffer.length),
          "upload-metadata": buildTusMetadata({
            bucketName,
            objectName,
            contentType,
          }),
        },
      });

      if (!createResponse.ok) {
        const body = await createResponse.text();
        return {
          error: new Error(
            `Failed to create resumable upload (${createResponse.status}): ${body}`
          ),
        };
      }

      const locationHeader = createResponse.headers.get("location");
      if (!locationHeader) {
        return {
          error: new Error("Resumable upload did not return an upload URL"),
        };
      }

      const uploadUrl = new URL(locationHeader, endpoint).toString();
      let offset = 0;

      while (offset < fileBuffer.length) {
        const chunk = fileBuffer.subarray(offset, offset + RESUMABLE_CHUNK_SIZE);
        const patchResponse = await fetchWithRetries(uploadUrl, {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${supabaseAnonKey}`,
            apikey: supabaseAnonKey,
            "content-type": "application/offset+octet-stream",
            "tus-resumable": "1.0.0",
            "upload-offset": String(offset),
          },
          body: chunk,
        });

        if (!patchResponse.ok) {
          const body = await patchResponse.text();
          return {
            error: new Error(
              `Failed resumable upload patch (${patchResponse.status}): ${body}`
            ),
          };
        }

        const nextOffsetHeader = patchResponse.headers.get("upload-offset");
        offset = nextOffsetHeader
          ? Number(nextOffsetHeader)
          : offset + chunk.length;
      }

      return { error: null };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    error:
      lastError instanceof Error
        ? lastError
        : new Error("Resumable upload failed for an unknown reason"),
  };
}

async function runPool(tasks, workerCount, worker) {
  let index = 0;
  const results = [];

  async function runWorker() {
    while (index < tasks.length) {
      const taskIndex = index;
      index += 1;
      results[taskIndex] = await worker(tasks[taskIndex], taskIndex);
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker())
  );

  return results;
}

async function main() {
  const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const bucketName =
    process.env.SUPABASE_STRUCTURE_BUCKET ||
    process.env.NEXT_PUBLIC_SUPABASE_STRUCTURE_BUCKET ||
    DEFAULT_BUCKET;
  const concurrency = Number(process.env.STRUCTURE_UPLOAD_CONCURRENCY || DEFAULT_CONCURRENCY);

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("STRUCTURE_UPLOAD_CONCURRENCY must be a positive integer");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });
  const files = await listFiles(STRUCTURE_ROOT);

  console.log(
    `Uploading ${files.length} structure assets to bucket "${bucketName}" with concurrency ${concurrency}`
  );

  let uploaded = 0;
  let skipped = 0;

  await runPool(files, concurrency, async (absolutePath, taskIndex) => {
    const result = await uploadOne({
      supabase,
      bucketName,
      absolutePath,
      rootDir: STRUCTURE_ROOT,
    });

    if (result.status === "uploaded") {
      uploaded += 1;
    } else {
      skipped += 1;
    }

    if ((taskIndex + 1) % 25 === 0 || taskIndex + 1 === files.length) {
      console.log(
        `Processed ${taskIndex + 1}/${files.length} files (${uploaded} uploaded, ${skipped} skipped)`
      );
    }

    return result;
  });

  console.log(
    `Upload complete: ${uploaded} uploaded, ${skipped} skipped, ${files.length} total`
  );
}

main().catch((error) => {
  console.error("Structure asset upload failed:", error);
  process.exitCode = 1;
});
