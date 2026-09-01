# RigBuilder

**An agent-native PC part picker, built on WebMCP.** The page is a compatibility solver; *your* agent — ChatGPT site tools in the desktop app, or a compatible Chrome 149+ agent/inspector — is the interface. The agent plans and converses; the page checks sockets, clearances, power and budgets against its catalog and hands back validated state on every call.

> Built for the [WebMCP Challenge](https://webmcp.devpost.com/) (Aug 25 – Sep 3, 2026). **Live app:** [rigbuilder.andreas-adner.workers.dev](https://rigbuilder.andreas-adner.workers.dev/). The demo video and final testing notes will be linked from the Devpost submission.

- **Shopper side:** 14 WebMCP tools — search with tri-state compatibility, hypothetical validation, a bounded-search budget optimizer, alternatives that keep the build valid, a render of the build that lands in the shared workspace, share links.
- **Operator side (`/admin`):** 5 more tools. The store's own agent researches a newly launched part on the web, drafts it into the schema-validated catalog with sources; a human verifies and publishes. The catalog is alive, not a JSON file frozen at build time.
- **Human/agent collaboration is contractual:** shared state is versioned; a write based on stale knowledge is rejected even if the agent never learned about revisions; every mutation is visible in the activity feed and undoable.

## Why I built this

In July 2025 I came across [MCP-B on Hacker News](https://news.ycombinator.com/item?id=44515403) — Alex Nahas's proposal that a web page could expose MCP tools *to an agent running in the browser*, instead of every agent having to reverse-engineer the DOM. It struck me as obviously right: the page already knows its own state and its own rules, so let it say so. A few weeks later I had it running inside a Dataverse app ([post](https://lnkd.in/p/dZq6cScZ)) and I kept following the space as MCP-B grew into the WebMCP proposal. When Chrome shipped its first WebMCP preview in early 2026 I tried that too ([post](https://lnkd.in/p/dj_7Wkp2)). The PC-part-picker example is not new to me either: in my talk at AgentCon Stockholm I used exactly this scenario to show how [AG-UI](https://docs.ag-ui.com/) shares state between an agent and a PC-building app — that demo is [still live](https://agent-con-demos.vercel.app/demos/shared-state). It worked, but the site had to *ship* the assistant. RigBuilder is the thing I wanted to build all along: not a chat box bolted onto a site, but a site whose whole job is to be a good tool for whatever agent the user brings.

## Try it

**With an agent** — open the [live app](https://rigbuilder.andreas-adner.workers.dev/) in ChatGPT's desktop built-in browser when your account and selected model have site-tools access. Chrome 149+ gets the WebMCP API from the production origin trial without a flag, but still needs a compatible browser agent or the Model Context Tool Inspector; for local development, enable `chrome://flags/#enable-webmcp-testing`. The header chip reads **"WebMCP · 14 tools exposed to your agent"**; click it to see the tool list. Then:

1. *"Build me a quiet, compact 1440p gaming PC under $1500 on this site."*
2. Change something by hand — swap the case to a Fractal Terra from the part browser. Then: *"I changed the case — fix whatever broke."* The agent either re-reads before writing, or its stale write is rejected; it then adapts to the shared state.
3. *"Get me under $1400 but keep the GPU."* — the page's optimizer computes the swap plan; the agent presents it before applying.
4. *"Show me what it looks like."* — a brand-free impression rendered from the build's attributes. When an exact reviewed case card and suitable exact or reviewed-generic GPU/cooler/RAM cards are available, those cards anchor the composition; otherwise rendering falls back to text only. Part cards are our own generated, human-reviewed images — manufacturer pages were consulted as visual references, but no vendor imagery is shipped. The first render takes roughly 10–40 s and may require one click on *Verify*.
5. *"Give me a shareable link."* — open it anywhere; the build loads from the link.
6. **Operator:** open `/admin` (Cloudflare Access; judges get a login via the submission). *"Find the specs for [a recent GPU] and add it to the catalog as a draft with sources."* Verify, publish, then search for it on the shopper page.

**Without an agent** — the site is a complete manual part picker with the same live compatibility engine: try the "only compatible" toggle, the conflict cards, undo, and the schematic that fills as you add parts.

The full scripted walkthrough and eval prompts: [`docs/DEMO.md`](docs/DEMO.md), [`docs/EVALS.md`](docs/EVALS.md).

## How it works

```
Browser tab ─────────────────────────────────────────────────────────┐
  React UI  ◄──►  Zustand store (build, goal, buildRevision, renders,│
  workbench       feed, guarded undo history)                        │
                       ▲                                             │
                       │                                             │
  Engine (pure TS: 24 rules, tri-state fit, wattage, ranking,        │
  bounded-search optimizer, performance tiers, renderPrompt)         │
                       ▲                                             │
  WebMCP layer: document.modelContext, 14 tools, one envelope,       │◄── shopper's agent
  lastSeenRevision stale-write guard                                 │
  /admin: 5 catalog tools (draft → human verify → publish)           │◄── operator's agent
└──────────────────────────────┬──────────────────────────────────────┘
                               │ same origin
Cloudflare Worker ─────────────▼──────────────────────────────────────┐
  GET  /api/catalog      D1 catalog of record, catalogVersion + ETag   │
  POST /api/admin/*      Access-gated drafts / verify / publish / log  │
  POST /api/verify       Turnstile → signed device + 1 h session cookies│
  POST /api/render       ids + enums + bounded flair → rebuilt prompt  │
                         with the same engine → R2 cache → gpt-image-2 │
  GET  /api/cards/*      reviewed exact/generic WebP thumbnails        │
  POST /api/builds       content-addressed short links (KV)            │
  IP bursts · 10/device/day · global cap, atomically enforced in a DO  │
└──────────────────────────────────────────────────────────────────────┘
```

Design decisions and their reasoning: [`docs/DESIGN.md`](docs/DESIGN.md). Review dispositions, including where we deliberately disagreed with reviewers: [`docs/REVIEW_RESPONSES.md`](docs/REVIEW_RESPONSES.md). WebMCP primer: [`docs/WEBMCP_PRIMER.md`](docs/WEBMCP_PRIMER.md).

### The WebMCP implementation, specifically

- **Tools are capabilities the UI doesn't have**, not wrapped buttons: `validate_build` accepts hypothetical ops and answers "what would break if…" without mutating; `search_parts(compatibleWithCurrentBuild)` pre-filters through the solver and returns `compatible | incompatible | conditional` with the constraints that *couldn't* be checked yet; `fit_to_budget` is a bounded exhaustive/beam search over swaps that keep the build valid, returned as a proposal the agent presents before applying.
- **One envelope, every call:** `{ ok, buildRevision, summary, digest, data, delta?, error? }`. Every response carries the revision and a slim build digest, so any call re-syncs the agent. Stable error codes (`STALE_REVISION`, `SLOT_OCCUPIED`, `BUDGET_INFEASIBLE`, `VERIFICATION_REQUIRED`, …).
- **Stale-write guard without agent cooperation:** the tool layer records the revision it last *returned* to the agent; a write is checked against that (or an explicit `expectedRevision`). A human edit between two agent calls makes the next write fail with the current state attached — the agent didn't have to opt in.
- **Honest annotations:** `readOnlyHint` on all nine non-mutating shopper tools; `render_build` and the four build/goal writes are not read-only. On the admin surface, `catalog_search` and `catalog_upsert_part` carry `untrustedContentHint` because draft text may have been supplied by an agent from the web.
- **Lifecycle:** shopper metadata lives in `src/webmcp/descriptions.ts`; handlers live in `tools.ts`; `register.ts` registers the set at boot with one ref-counted `AbortController`. `Promise.allSettled` keeps one failed registration from taking the surface down; the chip count comes from `getTools()` and refreshes on `toolchange`. `document.modelContext` is touched in exactly one file (`src/webmcp/adapter.ts`).
- **Descriptions are the UX:** every description ≤ 500 chars, parameters ≤ 150, outputs budgeted (net of the digest) at ≤ 1 500 chars except the two documented "big" calls — enforced by tests.

### Shopper tools

| Tool | Kind | What it does |
|---|---|---|
| `get_build_state` | read | Full build, totals, wattage/headroom, all conflicts, goal, active render, render allowance, `catalogVersion`. The one "big" call. |
| `search_parts` | read | Catalog search per category with typed filters, sort, pagination; tri-state `fit` + `pending`/`preexisting` codes; `compatibleWithCurrentBuild` hides `incompatible`. |
| `get_part_details` | read | Full spec sheet incl. `verified` and source. |
| `validate_build` | read | Conflicts for the current build or for hypothetical `add/replace/remove` ops — nothing mutated. |
| `explain_compatibility` | read | Per-rule `pass/fail/not_applicable/unknown` with concrete reasons ("GPU is 330 mm, case max 322 mm"). |
| `estimate_performance` | read | Editorial tier estimate per workload/resolution; bottleneck; PSU load. |
| `add_part` | write | Add by id; `replace` for occupied single slots, `replacesPartId` for RAM/storage swaps; returns validation delta. |
| `remove_part` | write | By id or whole category. |
| `set_build_goal` | write | Use case, budget, enum-only preferences; enables goal-aware checks. |
| `reset_build` | write | Requires `confirm: true`. |
| `render_build` | write | Renders a brand-free impression of the build with optional user-directed cosmetic flair (for example, a turtle sticker on the glass); cache hits are free, cold renders are limited; never changes `buildRevision`. |
| `suggest_alternatives` | read | Swap candidates for a slot that add no new errors; `cheaper / better / quieter / smaller`. |
| `fit_to_budget` | read | Bounded-search swap plan under a budget with protected slots; a proposal, not an action. |
| `export_build` | read | Markdown, JSON, or a `/b/<id>#b=…` share link. |

### Admin tools (`/admin`)

| Tool | Kind | What it does |
|---|---|---|
| `catalog_search` | read · untrusted | Search published parts and drafts (call before upserting). |
| `catalog_get_schema` | read | JSON Schema for a category + id format + units. |
| `catalog_upsert_part` | write · untrusted | Create/update a part as a **draft**; needs ≥ 1 https source; cannot set `verified`. |
| `catalog_update_price` | write | Draft price change with a source URL. |
| `catalog_publish` | write | Promote drafts, bump `catalogVersion`, write the change log; `confirm: true`. |

Verification is human-only (a button in the admin UI). The Worker enforces both rules independently of the tool layer.

Access-authenticated contributors can exercise the living-catalog workflow with new
parts, but cannot change, re-price, verify, discard a draft for, or publish an overwrite
of an existing catalog part. Full operators are selected by the server-side
`ADMIN_OWNER_EMAILS` secret. The Worker enforces this boundary for the UI, WebMCP tools
and direct API requests; the UI also labels contributor sessions and disables protected
controls.

## Run it locally

```sh
pnpm install
cp .dev.vars.example .dev.vars          # local switches; add IMAGE_API_KEY to test renders
pnpm catalog:migrate && pnpm catalog:import   # local D1 with the 448-part seed
pnpm catalog:reset                       # later: wipe drafts/agent edits, back to seed v1
pnpm dev                                 # Vite + Worker (local D1/KV/R2/DO emulated)
pnpm test                                # engine, tools, store, worker — 285 tests
pnpm check:data                          # schema + referential checks on the seed
```

Open http://localhost:5173 (shopper) and http://localhost:5173/admin (Access is bypassed locally via `DEV_ADMIN_BYPASS=1`). To exercise the tools without an agent, use Chrome with `chrome://flags/#enable-webmcp-testing` and the Model Context Tool Inspector.

To turn a vendor product-image URL into a human-reviewed, brand-free part card, use
`pnpm cards:vendor`. The complete generation, inspection, local verification, and remote
publication procedure is in the [vendor-image CLI operator runbook](docs/BACKEND.md#vendor-image-cli-operator-runbook).

## Deploy (Cloudflare)

One Worker with static assets, D1, KV, R2, a Durable Object, a Rate-Limiting binding, Turnstile and Access. The runbook — creating each resource, secrets, the Access application and judge allowlist, the origin-trial meta tag — is in [`docs/BACKEND.md`](docs/BACKEND.md). Short version: `wrangler login` → create D1/KV/R2 and paste ids into `wrangler.jsonc` → `pnpm catalog:migrate:remote && pnpm catalog:import:remote` → run `wrangler secret put` separately for `IMAGE_API_KEY`, `TURNSTILE_SECRET` and `SESSION_HMAC_KEY` → `pnpm cards:publish --remote --generic-all` (seeds R2 with the 38 reviewed generic part cards that ship in [`assets/cards/generic/`](assets/cards/generic/README.md); without them the app runs with text-only renders and no thumbnails) → `pnpm deploy`. Exact per-product cards are generated and reviewed separately (see the runbook); they are not in the repo.

## Data, provenance and honesty

- The seed catalog contains **448 parts**, authored into our own schema from public manufacturer spec pages. **82 parts are hand-verified** with recorded source URLs and show a ✓; the rest are schema-checked but unverified. Every part record returned by the tools identifies its verification state. Method and per-part sources: [`src/data/SOURCES.md`](src/data/SOURCES.md).
- The engine is **authoritative for the constraints it explicitly models against the current catalog snapshot** — not an oracle. Out of scope, on purpose: BIOS versions, GPU thickness/slot count, RAM-vs-cooler clearance, PSU connectors, lane sharing. Wattage and performance are labeled estimates; renders are impressions, not to scale.
- Prices are indicative USD with a per-part `priceUpdatedAt`; there is no live pricing and no affiliate anything.
- Product names are used descriptively; no logos or manufacturer images appear anywhere, and render prompts contain no brand or model names. RigBuilder is unaffiliated with any manufacturer or retailer.

## Security and privacy

- **Prompt-injection exposure is low and bounded** (not zero): shopper inputs are ids/enums except for the explicit, single-line `render_build.flair` cosmetic direction (200 characters maximum). That user-authored text is isolated inside the fixed render template and never becomes a tool instruction; share payloads are validated and never reflect it. The admin side is where web-sourced text enters: every field is schema-validated and length-capped; `catalog_search` and `catalog_upsert_part` carry `untrustedContentHint`; agents cannot verify; publishing needs `confirm` plus a Cloudflare Access session, and the Worker validates the Access JWT itself.
- **The Worker trusts no client-derived prompt or hash.** `/api/render` receives part ids, enums and the bounded optional flair string, then rebuilds the prompt and cache hash with the same engine code the page runs; forged `prompt`/`buildHash` fields are rejected.
- **Human control:** guarded undo on every build mutation; proposals are never auto-applied; stale writes are rejected.

| Data | Where | Retention | Notes |
|---|---|---|---|
| Catalog (parts, drafts, change log) | D1 | Indefinite | Product data; `addedBy` is a role, not an identity |
| Current build (part ids + goal enums) | Browser localStorage | Until cleared by the browser/user | Restored after catalog load; no account or server sync |
| Saved build payload (part ids + goal enums) | KV, content-addressed id | 90 days | Public to anyone with the link; nothing personal |
| Render image | R2, keyed by prompt hash | 30 days | No user identifier |
| Derived render prompt | Sent to OpenAI (`gpt-image-2`) | Per OpenAI API policy | Generic build attributes plus optional user-authored cosmetic flair |
| Anonymous device cookie | Browser | 30 days, refreshed on verification | Signed random id used only for render allowance; clearing it resets the anonymous identity |
| Session cookie | Browser | 1 h | Signed; binds recent Turnstile proof to the anonymous device id |
| Anonymous render counters | Durable Object | Current UTC-day record; replaced on first later-day access | Device id → count only; global and per-device limits are updated atomically |
| IP address | Rate-Limiting binding | Provider-managed rate-limit window | Used for 5/60 s burst control; never written to D1/KV/R2 by the app |
| Admin identity | Cloudflare Access + admin audit log | Per Access policy / operational retention | The verified identity responsible for each catalog mutation is stored server-side for accountability; admin UI responses mask emails, and shopper APIs/tools never receive identity data. |
| Worker logs | Cloudflare observability | Default | Method, path template, status, duration — no bodies, prompts or ids |

## Prior art

RigBuilder is a from-scratch rebuild, on an inverted architecture, of the AG-UI / CopilotKit PC builder shown at AgentCon Stockholm 2026 ([live demo](https://agent-con-demos.vercel.app/demos/shared-state) — AG-UI shared state between the agent and the app). That version *shipped* an assistant (model, runtime and inference bill included). This one ships capability and lets whatever agent you already trust be the interface. No code was carried over; this repository's history starts inside the submission window.

## License

MIT — see [LICENSE](LICENSE).
