import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

/**
 * Cloudflare R2 client (S3-compatible) plus presign helpers. The bucket is
 * private; all reads and writes go through presigned URLs issued only after an
 * ownership/membership check in the calling service.
 */

const globalForR2 = globalThis as unknown as { __shelfR2?: S3Client };

function createClient(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

export const r2: S3Client = globalForR2.__shelfR2 ?? createClient();
globalForR2.__shelfR2 = r2;

export const R2_BUCKET = env.R2_BUCKET;

/** Presigned PUT URL bound to key, content type, and size. */
export function presignPut(params: {
  key: string;
  contentType: string;
  contentLength: number;
  ttl?: number;
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: params.key,
    ContentType: params.contentType,
    ContentLength: params.contentLength,
  });
  return getSignedUrl(r2, command, {
    expiresIn: params.ttl ?? env.PRESIGN_UPLOAD_TTL,
  });
}

/** Presigned GET URL with a cache-control hint for the browser. */
export function presignGet(params: {
  key: string;
  ttl?: number;
  responseCacheControl?: string;
}): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: params.key,
    ResponseCacheControl: params.responseCacheControl,
  });
  return getSignedUrl(r2, command, {
    expiresIn: params.ttl ?? env.PRESIGN_DOWNLOAD_TTL,
  });
}

/** Server-side verification of an uploaded object's size (returns bytes or null). */
export async function headObjectSize(key: string): Promise<number | null> {
  const res = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  return res.ContentLength ?? null;
}

/** Cheap connectivity/permissions check for the health endpoint. */
export async function checkR2Health(): Promise<boolean> {
  await r2.send(new HeadBucketCommand({ Bucket: R2_BUCKET }));
  return true;
}
