# Prisma + Supabase on Vercel

## Build: avoid “Outdated Prisma Client”

We run **`prisma generate`** before every build (`build` and `vercel-build` scripts) so Vercel’s cached `node_modules` don’t leave you with an old Prisma client. If you still see “Prisma has detected that this project was built on Vercel…”, trigger a **Redeploy with Clear Cache** (Vercel → Project → Deployments → ⋮ → Redeploy → check “Clear build cache”).

## Env vars (Vercel Supabase integration)

The app uses the same names as the **Vercel Supabase integration**:

- **POSTGRES_PRISMA_URL** — Prisma at runtime (pooled, port 6543 is fine).
- **POSTGRES_URL_NON_POOLING** — Used for migrations when run elsewhere (direct connection, port 5432).

Both are set automatically when you connect Supabase in Vercel.

## Migrations are not run on Vercel

Migrations are **not** run during the Vercel build. In practice, Prisma often ends up using the pooled URL (6543) in the build environment, which can hang or fail. So the build only runs `prisma generate && next build`.

**Run migrations manually** when you add or change them:

```bash
# From your machine, with production DB URL in env:
export POSTGRES_PRISMA_URL="postgresql://..."   # from Vercel env
export POSTGRES_URL_NON_POOLING="postgresql://..."  # direct, port 5432
npx prisma migrate deploy
```

Or run the same in a GitHub Action / CI job that has access to these secrets.

## Local dev

Copy `.env.example` to `.env` and set `POSTGRES_PRISMA_URL` and `POSTGRES_URL_NON_POOLING` (same URL for local Postgres is fine).
