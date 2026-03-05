import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTemplateConfig } from "@/lib/video-models";
import { uploadReferenceImage, uploadPreGenReferenceImage } from "@/lib/s3";

const ALLOWED_MIMES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

async function parseBody(request: NextRequest): Promise<{
  name?: string;
  model?: string;
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
    return {
      name: (formData.get("name") as string)?.trim(),
      model: (formData.get("model") as string)?.trim(),
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
    model: body.model?.trim(),
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

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const templates = await prisma.template.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      model: t.model,
      enabled: t.enabled,
      config: parseTemplateConfig(t.model, t.config as object),
      dropboxSourcePath: t.dropboxSourcePath,
      dropboxDestinationPath: t.dropboxDestinationPath,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, model, config, dropboxSourcePath, dropboxDestinationPath, reference0, reference1, preGenRef0, preGenRef1 } = await parseBody(request);

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!model) {
    return NextResponse.json({ error: "model is required" }, { status: 400 });
  }

  const configObj = config != null ? (config as object) : {};
  const template = await prisma.template.create({
    data: {
      userId,
      name,
      model,
      enabled: true,
      config: configObj,
      dropboxSourcePath: dropboxSourcePath || null,
      dropboxDestinationPath: dropboxDestinationPath || null,
    },
  });

  const refs: string[] = Array.isArray((configObj as { referenceImageUrls?: string[] }).referenceImageUrls)
    ? [...(configObj as { referenceImageUrls: string[] }).referenceImageUrls]
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
      await prisma.template.delete({ where: { id: template.id } });
      return NextResponse.json({ error: err }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const key = await uploadReferenceImage(
      userId,
      template.id,
      { buffer, mimetype: file.type, originalName: file.name }
    );
    if (key) {
      refs[i] = key;
      while (refs.length < i + 1) refs.push("");
      refs.length = Math.max(refs.length, i + 1);
    }
  }

  let preGenRefs: string[] = [];
  const preGenFiles = [
    preGenRef0 && preGenRef0.size > 0 ? preGenRef0 : null,
    preGenRef1 && preGenRef1.size > 0 ? preGenRef1 : null,
  ];
  for (let i = 0; i < preGenFiles.length; i++) {
    const file = preGenFiles[i];
    if (!file) continue;
    const err = validateFile(file);
    if (err) {
      await prisma.template.delete({ where: { id: template.id } });
      return NextResponse.json({ error: err }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const key = await uploadPreGenReferenceImage(userId, template.id, {
      buffer,
      mimetype: file.type,
      originalName: file.name,
    });
    if (key) preGenRefs.push(key);
  }

  const preGenConfig = (configObj as { preGen?: { prompt?: string } }).preGen;
  const preGenPrompt = typeof preGenConfig?.prompt === "string" ? preGenConfig.prompt : "";
  const preGen = preGenPrompt || preGenRefs.length > 0
    ? { prompt: preGenPrompt, referenceImageUrls: preGenRefs }
    : undefined;

  const finalRefs = refs.filter(Boolean);
  const updatedConfig: Record<string, unknown> = { ...(configObj as object), referenceImageUrls: finalRefs };
  if (preGen) updatedConfig.preGen = preGen;
  await prisma.template.update({
    where: { id: template.id },
    data: { config: updatedConfig as object },
  });

  const updated = await prisma.template.findUnique({
    where: { id: template.id },
  });

  return NextResponse.json(
    {
      id: updated!.id,
      name: updated!.name,
      model: updated!.model,
      enabled: updated!.enabled,
      config: parseTemplateConfig(updated!.model, updated!.config as object),
      dropboxSourcePath: updated!.dropboxSourcePath,
      dropboxDestinationPath: updated!.dropboxDestinationPath,
      createdAt: updated!.createdAt.toISOString(),
      updatedAt: updated!.updatedAt.toISOString(),
    },
    { status: 201 }
  );
}
