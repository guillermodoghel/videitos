# Vercel Workflow (job processing)

Each job runs in its own **Vercel Workflow** durable execution: process the job (Runway), poll until the video is ready, then complete via webhook (Dropbox upload + credits). Rate limiting and provider errors are handled with sleeps and retries inside the workflow — no GCP Cloud Tasks or AWS Step Functions.

Implementation: [src/workflows/job-workflow.ts](../src/workflows/job-workflow.ts), started by [src/lib/start-job-workflow.ts](../src/lib/start-job-workflow.ts).

## Flow

1. **Job created** (Dropbox webhook, template sync, or dashboard) → status `queued`.
2. **Workflow started** — `startJobWorkflow({ jobId, callbackBaseUrl })` calls `start(jobWorkflow, [jobId, baseUrl])` and stores `workflowRunId` on the job.
3. **Phase: process** — workflow step `fetch`es `POST /api/jobs/workflow/process` (runs `processJob` in a Vercel function for observability):
   - On success → `operationName` (Runway task id), phase `generating`.
   - On `rate_limit` → phase `waiting_rate_limit`, sleep **5s**, retry (see [job-retry.ts](../src/lib/constants/job-retry.ts)).
   - On `runway_insufficient_credits` → phase `waiting_runway_credits`, sleep **30s**, up to **20** attempts (~10 min), then fail job.
   - On fatal error → `POST /api/webhook/job` with `status: "error"`.
4. **Phase: poll** — loop calls `POST /api/job-status` with `{ jobId, operationName }`:
   - Persists `runwayProgress` and `runwayPollStatus` on the job ([persist-runway-poll-status.ts](../src/lib/persist-runway-poll-status.ts)).
   - On done with `videoUri`, persists `runwayOutputVideoUri` for upload retries.
   - Sleep **5s** between polls; max **720** attempts (**60 minutes**). Constants: `RUNWAY_POLL_WORKFLOW` in [job-retry.ts](../src/lib/constants/job-retry.ts).
5. **Phase: webhook** — `POST /api/webhook/job` with `status: "ready"` and `videoUri`:
   - [complete-job-with-runway-video.ts](../src/lib/complete-job-with-runway-video.ts) downloads from Runway, uploads to Dropbox, deducts credits if platform key.
   - On Dropbox **429**, workflow sleeps (capped at **90s**) and retries up to **24** times (`DROPBOX_UPLOAD_WORKFLOW_RETRY`).
6. **Done** — job `completed`, `workflowPhase` cleared.

