# From Vibecoding to Revenue: Building an AI B2B SaaS

I just vibecoded an AI B2B SaaS that is generating revenue.

A friend contacted me. He runs a photobooth company for corporate events and wanted to add animated avatars to his experience.  
He already had software that generates avatars and drops files into Dropbox for delivery.

So I built the missing piece: a service that listens for new images, processes them with AI video generation, and stores results back in Dropbox so his existing software stays in charge of final delivery.

That is how this project was born.

---

## The Real-World Problem

Most AI demos fail in production because they do not fit real operations.

In this case, the operation was clear:

1. A new avatar image arrives in Dropbox
2. The system detects it automatically
3. A processing job is created
4. The AI model generates an animated result
5. The output is uploaded back to Dropbox
6. Existing client software delivers the final experience

No manual handoff, no operator babysitting, no fragile scripts.

---

## System Architecture

This stack is built around:

- Next.js API routes (on Vercel)
- Vercel Workflows for durable orchestration
- Prisma + database-backed job state
- Dropbox webhooks and cursor-based folder sync
- Stripe webhooks for credit billing and auto-recharge

### High-Level Architecture

```mermaid
flowchart TD
    A[Dropbox: New Image] --> B[Webhook: /api/webhook/dropbox]
    B --> C[Validate Signature + Parse Accounts]
    C --> D[Find User + Enabled Templates]
    D --> E[Create Job status=queued]
    E --> F[Start Vercel Workflow]

    F --> G[Process Job with AI Model]
    G --> H[Poll Operation Status]
    H --> I{Done?}
    I -- No --> H
    I -- Yes --> J[Webhook: /api/webhook/job]
    J --> K[Upload Video to Dropbox]
    K --> L[Client Software Final Delivery]
```

---

## Vercel Workflow Design

The key technical decision was to use one durable **Vercel Workflow run per job**.

Instead of stitching Cloud Tasks + Step Functions, the workflow itself handles:

- processing
- retrying on rate limits
- polling long-running operations
- final callback

### Workflow Sequence

```mermaid
sequenceDiagram
    participant DBX as Dropbox
    participant API as Next.js API
    participant WF as Vercel Workflow
    participant AI as Video Model API
    participant DB as Database
    participant OUT as Dropbox Output

    DBX->>API: Webhook notification (new file)
    API->>API: Verify HMAC signature
    API->>DB: Create queued job
    API->>WF: start(jobWorkflow, jobId, callbackBaseUrl)

    WF->>AI: processJob(jobId)
    alt rate limited
        WF->>WF: sleep(15s) and retry
        WF->>AI: processJob(jobId) again
    end

    loop until done
        WF->>API: POST /api/job-status
        API-->>WF: done=false
        WF->>WF: sleep(5s)
    end

    WF->>API: POST /api/webhook/job (ready/error)
    API->>OUT: Upload generated video
    API->>DB: Finalize job state
```

---

## Dropbox Ingestion Details

The Dropbox webhook route is built for production safety:

- validates `x-dropbox-signature` using app secret + HMAC SHA-256
- supports account id normalization (`dbid:` variants)
- reads templates with source folders enabled
- uses `list_folder` + `list_folder/continue` with persisted cursor
- deduplicates files to avoid duplicate jobs during rapid webhook bursts
- starts workflow asynchronously per new job

### Ingestion and Cursor Handling

```mermaid
flowchart TD
    A["Webhook POST"] --> B{"Signature valid?"}
    B -- "No" --> X["Invalid signature (401)"]
    B -- "Yes" --> C["Extract account IDs"]
    C --> D["Resolve users"]
    D --> E["Load enabled templates"]
    E --> F{"Template has cursor?"}

    F -- "No" --> G["Initial list_folder call"]
    G --> H["Process entries"]
    H --> I["Save cursor"]

    F -- "Yes" --> J["list_folder_continue call"]
    J --> K["Process delta entries"]
    K --> L["Update cursor"]

    H --> M["Create queued job if new"]
    K --> M
    M --> N["Start workflow"]
```

---

## Billing and Revenue Mechanics

Revenue reliability matters as much as generation quality.

The Stripe webhook route handles:

- checkout credit purchases
- payment-intent success for auto-recharge
- setup-intent default payment method handling
- idempotent credit grants via unique `externalId`
- transactional balance updates and credit transaction recording
- re-queueing jobs previously blocked by insufficient credits

### Credit Lifecycle

```mermaid
flowchart LR
    A[Stripe Event] --> B{Event type}
    B -->|checkout.session.completed| C[Grant PURCHASE credits]
    B -->|payment_intent.succeeded| D[Grant AUTO_RECHARGE / PURCHASE]
    B -->|setup_intent.succeeded| E[Save default payment method]

    C --> F{externalId already processed?}
    D --> F
    F -- Yes --> G[Skip duplicate]
    F -- No --> H[DB transaction: increment balance + write ledger]
    H --> I[Resume jobs blocked by low credits]
```

---

## Why This Is More Than a Demo

This project is not "just AI generation". It is a full B2B workflow system:

- event-driven ingestion
- durable orchestration
- fault-aware retries
- idempotent billing
- operational observability
- smooth integration into an existing business toolchain

If your system can run in production, solve a client's problem, and generate revenue, that is engineering work.

---

## "Am I an AI engineer now?"

If you can:

- map a business need to a technical architecture,
- ship reliable AI operations end-to-end,
- handle failures and billing safely,
- and create measurable business value,

then yes: you are doing AI engineering.

Title is optional. Delivery is not.

