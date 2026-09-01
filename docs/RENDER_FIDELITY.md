# Render fidelity — reference images for `render_build`

> Decision record and implementation plan for making generated build renders recognisable, repeatable, and honest about their fidelity.

## Executive decision

Ship the improvement in three independently valuable layers:

1. enrich the deterministic appearance vocabulary;
2. generate reviewed, brand-free part cards offline; and
3. compose renders from those cards in the Worker, with a text-only fallback.

The first layer is the safe baseline and should remain shippable on its own. The latter two are quality upgrades, not prerequisites for a usable product. The composition path must earn its place through a fixed A/B evaluation; if it does not produce visibly better and more consistent renders, retain the text path.

This document is deliberately written as an acceptance-gated plan rather than a calendar schedule. Progress is measured by prerequisites, verified behavior, and decision gates.

Status (2026-08-29). Owner decided: go for generated part cards (Option B); offline vendor photos allowed as reference input under the Phase 1 guardrails.

| Phase | State |
|---|---|
| 0 — `appearance` attributes | ready (not started) |
| 1 — part cards | specific-card generator, review and publishing **implemented**. A deterministic 38-archetype generic set and generator are also implemented; all 38 generic candidates were human-reviewed and published to both local and production R2. The demo-path exact cards are published in production. |
| 2 — composition in the Worker | **implemented** (`worker/card-store.ts`, `worker/image-provider.ts` `compose()`, `worker/render.ts`, `composePrompt()` in `src/engine/renderPrompt.ts`). Exact cards win; reviewed generic GPU/cooler/RAM cards may fill gaps, but composition still requires an exact case card. **The A/B accept gate below has not been run.** |
| 3 — cards in the UI | **implemented**: same-origin WebP thumbnails in search rows, filled slots, admin catalog rows and `get_part_details`; exact-card-first with deterministic generic fallback. |

## 1. Where fidelity is lost today

`render_build` (DESIGN §4.3) rebuilds a deterministic, brand-free prompt from part *attributes* (`src/engine/renderPrompt.ts`). The baseline prompt uses case color / volume class / window / front style, GPU length class, cooler type + radiator size, RAM stick count, lighting preference, style and angle; the caller may add one separately bounded `flair` line. Other catalog details are discarded.

Concrete example — the demo-path case `case-fractal-terra` (Fractal Terra: sandwich-layout SFF, walnut front, anodised aluminium):

> "A neutral-toned compact small-form-factor case of about 10 liters with a solid front panel and a solid side panel."

That describes a beige shoebox. The model has no way to produce anything resembling the product, and every regeneration (new angle, new style) invents a *different* shoebox — so the "superseded renders" strip on the stage looks like several unrelated PCs, which undercuts the payoff beat.

Two distinct losses:

1. **Information loss** — the attribute vocabulary is too coarse (no shape, materials, fan count, GPU thickness, cooler finish, RAM heat-spreader colour…).
2. **Consistency loss** — pure text-to-image redraws the object each call; nothing anchors shape across renders of the same build.

Reference images fix (2) very well and (1) only insofar as the reference itself is faithful. So the question is *where the reference images come from*.

## 2. Options for reference images

### A. Manufacturer / retailer product photos — **rejected**

Highest fidelity in principle, but:

- Conflicts with the provenance policy in DESIGN §9 and `src/data/SOURCES.md` ("no descriptions, images or logos copied"). That policy is a deliberate judge-facing stance; reversing it for the payoff shot would be visible in the repo.
- Output would carry brand marks; `render_build` is documented and labelled as "a brand-free impression". DEMO.md already flags that generated images must be reviewed for invented logos — this would guarantee them.
- Fetching from vendor sites is brittle (bot-blocking already broke the admin agent on supplier pages, per TODO/SOURCES) and hotlinking would leak the render request to third parties.

Not feasible under the project's own constraints. A rights-cleared, human-uploaded variant is noted in §6 as a future admin feature, not a hackathon deliverable.

### B. Self-generated, brand-free **part cards** — **recommended**

Generate one canonical image per *visually significant* part (case, GPU, cooler, RAM; optionally motherboard) from a *richer* attribute prompt, once, offline. Store them content-addressed in R2. At render time call the Images **edits** endpoint with the build's part cards as `image[]` inputs plus the scene prompt, instead of pure text generation.

