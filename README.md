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

## Deployment (coming soon)

- Workers: `wrangler deploy` (from each worker directory)
- Frontend: push to GitHub → Cloudflare Pages auto-deploys from `out/`
- KV namespaces and Queues will be provisioned in a future step

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
