# RigBuilder — Design and implementation reference (v2.3)

**Product name:** RigBuilder

**Status:** Core implementation complete and deployed; cross-client evals/video pending · **v1:** 2026-08-27 · **v2:** 2026-08-29 (after review round 1) · **v2.1:** 2026-08-29 (after review round 2) · **v2.2:** 2026-08-29 (living catalog + agent-native admin) · **v2.3:** 2026-08-29 (implementation/documentation sync) · **Deadline:** 2026-09-03 13:00 PT (22:00 CEST)

Review inputs live in `scratchpad/` (git-ignored): `FINDINGS_round1.md`, `FINDINGS_round2.md`. **Dispositions, including the points where this design deliberately disagrees with the reviewer, are recorded in [REVIEW_RESPONSES.md](REVIEW_RESPONSES.md).** Reviewers: read that file first.

**v2.3 in one breath:** catalog lives in **D1** behind a versioned Worker API (bundled JSON is the seed + offline fallback) · the complete **`/admin`** workspace sits behind Cloudflare Access with **5 admin WebMCP tools** — the operator's agent researches new parts and drafts them into the catalog; a human verifies and either actor can publish with explicit confirmation · the shopper exposes 14 tools, reviewed part cards and composed/text rendering · "client-side" stays an implementation detail, not a pitch line. See REVIEW_RESPONSES.md for the decisions that led here.

**v2.1 in one breath:** render endpoint receives ids + enums and one bounded optional cosmetic-flair string, Worker rebuilds prompt/hash (no client-supplied prompt) · `buildRevision` (parts + goal) split from render artifacts · stale-write guard defaults to the revision the agent last saw (no agent cooperation needed) · `gpt-image-2`, one provider · Turnstile → signed session cookie; Rate-Limiting binding for bursts, Durable Object for the daily cap; R2 for images · short links are `/b/<id>#b=<payload>` (fragment fallback for KV propagation) · tri-state compatibility · optimizer fixes (7ⁿ, utility objective, explicit ordered ops, `replacesPartId`) · slim per-response state (slot ids only) · `verified` in every part output · narrow-pane layout (~800 px) · privacy table.