The workflow checks **cancellation** after major steps (`errorMessage === "Canceled"`). See [Cancel](#cancel) below.

## Workflow phases (dashboard)

| Phase code | Label |
|------------|-------|
| `starting` | Starting workflow |
| `claiming_slot` | Claiming Runway slot |
| `preparing` | Preparing input |
| `submitting` | Starting generation |
| `waiting_rate_limit` | Waiting for slot |
| `waiting_runway_credits` | Waiting for Runway credits |
| `generating` | Generating video |
| `polling` | Checking generation status |
| `uploading` | Uploading to Dropbox |
| `waiting_dropbox_rate_limit` | Waiting for Dropbox (rate limit) |

Defined in [job-workflow-phase.ts](../src/lib/constants/job-workflow-phase.ts).

## Starting a workflow

Call sites:

- [dropbox-template-sync.ts](../src/lib/dropbox-template-sync.ts) — new jobs from Dropbox
- [rerun-job.ts](../src/lib/rerun-job.ts) — retry / retake
- [resume-insufficient-credits-jobs.ts](../src/lib/resume-insufficient-credits-jobs.ts) — after credit top-up
- `POST /api/jobs/start-execution` — batch / legacy trigger (requires `JOB_PROCESS_SECRET`)

`callbackBaseUrl` must be reachable by the workflow runtime — typically `HOSTNAME` (production URL or tunnel for local dev).

## Cancel

`POST /api/jobs/[id]/cancel` ([cancel route](../src/app/api/jobs/[id]/cancel/route.ts)):

1. Best-effort `cancelRunwayTaskForJob` → Runway task cancel API.
2. Job updated: `status: failed`, `errorMessage: "Canceled"`, workflow fields cleared.
3. `cancelJobWorkflowRun(workflowRunId)` stops the Vercel Workflow run.

The workflow calls `isJobCanceled()` at checkpoints and exits without calling error webhooks.

## Concurrency and rate limits

- Per **(user, model)** limits from `getModelRateLimit(modelId)` in [video-models.ts](../src/lib/video-models.ts).
- Enforced in `processJob()` via DB transaction counting active Runway jobs (`maxConcurrent`, default **3**).
- Multiple workflows may be started; those without a slot retry every **5s** until a slot is free.

Tune `RUNWAY_MAX_CONCURRENT_TASKS` and per-model `rateLimit` in `video-models.ts`.

## Middleware

[src/middleware.ts](../src/middleware.ts) proxies `/.well-known/workflow/v1/flow` and `/.well-known/workflow/v1/step`, logging **503** responses (WDK busy; runtime retries automatically).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HOSTNAME` | Yes (prod) | Base URL for workflow callbacks (`/api/job-status`, `/api/webhook/job`). Fallback: `http://localhost:3000`. |
| `POSTGRES_PRISMA_URL` | Yes | Database |
| `POSTGRES_URL_NON_POOLING` | Yes | Migrations / direct connection |
| `SESSION_SECRET` | Yes | Sessions and signed tokens |
| `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` | Yes | Dropbox OAuth + webhooks |
| `STRIPE_*` | If using credits | Stripe secret, webhook, publishable key |
| `AWS_*` | If using S3 | Thumbnails, pre-gen, pending video cache |
| `JOB_PROCESS_SECRET` | For workflow process + start-execution | `POST /api/jobs/workflow/process`, legacy `claim-and-process`, `start-execution` |
| `USER_CREATE_SECRET_TOKEN` | For admin user API | Not used by workflow |

Full list with placeholders: [.env.example](../.env.example).

**Per-user (not env):** `runwayApiKey`, Dropbox tokens — see Settings in the app.

**No longer needed:** `GCP_PROJECT_ID`, `GCP_LOCATION`, `GCP_SERVICE_ACCOUNT_JSON`, `STEP_FUNCTION_ARN`, AWS credentials used only for Step Functions.

## Observability

- **Vercel dashboard** → Observability → Workflows: inspect runs, steps, failures.
- **App dashboard** → Jobs list: `workflowPhase`, `runwayProgress`, `runwayPollStatus`.
- Structured logs: `jobLog` / `jobLogError` with prefixes like `workflow:process`, `workflow:poll`, `workflow:step` (durable step name in `step` field), `process`, `status`, `webhook`, `complete`.
- Filter Vercel Runtime logs by route (`/api/jobs/workflow/process`, `/api/job-status`, `/api/webhook/job`) or by `jobId` / `attempt` / `pollAttempt` / `uploadAttempt` in log fields.

## Retry constants (reference)

| Constant | Behavior |
|----------|----------|
| `RATE_LIMIT_WORKFLOW_RETRY_SECONDS` | 5s between process retries |
| `RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY` | 30s × 20 attempts |
| `RUNWAY_POLL_WORKFLOW` | 5s × 720 attempts (60 min timeout) |
| `DROPBOX_UPLOAD_WORKFLOW_RETRY` | Up to 24 retries, sleep capped at 90s |

Source: [src/lib/constants/job-retry.ts](../src/lib/constants/job-retry.ts).

## References

- [Vercel Workflow](https://vercel.com/docs/workflow)
- [Workflow Development Kit (WDK)](https://useworkflow.dev)
- [architecture.md](architecture.md) — system context and data model
