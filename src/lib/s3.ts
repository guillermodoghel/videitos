import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
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

/** Get object body as Buffer (e.g. for sending to Veo). Returns null if missing or error. */
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
