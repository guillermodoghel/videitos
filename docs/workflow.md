# Vercel Workflow (job processing)

Jobs are processed by a **Vercel Workflow** per job: one durable run that processes the job (Veo/Runway), polls until the video is ready, then calls the webhook to complete. Rate limiting is enforced in code: the workflow step retries on `rate_limit` until a slot is free (per user/model in DB).

## Flow

1. **Job created** (e.g. from Dropbox webhook or dashboard) → status `queued`.
2. **Workflow started** via `start(jobWorkflow, [jobId, callbackBaseUrl])` (from `startJobWorkflow()`).
3. **Step: process** – `processJob(jobId)`. On `rate_limit`, the step returns retryable and the workflow sleeps then retries. When it succeeds, we get `operationName`.
4. **Loop: poll** – step calls `POST /api/job-status` with `{ jobId, operationName }`; if not done, `sleep('5 seconds')` and repeat.
5. **Step: webhook** – when done, step calls `POST /api/webhook/job` with `status: "ready"` or `"error"` and payload; job is updated and (on ready) video is uploaded to Dropbox.

No GCP Cloud Tasks or AWS Step Function required.

## Env vars

| Variable   | Required | Description |
|-----------|----------|-------------|
| `HOSTNAME` | Yes      | Base URL for callbacks (e.g. `https://myapp.vercel.app`). Used so the workflow can call `/api/job-status` and `/api/webhook/job`. |

Optional: `VERCEL_URL` is used by Vercel; if `HOSTNAME` is unset, the app may fall back to `http://localhost:3000` for local dev.

**No longer needed** (after switching from GCP + AWS): `GCP_PROJECT_ID`, `GCP_LOCATION`, `GCP_SERVICE_ACCOUNT_JSON`, `STEP_FUNCTION_ARN`, and AWS credentials used only for Step Functions. You can remove them from Vercel and `.env`. `JOB_PROCESS_SECRET` is still used for `/api/jobs/start-execution` and `/api/jobs/claim-and-process` (legacy route).

## Concurrency and rate limits

- **Per (user, model)** limits come from `getModelRateLimit(modelId)` and are enforced inside `processJob()` via a DB transaction (and Runway’s 1-concurrent rule). Multiple workflow runs can be started; the first step retries until it can claim a slot.
- You can tune “how many at a time” by model in `src/lib/video-models.ts` (e.g. `requestsPerWindow`, `windowSeconds`).

## Observability

In the [Vercel dashboard](https://vercel.com/docs/workflow#observability), use **Observability → Workflows** to inspect runs, steps, and failures.

## References

- [Vercel Workflow](https://vercel.com/docs/workflow)
- [Workflow Development Kit (WDK)](https://useworkflow.dev)
