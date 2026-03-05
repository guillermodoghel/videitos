import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTemplateConfig, isRunwayImageToVideoModel } from "@/lib/video-models";
import { uploadReferenceImage, uploadPreGenReferenceImage } from "@/lib/s3";

const ALLOWED_MIMES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

async function parseBody(
  request: NextRequest
): Promise<{
  name?: string;
  enabled?: boolean;
  config?: unknown;
  dropboxSourcePath?: string | null;
  dropboxDestinationPath?: string | null;
  reference0?: File | null;
  reference1?: File | null;
  preGenRef0?: File | null;
  preGenRef1?: File | null;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const configStr = formData.get("config");
    const enabledVal = formData.get("enabled");
    return {
      name: (formData.get("name") as string)?.trim(),
      enabled: enabledVal === "true",
      config: configStr ? JSON.parse(configStr as string) : undefined,
      dropboxSourcePath: (formData.get("dropboxSourcePath") as string) || null,
      dropboxDestinationPath: (formData.get("dropboxDestinationPath") as string) || null,
      reference0: formData.get("reference0") as File | null,
      reference1: formData.get("reference1") as File | null,
      preGenRef0: formData.get("preGenRef0") as File | null,
      preGenRef1: formData.get("preGenRef1") as File | null,
    };
  }
  const body = await request.json();
  return {
    name: body.name?.trim(),
    enabled: body.enabled,
    config: body.config,
    dropboxSourcePath: body.dropboxSourcePath ?? null,
    dropboxDestinationPath: body.dropboxDestinationPath ?? null,
    reference0: null,
    reference1: null,
    preGenRef0: null,
    preGenRef1: null,
  };
}

function validateFile(file: File): string | null {
  if (!ALLOWED_MIMES.includes(file.type)) {
    return `Invalid type: ${file.type}. Use PNG, JPEG, or WebP.`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return "File too large (max 10 MB).";
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const template = await prisma.template.findFirst({
    where: { id, userId },
  });
  if (!template) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: template.id,
    name: template.name,
    model: template.model,
    enabled: template.enabled,
    config: parseTemplateConfig(template.model, template.config as object),
    dropboxSourcePath: template.dropboxSourcePath,
    dropboxDestinationPath: template.dropboxDestinationPath,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.template.findFirst({
    where: { id, userId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { name, enabled, config, dropboxSourcePath, dropboxDestinationPath, reference0, reference1, preGenRef0, preGenRef1 } = await parseBody(request);

  const existingConfig = (existing.config as { referenceImageUrls?: string[]; preGen?: { prompt?: string; referenceImageUrls?: string[] } }) ?? {};
  const fromForm = config as { referenceImageUrls?: string[]; preGen?: { prompt?: string; referenceImageUrls?: string[] } } | undefined;
  let refs: string[] = Array.isArray(fromForm?.referenceImageUrls)
    ? [...fromForm.referenceImageUrls]
    : Array.isArray(existingConfig.referenceImageUrls)
      ? [...existingConfig.referenceImageUrls]
      : [];

  const files = [
    reference0 && reference0.size > 0 ? reference0 : null,
    reference1 && reference1.size > 0 ? reference1 : null,
  ];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    const err = validateFile(file);
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const key = await uploadReferenceImage(userId, id, {
      buffer,
      mimetype: file.type,
      originalName: file.name,
    });
    if (key) {
      if (refs.length <= i) refs.length = i + 1;
      refs[i] = key;
    }
  }

  let preGenRefs: string[] = Array.isArray(fromForm?.preGen?.referenceImageUrls)
    ? [...fromForm.preGen.referenceImageUrls]
    : Array.isArray(existingConfig.preGen?.referenceImageUrls)
      ? [...existingConfig.preGen.referenceImageUrls]
      : [];
  const preGenFiles = [
    preGenRef0 && preGenRef0.size > 0 ? preGenRef0 : null,
    preGenRef1 && preGenRef1.size > 0 ? preGenRef1 : null,
  ];
  for (let i = 0; i < preGenFiles.length; i++) {
    const file = preGenFiles[i];
    if (!file) continue;
    const err = validateFile(file);
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const key = await uploadPreGenReferenceImage(userId, id, {
      buffer,
      mimetype: file.type,
      originalName: file.name,
    });
    if (key) {
      if (preGenRefs.length <= i) preGenRefs.length = i + 1;
      preGenRefs[i] = key;
    }
  }
  preGenRefs = preGenRefs.filter(Boolean);

  const mergedConfig =
    config != null
      ? { ...(existing.config as object), ...(config as object) }
      : (existing.config as object);
  const refsForModel = isRunwayImageToVideoModel(existing.model) ? [] : refs;
  const preGenPrompt = typeof fromForm?.preGen?.prompt === "string" ? fromForm.preGen.prompt : existingConfig.preGen?.prompt ?? "";
  const preGen = preGenPrompt || preGenRefs.length > 0
    ? { prompt: preGenPrompt, referenceImageUrls: preGenRefs }
    : undefined;
  const { preGen: _drop, ...mergedWithoutPreGen } = mergedConfig as Record<string, unknown>;
  const finalConfig: Record<string, unknown> = { ...mergedWithoutPreGen, referenceImageUrls: refsForModel };
  if (preGen) finalConfig.preGen = preGen;

  const data: { name?: string; enabled?: boolean; config?: object; dropboxSourcePath?: string | null; dropboxDestinationPath?: string | null } = {};
  if (typeof name === "string") data.name = name;
  if (typeof enabled === "boolean") data.enabled = enabled;
  if (dropboxSourcePath !== undefined) data.dropboxSourcePath = dropboxSourcePath || null;
  if (dropboxDestinationPath !== undefined) data.dropboxDestinationPath = dropboxDestinationPath || null;
  data.config = finalConfig as object;

  const template = await prisma.template.update({
    where: { id },
    data,
  });

  return NextResponse.json({
    id: template.id,
    name: template.name,
    model: template.model,
    enabled: template.enabled,
    config: parseTemplateConfig(template.model, template.config as object),
    dropboxSourcePath: template.dropboxSourcePath,
    dropboxDestinationPath: template.dropboxDestinationPath,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.template.findFirst({
    where: { id, userId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.template.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
