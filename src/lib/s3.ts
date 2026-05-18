import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucket = process.env.AWS_S3_BUCKET;
const region = process.env.AWS_REGION ?? "us-east-1";

function getClient(): S3Client | null {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !bucket) {
    return null;
  }
  return new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

/** S3 key format: userId/templateId/references/filename */
export function referenceImageKey(
  userId: string,
  templateId: string,
  filename: string
): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${userId}/${templateId}/references/${safe}`;
}

/** S3 key format: userId/templateId/pregen_refs/filename (for pre-gen reference images) */
export function preGenReferenceImageKey(
  userId: string,
  templateId: string,
  filename: string
): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${userId}/${templateId}/pregen_refs/${safe}`;
}

/** S3 key format: userId/jobs/jobId/pregen.ext (pre-gen output image for job list) */
export function preGenOutputImageKey(userId: string, jobId: string, ext: "png" | "jpg"): string {
  return `${userId}/jobs/${jobId}/pregen.${ext}`;
}

/** Cached Dropbox source thumbnail for jobs list (immutable per job). */
export function jobSourceThumbnailKey(
  userId: string,
  jobId: string,
  ext: "png" | "jpg" | "webp" | "gif"
): string {
  return `${userId}/jobs/${jobId}/source-thumb.${ext}`;
}

export async function uploadJobSourceThumbnail(
  userId: string,
  jobId: string,
  buffer: Buffer,
  contentType: string
): Promise<string | null> {
  const client = getClient();
  if (!client || !bucket) return null;

  const ext =
    contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : contentType === "image/gif"
          ? "gif"
          : "jpg";
  const key = jobSourceThumbnailKey(userId, jobId, ext);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  return key;
}

export function contentTypeForS3Key(key: string): string {
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/** Temp Runway video while waiting on Dropbox rate limits (deleted after successful upload). */
export function pendingJobVideoKey(userId: string, jobId: string): string {
  return `${userId}/jobs/${jobId}/pending-upload.mp4`;
}

export async function uploadPendingJobVideo(
  userId: string,
  jobId: string,
  buffer: Buffer
): Promise<string | null> {
  const client = getClient();
  if (!client || !bucket) return null;
  const key = pendingJobVideoKey(userId, jobId);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "video/mp4",
    })
  );
  return key;
}

export async function deletePendingJobVideo(userId: string, jobId: string): Promise<void> {
  const client = getClient();
  if (!client || !bucket) return;
  await client
    .send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: pendingJobVideoKey(userId, jobId),
      })
    )
    .catch(() => undefined);
}

export async function uploadReferenceImage(
  userId: string,
  templateId: string,
  file: { buffer: Buffer; mimetype: string; originalName?: string }
): Promise<string | null> {
  const client = getClient();
  if (!client || !bucket) return null;

  const ext = file.mimetype === "image/png" ? "png" : file.mimetype === "image/jpeg" || file.mimetype === "image/jpg" ? "jpg" : "png";
  const baseName = file.originalName?.replace(/\.[^.]+$/, "") || "image";
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const filename = `${baseName}-${unique}.${ext}`;
  const key = referenceImageKey(userId, templateId, filename);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  return key;
}

export async function uploadPreGenReferenceImage(
  userId: string,
  templateId: string,
  file: { buffer: Buffer; mimetype: string; originalName?: string }
): Promise<string | null> {
  const client = getClient();
  if (!client || !bucket) return null;

  const ext = file.mimetype === "image/png" ? "png" : file.mimetype === "image/jpeg" || file.mimetype === "image/jpg" ? "jpg" : "png";
  const baseName = file.originalName?.replace(/\.[^.]+$/, "") || "image";
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const filename = `${baseName}-${unique}.${ext}`;
  const key = preGenReferenceImageKey(userId, templateId, filename);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  return key;
}

export async function uploadPreGenOutputImage(
  userId: string,
  jobId: string,
  buffer: Buffer,
  mimetype: string
): Promise<string | null> {
  const client = getClient();
  if (!client || !bucket) return null;

  const ext = mimetype === "image/png" ? "png" : "jpg";
  const key = preGenOutputImageKey(userId, jobId, ext);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    })
  );
  return key;
}

/** Returns true if the value is an S3 key (our stored path), not an external URL */
export function isS3Key(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("http://") &&
    !value.startsWith("https://")
  );
}

/** Get a presigned URL for an S3 key (e.g. for display). Expires in 1 hour. */
export async function getPresignedUrl(key: string): Promise<string | null> {
  const client = getClient();
  if (!client || !bucket) return null;
  try {
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 3600 }
    );
    return url;
  } catch {
    return null;
  }
}

/** Get object body as Buffer. Returns null if missing or error. */
export async function getObjectBody(key: string): Promise<Buffer | null> {
  const client = getClient();
  if (!client || !bucket) return null;
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

/** Replace S3 keys in referenceImageUrls with presigned URLs for display. */
export async function resolveReferenceImageUrls(
  referenceImageUrls: string[]
): Promise<string[]> {
  const out: string[] = [];
  for (const item of referenceImageUrls) {
    if (isS3Key(item)) {
      const url = await getPresignedUrl(item);
      if (url) out.push(url);
    } else {
      out.push(item);
    }
  }
  return out;
}