Verified against the [official OpenAI Image guide](https://developers.openai.com/api/docs/guides/image-generation) on 2026-08-29: `/v1/images/edits` accepts multiple reference images through `image[]` and the documented composition example uses four inputs. **`gpt-image-2` processes every image input at high fidelity automatically**, so `input_fidelity` must be omitted. RigBuilder normalizes its reviewed reference cards to 1024×1024 PNG as an implementation invariant before composition.

What it buys:

- **Consistency**: the same case card anchors every angle/style of the same build → the render strip reads as *one* PC. This is the biggest visible win.
- **Fidelity up to the card**: a card produced from a rich prompt ("compact sandwich-layout SFF case, 10 L, brushed dark-grey aluminium shell, natural walnut front panel, no window") is much closer to the product than the current sentence, and it is generated once, so it can be **human-reviewed and regenerated** — which fits the "agents draft, humans verify" story of the catalog.
- **Second payoff for free**: the cards double as part thumbnails in search results, slot cards and the admin table (DESIGN §7 currently says "no stock imagery" — cards are our own, brand-free imagery).
- Trust boundary unchanged: the client still sends only ids; the Worker picks cards by id from R2.

Cost: one image per card (≈ 20 cards for the demo path, ≈ 250 for all visual categories) + the composition call, which is priced like a generation plus input-image tokens. Well inside the existing daily cap logic.

### C. Richer attributes in the text prompt only — **do regardless (Phase 0)**

Zero new infrastructure; needed anyway because it is what the cards are generated *from*. On its own it fixes part of (1) and none of (2).

## 3. Plan

Phases are sequenced by dependency. Each has acceptance criteria; nothing here is estimated in time.

### Phase 0 — `appearance` attributes (ready)

Add an **optional, strict** `appearance` object to the four visual categories in `src/data/schema.ts`. Optional so the 448-part seed keeps validating; strict so agent typos surface. Catalog appearance remains enums only; the separate, user-authored `render_build.flair` field is the sole bounded free-text exception and never enters catalog data.

| Category | Fields (all optional, enum/number) |
|---|---|
| case | `shape: "tower"\|"sandwich-sff"\|"cube"\|"open-frame"\|"desk"`, `material: "steel"\|"aluminium"\|"wood-front"\|"mesh-heavy"`, `finish: "matte"\|"brushed"\|"glossy"`, `windowSide: "left"\|"dual"`, `accentColor: "none"\|"wood"\|"orange"\|"white"\|"black"` |
| gpu | `fans: 1\|2\|3`, `shroudColor: "black"\|"white"\|"silver"\|"dark-grey"`, `hasRgb`, `thicknessSlots` (already `slots`) |
| cooler | `fans: 1\|2\|3`, `finish: "black"\|"white"\|"silver"`, `blockDisplay: boolean` (AIO pump screen) |
| ram | `heatspreaderColor: "black"\|"white"\|"silver"`, `heightClass: "low"\|"tall"` |

Deliverables:

- Schema + `check:data` + D1 column (`appearance` JSON text) + migration `0002_appearance.sql`; `/api/catalog` passes it through.
- `renderPrompt.ts` consumes `appearance` when present with the same "attributes only" discipline; snapshot tests updated. Missing fields fall back to today's phrasing.
- Populate `appearance` for the **demo-path parts** (DEMO.md build) by hand from the spec pages already cited in `sources[]`; let the admin agent draft the rest via `catalog_upsert_part` (the schema tool exposes the new fields automatically — this is a nice live demonstration of the living catalog).
- `catalog_get_schema` description mentions `appearance`.

Accept when: `pnpm test` green; the Terra prompt names sandwich layout, aluminium and walnut front; hash changes only when appearance changes.

### Phase 1 — part cards — **implemented** (`attributes` mode still depends on Phase 0)

**Decision (2026-08-29):** cards are generated **offline** and may use a **vendor product photo as a reference input**. The photo never ships: not in the repo, not in R2, not in the Worker, not in the video. Rationale: the rules (§4/§8) govern *submitted* content; a card is a new image in our own studio setup that reproduces the product's *appearance* (which a photo's copyright does not cover), not the photograph. Risk is low and bounded, not zero — hence the guardrails below and honest documentation.

**Guardrails (non-negotiable)**

