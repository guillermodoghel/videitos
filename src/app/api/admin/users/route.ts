import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, getSessionUser } from "@/lib/auth";
import { USER_ROLE } from "@/lib/constants/user-role";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== USER_ROLE.ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== USER_ROLE.ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email?: string; password?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { email, password, name } = body;
  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 }
    );
  }

  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) {
    return NextResponse.json(
      { error: "email is required" },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email: trimmedEmail },
  });
  if (existing) {
    return NextResponse.json(
      { error: "User with this email already exists" },
      { status: 409 }
    );
  }

  const hashed = await hashPassword(password);
  const created = await prisma.user.create({
    data: {
      email: trimmedEmail,
      password: hashed,
      name: typeof name === "string" ? name.trim() || null : null,
    },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  return NextResponse.json(created, { status: 201 });
}
