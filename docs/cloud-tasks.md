# Google Cloud Tasks (job queue)

Jobs are enqueued to a **per–(user, model)** Cloud Tasks queue so rate limits are enforced by the queue. The queue calls our callback; the callback runs the job (Veo) and starts the Step Function to poll until done.

## Env vars

Set these in Vercel and locally (e.g. in `.env`):

| Variable | Required | Description |
|----------|----------|-------------|
| `GCP_PROJECT_ID` | Yes | GCP project ID (e.g. `my-project`) |
| `GCP_LOCATION` | No | Cloud Tasks location (default `us-central1`) |
| `GCP_SERVICE_ACCOUNT_JSON` | Yes* | Service account key: **JSON string** or **base64-encoded JSON**. *If unset, uses Application Default Credentials. |
| `HOSTNAME` | Yes for queue name | Used in queue ID (sanitized: no `https://`, no dots/special chars). e.g. `https://myapp.vercel.app` → queue prefix `videitos-myapp-vercel-app`. |

## Passing credentials (no JSON file)

You can provide the service account key **as an env var** in two ways:

1. **Raw JSON** (works in Vercel / many hosts): paste the entire key JSON as the value. Use a single line (minified). Example in Vercel: paste the contents of your `key.json` into the env value.

2. **Base64** (best for `.env` files where quotes are tricky): encode the JSON once and put the result in the env.
   ```bash
   # Create base64 value from key file (no newlines)
   cat path/to/key.json | tr -d '\n' | base64
   ```
   Then set `GCP_SERVICE_ACCOUNT_JSON=<that base64 string>`. The app decodes it and parses the JSON automatically.

The app never reads a file: it only uses `GCP_SERVICE_ACCOUNT_JSON` or, if that’s empty, Application Default Credentials (e.g. `GOOGLE_APPLICATION_CREDENTIALS` pointing to a file on the machine).

## Service account

The account must have:

- **Cloud Tasks Enqueuer** (or `roles/cloudtasks.enqueuer`) so the app can create queues and enqueue tasks.
- Optionally **Cloud Tasks Admin** if you want the app to create queues; otherwise create queues manually with the same names and rate limits.

Key (JSON) can be created in GCP Console → IAM & Admin → Service Accounts → Keys.

## Queue naming

Queue ID: **`videitos-<sanitized-HOSTNAME>-<hash(userId:modelId)>`**

- **Sanitized HOSTNAME**: protocol stripped (`https://`), non‑alphanumeric (including dots) replaced by a single `-`, lowercased, max 40 chars. Example: `https://dev.doghel.com.ar` → `dev-doghel-com-ar`.
- **Hash**: first 12 chars of SHA256(`userId:modelId`) so the full ID stays within GCP’s 63‑character limit.

Rate limit is taken from the model config (e.g. 2 per 60s → `maxDispatchesPerSecond = 2/60`).

## Callback

Cloud Tasks POSTs to `{HOSTNAME}/api/jobs/process-task` with body `{ jobId, callbackBaseUrl }`. The callback is protected by `JOB_PROCESS_SECRET` (same as before); the task is created with header `X-Job-Process-Secret` so the request is authenticated.
