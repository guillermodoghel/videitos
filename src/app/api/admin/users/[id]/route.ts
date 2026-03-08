import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, getSessionUser } from "@/lib/auth";
import { USER_ROLE } from "@/lib/constants/user-role";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== USER_ROLE.ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  return NextResponse.json(target);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== USER_ROLE.ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let body: { email?: string; name?: string; role?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const trimOrNull = (v: unknown): string | null =>
    v === null || v === undefined
      ? null
      : typeof v === "string"
        ? v.trim() || null
        : null;

  const updates: {
    email?: string;
    name?: string | null;
    role?: string;
    password?: string;
  } = {};

  if (body.email !== undefined) {
    const email = trimOrNull(body.email);
    if (!email) {
      return NextResponse.json(
        { error: "email cannot be empty" },
        { status: 400 }
      );
    }
    const trimmed = email.toLowerCase();
    const conflict = await prisma.user.findFirst({
      where: { email: trimmed, NOT: { id } },
    });
    if (conflict) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 409 }
      );
    }
    updates.email = trimmed;
  }

  if (body.name !== undefined) {
    updates.name = trimOrNull(body.name);
  }

  if (body.role !== undefined) {
    const role = typeof body.role === "string" ? body.role.trim() : "";
    if (role !== USER_ROLE.USER && role !== USER_ROLE.ADMIN) {
      return NextResponse.json(
        { error: "role must be 'user' or 'admin'" },
        { status: 400 }
      );
    }
    updates.role = role;
  }

  if (body.password !== undefined) {
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length > 0 && password.length < 8) {
      return NextResponse.json(
        { error: "password must be at least 8 characters" },
        { status: 400 }
      );
    }
    if (password.length > 0) {
      updates.password = await hashPassword(password);
    }
  }

  if (Object.keys(updates).length === 0) {
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    return NextResponse.json(target);
  }

  const updated = await prisma.user.update({
    where: { id },
    data: updates,
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  return NextResponse.json(updated);
}
