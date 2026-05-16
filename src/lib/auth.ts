import { cookies } from "next/headers";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { USER_ROLE } from "@/lib/constants/user-role";

const SESSION_COOKIE = "videitos_session";
const SESSION_DAYS = 7;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

  await prisma.session.create({
    data: { userId, token, expiresAt },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });

  return token;
}

type SessionRecord = {
  id: string;
  userId: string;
  impersonatorUserId: string | null;
  expiresAt: Date;
};

async function getSessionRecord(): Promise<SessionRecord | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    select: {
      id: true,
      userId: true,
      impersonatorUserId: true,
      expiresAt: true,
    },
  });

  if (!session || session.expiresAt < new Date()) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    }
    return null;
  }

  return session;
}

export async function getSessionUserId(): Promise<string | null> {
  const session = await getSessionRecord();
  return session?.userId ?? null;
}

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  creditBalance?: number;
  impersonator?: { id: string; email: string };
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getSessionRecord();
  if (!session) return null;

  const row = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, role: true, creditBalance: true },
  });
  if (!row) return null;

  const user: SessionUser = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    creditBalance:
      row.creditBalance != null ? Number(row.creditBalance) : undefined,
  };

  if (session.impersonatorUserId) {
    const impersonator = await prisma.user.findUnique({
      where: { id: session.impersonatorUserId },
      select: { id: true, email: true },
    });
    if (impersonator) {
      user.impersonator = impersonator;
    }
  }

  return user;
}

/** Returns the admin account when logged in as admin or while impersonating. */
export async function getAdminSessionUser(): Promise<SessionUser | null> {
  const session = await getSessionRecord();
  if (!session) return null;

  const adminId = session.impersonatorUserId ?? session.userId;
  const row = await prisma.user.findUnique({
    where: { id: adminId },
    select: { id: true, email: true, name: true, role: true, creditBalance: true },
  });
  if (!row || row.role !== USER_ROLE.ADMIN) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    creditBalance:
      row.creditBalance != null ? Number(row.creditBalance) : undefined,
  };
}

export async function startImpersonation(
  adminUserId: string,
  targetUserId: string
): Promise<void> {
  const session = await getSessionRecord();
  if (!session) throw new Error("No session");

  await prisma.session.update({
    where: { id: session.id },
    data: {
      userId: targetUserId,
      impersonatorUserId: adminUserId,
    },
  });
}

export async function stopImpersonation(): Promise<boolean> {
  const session = await getSessionRecord();
  if (!session?.impersonatorUserId) return false;

  await prisma.session.update({
    where: { id: session.id },
    data: {
      userId: session.impersonatorUserId,
      impersonatorUserId: null,
    },
  });

  return true;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } }).catch(() => {});
  }
  cookieStore.delete(SESSION_COOKIE);
}