**v2.3 implementation snapshot:** production is live at [rigbuilder.andreas-adner.workers.dev](https://rigbuilder.andreas-adner.workers.dev/) with the origin-trial token and all Worker bindings configured · 448 seed parts, 82 verified · 14 shopper tools + 5 admin tools · local build/goal and latest active-render persistence · exact and 38 reviewed generic part-card archetypes, same-origin thumbnails, generic-assisted composition with an exact-case requirement, text-only fallback · 285 passing tests in 28 files. Share links deliberately contain build + goal only; they do not automatically restore render artifacts.

---

## 1. Concept

**An agent-native PC part picker.** The human and their agent build a PC together: the agent converses, plans and drives the build; the page is the **compatibility solver, the shared workspace, and the renderer** both parties see and manipulate.

### The one-sentence pitch

> The page is the engine, the agent is the interface: RigBuilder exposes a real constraint solver to your agent through WebMCP, so the agent never has to guess whether a GPU fits your case — it asks the page, and the page checks it against the modeled constraints and the bundled spec data.

### Why this fits "the future of the open web"

- **Bring-your-own-agent commerce.** Today, a site that wants an assistant must ship one (own the model, the runtime, the inference bill — the CopilotKit pattern). WebMCP inverts this: the user arrives with their agent (ChatGPT, Chrome), and the site hands it tools.
- **Agent-as-interface, not agent-as-user.** The tools are not "click add-to-cart for me." They are queries against a domain engine the agent cannot replicate: constraint validation, budget optimization, physical-fit checks — and a render that is *tied to the deterministic page state and appears in the shared workspace* (the agent may be able to draw pictures on its own; it cannot draw *this build* into *this page*).
- **The pattern works on both sides of the counter.** The shopper's agent builds a PC through 14 tools; the *operator's* agent maintains the catalog through 5 more on `/admin` — researching a just-launched part on the web, drafting it into the schema-validated catalog, and leaving verification and publishing to a human. Same architecture, second audience, and the catalog is visibly alive.
- **Human/agent collaboration is visible and contractual.** Shared state flows both ways and is versioned: the agent adds a part → the UI updates with a highlight; the human swaps a part manually → the agent's next call sees the change, and a write based on stale knowledge is rejected *without the agent having to do anything special* (§4.5). An activity feed shows every action from either side; every build mutation is undoable.

### Wording rule (review round 1, #2)

The engine is **authoritative for the constraints it explicitly models, against the catalog snapshot** — not an oracle. Say that, everywhere: README, tool descriptions, UI footer, demo voice-over. Prices are "indicative USD (snapshot 2026-08)". Wattage and performance are labeled *estimates*. Renders are "a brand-free impression derived from the build's attributes and reviewed generated references". The footer lists the dataset snapshot date and links `src/data/SOURCES.md`. Never imply universal physical compatibility (BIOS versions, GPU thickness/slot count, RAM-vs-cooler clearance, PSU connectors, lane sharing are *out of scope* and the README says so). Forbidden phrases in all docs and voice-over: "ground truth", "the page knows", "never hallucinates".

### Explicit non-goals

- **No accounts, no affiliate links, no live retail pricing.** Not a shop. Prices are catalog-maintained indicative USD with a per-part `priceUpdatedAt`; the admin tools are the update path, not a price feed.
- **"Client-side" is not a selling point.** The engine and shopper tools execute in the page for latency and offline-manual-use reasons (§3.3); the pitch never mentions it. The Worker owns the catalog (D1), rendering, sharing and admin.
- No in-page LLM chat fallback: without an agent the site is a fully usable manual part picker.

---

## 2. Judging-criteria mapping (write the submission text from this)

| Criterion | Our story |
|---|---|
| **WebMCP leverage** | 14 shopper tools + 5 admin tools, most non-trivial: constraint solver, hypothetical validation, bounded-search budget optimizer, alternatives that keep the build valid, state-bound rendering. Versioned shared state with stale-write rejection that needs no agent cooperation. Every mutating tool returns post-mutation validation. AbortSignal lifecycle, honest `readOnlyHint`s / `untrustedContentHint`, `toolchange` awareness. Two audiences (shopper, operator) served by the same pattern. |
| **Execution** | A complete product with or without an agent: manual picker with live validation, rendering, saved/shareable builds, a **living catalog** (D1, versioned, import pipeline, admin UI with an update path — not a frozen JSON file). Deployed on Cloudflare with an origin-trial token so Chrome 149+ exposes the API without flags; an agent/inspector still consumes it. Distinctive visual identity, not a template. |
| **Potential impact** | PC building is a real, high-stakes compatibility problem (wrong-socket returns are an entire genre of retail pain). Pattern generalizes to all configurator commerce: cars, bikes, kitchens, servers. |
| **Creativity & ambition** | The inversion story: from "ship an agent" (our 2026 AgentCon CopilotKit build — cited as prior art, fully rebuilt) to "the user brings their agent." Page-as-solver, agent-as-narrator, and a render that lands in the shared workspace. |

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser tab                                                      │
│                                                                  │
│  ┌──────────────┐   ┌────────────────┐   ┌──────────────────┐    │
│  │ React UI     │◄──┤ Zustand store  │──►│ WebMCP layer     │◄───┼── shopper's agent
│  │ manual picker│   │ build+goal     │   │ document.        │    │   (ChatGPT / Chrome)
│  │ workbench    │   │ buildRevision  │   │ modelContext     │    │
│  │ render stage │   │ renders[]      │   │ 14 tools         │    │
│  │              │   │ log, history   │   │ lastSeenRevision │    │
│  └──────────────┘   └───────┬────────┘   └──────────────────┘    │
│                             │                                    │
│                     ┌───────▼────────┐   ┌───────────────────┐   │
│                     │ Engine (pure TS│◄──┤ catalog cache     │◄──┼── GET /api/catalog
│                     │ validate/rank/ │   │ (fetched, ETag;   │   │   (bundled seed JSON
│                     │ optimize/prompt│   │  localStorage)    │   │    = offline fallback)
│                     └────────────────┘   └───────────────────┘   │
│                                                                  │
│  /admin  (Cloudflare Access)  ┌────────────────────────────┐     │
│  catalog table · draft diff · │ 5 admin WebMCP tools       │◄────┼── operator's agent
│  Verify ✓ (human) · Publish   │ (draft → human publish)    │     │   (web search + tools)
└──────────────────────────┬────┴────────────────────────────┴─────┘
                           │ HTTPS, same origin
┌──────────────────────────▼───────────────────────────────────────┐
│ Cloudflare Worker  (bundles the SAME engine + schema modules)     │
│  GET  /api/catalog          published parts + catalogVersion (D1) │
│  POST /api/admin/*          Access-gated: upsert/price/verify/    │
│                             publish → D1 drafts → new version     │
│  POST /api/verify           Turnstile → device + session cookies  │
│  POST /api/render           {partIds, goal, style, angle, flair} → │
│                             Worker rebuilds prompt+hash → R2 →    │
│                             gpt-image-2                            │
│  GET  /api/render/<hash>.webp   same-origin image route (R2)      │
│  GET  /api/cards/*          exact/generic reviewed thumbnails (R2)│
│  POST /api/builds           content-addressed short id (KV)       │
│  GET  /b/<id>               SPA; payload also in #b= fragment     │
│  D1 (catalog) · R2 · KV · Rate-Limiting binding · DO (daily cap)  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.1 Stack

| Layer | Choice | Rationale |
|---|---:|---:|---|
| Build | **Vite 7 + React 19 + TypeScript**, pnpm | Scaffolded 2026-08-29 (Milestone 0). |
| State | **Zustand** | Store readable outside React — tool `execute()` calls `useStore.getState()` directly. |
| Styling | **Tailwind v4 with a custom theme** + hand-written CSS/SVG (gauges, case silhouette) | Tailwind is the utility layer, not the look. See §7. |
| WebMCP | **`document.modelContext` native + `@mcp-b/webmcp-types`**, behind `src/webmcp/adapter.ts` | Types only; **no polyfill**. Adapter isolates API drift and normalizes return shapes. |
| Engine | Pure TypeScript module, zero deps, **bundled into both the page and the Worker** | Vitest-tested; the Worker reuses the catalog schema and `renderPrompt` logic, so it resolves ids and rebuilds derived prompts/hashes server-side. Runs in-page for low-latency validation — an implementation choice, not a pitch line. |
| Data | **Cloudflare D1** is the catalog of record (`parts`, `catalog_versions`, `change_log`), served by `GET /api/catalog` with `catalogVersion` + ETag. Curated JSON in `src/data/parts/` is the **seed** (`pnpm catalog:import`) and the **offline fallback** bundled in the page. zod schema shared by seed, API, admin UI and tools. | See §6. A living dataset with an update path, not a frozen file. |
| Backend | **Cloudflare Worker** via `@cloudflare/vite-plugin`; **D1** (catalog), **R2** (images), **KV** (saved builds), **Rate-Limiting binding** (bursts), **Durable Object** (daily render cap), **Turnstile** (render), **Cloudflare Access** (`/admin`, `/api/admin/*`) | Same origin, one `pnpm deploy`. Access = zero auth code; judges get an allowlisted login via the Devpost testing field. |
| Image model | **OpenAI `gpt-image-2`** — one provider, configured in production | The provider is behind a small interface for cleanliness only; no second provider is implemented. Cold text/composed latency and the composed A/B gate still require production rehearsal. |
| Hosting | Cloudflare Workers at `rigbuilder.andreas-adner.workers.dev` | Production origin is fixed and carries its origin-trial token. |
| License | **MIT**, at repo root | Rules require a detectable open-source license. |

### 3.2 Repo layout (this repository *is* the app repo)

`github.com/adner/RigBuilder`, public, MIT. Planning docs in `docs/`. App at root:

```
src/engine/      pure TS: rules, wattage, ranking, optimizer, renderPrompt (+ tests)  ← shared with worker/
src/data/        schema.ts (zod), parts/*.json (seed + fallback), SOURCES.md, check.ts  ← shared with worker/
src/catalog/     client loader: fetch /api/catalog, ETag, localStorage cache, seed fallback
src/store/       zustand store, buildRevision, renders, history
src/webmcp/      adapter.ts, tools.ts (all 14), envelope.ts, descriptions.ts, lastSeen.ts
src/ui/          shopper/admin layouts, part browser, render client, primitives
src/admin/       /admin route: catalog table, draft diff, verify/publish, admin tools registration
worker/          routing, D1 repo/catalog/admin, render/cards, session, quotas, share links, tests
scripts/         catalog import/reset, D1 migrations, exact/generic part-card generation + publication
docs/            design, backend, demo/evals, WebMCP, render-fidelity and theme references
```

### 3.3 Key design rules

- **Tool concerns are separated.** `src/webmcp/descriptions.ts` is the metadata/schema source of truth, `tools.ts` contains handlers, and `register.ts` owns the ref-counted, StrictMode-safe registration lifecycle. One shared `AbortController` unregisters the set; `Promise.allSettled` isolates failures; the chip shows the live count.
- **Descriptions are tested from their source of truth.** The README table mirrors the public surface manually; `src/webmcp/size.test.ts` enforces names, order, annotations and size budgets against `descriptions.ts`.
- **The Worker trusts no client-derived prompt or hash.** It accepts validated ids/enums plus the explicit bounded render-flair field, then reconstructs derived values (prompt, hash) itself.
- **Backend is optional at runtime for the shopper.** Catalog fetch falls back to the bundled seed (footer shows "offline catalog · seed vN"); render and share degrade as specified. `/admin` requires the backend.
- **Agents draft, humans verify and publish.** No admin tool can set `verified: true`; publishing requires `confirm: true` and an Access session. Access identities not listed in the server-side owner allowlist are add-only contributors: they can publish new ids but cannot alter, re-price, verify, discard drafts for, or overwrite existing published parts. Web-sourced text is quarantined in the admin context and never reaches shopper tool responses except via the length-capped, plain-text `name`/`brand` fields.

### 3.4 Status chip

- Native present, after all registrations settle: **"WebMCP · 14 tools exposed to your agent"** — click opens a popover listing each tool + description.
- Native absent: **"WebMCP not detected — open in ChatGPT's browser or Chrome 149+"**.
- On `/admin` the chip reads **"WebMCP · 5 catalog tools exposed to your agent"**.
- Count derived from `getTools()`, refreshed on `toolchange`. The chip never claims an agent is *connected*.

---

## 4. The tool surface (14 shopper tools + 5 admin tools)

Principles:

1. **Every shopper response carries `buildRevision` + a slim build digest** (slot → part id, totals, validation counts). Its fixed overhead is ≤ 200 characters; long real catalog ids bring the complete digest to about 476 characters. Names, prices and conflict details live in tool-specific data.
2. **Each of the four build/goal writes returns the post-mutation validation delta.** `render_build` returns an artifact and never changes `buildRevision`.
3. **Machine-readable first.** One envelope (§4.4), stable codes, ids as ids, numbers as numbers, one-sentence `summary`.
4. **Descriptions carry working context** within Chrome's size guidance (§4.6).
5. **Honest annotations:** every non-mutating tool (incl. solver/proposal tools and `export_build`) sets `readOnlyHint: true`. `render_build` is not read-only (costs money, changes the stage).
6. **`verified: boolean` on every returned part record**; verified parts win ties in ranking and optimization.

### 4.1 Read tools

| Tool | Input | Returns (`data`) |
|---|---|---|
| `get_build_state` | — | Full build (slot → id/name/price/verified/key specs), total, est. wattage, PSU headroom %, full conflict list, goal, active render (`renderId`, `forBuildRevision`), `catalogVersion`. The only "full" response. |
| `search_parts` | `category` (enum of 8), optional `query`, `maxPrice`, `minPrice`, `filters` (typed per category), `compatibleWithCurrentBuild` (default true when build non-empty), `sortBy` (price / performance / name), `limit` (default 6, max 20), `offset` | Parts with ≤ 5 key specs, `verified`, and **tri-state `fit: "compatible" \| "incompatible" \| "conditional"`** with `pending: ["GPU_TOO_LONG"]`-style list of constraints that cannot be checked yet (e.g. no case chosen). Also `preexisting: [codes]` when an error already fails because of *other* slots (e.g. a board already over its M.2 count when browsing SATA drives) — such failures never block a candidate. A rule the candidate's own category is needed for (a too-long GPU; any CPU when the PSU cannot carry the GPU alone) still blocks. With `compatibleWithCurrentBuild: true`, `compatible` and `conditional` are returned, `incompatible` excluded. Paginated; `total`. |
| `get_part_details` | `partId` | Full spec sheet incl. acoustics/size fields, perf tiers, `verified`, `sourceUrl` if verified. |
| `validate_build` | optional `hypothetical: [{op: "add"\|"replace"\|"remove", partId, replacesPartId?}]` | Conflicts `[{code, severity, partIds, explanation}]` for the current build, or with the ops applied in order **without mutating**. `add` on an occupied single slot → `SLOT_OCCUPIED` unless op is `replace`. |
| `explain_compatibility` | `partId` | Per rule: `pass \| fail \| not_applicable \| unknown` with reason ("GPU is 358 mm, case max 330 mm" / "no case selected yet — length unchecked"). Overall tri-state `fit`. |
| `estimate_performance` | `workload` (gaming / streaming / video-editing / 3d-rendering / ml / office), optional `resolution` (1080p / 1440p / 4k) | Per-component tier (§6.2), min-tier bottleneck, balance note, PSU load estimate. `summary` says "editorial tier estimate". |

### 4.2 Write tools

**Stale-write guard (all build/goal writes):** each write compares against `expectedRevision` if the agent supplies it, otherwise against **`lastSeenRevision` — the `buildRevision` this tool layer most recently returned to the agent**. Mismatch → `ok:false, STALE_REVISION`, nothing mutated, current digest in the envelope. See §4.5 for why this is the default rather than a required parameter.

| Tool | Input | Returns |
|---|---|---|
| `add_part` | `partId`, optional `replace: boolean` (single-slot categories), optional `replacesPartId` (multi-slot: swap this specific RAM kit / drive), optional `expectedRevision` | New digest + validation delta (`added` / `removed` conflict codes). Single-slot occupied without `replace` → `SLOT_OCCUPIED`. |
| `remove_part` | `partId` **or** `category` (removes *all* parts in a multi-slot category — stated in description), optional `expectedRevision` | New digest + delta. |
| `set_build_goal` | `useCase` (enum), `budgetUSD`, optional `preferences: { noise?: "quiet"\|"standard", size?: "compact"\|"standard"\|"any", lighting?: "rgb"\|"none"\|"any", color?: "black"\|"white"\|"any" }`, optional `expectedRevision` | Ack + goal-aware validation. **Enums only, no free text.** Goal counts as build state (bumps `buildRevision`). |
| `reset_build` | `confirm: true`, optional `expectedRevision` | Cleared build, new revision. |
| `render_build` | optional `style: "photoreal"\|"cutaway"\|"studio"`, optional `angle: "front"\|"three-quarter"\|"side"`, optional `flair` (single-line string, max 200 chars) | `{ renderId, forBuildRevision, buildHash, imageUrl (same-origin), cached, status: "active"\|"superseded" }`. `flair` carries visible cosmetic direction such as “a turtle sticker on the glass panel”; it is render-scoped and **does not change `buildRevision`** (§4.5). Requires a case → `RENDER_NEEDS_CASE`. May require human verification or return limit/progress errors with retry details. |

### 4.3 Solver & output tools (the differentiators)

| Tool | Input | Returns |
|---|---|---|
| `suggest_alternatives` | `category`, optional `direction` (cheaper / better / quieter / smaller), `count` (default 3, max 6) | Candidates for the slot such that the swap **introduces no new errors and does not worsen existing conflicts**; each with price delta, spec delta, validation delta, `verified`, tradeoff sentence. Ranking per §6.3; inapplicable direction → `DIRECTION_NOT_APPLICABLE` listing applicable ones. |
| `fit_to_budget` | `budgetUSD`, optional `protect: string[]` (categories that must not change), optional `preserve: "performance"\|"noise"\|"size"` (default from goal, else performance) | A **proposal**: `proposalId`, `forBuildRevision`, ordered `ops: [{op: "replace", category, fromPartId, toPartId, savings, tradeoff}]`, resulting total + validation. Not applied. Semantics §6.4. Infeasible → `BUDGET_INFEASIBLE { cheapestTotal, blockedBy: [protected categories] }`. |
| `export_build` | `format` (markdown / json / url) | Markdown list, raw JSON, or share URL **`/b/<id>#b=<payload>`** (`id` content-addressed via Worker KV; the fragment carries the full payload so the link works even before KV propagates or if the backend is down — `transport: "short+fragment" \| "fragment"`). |

> Tool count: `get_build_state`, `search_parts`, `get_part_details`, `validate_build`, `explain_compatibility`, `estimate_performance`, `add_part`, `remove_part`, `set_build_goal`, `reset_build`, `render_build`, `suggest_alternatives`, `fit_to_budget`, `export_build` = **14**. Derived at runtime wherever shown.

**Applying a proposal:** the agent applies each op with `add_part { partId: toPartId, replace: true | replacesPartId: fromPartId }`. Each successful write returns a new `buildRevision`; the next op is checked against it (automatically via `lastSeenRevision`). A human edit mid-plan therefore fails the next op with `STALE_REVISION`; the description tells the agent to re-run `fit_to_budget` in that case. No `apply_proposal` tool — the human sees each swap in the feed.

#### `render_build` details (v2.1 trust boundary)

- **Client sends only** `{ v: 1, partIds: string[], goal?: {enums}, style, angle, flair? }` plus the session cookie. `flair` is optional, single-line and capped at 200 characters; no prompt or hash is accepted.
- **Worker** (bundling the same `src/data` schema + `src/engine/renderPrompt.ts`): validates ids against the D1 catalog and enums against the schema (body ≤ 2 KB) → rebuilds the canonical prompt → `buildHash = sha256(canonical prompt)` → checks R2 → on a miss calls `gpt-image-2` → stores the returned image under `renders/<renderId>.webp` with a 30-day lifecycle rule. Rich requests ask for 1536×1024 medium-quality WebP at compression 60, with a minimal retry for unsupported optional parameters. Provider URLs are never exposed.
- **Two render modes (added 2026-08-29, docs/RENDER_FIDELITY.md Phase 2).** Every response carries `mode`. Composition requires an **exact, reviewed case card**. For each present GPU/cooler/RAM category, an exact card wins and a reviewed, compose-eligible generic archetype may fill the gap; if any required reference is unavailable or dangling, the request falls back to text generation without failing. Composed mode reads cards server-side and calls the Images edits endpoint with ordered `image[]` references plus `composePrompt()`. The client cannot supply an image, URL or card key. Hashes include normalized flair; the R2 key / `renderId` additionally folds in mode and selected card keys, so cosmetic variants, modes and card revisions never collide.
- **Prompt template** is deterministic from hardware attributes plus normalized optional flair: case class/volume/color/window/front style, GPU length class, cooler type (tower / AIO radiator size), RAM stick count, lighting preference, style, angle, then an isolated cosmetic-detail sentence. **No brand or model names from catalog data and no client-supplied full prompt.** The fixed tail continues to forbid text, logos and brand marks. Snapshot-tested; the Worker boundary is tested with forged prompts, unknown ids, oversized bodies, invalid enums and invalid flair.
- **Abuse controls:** `POST /api/verify` validates Turnstile and issues two signed HttpOnly SameSite=Strict cookies scoped to `/api/`: a random anonymous `rb_device` id (30 days, refreshed on verification) and an `rb_session` Turnstile proof bound to that id (1 h). `/api/render` without a valid session → `VERIFICATION_REQUIRED`. The Rate-Limiting binding remains a per-IP 5/60 s burst guard. On an R2 miss, the single global Durable Object atomically enforces **10 cold renders per device per UTC day** and the configurable global ceiling (default 200/day); cache hits consume neither. Distinct `RENDER_USER_DAILY_LIMIT` and `RENDER_GLOBAL_DAILY_LIMIT` errors carry remaining counts, `retryAfterSec`, and `resetsAt`. A 90 s render-hash lease rejects concurrent duplicate misses with `RENDER_IN_PROGRESS` without consuming quota. Timeout 60 s → `RENDER_FAILED`.
- **Artifact lifecycle** (§4.5): render is `{ renderId, forBuildRevision, buildHash, status }`. On completion, if the current build's hash still equals `buildHash` → becomes the active stage image; else stored in the strip as "rev N — superseded" and the stage keeps the schematic. Aborting the tool aborts the fetch (provider cost may already be incurred). Renders are **not** undoable — they are artifacts, not build mutations.
- **Cost:** `gpt-image-2` is a paid API and is configured in production. Cold text/composed latency still needs rehearsal measurement; warm the demo checkpoints so the video's render beat is a cache hit — and say so in the voice-over.
- **Degraded:** backend/key missing → `RENDER_UNAVAILABLE`; UI shows the schematic.

### 4.4 Response envelope (every tool, always)

```jsonc
{
  "ok": true,
  "buildRevision": 12,
  "summary": "GPU replaced; 0 errors, 1 warning",
  "digest": { "slots": {"cpu":"cpu-9800x3d","gpu":"gpu-5070ti","case":null,"...":"..."},
              "totalUSD": 1487, "estWatts": 520, "validation": {"errors":0,"warnings":1,"info":0} },
  "data": { /* tool-specific */ },
  "delta": { "added": ["PSU_LOW_HEADROOM"], "removed": ["GPU_TOO_LONG"] },   // writes only
  "error": { "code": "STALE_REVISION", "message": "...", "details": {} }      // ok:false only
}
```

Error codes: `UNKNOWN_PART`, `SLOT_OCCUPIED`, `INVALID_INPUT`, `STALE_REVISION`, `DIRECTION_NOT_APPLICABLE`, `BUDGET_INFEASIBLE`, `RENDER_NEEDS_CASE`, `VERIFICATION_REQUIRED`, `RENDER_RATE_LIMITED`, `RENDER_USER_DAILY_LIMIT`, `RENDER_GLOBAL_DAILY_LIMIT`, `RENDER_IN_PROGRESS`, `RENDER_FAILED`, `RENDER_UNAVAILABLE`, `BACKEND_UNAVAILABLE`, `CANCELLED`, `INTERNAL`.

### 4.5 State contract

Constraint acknowledged: the page cannot instruct the agent — it only sees descriptions and responses.

1. **`buildRevision`** increments on every mutation of parts or goal, by human or agent (incl. undo). UI-only state (panel open, selected tab) and render artifacts do **not** touch it.
2. **Every response carries `buildRevision` + digest**, so any call re-syncs the agent.
3. **Stale-write guard without agent cooperation.** The tool layer records `lastSeenRevision` = the `buildRevision` most recently *returned to the agent* by any tool. A write with no `expectedRevision` is checked against `lastSeenRevision`; a write with `expectedRevision` is checked against that. Either mismatch → `STALE_REVISION`. Consequence: if the human edits the build between two agent calls, the agent's next write fails *even if the agent never learned about revisions*. `lastSeenRevision` is initialized to the current revision at registration (first call before any read is allowed). **Deliberate disagreement with review round 2 #3 (required parameter)** — see REVIEW_RESPONSES.md.
4. **Chaining.** A successful write returns the new revision, which becomes `lastSeenRevision`; multi-step plans therefore chain automatically.
5. **Description nudge** on writes: "If the human may have changed the build, call `get_build_state` first; on `STALE_REVISION`, re-read and re-plan."
6. **Human-side signal.** Human edits post a feed row "👤 changed <slot> — the agent will see this on its next call (rev N)".
7. **Renders** are artifacts bound to `{forBuildRevision, buildHash}` with `status: active | superseded` (§4.3). `get_build_state` reports the active one.
8. `toolchange` is not used to carry state; descriptions stay static.

### 4.6 Size budgets (Chrome guidance ≈ 500 chars/tool description, 150/parameter, 1 500/output)

- Test: every description ≤ 500 chars; every parameter description ≤ 150 chars. Shared context (categories, id format) lives in `get_build_state` + `search_parts` only.
- Digest: fixed overhead ≤ 200 chars (test); with the real catalog's 8 longest ids the complete digest is currently 476 chars. The earlier “≤ 200 absolute” target was unattainable without renaming ids, so output budgets below are **net of the digest**.
- Output test with worst-case names, net of digest: ordinary tools stay ≤ 1 500 chars; `get_build_state` and full `validate_build` are documented big calls with ≤ 3 000 and ≤ 2 000 respectively. Measured 2026-08-29: `search_parts` 1 474, `explain_compatibility` 1 464, `suggest_alternatives` 1 423, `fit_to_budget` 1 458, build/goal writes 236–393 net. `search_parts` defaults to **6**; maximum 20 stays within its separate 3 000-character test.

### 4.7 Admin tools (registered only on `/admin`, behind Cloudflare Access)

The operator's agent typically has its own web-search capability. The page does **not** search the web; it gives the agent the schema, the duplicate check, and a draft/publish workflow with a human gate.

| Tool | Input | Returns / rules |
|---|---|---|
| `catalog_search` | `query`, optional `category`, `status: "published"\|"draft"\|"all"` | Matching parts (id, name, brand, category, price, `verified`, `status`, `updatedAt`). `readOnlyHint`. **`untrustedContentHint: true`** — results may contain agent-entered text. Description tells the agent to search before upserting to avoid duplicates. |
| `catalog_get_schema` | `category` | The JSON Schema for that category's part (generated from zod) + id format rule + field notes (units: mm, W, MHz). `readOnlyHint`. |
| `catalog_upsert_part` | `part` (full category schema; `id` optional on create), **`sources: [{url, title}]` (≥ 1, https only)**, optional `note` (≤ 200 chars) | Validates against the schema; writes a **draft** with `verified: false`, `addedBy: "agent"`, `priceUpdatedAt: now`. Returns `{partId, status: "draft", validation: {ok, issues[]}, diff}` (diff vs. published if updating). Cannot set `verified`. Name ≤ 80, brand ≤ 40, plain text only (no URLs/markup — rejected). |
| `catalog_update_price` | `partId`, `priceUSD`, `sourceUrl` | Draft price change; `priceUpdatedAt` set on publish. |
| `catalog_publish` | `confirm: true`, optional `partIds` (default: all drafts) | Promotes drafts → published, bumps `catalogVersion`, appends `change_log`. Returns new version + summary. **Not** read-only. |

- **Verification is human-only:** the ✓ *Verified* toggle exists only in the admin UI (after the human checks the source pages). Agent-added parts therefore surface on the shopper side as unverified, exactly like bulk-generated seed data, until a human verifies them.
- **Trust boundary:** every string field is schema-validated, length-capped, and rejects URLs/markup where plain text is required; `sources[].url` must be https and is stored, never rendered as a link in shopper responses. Shopper tools emit only length-capped `name`/`brand` from admin-authored prose. `catalog_search` and `catalog_upsert_part` carry `untrustedContentHint`; the schema read is trusted, static output.
- **Research flow (the demo):** operator: *"The RTX 5060 Ti 16 GB launched today — find its specs and add it."* → agent web-searches (its own capability) → `catalog_get_schema("gpu")` → `catalog_search` (no duplicate) → `catalog_upsert_part` with `sources` → draft appears in the admin table with a diff → human clicks *Verify* after glancing at the sources (or leaves it unverified) → `catalog_publish` (agent, `confirm: true`, or the human's Publish button) → shopper page shows "catalog v43" and `search_parts` finds the new GPU.
- Registration: same `tools.ts` pattern, separate module `src/admin/tools.ts`, registered only when the `/admin` route mounts (own `AbortController`, unregistered on leave).

---

## 5. Compatibility engine

Pure TS: `validate(build, goal?) → Conflict[]`, `estimateWattage`, `fit(part, build) → {fit, checks[]}` (tri-state), `compatibleParts`, `alternatives`, `fitToBudget`, `performance`, `renderPrompt(build, goal, style, angle, flair?)`, `composePrompt(...)`, and deterministic card-archetype selection. Every rule has a stable code and declares which slots it needs; if a needed slot is empty the rule reports `unknown` (feeds `conditional`).

### Rules v1 (severity in brackets)

| Code | Check |
|---|---|
| `SOCKET_MISMATCH` [error] | CPU socket ≠ motherboard socket. |
| `CHIPSET_UNSUPPORTED` [error] | CPU generation not in the chipset's support table (documented in SOURCES.md). |
| `RAM_TYPE_MISMATCH` [error] | DDR4 RAM on DDR5 board etc. |
| `RAM_SLOTS_EXCEEDED` [error] | More sticks than slots. |
| `RAM_SPEED_LIMITED` [warning] | RAM rated above board's max (will downclock). |
| `FORM_FACTOR_MISMATCH` [error] | Motherboard form factor not supported by case. |
| `GPU_TOO_LONG` [error] | GPU length > case max GPU clearance. |
| `COOLER_TOO_TALL` [error] | Air-cooler height > case max cooler height. |
| `COOLER_SOCKET_UNSUPPORTED` [error] | Cooler's socket list lacks CPU socket. |
| `RADIATOR_UNSUPPORTED` [error] | AIO radiator size not in case's supported list. |
| `COOLER_UNDERSIZED` [warning] | Cooler TDP rating < CPU TDP. |
| `PSU_INSUFFICIENT` [error] | Estimated load > PSU wattage. |
| `PSU_LOW_HEADROOM` [warning] | Headroom < 20 %. |
| `PSU_FORM_FACTOR` [error] | PSU form factor doesn't fit case. |
| `NO_IGPU_NO_GPU` [error] | CPU without iGPU and no discrete GPU. |
| `M2_SLOTS_EXCEEDED` / `SATA_PORTS_EXCEEDED` [error] | Storage exceeds board connectivity. |
| `PCIE_GEN_MISMATCH` [info] | GPU/SSD PCIe gen above board's. |
| `COOLER_MISSING` [warning] | CPU without stock cooler and no cooler. |
| `OVER_BUDGET` [warning, goal] | Total > goal budget. |
| `GOAL_SLOT_MISSING` [info, goal] | e.g. gaming goal, no GPU yet. |
| `TIER_IMBALANCE` [info, goal] | Flagship GPU + entry CPU for gaming goal, etc. |
| `GOAL_NOISE` [info, goal] | Goal `noise: quiet` and any part with noiseTier ≥ 4. |
| `GOAL_SIZE` [info, goal] | Goal `size: compact` and case volume > 25 L. |

Wattage model: Σ per-part draw estimates (CPU TDP × 1.2, GPU TDP × 1.4 transient factor, 5 W per stick/SSD, 30 W board/fans) + 50 W base. Documented as an estimate.

**Testing:** fixtures per rule (bad build per code, good build triggering nothing, *incomplete* build yielding `unknown`), optimizer and ranking tests with deterministic expected outputs, renderPrompt snapshots, Worker boundary tests.

---

## 6. Dataset and models

### 6.1 Dataset

**Curated, rich, living.** The current seed contains **448 parts**, with a current-generation skew (AM5/LGA1851 + one legacy generation each). Every part passes schema + referential checks (`pnpm check:data`) before seeding. **Storage:** D1 is the catalog of record; `src/data/parts/*.json` is the curated seed (imported by `pnpm catalog:import`, which validates, upserts, and publishes a new `catalogVersion`) and the bundled offline fallback. Each part carries `status`, `verified`, `sources[]`, `addedBy` (seed / human / agent), `priceUpdatedAt`, `updatedAt`. The shopper page fetches `/api/catalog` on load (ETag; cached in localStorage), shows `catalogVersion` + snapshot date in the footer, and includes `catalogVersion` in `get_build_state`. **82 parts are hand-verified** against recorded public source pages and carry `verified: true`; the UI shows ✓ and returned part records expose the flag. Verified parts win ties in ranking and optimization.

| Category | Count | Verified | Critical fields (beyond name/brand/price/verified) |
|---|---:|---:|---|
| CPU | 54 | 0 | socket, generation, cores/threads, boostClock, tdp, hasIgpu, includesCooler, perfTier{} |
| Motherboard | 64 | 15 | socket, chipset, formFactor, ddrGen, maxRamSpeed, ramSlots, m2Slots, sataPorts, pcieGen |
| RAM | 44 | 0 | ddrGen, speed, sticks, capacityPerStick, hasRgb |
| GPU | 49 | 13 | lengthMm, slots, tdp, pcieGen, recommendedPsuW, vram, noiseTier, perfTier{} |
| Cooler | 70 | 13 | type (air/aio), heightMm or radiatorMm, socketSupport[], tdpRating, noiseTier, hasRgb |
| Case | 76 | 34 | formFactorSupport[], maxGpuLengthMm, maxCoolerHeightMm, radiatorSupport[], psuFormFactor, volumeLiters, color, hasWindow, frontStyle, noiseTier |
| PSU | 46 | 7 | wattage, formFactor, efficiency, modular, noiseTier |
| Storage | 45 | 0 | interface (m2-nvme/sata), capacity, pcieGen |

- **Provenance policy (operational, no legal conclusions):** independently authored schema; values entered from public manufacturer spec pages; source URL recorded for every verified part; no copied descriptions, vendor images or logos; product names used textually only. Generated part cards may use vendor pages as temporary visual references under the guardrails in `RENDER_FIDELITY.md`, but vendor bytes are not retained or shipped. **Do not import** `docyx/pc-part-dataset` or anything PCPartPicker-derived. `src/data/SOURCES.md` documents method, snapshot date, verified set, and chipset support.
- Curation: schema first → bulk generation by agents → `check:data` → hand-verify the demo-path parts (the ITX-case mm figures verified *twice*).

### 6.2 Performance model (`perfTier`)

CPU and GPU carry `perfTier: { gaming1080p, gaming1440p, gaming4k, streaming, videoEditing, rendering3d, ml, office }` (1–10), authored from published review consensus, documented as an editorial tier in SOURCES.md. `estimate_performance` returns component tiers, min-tier bottleneck, balance note.

### 6.3 Alternatives ranking and utility

Candidates = parts in the category such that swapping introduces no new errors and does not worsen existing conflicts (validation delta returned per candidate). **Utility per category** (used by `better`, and as the optimizer's retained-utility objective): CPU/GPU = goal-workload perfTier; RAM = capacity × speed rank; storage = capacity × pcieGen rank; PSU = wattage rank + efficiency rank; cooler = tdpRating rank; case = volume-appropriate clearance rank; motherboard = feature rank (m2Slots + ramSlots + pcieGen).

| direction | applies to | ranking |
|---|---|---|
| `cheaper` | all | lower price, then higher utility |
| `better` | all | higher utility, then lower price |
| `quieter` | cooler, gpu, psu, case | lower `noiseTier`, then price |
| `smaller` | case (volumeLiters), cooler (heightMm / radiatorMm), motherboard (ITX < mATX < ATX < E-ATX), psu (SFX < SFX-L < ATX) | ascending size, then price |
| *(none)* | all | closest price with utility ≥ current |

Inapplicable → `DIRECTION_NOT_APPLICABLE`. Ties: `verified` first, then part id.

### 6.4 `fit_to_budget` semantics

- **Unit of search:** one choice per *category*. For multi-slot categories the search considers replacing the single most expensive kit/drive (documented); other items in that category are kept.
- **Candidates:** per unprotected filled category, up to 6 alternatives sorted `cheaper` **plus "keep" = up to 7 choices**. ≤ 5 categories → exhaustive (≤ 7⁵ = 16 807 combos, price-pruned); > 5 → beam search width 50. Every evaluated combination runs `validate()`.
- **Objective**, lexicographic among combinations with total ≤ budget: (1) minimize loss in the `preserve` metric (performance: Σ goal-workload perfTier drop, GPU ×2 / CPU ×1.5 for gaming; noise: Σ noiseTier increase; size: volume increase); (2) minimize number of swaps; (3) **maximize retained utility** (§6.3) across swapped categories; (4) highest total ≤ budget; (5) verified first; (6) part-id order. Deterministic.
- **Protected** categories immutable; empty slots never filled.
- **Infeasible:** `BUDGET_INFEASIBLE { cheapestTotal, blockedBy }`.
- Output is ordered `ops` (§4.3); description says "bounded search over valid alternatives"; it *proposes*, the agent applies.

---

## 7. UI: manual-first, agent-visible, visually distinctive

### 7.1 Visual direction — "the workbench"

Non-negotiable: **must not look like a generic Tailwind dashboard.** The implemented direction is documented in `THEME.md`:

- **Metaphor:** a daylight engineer's workbench — pale green ESD mat, warm ceramic trays, restrained drafting grid. Cable-orange ember is reserved for *agent actions*; instrument-blue glacier denotes the human and interactive controls; red/amber/green remain validation-only.
- **Center stage:** proportional SVG **build measurement board** with assembly and footprint views. Components share a scale; the representative case envelope is volume-derived; modeled dimensions such as "GPU 304 / 330 mm" are annotated. `render_build` images land here with a reveal; superseded renders go to a strip.
- **Instrumentation:** power draw as a gauge with the PSU headroom band; price ticker; conflicts as callouts pointing at the affected slot.
- **Type:** condensed technical display face for headings, mono for specs/ids, clean sans for prose.
- **Motion:** agent mutations flash in the agent accent, feed row slides in, gauge moves; ≤ 300 ms.
- **No third-party imagery, no logos.** Reviewed, brand-free part cards generated from catalog attributes may appear as small inspection-window thumbnails; an exact part card wins, otherwise the UI uses a deterministic generic archetype or a text marker.

### 7.2 Layout

Responsive behavior: **≥ 1280 px** opens three regions side by side by default; **1024–1279 px** defaults to build + stage/browser, with Activity able to add/remove the collaboration column; **< 1024 px** is one scrolling column with stage and browser first, followed by goal/slot rail/instruments, while collaboration becomes a drawer with a badge. The demo is rehearsed at roughly 800 px.

1. **Build slots.** 8 slot cards: filled (part, price, ✓ verified, swap/remove) or empty. Goal banner. Totals + gauge.
2. **Stage + part browser.** Stage on top. Browser: category tabs, search, typed filters, **"only compatible" toggle** (ON by default once non-empty: shows `compatible` + `conditional` with a "not yet checked: length" hint, hides `incompatible` with a "12 hidden — show" count; OFF: incompatible parts are dimmed with an inline reason and remain selectable through an explicit engine-derived "Add/Swap anyway" warning, preserving human control while preventing accidental invalid builds).
3. **Collaboration panel.** Validation report (conflict cards, "fix" jumps to browser with filter) + **activity feed** (meaningful 🤖 tool work and 👤 human actions, with revisions and concise results). State-sync chatter such as `get_build_state` is intentionally omitted. Build mutations have guarded **undo**.

**Undo:** guarded inverse operations — a row's undo applies only if the affected slot still holds what that action left there; otherwise "superseded". Ctrl+Z (top of stack) always works. Undo bumps `buildRevision` and is logged. Renders are not undoable.

**Share/load:** `/b/<id>#b=<payload>` and bare `#b=<payload>` both load payload `{v:1, parts:[ids], goal}` (version-checked, ≤ 2 KB, unknown ids dropped with a notice, malformed → friendly error). The app tries the fragment first and uses KV only for a bare short-id route. **Render artifacts are not part of the share contract and are not fetched automatically on share load**; the schematic appears until the user/agent renders. Normal non-share visits restore the local build, goal and latest valid active render from `rigbuilder.build.v1` in localStorage.

**The demo money shot:** agent narrates, slots fill with highlights, schematic assembles, validation flips red → green, the human swaps a part mid-conversation, the agent's next write is rejected as stale, it re-reads and adapts; then the agent renders the finished build into the stage.

### 7.3 `/admin` — catalog workspace (operator side)

Deliberately minimal; same theme, "back office" variant of the workbench:

- **Catalog table:** search, category filter, status filter (published / draft), columns id · name · brand · price (`priceUpdatedAt`) · verified ✓ · sources · updatedAt · addedBy. Inline edit of price and sources.
- **Add part** form generated from the zod schema per category (same validator as the tools).
- **Draft diff panel:** every draft shows its change vs. published (new / changed fields), its sources as links (admin context only), and *Verify* ✓ (human-only) + *Discard*.
- **Publish** button (with a confirm) → new `catalogVersion`; change log below (reuses the activity-feed component: 🤖 agent drafts, 👤 human verify/publish).
- WebMCP chip: "WebMCP · 5 catalog tools exposed to your agent".
- Gated by Cloudflare Access (email allowlist). No roles, no user management, no bulk-import UI (the CLI is the bulk path), and no card-generation/publication UI. The catalog table does show reviewed exact/generic thumbnails and card status.

---

## 8. Security, trust & privacy

- **Prompt-injection exposure: low and bounded** (not zero). Shopper side: goal preferences are enums; share payloads are validated and never reflected verbatim; responses are structured JSON; the only catalog prose returned is length-capped plain `name`/`brand`. `render_build.flair` is a separate single-line cosmetic field capped at 200 characters and isolated inside a fixed prompt template. **Admin side is where web-sourced text enters**: fields are schema-validated and capped; plain-text fields reject URLs/markup/newlines; `sources[].url` is https-only and stored but not returned through shopper tools; `catalog_search` and `catalog_upsert_part` carry `untrustedContentHint`; agents cannot verify; publish requires confirm + Access; drafts are diffable and discardable.
- `readOnlyHint: true` on all non-mutating tools. Writes are small and explicit (`replace`, `confirm`, stale-write guard).
- **Human control:** guarded undo; proposals not auto-applied; stale writes rejected.
- **Worker boundary:** accepts ids + enums plus bounded optional render flair; rebuilds prompt/hash; body caps; schema validation; Turnstile → signed anonymous-device + session cookies; Rate-Limiting binding (IP bursts) + one Durable Object (atomic per-device/global daily caps and duplicate-render leases). **CORS is not a control** — the cookies + limits are.
- **Privacy table (goes in README):**

| Data | Where | Retention | Notes |
|---|---|---|---|
| Catalog (parts, drafts, change log) | D1 | Indefinite | Product data only; `addedBy` is a role, not an identity; sources are public URLs |
| Admin identity | Cloudflare Access (verified email/PIN) + admin audit log | Per Access policy / operational retention | Access logs at the edge; each catalog mutation stores its responsible verified identity server-side. Admin UI responses mask emails; shopper APIs/tools never receive identity data. |
| Current build (part ids + goal enums) | Browser localStorage | Until cleared by the browser/user | No account or server sync; restored through the current catalog |
| Saved build payload (part ids + goal enums) | KV, content-addressed id | 90 days TTL | Public to anyone with the link; nothing personal inside |
| Render image | R2 `renders/<hash>.webp` | 30 days | Keyed by prompt hash; no user identifier |
| Derived render prompt | Sent to OpenAI (`gpt-image-2`) | Per OpenAI API policy | Generic build attributes plus optional user-authored cosmetic `flair` |
| Anonymous device cookie | Browser | 30 days, refreshed on verification | Signed random id used only for render allowance |
| Session cookie | Browser | 1 h | Signed Turnstile proof bound to the anonymous device id |
| Anonymous render counters | Durable Object | Current UTC-day record; replaced on first later-day access | Device id → count only; global and per-device updates are atomic |
| IP address | Rate-limit binding | Provider-managed rate-limit window | Used only for 5/60 s bursts; not written to D1/KV/R2 by the app |
| Worker logs (observability) | Cloudflare | Cloudflare default | Method, path, status, duration; **no bodies, prompts or ids** (logging policy enforced in code) |

- No `exposedTo` (top-level page only).

---

## 9. Environments, deploy & testing

| Environment | Mechanism | Notes |
|---|---|---|
| ChatGPT desktop built-in browser | Site tools, when enabled for the account and selected model | **Primary judging target.** Narrow-pane layout; full eval pass still pending. |
| Chrome 149+ (judges) | **Origin-trial token** for the production origin (meta tag in `index.html`) + compatible agent/Model Context Tool Inspector | Token is installed and served; API discovery/agent evals still need to be logged. Treat this as a separate client lane from the ChatGPT desktop browser. |
| Chrome (local dev) | `chrome://flags/#enable-webmcp-testing` + Model Context Tool Inspector | |
| Any browser, no WebMCP | Manual picker fully functional | |

- Deploy: `pnpm deploy` (Vite + Wrangler). Bindings: **D1 `CATALOG`** (migrations in `scripts/migrations/`, `pnpm catalog:import` seeds/publishes, `pnpm catalog:reset[:remote]` wipes back to seed v1), R2 `RENDERS`, KV `BUILDS`, Rate-Limiting `RENDER_BURST`, Durable Object `RenderQuota`. **Cloudflare Access** covers `/admin` + `/api/admin/*`; the Worker also validates `Cf-Access-Jwt-Assertion`. Secrets are set separately with `wrangler secret put IMAGE_API_KEY`, `TURNSTILE_SECRET`, and `SESSION_HMAC_KEY`. Vars include `IMAGE_PROVIDER`, global/user render caps, public Turnstile site key, and Access domain/AUD. Local dev reads `.dev.vars`.
- **Production snapshot (2026-08-29):** app and `/api/health` return 200; D1 is reachable at catalog v3 with 448 published parts; image key, R2, quota, burst, session/Turnstile and KV report configured; unauthenticated admin API access redirects to Cloudflare Access; the origin-trial meta is present; all 38 generic cards and sampled demo-path exact cards are served.
- **Evals** (`docs/EVALS.md`): 12 shopper prompts + 3 admin prompts, including stale-write recovery without explicit `expectedRevision`, a multi-op budget plan, bounded render flair, cold/cached/verification behavior, a sourced catalog draft, human-only verification, and price publication. Run in both clients; log in `EVALS.md` and DEMO.md §4.
- **Automated:** 285 tests in 28 files cover engine rules/optimizer/ranking, state/persistence/share, envelopes/descriptions/registration, admin validation and Access JWTs, catalog/cards, render/provider/session/quota/burst boundaries, exact/generic composition and flair. `pnpm check:data` separately validates all 448 seed records and referential rules.

---

## 10. Repo & submission

- `adner/RigBuilder`, public, MIT. First commit 2026-08-29. Predecessor cited as prior art, rebuilt.
- README: what/why, architecture, tool tables (14 shopper + 5 admin), live URL, setup, deploy + bindings, testing with/without WebMCP, admin flow, data provenance + disclaimer, security + privacy table, license.
- Devpost text from §1 + §2. Video < 3 min per `docs/DEMO.md`; **all generated images reviewed before inclusion** (models can invent text/logos).

## 11. Delivery status and remaining schedule

The originally planned implementation workstreams finished ahead of their dated slots. Current status on 2026-08-29:

- **Implemented and automated-verified:** application shell, 24-rule engine, optimizer/ranking/performance, 448-part seed and D1 catalog, versioned/persisted store, 14 shopper tools, 5 admin tools, Access-gated admin UI/API, render/share/session/quota infrastructure, exact/generic card pipeline and thumbnails, responsive shopper/admin UI, documentation baseline.
- **Production infrastructure verified:** live origin, origin-trial meta, D1/R2/KV/DO/rate limit/Turnstile/session/image-provider health, Access redirect, catalog v3.
- **Still requires human/client evidence:** both-client WebMCP eval logs, cold text/composed render timing, composed-vs-text A/B decision, judge Access login, full demo rehearsal, video, Devpost testing instructions and submission.

| Date | Remaining deliverable |
|---|---|
| **Aug 30–31** | Run all shopper/admin evals in ChatGPT desktop (with site-tools access) and Chrome 149+ with the compatible inspector/agent; exercise the actual judge Access account; measure cold text/composed rendering; run the render-fidelity A/B gate; fix only evidence-backed issues. |
| **Sep 1** | Make DEMO beats 2–5c repeatable at the narrow breakpoint; warm checkpoint renders; freeze Devpost copy and testing instructions. |
| **Sep 2** | Full rehearsal, record/review/upload the <3-minute video, run final automated verification and production smoke checks. |
| **Sep 3** | Final link/credential check and submit well before 22:00 CEST. |

**Scope policy (owner decision 2026-08-29):** the full implemented tool surface remains. If composed rendering or the admin flow is not reliable enough after evals, the video may omit that beat; documentation and test instructions must state the observed behavior accurately. See REVIEW_RESPONSES.md R2-#1.
