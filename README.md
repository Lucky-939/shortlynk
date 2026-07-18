# ShortLynk

A production-shaped, serverless URL shortener built entirely on Cloudflare's
edge platform — Workers, KV, Queues, and Pages. No servers, no containers,
no idle cost. Every request is handled at the edge, in one of Cloudflare's
300+ data centers, close to whoever's clicking.

**Live app:** https://shortlynk.pages.dev

---

## What this actually demonstrates

This project isn't a URL shortener for its own sake — it's a deliberately
small surface area used to prove out a real distributed-systems pattern:

- **Event-driven architecture** — a redirect never waits on analytics to
  finish writing. Click events are queued and processed asynchronously by a
  dedicated consumer, decoupled from the request path entirely.
- **Multi-service authorization** — a homegrown JWT system where one
  service signs tokens and three independent services verify them, with
  zero shared session state.
- **Eventual-consistency data modeling on a key-value store** — building
  secondary indexes, atomic-ish counters, and time-bucketed analytics on
  top of a store (Cloudflare KV) that has none of those primitives
  natively.
- **CI/CD with real, debugged failures** — not a happy-path pipeline copied
  from a tutorial; this one was built by hitting and fixing genuine lockfile
  drift and Workers-runtime version conflicts.

## Architecture

```
                         ┌─────────────────────┐
                         │   Frontend (Pages)   │
                         │   Next.js, static     │
                         └──────────┬───────────┘
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
            ┌───────────────┐┌───────────────┐┌───────────────────┐
            │  auth-worker  ││ shorten-worker ││ analytics-worker  │
            │  signup/login ││ create links   ││ read links/stats  │
            └───────┬───────┘└───────┬────────┘└──────┬────────────┘
                    │                │                │
              USERS_KV          URLS_KV      URLS_KV + ANALYTICS_KV

        ─────────────────────────────────────────────────────────────
                    public path (no login required)

        visitor clicks link
                │
                ▼
        ┌────────────────┐   queue    ┌──────────────────────────┐
        │ redirect-worker │ ─────────▶ │ click-processor-worker   │
        │ 301, <10ms      │ (async)    │ aggregates → ANALYTICS_KV │
        └────────────────┘            └──────────────────────────┘
```

Two distinct traffic patterns, by design:

- **Authenticated path** (blue, top): the dashboard talks directly to
  `auth-worker`, `shorten-worker`, and `analytics-worker`, all gated behind
  a JWT.
- **Public path** (bottom): anyone clicking a short link never touches the
  frontend or auth at all. `redirect-worker` reads `URLS_KV`, fires a
  `301`, and — without making the visitor wait — pushes a click event onto
  a Cloudflare Queue. `click-processor-worker` consumes that queue in the
  background and is the *only* writer to `ANALYTICS_KV`. If it goes down,
  redirects keep working and clicks simply queue up until it recovers.

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Compute | Cloudflare Workers (TypeScript) | Edge-native, zero cold-start concerns at this scale, generous free tier |
| Storage | Cloudflare KV | Sub-millisecond reads for the exact access pattern here (get-by-key); no schema migrations |
| Async pipeline | Cloudflare Queues | Decouples the redirect's response time from analytics writes |
| Frontend | Next.js (static export) + Tailwind | Deployed as pure static assets via Cloudflare Pages, no server runtime needed |
| Auth | Homegrown JWT (Web Crypto API) | Cloudflare has no built-in Cognito-equivalent; HMAC-SHA256 signing + PBKDF2 password hashing, both native to the Workers runtime, no external libraries |
| IaC / deploy | Wrangler CLI | Cloudflare's native deploy tool, config-as-code via `wrangler.toml` |
| CI/CD | GitHub Actions | Test-on-PR, test-then-deploy-on-merge |

## Design decisions (things to be ready to defend)

**Why Cloudflare instead of AWS?**
The original architecture plan was AWS (Lambda, DynamoDB, SQS, Cognito).
The pivot to Cloudflare was a deliberate, pragmatic call: AWS requires a
card even for free-tier signup, which was a real access barrier. Cloudflare
Workers' free plan needs only an email. The underlying architecture pattern
— serverless compute, key-value storage, async queue, managed static
hosting — maps almost one-to-one between the two platforms. Shipping a
working, live product on accessible infrastructure was judged more
valuable than a theoretically "more standard" stack that never left a
laptop.

**Why KV instead of a relational database?**
Every access pattern here is pure key-value: get a URL by its short code,
increment a counter, list keys by prefix. None of it needs joins,
transactions, or relational integrity. KV's trade-off — no atomic
increment, no secondary indexes — is real and explicitly documented in
code comments everywhere it applies (see "Known limitations" below), but
it's the right tool for this specific shape of data.

**Why a queue instead of writing analytics synchronously?**
This was tested both ways during development. A synchronous version
(`redirect-worker` calling `analytics-worker` directly and waiting for the
write to complete) was briefly implemented, then deliberately reverted
after review — it added a full network round-trip to the one code path
that most needs to be fast, and it eliminated the actual event-driven
architecture the project set out to demonstrate. The queue-based version
guarantees the redirect never waits on analytics, and Cloudflare Queues
guarantees at-least-once delivery even if the consumer is temporarily
down.

