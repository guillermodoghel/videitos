# Videitos

AI video generation from Dropbox images. Users connect Dropbox, define **templates** (model, duration, prompts), and the app creates **jobs** that generate short clips via **Runway** (Gen-4.5, Gen-4 Turbo, Veo 3.1) and upload results back to Dropbox. Credits are billed through **Stripe**.

Built with **Next.js 16**, **Prisma**, **PostgreSQL**, and **Vercel Workflow** (one durable workflow run per job).

## Features

- Dropbox folder watch → automatic job creation
- Template-based generation (Runway image-to-video models)
- Credit balance, purchases, and auto-recharge (Stripe)
- Job dashboard with workflow phase and Runway poll progress
- Admin: users, credits, impersonation, revenue, Dropbox upload retries
- S3 cache for thumbnails, pre-gen images, and pending uploads

## Prerequisites

- **Node.js 20**
- **PostgreSQL** (schema `videitos`)
- **Vercel** account (Workflow runs in production; local Workflow behavior is limited — see [docs/workflow.md](docs/workflow.md))
- **Dropbox** app (OAuth + webhooks)
- **Stripe** account (test mode for dev)
- **AWS S3** bucket for media cache

## Quick start

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your credentials

npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Create a user via the admin API or seed, connect Dropbox in Settings, and add a Runway API key (yours or a platform admin key).

## Environment variables

Copy [.env.example](.env.example) to `.env.local`. Summary by category:

| Category | Variables |
|----------|-----------|
| Database | `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING` |
| App | `HOSTNAME`, `SESSION_SECRET` |
| Dropbox | `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| AWS S3 | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `AWS_REGION` |
| Internal | `JOB_PROCESS_SECRET`, `USER_CREATE_SECRET_TOKEN` |

**Runway and Google AI keys** are per-user fields in the database (Dashboard → Settings), not environment variables. When a user has no Runway key, the app uses the first admin’s platform key and deducts Videitos credits. See [src/lib/runway-api-key.ts](src/lib/runway-api-key.ts).

## Database

- ORM: [Prisma](https://www.prisma.io/) with PostgreSQL schema **`videitos`**
- Migrations: `prisma/migrations/`
- Local: `npx prisma migrate dev`
- Production: GitHub Actions runs `prisma migrate deploy` on push to `main` ([.github/workflows/migrate.yml](.github/workflows/migrate.yml)) using `POSTGRES_URL_NON_POOLING`

## Local development notes

- Set `HOSTNAME=http://localhost:3000` so Dropbox OAuth and internal workflow callbacks resolve correctly.
- **Vercel Workflow** steps call back to `HOSTNAME` (`/api/job-status`, `/api/webhook/job`). For full durable runs locally you may need a tunnel (e.g. ngrok) or deploy to a preview URL. Details: [docs/workflow.md](docs/workflow.md).
- **Stripe webhooks**: use [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward events to `/api/webhook/stripe`.
- **Dropbox webhooks**: require a public HTTPS URL pointing to `/api/webhook/dropbox`.

## Project layout

```
src/app/           App Router pages and API routes
src/lib/           Business logic (process-job, runway, dropbox, stripe, s3, …)
src/workflows/     job-workflow.ts — Vercel Workflow definition
prisma/            Schema and migrations
docs/              Architecture, workflow, product article
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | `prisma generate` + Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |
| `npm run s3:create-bucket` | Create/configure S3 bucket (if script present) |

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/architecture.md](docs/architecture.md) | System design, data model, integrations |
| [docs/workflow.md](docs/workflow.md) | Vercel Workflow job pipeline |
| [docs/ai-b2b-saas-article.md](docs/ai-b2b-saas-article.md) | Product background and origin story |

## Deployment

1. Deploy the Next.js app to **Vercel** (Workflow enabled).
2. Set all variables from `.env.example` in the Vercel project; set `HOSTNAME` to your production URL (e.g. `https://app.example.com`).
3. Configure Stripe and Dropbox webhooks to the production URLs.
4. Ensure GitHub secret `POSTGRES_URL_NON_POOLING` is set for CI migrations.

## Job statuses

| Status | Meaning |
|--------|---------|
| `queued` | Waiting to start or claim a Runway slot |
| `processing` | Generation or upload in progress |
| `completed` | Video delivered to Dropbox |
| `failed` | Error or canceled (`errorMessage` explains why) |

Legacy `sent_to_veo` is treated like `processing` in the UI.
