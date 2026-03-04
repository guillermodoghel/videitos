#!/usr/bin/env node
/**
 * Fail fast if POSTGRES_URL_NON_POOLING is missing or points at Supabase transaction pooler (6543).
 * Migrations must use the direct/session connection (port 5432).
 */
const directUrl = process.env.POSTGRES_URL_NON_POOLING;
if (!directUrl || directUrl.trim() === "") {
  console.error(
    "POSTGRES_URL_NON_POOLING is not set. Required for Prisma migrations (Vercel Supabase integration provides it)."
  );
  process.exit(1);
}
if (directUrl.includes(":6543")) {
  console.error(
    "POSTGRES_URL_NON_POOLING must be the direct connection (port 5432), not the Transaction pooler (6543)."
  );
  process.exit(1);
}
console.log("POSTGRES_URL_NON_POOLING set (migrations will use direct connection).");