**Why a homegrown JWT instead of a real auth provider?**
There's no Cognito-equivalent on Cloudflare's free tier. Building JWT
signing/verification and PBKDF2 password hashing directly on the Web
Crypto API (native to the Workers runtime, no external dependency)
demonstrates understanding of what an auth provider actually does under
the hood, rather than just configuring one.

**Why no custom domain?**
Everything runs on Cloudflare's free `*.workers.dev` / `*.pages.dev`
subdomains rather than a purchased domain. This was a deliberate cost
decision for a portfolio project — the architecture is identical either
way, and mapping a real domain later is a config change, not a rebuild.

## Security & permissions

See the full breakdown of which Worker can access which KV namespace in
[the permissions table above the code section of this repo] — the short
version: each Worker is bound only to the KV namespace(s) it actually
needs, `click-processor-worker` has no public HTTP surface at all, and
`redirect-worker` (the only fully public endpoint with no auth) never
writes to storage directly, only publishes to a queue.

Passwords are hashed with PBKDF2 (100,000 iterations, SHA-256, random
16-byte salt per user) — never stored or logged in plaintext. JWTs are
HMAC-SHA256 signed with a 7-day expiry. Login failures return an identical
generic error for both "wrong password" and "unknown email," preventing
account enumeration.

`/shorten`, `/signup`, and `/login` are rate-limited per IP (IP addresses
are never stored raw — only a SHA-256 hash is used as the rate-limit key,
consistent with how click analytics handles visitor IPs).

## CI/CD Pipeline

Two GitHub Actions workflows, defined in `.github/workflows/`:

- **`ci.yml`** — triggers on every pull request. Runs the full `vitest`
  suite for all 6 packages (`shared` + 5 Workers) in an isolated matrix job
  per package, plus a Next.js static-export build check for the frontend.
  Fails fast on any single failure. **Never deploys.**
- **`deploy.yml`** — triggers on push to `main`. Runs the identical test
  matrix first; only if every test passes does it proceed to deploy all 5
  Workers (via `wrangler-action`) and the frontend (via `wrangler pages
  deploy`) to production.

### Required GitHub repository secrets

Configure under **Settings → Secrets and variables → Actions**:

| Secret | Where to find it |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard, right sidebar of any Workers/Pages page, or `wrangler whoami` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Custom Token, scoped to `Account: Workers Scripts: Edit`, `Account: Cloudflare Pages: Edit`, `Account: Account Settings: Read` |

## Local development

This is a real distributed system even on your laptop — six independent
processes need to run simultaneously and share local state:

```bash
# In six separate terminals, from the repo root:
cd auth-worker              && wrangler dev --persist-to ../.wrangler-state
cd shorten-worker            && wrangler dev --persist-to ../.wrangler-state
cd redirect-worker           && wrangler dev --persist-to ../.wrangler-state
cd click-processor-worker    && wrangler dev --persist-to ../.wrangler-state
cd analytics-worker          && wrangler dev --persist-to ../.wrangler-state
cd frontend                  && npm run dev
```

The `--persist-to ../.wrangler-state` flag is not optional — without it,
each `wrangler dev` process keeps an isolated local KV/Queue simulation,
and services won't be able to see each other's writes.

Each Worker needs a `.dev.vars` file (gitignored) with a matching
`JWT_SECRET` value shared across `auth-worker`, `shorten-worker`, and
`analytics-worker`.

## Repo structure

```
shortlynk/
├── shared/                  # JWT + PBKDF2 crypto, CORS helper, rate limiter — no external deps
├── auth-worker/              # POST /signup, POST /login
├── shorten-worker/           # POST /shorten (JWT-gated)
├── redirect-worker/          # GET /{shortCode} — fully public
├── click-processor-worker/   # Queue consumer, sole writer to ANALYTICS_KV
├── analytics-worker/         # GET /links, GET /links/:code/stats (JWT-gated)
├── frontend/                 # Next.js static export, deployed via Cloudflare Pages
└── .github/workflows/        # ci.yml, deploy.yml
```

## Known limitations / what I'd improve with more time

Being upfront about trade-offs made under real constraints:

- **KV's get-then-put counters have a theoretical race condition.**
  Cloudflare KV has no atomic increment. Two near-simultaneous writes to
  the same counter key could produce a "lost update" (counted as +1
  instead of +2). At this project's traffic volume the odds of collision
  on any single key are negligible, and it's documented inline everywhere
  it applies. A Durable Object acting as a serialized write gate would
  eliminate this entirely — the correct next step if this needed to scale.
- **No custom domain / DNS.** Purely a cost decision for a portfolio
  project; mapping a real domain is a config change away, not an
  architecture change.
- **No malicious-URL scanning before shortening.** A production link
  shortener handling real public traffic would want to check submitted
  URLs against a phishing/malware blocklist before accepting them.
- **Rate limiting is per-IP and fixed-window, not sliding-window or
  distributed-abuse-aware.** Good enough to stop casual abuse of a public
  demo; a real production system fielding actual attack traffic would want
  something more sophisticated (e.g., Cloudflare's native Rate Limiting
  Rules at the zone level, or a sliding-window algorithm).
- **JWTs are stored in `localStorage` on the frontend**, not an `httpOnly`
  cookie. This was a deliberate, documented trade-off (see code comments
  in the auth flow) — `httpOnly` cookies would require a backend session
  layer this project doesn't have, and for a portfolio project's threat
  model, client-stored JWT is a reasonable, explained compromise rather
  than an oversight.