import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

const SECRET_HEADER = "x-secret-token";

export async function POST(request: NextRequest) {
  const secret = process.env.USER_CREATE_SECRET_TOKEN;
  if (!secret) {
    return NextResponse.json(
      { error: "User creation not configured" },
      { status: 500 }
    );
  }

  const provided = request.headers.get(SECRET_HEADER);
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const user = await prisma.user.create({
    data: {
      email: trimmedEmail,
      password: hashed,
      name: typeof name === "string" ? name.trim() || null : null,
    },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  return NextResponse.json(user, { status: 201 });
}