1. Reference photos may live in git-ignored `scratchpad/refs/<partId>.<jpg|png|webp>` or be supplied with `pnpm cards:vendor --only <partId> --reference-url <https-url>`. The URL path holds source bytes only in memory. Vendor sources are never committed or uploaded to R2.
2. Card prompt forbids logos, text, badges, stickers and packaging; the model is told to reproduce *shape, proportions, materials, colours, fan layout* only.
3. **Every card is human-reviewed** before upload. A card with any mark or text is regenerated (a new candidate and, if needed, a stronger prompt), never edited.
4. `src/data/SOURCES.md` states the method: *"Part cards are original generated images. Manufacturer product pages were consulted as visual references for appearance; no vendor image is stored or redistributed."* Same sentence in README's render section.
5. Fallback per part: `attributes` mode (text-only, from Phase 0 enums) or `description` mode (a reviewed, offline-only free-text visual description in `scratchpad/refs/<partId>.txt`, written by a human or a vision-capable agent from the product page). Any part can use any mode; the mode is recorded in the card index.

**Pipeline** — `scripts/part-cards.ts` (runs on the owner's machine with `IMAGE_API_KEY`; uses the same provider model and output conventions as the Worker, but makes its own offline generation/edit calls)

| Step | Detail |
|---|---|
| Select | `--only case-fractal-terra,gpu-…` (demo path first, ≈ 20 parts), later `--category case` / all of {case, gpu, cooler, ram}. Each selected run writes candidate numbers from 1 again, so move or review existing candidates before rerunning if they must be retained. |
| Resolve mode | `cards:vendor --only <id> --reference-url <https-url>` → in-memory `reference`; otherwise `refs/<id>.<img>` present → `reference`; else `refs/<id>.txt` → `description`; else `attributes`. `--mode` overrides. |
| Prompt | `src/engine/partCardPrompt.ts` (pure, snapshot-tested). Common tail: *"Single product, centred, isolated on a seamless neutral light-grey studio backdrop, three-quarter front view, soft even lighting, sharp focus, photoreal. No text, logos, badges, stickers, packaging, cables or people."* Head per mode: reference → *"Recreate the product in the reference image in this setting, keeping its exact shape, proportions, materials, colours and fan layout; omit all branding"*; description → the reviewed text; attributes → sentence from Phase 0 enums + existing fields (`volumeLiters`, `slots`, `radiatorMm`, `sticks`…). |
| Generate | reference → `/v1/images/edits` with `image[]=[photo]`; others → `/v1/images/generations`. `size 1024x1024`, `quality high`, `output_format png` (cards must share format/size for later composition). `--n 2` produces candidates for review. |
| Review | Candidates written to `scratchpad/cards/<id>/<n>.png` + a generated `contact.html` sheet. Human picks one (`--pick <id> <n>`) or regenerates. Reject rule: any glyph/mark, wrong window/front, wrong fan count. |
| Publish | `pnpm cards:publish --local\|--remote --pick <partId> <n>` publishes a reviewed specific card; `--pick-generic <archetype> <n>` publishes a reviewed generic. Each source PNG gets a 160×160 WebP derivative, and the corresponding specific or generic index is updated. Nothing is auto-published. The 30-day lifecycle rule is scoped to `renders/` and must not cover `cards/`. |
| Cost | ≈ 1–2 images per part; ~40 images for the demo path, ~500 for all four categories. The 38 generic archetypes are complete; do the full exact per-part set only after the Phase 2 A/B passes. |

**Dependencies:** `reference` and `description` modes need nothing from Phase 0 and can start now; `attributes` mode needs the Phase 0 enums. Phase 0 remains worth doing (it improves the text-only render fallback and the card prompt for parts without a reference).

Accept when: demo-path cards exist in R2 with index entries; each has been reviewed by a human; none contains text or marks; every candidate retains its prompt/mode/model audit metadata and publication is content-addressed; `scratchpad/refs` is git-ignored and `git ls-files` shows no reference image.

### Phase 2 — composition in the Worker — **implemented** (2026-08-29)

- `image-provider.ts`: `compose(prompt, images: {bytes, contentType}[], opts)` → multipart POST to `/v1/images/edits` with `model: gpt-image-2`, `image[]`, `size 1536x1024` (landscape) / `1024x1024`, `quality medium`, `output_format webp`, `output_compression 60`; the 400-retry, the 429 → `RENDER_RATE_LIMITED`, the abort → 504 mapping and the "log the status, never the prompt or body" rule are now shared with `generate`. `fakeProvider` records `composeCalls: {prompt, images, contentTypes}[]`.
- `card-store.ts`: `CardStore` over the `RENDERS` bucket — separate, cached specific and generic indexes plus strict source/thumbnail-key validation. An unreadable index means "no cards". `memoryCardStore()` supports both indexes in tests.
- `render.ts`: after resolving parts it requires an exact case card. Exact GPU/cooler/RAM cards win; a missing card may use its reviewed, compose-eligible generic archetype. If a required object is absent the request safely downgrades to text generation. Card **bytes** are fetched only on a cache miss.
- `composePrompt(build, goal, style, angle, order, genericCategories, flair?)` in `renderPrompt.ts` names each reference image by the category it depicts, identifies generic anchors honestly, and reuses the deterministic baseline's style / angle / lighting / no-text rules. The text fallback and both hashes include the normalized optional flair.
- **Cache key**: `buildHashInput(build, goal, style, angle, cardKeys?)` returns `prompt + "|composed|" + cardKeys.join(",")` when card keys are given.
- Full cards are read from R2 inside the Worker and never exposed. Only 160×160 WebP derivatives are served to the client through the constrained Phase 3 route.
- Timeout: multi-image edits are slower; `RENDER_TIMEOUT_MS` stays 60 s — **cold composed latency in prod is still unmeasured**. The video beat stays a cache hit either way.

**Deviations from the plan above**

1. *Two hashes instead of one.* The plan folded the card keys into `buildHash`. That would have broken the page: `src/ui/renderClient.ts` and `render_build` recompute the build hash locally and compare it with the response to decide `active` vs `superseded`, and the client cannot know the card keys — every composed render would have been filed as superseded. So the response now carries **`buildHash`** = `sha256(renderPrompt(...))` (build identity, client-recomputable, mode-independent) and **`renderId`** = the storage hash that folds in the mode and the card keys. `imageUrl` and the R2 key use `renderId`. In text mode the two are equal, so nothing about the existing behaviour changed.
2. *Publishing is a separate script.* `scripts/part-cards.ts` (generation) and `scripts/part-cards-publish.ts` (`pnpm cards:publish --local|--remote --pick <partId> <n> | --list`) are split, because generation and review/publication happen at different times — and they were built by different agents in parallel.
3. *Multi-part categories.* RAM may hold several kits; the composed path anchors on the **first** part in each category, so a second RAM kit does not need its own card.

Accept when: side-by-side A/B for the demo build (text vs composed, same style/angle × 3 attempts) — composed must be judged (by you) clearly closer to the real parts *and* consistent across angles. If it is not, keep the text fallback as the public default. **This gate is still open, but it is no longer blocked on publication:** generic cards and demo exact cards are present in production. Deleting `cards/index.json` remains the kill switch because composition always requires an exact case card; requests then fall back to `mode: "text"`.

Worker tests (green): composed path chosen iff the case has an exact card and each present GPU/cooler/RAM has an exact or reviewed compose-eligible generic card; fallback on a missing required reference, a caseless card set, no card store and a dangling object; the cache key separates the modes and moves when a card is republished; a composed cache hit skips provider and quota; the provider receives the images in `case → gpu → cooler → ram` order as multipart `image[]`; forged bodies (`prompt`, `cardKeys`, `images`) still 400.

### Phase 3 — cards in the UI — **implemented** (2026-08-29)

- `GET|HEAD /api/cards/:partId/thumb.webp?fallback=<archetype>` returns a reviewed 160×160 WebP derivative. The Worker resolves the part id through the specific index first, then the validated generic fallback; clients never submit or receive R2 keys.
- Responses use an ETag and a short `max-age=60, stale-while-revalidate=600` cache because publishing can change which content-addressed derivative an id resolves to. Missing images return 404 and the component shows a compact category marker.
- `genericCardArchetype(part)` maps attributes to one of 38 stable archetypes across CPU, motherboard, RAM, GPU, cooler, case, PSU and storage. Eleven case archetypes are intentionally thumbnail-only; only GPU, cooler and RAM generics may be render references, preserving the case as the build's strongest identity anchor.
- Thumbnails appear in part-browser results, filled build slots and admin catalog rows. `get_part_details` exposes the same same-origin `imageUrl`.
- Hovering or keyboard-focusing a loaded thumbnail opens a larger viewport-bounded inspection preview in a body portal, so scroll containers cannot clip it; Escape closes it.
- The admin table reads one Access-gated `/api/admin/card-status` response and labels every row `specific`, `generic`, or `none`. It receives index membership only, never R2 object keys.
- Generic candidates are created with `pnpm cards:generic`, reviewed in `scratchpad/cards/generic/contact.html`, then published one at a time with `pnpm cards:publish --local|--remote --pick-generic <archetype> <n>`. The accepted set of all 38 is committed under `assets/cards/generic/<archetype>/1.png` (+ `prompt.txt`) and can be seeded into any bucket in one go with `pnpm cards:publish --local|--remote --generic-all` (idempotent; see `assets/cards/generic/README.md`).

## 4. Feature analysis: composed part-card renders

### User value

The feature addresses two visible failures in the current renderer: a coarse attribute prompt produces generic-looking hardware, and independent generations drift in shape between angles. A reviewed card gives the model a stable visual anchor; composition then turns the render strip from unrelated inventions into alternate views of one build. The secondary value is reuse: the same cards can make catalog browsing and slot cards more legible.

### Technical fit

The feature fits the existing trust boundary. The browser sends part IDs, the Worker resolves cards from R2, and the image provider receives only server-selected inputs. No vendor photo is persisted or exposed. The implementation is additive: `compose()` is a new provider operation, `render()` selects it only when every required card is available, and the existing generation path remains the fallback.

### Cost and latency

There are two different costs to track:

- **Card production cost:** one or two offline generations per visual part, plus human review.
- **Per-render cost:** the composition request includes input-image processing as well as output generation and may be slower than text-only generation.

The feature is justified only if the visible quality gain exceeds those costs for the demo path. Record cache-hit and cold-request latency, image count, failure rate, and daily spend separately; do not hide card-generation spend inside the render cap.

### Evaluation design

Use the same build, style and angle for each text/composed pair, with three fresh attempts per mode. Have reviewers score, independently, (a) recognisability of case/GPU/cooler/RAM, (b) consistency across three angles, (c) installation plausibility, and (d) unwanted text, logos, or invented components. A composed render passes only if it is clearly better on recognisability and consistency without regressing trust criteria. Keep the text-only output beside it so the decision is reversible.

### Recommendation

Proceed with the feature behind a server-side mode decision and a kill switch. Make the demo path the first evaluation cohort, publish only reviewed cards, and treat the composed renderer as an experimental enhancement until the A/B gate passes. Do not make catalog-wide card generation or UI thumbnails a dependency of the core `render_build` experience.

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Composition ignores references or pastes them flatly | Phase 2 accept gate; keep text path as fallback; try `cutaway` style first — interiors are where references help most |
| Reference image constraints (same size/format) | Cards are always 1024×1024 PNG; script rejects anything else |
| Cards themselves wrong (model invents a window, adds logos) | Human review loop + regen; cards are cheap and one-off |
| Reference mode reproduces a vendor logo / badge | Prompt forbids marks; mandatory human review; regenerate, never retouch |
| Method perceived as hiding vendor-image use | Stated openly in SOURCES.md + README; reference photos never stored or shipped |
| Cache staleness after card regen | Card key in render hash (Phase 2) |
| Cost creep | Cards generated once, offline, from the owner's machine; renders still under `RENDER_DAILY_CAP` |
| Scope pressure vs. deadline | The implementation is isolated and complete; remaining work is the fixed A/B, cold-latency measurement and rehearsal. Make code changes only if those gates expose a concrete failure. |

## 6. Documentation to update when implemented

- [x] DESIGN §4.3 — composed mode paragraph (2026-08-29).
- [x] BACKEND.md — render modes, the two hashes, `cards/` prefix + index, `pnpm cards:publish`, lifecycle-rule exemption, local testing, cost (2026-08-29).
- [x] DESIGN §7 (imagery) — no third-party imagery; reviewed generated cards and deterministic generic fallbacks (2026-08-29).
- [ ] DEMO.md voice-over line ("rendered from brand-free part cards generated from the catalog's attributes — consistent across angles") — do this once cards are published and the A/B gate has passed, not before.
- [x] README render section + `src/data/SOURCES.md` (the "part cards are original generated images…" sentence from Phase 1 guardrail 4, 2026-08-29).

## 7. Deferred (not for the hackathon)

- Admin tool `catalog_attach_reference_image` for rights-cleared, human-uploaded product photos (press-kit terms vary per vendor; would require per-vendor licensing notes). Would slot into the same `compose` path as a higher-fidelity card.
- Per-motherboard/PSU cards (rarely visible in a render).
