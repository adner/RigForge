# RigBuilder backend runbook — catalog (D1) + admin API

The Worker (`worker/`) serves the catalog of record from **Cloudflare D1** and exposes
Access-gated admin writes. The shopper page never *needs* the backend (see "When the
backend is down"); `/admin` does. Design: `docs/DESIGN.md` §3, §4.7, §6.1, §8, §9.

**Production snapshot (2026-08-29):** the app and health endpoint return 200; D1 is
reachable at catalog v3 with 448 published parts; the image key, R2, quota, burst,
session/Turnstile and KV integrations report configured. Unauthenticated requests to
the admin API redirect to Cloudflare Access. The setup commands below remain the
recovery/reprovisioning procedure, not a description of the current production version.

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | – | `{ok, d1Reachable, catalogVersion, …}` |
| GET | `/api/catalog` | – | Published parts + `catalogVersion` + `snapshotDate`. ETag `"v<version>"`, `If-None-Match` → 304, `Cache-Control: public, max-age=60, stale-while-revalidate=600`. Header `x-rigbuilder-catalog-source: d1 \| seed`. |
| GET | `/api/admin/parts?status=published\|draft\|all&category=&q=&full=1&limit=` | Access | List (summaries; `full=1` for whole parts) |
| GET | `/api/admin/session` | Access | Current viewer's own verified identity and whether mutations are accountable (false only for local bypass). |
| GET | `/api/admin/parts/:id` | Access | `{published, draft, diff}` |
| GET | `/api/admin/schema/:category` | Access | JSON Schema (from zod) + field notes |
| GET | `/api/admin/log?limit=&before=` | Access | `change_log` newest first: `{entries:[{at, actor, identity, action, partId, detail}], nextBefore}`. Every mutation records the responsible verified Access identity; the API masks email addresses for other admin viewers. `limit` default 50, max 200; `before` is an ISO cursor (entries strictly older). `nextBefore` = last `at` when the page is full, else `null`. |
| GET | `/api/admin/card-status` | Access | Reviewed image-index membership for admin badges: `{specificPartIds, genericArchetypes}`. Content-addressed R2 keys are never exposed. |
| POST | `/api/admin/parts` | Access | Upsert a **draft**: `{part, addedBy?: "agent"\|"human", note?}`. Server forces `status:"draft"`, `verified:false`, `updatedAt:now`; `id` optional on create. `verified:true` in the body → `400 VERIFIED_IS_HUMAN_ONLY`. |
| POST | `/api/admin/parts/:id/price` | Access | `{priceUSD, sourceUrl?, addedBy?}` → draft (created from the published row if needed), `priceUpdatedAt:now` |
| POST | `/api/admin/parts/:id/verify` | Access **+ `X-RigBuilder-Admin-UI: 1`** | `{verified?: true}` → draft with `verified` set. **Human-only**: the header is sent only by the admin UI's Verify toggle; the WebMCP admin tools never call this route. Without the header → `403 VERIFIED_IS_HUMAN_ONLY`. |
| POST | `/api/admin/parts/:id/discard` | Access | Drop the draft |
| POST | `/api/admin/publish` | Access | `{confirm:true, partIds?, actor?: "agent"\|"human"}` → drafts → published, `catalogVersion+1`, `change_log` rows. `confirm` missing → `400 CONFIRM_REQUIRED`. |

### Admin authorization

Cloudflare Access authenticates every admin viewer. The Worker then applies two roles
from the verified JWT email claim:

- **Owner** — an email listed in the `ADMIN_OWNER_EMAILS` secret; retains all current
  draft, price, verification, discard and publish capabilities.
- **Contributor** — every other authenticated identity; may create, edit, price,
  discard and publish brand-new part ids only. A contributor cannot draft or publish
  an overwrite of an existing published id, change an existing part's price, discard
  its draft, or mark anything verified. These checks run in the Worker and therefore
  cover the UI, WebMCP tools and direct API calls alike.

Production safely defaults to contributor-only when `ADMIN_OWNER_EMAILS` is absent.
Local `DEV_ADMIN_BYPASS=1` sessions are owners so development remains usable.

All errors use `{ok:false, error:{code, message, details?}}`. Bodies are capped at 16 KB
(`413 BODY_TOO_LARGE`). Worker logs contain method, path, status and duration only.

### Draft model

`parts` has PK `(id, status)`: a part may exist as `published` and, in parallel, as one
`draft` (the pending edit). Publishing deletes the published row and flips the draft.
The shopper catalog only ever reads `status = 'published'`, so drafts are invisible
until a human (or the agent's `catalog_publish` with `confirm:true`) publishes.

## One-time setup (owner)

The current production deployment reuses the pre-rename `rigforge-catalog` D1 database
and `rigforge-renders` R2 bucket so catalog records, reviewed cards, and cached renders
remain available. The commands below use RigBuilder names for a brand-new environment.

```sh
pnpm dlx wrangler login

# 1. D1
pnpm exec wrangler d1 create rigbuilder-catalog
#    → copy "database_id" into wrangler.jsonc  d1_databases[0].database_id
pnpm catalog:migrate:remote          # applies scripts/migrations/*.sql
pnpm catalog:import:remote           # validates SEED_CATALOG, upserts, publishes v1

# 2. Deploy
pnpm deploy
curl -s https://<app>.workers.dev/api/health   # expect d1Reachable:true, catalogVersion:1
```

Re-running `catalog:import` is idempotent: parts are upserted; the version is bumped
only when the seed content hash changed (`--force` bumps anyway). `--dry-run` writes the
SQL batches to `scripts/.tmp/` without executing.

**Reset to initial state:** `pnpm catalog:reset:remote` (local: `pnpm catalog:reset`) is
`catalog:import --reset` — it deletes `parts`, `catalog_versions` and `change_log`, then
re-imports the seed as **v1**. Use it before every full demo rehearsal (DEMO.md §0) so
agent-drafted parts, price changes and the version history from the previous run are gone.
Renders (R2) and share links (KV) are content-addressed and are left alone on purpose.
Shopper pages pick up the reset on their next load (ETag revalidation).

### Cloudflare Access (protects `/admin` and `/api/admin/*`)

1. Zero Trust dashboard → **Access → Applications → Add → Self-hosted**.
   - Application domain: `<app>.workers.dev`, paths `/admin` and `/api/admin` (add both).
   - Session duration: 24 h is fine for the judging window.
2. Policy: **Allow** → Include → *Emails* → your address **and the judge account** you
   list in the Devpost "testing access" field (one-time-PIN login needs no IdP setup).
3. From the application's **Overview** copy the **Application Audience (AUD) Tag**.
4. Your team domain is `<team>.cloudflareaccess.com` (Zero Trust → Settings → Custom Pages).
5. Set both in `wrangler.jsonc` `vars` (they are not secrets) and redeploy:
   ```jsonc
   "ACCESS_TEAM_DOMAIN": "<team>.cloudflareaccess.com",
   "ACCESS_AUD": "<aud tag>"
   ```
The Worker validates the `Cf-Access-Jwt-Assertion` JWT itself (RS256 against
`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, checks `iss`, `aud`, `exp`)
— Access at the edge is not trusted blindly. Until both vars are set, admin routes
answer `503 ACCESS_NOT_CONFIGURED`. For authenticated admin mutations it also records
the normalized, verified JWT email claim (or the Access subject when no email exists)
in the server-side change log. The identity is never stored in part JSON or returned by
the shopper catalog/tools; admin log responses mask email addresses.

## Environment reference

| Name | Kind | Where | Purpose |
|---|---|---|---|
| `CATALOG` | D1 binding | `wrangler.jsonc` | Catalog of record; `migrations_dir: scripts/migrations` |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | var | `wrangler.jsonc` | Access JWT validation |
| `IMAGE_PROVIDER`, `RENDER_DAILY_CAP` | var | `wrangler.jsonc` | Render workstream |
| `IMAGE_API_KEY`, `TURNSTILE_SECRET`, `SESSION_HMAC_KEY` | secret | `wrangler secret put …` | Render workstream |
| `ADMIN_OWNER_EMAILS` | secret | `wrangler secret put ADMIN_OWNER_EMAILS` | Comma-separated normalized Access emails with full catalog mutation rights |
| `DEV_ADMIN_BYPASS=1` | local only | `.dev.vars` | Skip Access validation on `/api/admin/*` (never set in prod vars) |
| `DEV_VALIDATE_CATALOG=1` | local only | `.dev.vars` | Re-validate `/api/catalog` with zod on each request |

## Local development

```sh
cp .dev.vars.example .dev.vars     # includes DEV_ADMIN_BYPASS=1 + DEV_VALIDATE_CATALOG=1
pnpm catalog:migrate               # local SQLite under .wrangler/state/v3/d1
pnpm catalog:import                # seed → local D1, publishes v1
pnpm dev                           # Vite + Worker; /api/* is served by the Worker

curl -s localhost:5173/api/health
curl -si localhost:5173/api/catalog | head -20
curl -s localhost:5173/api/admin/parts?status=all
curl -s localhost:5173/api/admin/schema/gpu | head -c 400
pnpm d1:local --command "SELECT status, COUNT(*) FROM parts GROUP BY status"
```

Admin smoke test (bypass on):

```sh
curl -s -X POST localhost:5173/api/admin/parts -H 'content-type: application/json' \
  -d '{"part":{"category":"psu","name":"Demo 650","brand":"Demo","priceUSD":89,"wattage":650,"formFactor":"ATX","efficiency":"80+ Gold","modular":"full","noiseTier":2,"sources":[{"url":"https://example.com/psu"}]}}'
curl -s -X POST localhost:5173/api/admin/parts/psu-demo-demo-650/verify -H 'content-type: application/json' -H 'x-rigbuilder-admin-ui: 1' -d '{}'
curl -s -X POST localhost:5173/api/admin/publish -H 'content-type: application/json' -d '{"confirm":true,"actor":"human"}'
curl -si localhost:5173/api/catalog | grep -i etag        # now "v2"
```

Tests: `pnpm test` runs `worker/*.test.ts` against an in-memory repo (no miniflare);
they cover ETag/304, the verified gate, markup rejection, draft forcing, publish
versioning, the 16 KB cap, and Access JWT validation with a real RS256 key pair.

Windows note: `wrangler d1 execute` sometimes exits with `0xC0000409` after the SQL
has run (workerd teardown). `catalog-import.ts` treats that as success only when the
output confirms the statements executed.

## When the backend is down

`src/catalog/loader.ts` (`loadCatalog()`):

1. `GET /api/catalog` with `If-None-Match` from the localStorage cache (`rigbuilder.catalog.v1`).
2. 304 → cached copy (`source: "cache"`); 200 → validate with `catalogSchema`, cache, use (`source: "network"`).
3. Network error / non-2xx / invalid payload → cached copy if any, otherwise the bundled
   `SEED_CATALOG` (`source: "seed"`). The footer shows "offline catalog · seed vN".

`getCatalogState()` / `subscribeCatalog(listener)` let the store react without React;
`catalogVersion()` feeds `get_build_state`. Render and share degrade separately (see
below). `/admin` requires the backend and Access.

---

# Render + share (R2, KV, Durable Object, Rate-Limiting, Turnstile)

Design: `docs/DESIGN.md` §4.3 "render_build details (v2.1 trust boundary)", `export_build`,
§7.2, §8, §9; `docs/REVIEW_RESPONSES.md` R2-#7/#8. Code: `worker/session.ts`,
`worker/render.ts`, `worker/builds.ts`, `worker/payload.ts`, `worker/quota.ts`,
`worker/burst.ts`, `worker/render-store.ts`, `worker/image-provider.ts`.

## Routes

| Method | Path | Guard | Purpose |
|---|---|---|---|
| POST | `/api/verify` | – | `{token}` (Turnstile) → siteverify → sets signed HttpOnly/Secure/SameSite=Strict `rb_device` (anonymous id, 30 days) and `rb_session` (Turnstile proof bound to that id, 1 h) cookies. A later verification reuses the valid device id. `403 VERIFICATION_FAILED` on a failed challenge. |
| POST | `/api/render` | session + IP burst + daily caps | `{v:1, partIds: string[], goal?, style?, angle?, flair?}` (≤ 2 KB, strict; `flair` is a bounded single line). Server resolves ids, rebuilds prompt/hash, then checks R2. Cache hits skip provider and both daily counters. A miss atomically consumes the per-device allowance (10/day) and global allowance (default 200/day), then calls the provider. Success includes `renderId`, `buildHash`, `imageUrl`, `mode`, `cached` and `quota: {userLimit,userRemaining,globalLimit,globalRemaining,resetsAt}`. Limit errors are distinct: `RENDER_RATE_LIMITED` (IP burst), `RENDER_USER_DAILY_LIMIT`, `RENDER_GLOBAL_DAILY_LIMIT`; a concurrent identical miss returns `409 RENDER_IN_PROGRESS` without consuming quota. |
| GET | `/api/render/quota` | session | Current per-device and global limits/remaining counts plus `resetsAt`; does not consume. |
| GET | `/api/render/:hash.webp` | – | Image bytes from R2, `Cache-Control: public, max-age=31536000, immutable`, `ETag "<hash>"`. 404 envelope otherwise. |
| POST | `/api/builds` | burst | `{v:1, parts: string[], goal?}` (≤ 2 KB, strict, ids validated) → `{id, url: "/b/<id>#b=<base64url payload>", payload, transport: "short+fragment" \| "fragment", ttlSec}`. `id = base32(sha256(canonical JSON))[:10]` — idempotent. |
| GET | `/api/builds/:id` | – | `{id, payload}` or 404. |
| GET | `/api/health` | – | adds `render: {provider, keyConfigured, r2, quota, burst, sessionConfigured, turnstileSiteKey, turnstileSkipped, dailyCap, userDailyCap}` and `share: {kv}`. |

Order of checks on `POST /api/render`: session → burst → body → catalog ids → prompt →
card index → mode → hash → R2 hit → card bytes → atomic device/global quota + hash lease → provider (60 s
`AbortSignal`) → R2 put. The prompt and body are never logged; render hashes and build
ids are collapsed to `:hash` / `:id` in the request log (DESIGN §8).

### Render modes: `text` and `composed` (docs/RENDER_FIDELITY.md Phase 2)

Every response carries `mode`:

- **`composed`** — the build's published *part cards* are read from R2 and sent to
  `POST https://api.openai.com/v1/images/edits` as multipart `image[]` reference images
  together with `composePrompt()` ("image 1 is the case, image 2 the graphics card…").
  The render then looks like the actual parts and stays consistent across angles.
  Chosen only when the **case has an exact reviewed card** and every present GPU,
  cooler and RAM has either an exact reviewed card or a reviewed, compose-eligible
  generic archetype card. Images are sent in case → GPU → cooler → RAM order.
- **`text`** — the original deterministic text-to-image path (`renderPrompt()` →
  `/v1/images/generations`). Used whenever a card is missing, the index is unreadable, or
  a card object behind an index entry is gone. **A missing card never fails a render.**

Two hashes, deliberately different:

| Field | Input | Used for |
|---|---|---|
| `buildHash` | `sha256(renderPrompt(...))` | build identity; the page recomputes it to tell an *active* render from a *superseded* one. Unchanged by the mode. |
| `renderId` (= the `imageUrl` hash, = the R2 key) | `sha256(prompt)` for `text`, `sha256(prompt + "\|composed\|" + cardKeys.join(","))` for `composed` | the cache key. Text-only and composed renders never collide, and because card keys are content-addressed, republishing a card invalidates every render that used it. |

Card bytes are read **server-side by part id**. The request body schema stays strict: the
client cannot supply an image, a URL or a card key (DESIGN §4.3 trust boundary). R2 custom
metadata on the stored render gains `mode`.

### Part cards in R2 (`cards/` prefix)

Cards are generated offline, reviewed by a human, then published. Generation and
publication are intentionally separate commands.

**Generic cards ship in the repo.** The reviewed set of all 38 generic archetypes lives in
`assets/cards/generic/<archetype>/1.png` (+ `prompt.txt`; provenance in the README there).
Seed a bucket with the whole set — this is a required step for a fresh deployment, otherwise
the app has no thumbnails and every render falls back to the text-only path:

```sh
pnpm cards:publish --local  --generic-all   # local R2 for `pnpm dev`
pnpm cards:publish --remote --generic-all   # production; idempotent, skips already-published bytes
```

Exact per-product cards are **not** in the repo; they are produced with the vendor-image CLI
below and published one at a time.

#### Vendor-image CLI: operator runbook

Use this when a catalog part needs a specific image and a manufacturer/retailer product
photo is available as a direct image URL. Run from the repository root after `pnpm install`.
`IMAGE_API_KEY` must be present in the shell environment or `.dev.vars`.

1. Find the exact part id in the catalog. The vendor-reference command accepts any of the
   eight catalog categories. Build-render composition still consumes only case/GPU/cooler/
   RAM cards; exact cards for the other categories are used as UI thumbnails.
2. Generate two candidates. Quote URLs containing `&` or other shell characters:

   ```sh
   pnpm cards:vendor --only case-fractal-terra --reference-url "https://vendor.example/product.jpg" --n 2
   ```

   `--n` defaults to `1`; `--quality` defaults to `high`. Run
   `pnpm cards:vendor --help` for the command summary.
3. Open `scratchpad/cards/contact.html`. Inspect every candidate at full size and reject
   anything with a logo, wordmark, model name, badge, sticker, stray glyph, incorrect
   silhouette, wrong panel/window, or wrong fan count. Rerunning the command replaces the
   numbered candidate files for that part, so finish reviewing or copy a keeper first.
4. Publish the chosen candidate to local R2 and verify it in the shopper/admin UI:

   ```sh
   pnpm cards:publish --local --pick case-fractal-terra 2
   pnpm cards:publish --local --list
   ```

5. Only after that review, publish the same candidate to production when intended:

   ```sh
   pnpm cards:publish --remote --pick case-fractal-terra 2
   pnpm cards:publish --remote --list
   ```

The URL flow accepts only HTTPS `image/png`, `image/jpeg`, or `image/webp` responses up to
20 MiB. It rejects URL credentials, checks the image signature against the declared MIME
type, and follows at most five redirects—all of which must remain HTTPS. The vendor bytes
stay in memory only and go directly to the `gpt-image-2` Images edits request. Only the
source hostname is retained in `prompt.txt`; query strings and vendor bytes are not saved.
The prompt explicitly removes logos, text, badges, stickers, and packaging.

`cards:vendor` writes 1024×1024 candidate PNGs but cannot publish or update either R2
index. Publication always requires the separate `cards:publish --pick` command above.
For a file already downloaded by the operator, put it at
`scratchpad/refs/<partId>.(png|jpg|jpeg|webp)` and run `pnpm cards --only <partId> --n 2`;
it follows the same prompt, candidate, and human-review boundary.

Generic fallback candidates use a separate path and index:

```sh
pnpm cards:generic
pnpm cards:publish --local --pick-generic gpu-3fan-thick 1
pnpm cards:publish --local --list-generic
```

Layout in the **same** `RENDERS` bucket:

```
cards/<partId>/<sha256(png)>.png          specific source, content-addressed
cards/<partId>/<sha256(png)>.thumb.webp  160×160 UI derivative
cards/index.json                          specific-card index
cards/generic/<archetype>/<sha>.png       generic source, content-addressed
cards/generic/<archetype>/<sha>.thumb.webp generic UI derivative
cards/generic/index.json                  reviewed generic-card index
```

`--pick` hashes the picked candidate, uploads it under the content-addressed key, reads
`mode` from the first line of the candidate's `prompt.txt`, creates its WebP derivative,
and rewrites `cards/index.json`. `--pick-generic` applies the same review boundary to
`cards/generic/index.json`.
Re-picking the same bytes is a no-op. Cards must be **1024×1024 PNG** (the edits endpoint
requires the reference images to share format and size); `--force` overrides the check.
Replacing a card leaves the old object in place — delete it manually if you care.

The Worker reads `cards/index.json` **once per isolate with a 60 s TTL** (`worker/card-store.ts`),
then fetches card bytes by key only on a cache miss that actually composes. A freshly
published card therefore takes effect within a minute. Index entries whose key is not
`cards/<that part id>/<64 hex>.png` are dropped, so a corrupt index can never address
another object. Generic keys are validated against their archetype in exactly the same way.

The UI fetches only `GET|HEAD /api/cards/:partId/thumb.webp?fallback=<archetype>`.
The route chooses an exact reviewed thumbnail first and the validated generic fallback
second; it never exposes source cards or raw R2 keys. Responses use ETag plus a short
60-second cache so a newly reviewed card replaces a fallback promptly. A 404 renders as
a category marker in the UI.

> **Lifecycle rule:** the 30-day expiry below is scoped to the `renders/` prefix. Do **not**
> add a rule that covers `cards/` — cards are the reviewed input to every composed render
> and must not age out.

### Why layered limits (R2-#7)

The Rate-Limiting binding (`RENDER_BURST`, 5 / 60 s per `CF-Connecting-IP`) is
eventually consistent and only stops bursts. The **daily cost guards** live together in one
Durable Object (`RenderQuota`, `idFromName("global")`): it checks and increments the anonymous
device counter and global counter in one serialized update, avoiding partial consumption.
`RENDER_USER_DAILY_CAP` defaults to 10 and `RENDER_DAILY_CAP` defaults to 200. The same state
holds 90-second render-hash leases so duplicate misses do not fan out to the provider.

## One-time setup (owner)

```sh
# 1. R2 bucket for renders (+ 30-day expiry so stale renders age out)
pnpm exec wrangler r2 bucket create rigbuilder-renders
pnpm exec wrangler r2 bucket lifecycle add rigbuilder-renders --prefix renders/ --expire-days 30
#    (bucket_name is already in wrangler.jsonc; no id needed)
#    The prefix matters: the `cards/` prefix in the same bucket must NOT expire.

# 2. KV namespace for share links
pnpm exec wrangler kv namespace create BUILDS
#    → paste the returned id into wrangler.jsonc  kv_namespaces[0].id

# 3. Rate limit + Durable Object: declared in wrangler.jsonc, created on first deploy
#    (ratelimits[0].namespace_id is any integer unique in the account; migrations v1
#    creates the SQLite-backed RenderQuota class).

# 4. Secrets
pnpm exec wrangler secret put IMAGE_API_KEY        # OpenAI key with Images API access (gpt-image-2)
pnpm exec wrangler secret put TURNSTILE_SECRET     # from the Turnstile widget (step 5)
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" \
  | pnpm exec wrangler secret put SESSION_HMAC_KEY # random 256-bit key for the session cookie

# 5. Deploy and check
pnpm deploy
curl -s https://<app>.workers.dev/api/health | jq .render
```

### Turnstile (invisible widget)

1. Cloudflare dashboard → **Turnstile → Add widget**. Hostname: `<app>.workers.dev`
   (add your custom domain too). Widget mode: **Invisible** (the page triggers it on the
   first render attempt; a *Verify to render* button is shown only if the challenge
   needs interaction).
2. Copy the **site key** into `wrangler.jsonc` `vars.TURNSTILE_SITE_KEY` (public; the page
   reads it from `/api/health`) and the **secret key** into `wrangler secret put TURNSTILE_SECRET`.
3. The Worker calls `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the
   token + `remoteip`; tokens are single-use and expire in 5 min, which is why success is
   converted into a 1 h `rb_session` cookie bound to the signed 30-day anonymous
   `rb_device` id (REVIEW_RESPONSES R2-#7).

Testing keys (always pass) for staging: site `1x00000000000000000000AA`, secret
`1x0000000000000000000000000000000AA`.

## Environment reference (render + share)

| Name | Kind | Where | Purpose |
|---|---|---|---|
| `RENDERS` | R2 binding | `wrangler.jsonc` | `renders/<hash>.webp`, custom metadata `buildHash, createdAt, style, angle, mode`; **also** reviewed specific/generic source cards, 160×160 WebP derivatives and their separate indexes under `cards/` (not covered by the 30-day lifecycle rule) |
| `BUILDS` | KV binding | `wrangler.jsonc` | `b:<id>` → payload JSON, 90-day TTL |
| `RENDER_BURST` | Rate-Limiting binding | `wrangler.jsonc` | 5 / 60 s per IP on `/api/render` and `POST /api/builds` |
| `RENDER_QUOTA` | Durable Object (`RenderQuota`) | `wrangler.jsonc` | Atomic per-device/global daily counters and in-flight hash leases |
| `RENDER_DAILY_CAP` | var | `wrangler.jsonc` | Default 200 renders / UTC day |
| `RENDER_USER_DAILY_CAP` | var | `wrangler.jsonc` | 10 cold renders per anonymous device / UTC day |
| `IMAGE_PROVIDER` | var | `wrangler.jsonc` | `openai` (model `gpt-image-2`, 1536×1024, quality medium, WebP, `output_compression: 60`; verified 2026-08-29 against the live API — uncompressed output is ~1.4 MB, hence the compression) |
| `TURNSTILE_SITE_KEY` | var (public) | `wrangler.jsonc` | Widget site key for the page |
| `IMAGE_API_KEY`, `TURNSTILE_SECRET`, `SESSION_HMAC_KEY` | secret | `wrangler secret put …` | Provider key, siteverify secret, cookie HMAC key |
| `DEV_SKIP_TURNSTILE=1` | local only | `.dev.vars` | `POST /api/verify` accepts any token (never set in prod vars) |

## Local development

`.dev.vars.example` ships `SESSION_HMAC_KEY` and `DEV_SKIP_TURNSTILE=1`. R2, KV and the
Durable Object run in miniflare under `.wrangler/state`; if the local runtime lacks the
Rate-Limiting binding the Worker logs once and uses an in-memory 5 / 60 s limiter.
Without `IMAGE_API_KEY` a cache miss answers `503 RENDER_UNAVAILABLE`; everything else
(verify, cache hits, share links) works offline. Note that `.dev.vars` wins over
`wrangler dev --var`, so put the real key there (not the `sk-...` placeholder) to test
real renders locally.

To exercise a **composed** render locally, publish an exact case card into the local
bucket first (`pnpm cards:publish --local --pick <casePartId> <n>`). For each GPU,
cooler or RAM in the build, publish either its exact card or the reviewed generic
archetype selected by `genericCardArchetype`; `pnpm cards:publish --local --list` and
`--list-generic` show the two indexes. Then render the build (`pnpm dev` or
`pnpm exec wrangler dev`) and check `mode` in the response. A missing/dangling required
reference produces `mode: "text"`; that is the intended fallback, not a failure.
Wrangler's local R2 lives under `.wrangler/state`, so local and production card sets
are independent.

Windows note: under `wrangler dev` a POST rejected *before* its body is read (403/405/429)
used to kill workerd on the next request ("Network connection lost" in the proxy). The
fetch wrapper in `worker/index.ts` therefore drains any unread body before responding.

```sh
curl -si -c jar.txt -X POST localhost:5173/api/verify -H 'content-type: application/json' -d '{"token":"dev"}'
curl -si -b jar.txt -X POST localhost:5173/api/render -H 'content-type: application/json' \
  -d '{"v":1,"partIds":["case-…","cpu-…","gpu-…"],"style":"photoreal","angle":"three-quarter","flair":"a small illustrated turtle sticker on the glass"}'
curl -s -X POST localhost:5173/api/builds -H 'content-type: application/json' -d '{"v":1,"parts":["cpu-…","gpu-…"]}'
curl -s localhost:5173/api/builds/<id>
```

Tests (`pnpm test`, no miniflare): session sign/verify/expiry/tamper, `/api/verify`
with a fake siteverify, `VERIFICATION_REQUIRED`, `UNKNOWN_PART`, forged
`prompt`/`buildHash` rejected with the hash always computed server-side, 2 KB cap →
413, cache hit skipping provider + quota, per-device isolation/10-render exhaustion,
global exhaustion, duplicate-hash leases, reset timing and distinct error envelopes,
burst → 429, provider failure → `RENDER_FAILED`, R2 GET headers, share id determinism
+ round-trip, DO counter over `fetch()`. Composed mode (`worker/render.test.ts`,
`worker/card-store.test.ts`, `worker/image-provider.test.ts`): composed iff the case has
an exact card and each present internal card category has an exact or eligible reviewed
generic card; fallback when a required reference is missing / the case has none / the
object is gone / no card store; mode-separated cache key that changes when a card is
republished; composed cache hit skipping provider + quota; reference images in
case → gpu → cooler → ram order, multipart `image[]` shape, index entries with foreign or
malformed keys dropped.

## Cost notes

- `gpt-image-2` is a paid API: budget roughly the per-image list price × `RENDER_DAILY_CAP`
  as the worst-case daily spend (200/day default; lower it via the var for judging if
  needed). Cache hits cost nothing — warm the demo build before recording.
- A **composed** render additionally pays for the reference images it sends (input-image
  tokens) and is slower than a text render, so cold-latency measurements must be taken in
  composed mode. Card production itself is a separate, one-off, offline cost (`pnpm cards`)
  that never touches `RENDER_DAILY_CAP`.
- R2: a few hundred KB per render, 30-day expiry; well inside the free tier. KV: tiny
  payloads, 90-day TTL. Durable Object: one instance, a handful of requests per render.
- Rate-Limiting binding and Turnstile are free.
