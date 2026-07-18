# ShortLynk

A blazing-fast, edge-native URL shortener built on **Cloudflare Workers**, **Queues**, **KV**, and **Next.js Pages**.

---

## Monorepo Layout

```
/shortlynk
├── shorten-worker/          Cloudflare Worker — handles POST /shorten
├── redirect-worker/         Cloudflare Worker — handles GET /{shortCode}, publishes click events to a Queue
├── click-processor-worker/  Cloudflare Worker — Queue consumer, aggregates click analytics into KV
├── frontend/                Next.js 14 + TypeScript + Tailwind, static export → Cloudflare Pages
├── .github/
│   └── workflows/           CI/CD pipeline definitions (empty placeholder — coming soon)
├── .gitignore
└── README.md
```

---

## Architecture Overview

```
Browser
  │
  ├─── POST /shorten ──────► shorten-worker
  │                              └─ writes short-code → long-URL mapping to KV
  │
  └─── GET /{shortCode} ───► redirect-worker
                                 ├─ reads KV → 301 redirect to long URL
                                 └─ publishes ClickEvent to `click-events` Queue
                                          │
                                          ▼
                              click-processor-worker  (Queue consumer)
                                 └─ increments click counters in analytics KV
```

---

## Packages

### `shorten-worker`
| | |
|---|---|
| Runtime | Cloudflare Workers (TypeScript) |
| Entry | `src/index.ts` |
| Config | `wrangler.toml` |
| Purpose | Validates long URLs, generates a unique short code, and stores the mapping in a KV namespace. |

### `redirect-worker`
| | |
|---|---|
| Runtime | Cloudflare Workers (TypeScript) |
| Entry | `src/index.ts` |
| Config | `wrangler.toml` |
| Purpose | Looks up `shortCode` in KV, issues a 301 redirect, and enqueues a `ClickEvent` for async analytics processing. |

### `click-processor-worker`
| | |
|---|---|
| Runtime | Cloudflare Workers (TypeScript) — Queue consumer |
| Entry | `src/index.ts` |
| Config | `wrangler.toml` |
| Purpose | Consumes `click-events` Queue messages and aggregates per-link click counts + metadata into an analytics KV namespace. |

### `frontend`
| | |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v3 |
| Output | Static export (`out/`) — deployed via Cloudflare Pages |
| Purpose | User-facing UI: URL shortening form, dashboard, analytics. |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- **Wrangler CLI** — install globally or use the per-package devDependency
  ```bash
  npm install -g wrangler
  wrangler login
  ```

### Running a Worker locally

```bash
cd shorten-worker     # or redirect-worker / click-processor-worker
npm install
npm run dev           # → wrangler dev (hot-reloads on save)
```

Test it:
```bash
curl http://localhost:8787
```

### Running the frontend locally

```bash
cd frontend
npm install
npm run dev           # → Next.js dev server at http://localhost:3000
```

Static export (production bundle):
```bash
npm run build         # → produces out/
```

---

## Secrets & Environment Variables

Wrangler reads local secrets from a **`.dev.vars`** file in each worker directory.
This file is **never committed** (covered by `.gitignore`).

Format:
```ini
# shorten-worker/.dev.vars
MY_SECRET=some-value
```

For production, set secrets via:
```bash
wrangler secret put MY_SECRET
```

---

## CI/CD Pipeline

ShortLynk uses GitHub Actions to automate testing and deployment. The workflows are defined in `.github/workflows/`.

### Workflows

- **CI (`ci.yml`)**: Triggers on every Pull Request. Runs the full `vitest` suite for all 5 workers + the `shared` library in an isolated matrix job. It also builds the Next.js frontend to verify that static export succeeds. It **fails fast** if any component breaks, and does *not* deploy any code.
- **Deploy (`deploy.yml`)**: Triggers on pushes to the `main` branch. It first runs the exact same test matrix to prevent deploying broken code. If all tests pass, it uses `cloudflare/wrangler-action` to deploy all 5 workers and the frontend automatically.

### GitHub Repository Secrets

To enable automatic deployments, you must configure the following **Repository Secrets** in your GitHub repository (`Settings -> Secrets and variables -> Actions`):

1. **`CLOUDFLARE_ACCOUNT_ID`**
   - Your Cloudflare Account ID.
   - **Where to find it**: Visible in the right-hand sidebar on the Cloudflare dashboard under any Workers & Pages overview.
2. **`CLOUDFLARE_API_TOKEN`**
   - The API token used to authenticate deployments.
   - **Where to find it**: Cloudflare Dashboard → My Profile → API Tokens.
   - **Required Scopes**: Create a Custom Token with the following minimum permissions (this keeps it scoped down securely, without needing full account access):
     - `Account` | `Workers Scripts` | `Edit`
     - `Account` | `Cloudflare Pages` | `Edit`
     - `Account` | `Account Settings` | `Read`

---

## Deployment

---

## .gitignore highlights

| Pattern | Reason |
|---|---|
| `node_modules/` | Installed dependencies — never commit |
| `.wrangler/` | Wrangler build cache and local state |
| `.next/` | Next.js build cache |
| `out/` | Next.js static export output |
| `.dev.vars` | **Wrangler local secrets — must never be committed** |
| `.env*` | Local environment overrides |
