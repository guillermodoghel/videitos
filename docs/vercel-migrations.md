# Running Prisma migrations on Vercel (Supabase)

## Env vars (Vercel Supabase integration)

The app uses the same names as the **Vercel Supabase integration**:

- **POSTGRES_PRISMA_URL** — Prisma at runtime (pooled).
- **POSTGRES_URL_NON_POOLING** — Prisma migrations (direct connection, port 5432).

Both are set automatically when you connect Supabase in Vercel. No need for `DATABASE_URL` / `DIRECT_URL`.

## Build

Migrations run during `npm run build` with a **90 second timeout**. The build checks that `POSTGRES_URL_NON_POOLING` is set and not the transaction pooler (6543).

## Local dev

Copy `.env.example` to `.env` and fill in values. Easiest: in Vercel → your project → Settings → Environment Variables, copy the values for Production (or paste from Supabase → Project Settings → Database).

Required for Prisma:

- `POSTGRES_PRISMA_URL`
- `POSTGRES_URL_NON_POOLING`

## If the build still hangs

- Confirm the Vercel Supabase integration is connected so `POSTGRES_URL_NON_POOLING` is set.
- It must be the direct connection (port 5432), not the Transaction pooler (6543). The build script will fail fast if it sees 6543.
