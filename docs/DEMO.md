# RigBuilder — Demo Narrative

**Purpose:** the master run-through script. Use it three times: (1) as the rehearsal script once the app is feature-complete, (2) as the shooting script for the < 3-min demo video, (3) as the basis for the judges' testing instructions on Devpost. Every beat is mapped to the judging criterion it exercises — if a beat fails in rehearsal, that's a bug with a criterion attached.

Companion to [DESIGN.md](DESIGN.md) (§4 tool surface, §7 UI, §10 video outline). Wording rule applies here too (DESIGN §1): no "ground truth", "the page knows", "never hallucinates" — say *modeled constraints* / *bundled spec data*.

Production URL: https://rigbuilder.andreas-adner.workers.dev/

---

## 0. Pre-flight checklist

- [x] Production URL and `/api/health` return 200; the origin-trial token is present in the served page. Still verify API/tool discovery in Chrome 149+: **no flag**, compatible agent/Model Context Tool Inspector attached, status chip shows "WebMCP · 14 tools exposed to your agent".
- [x] Production health reports the image key, R2, quotas, Turnstile/session configuration, KV and D1 catalog v3 configured. [ ] Run one cold production render for timing, then prepare and warm the three pickup renders below. Export a share URL at checkpoints A, B and C; those URLs restore the exact builds even if a later agent run selects different parts. The render cache and share payloads survive catalog reset, but opening a share URL does **not** automatically attach a cached render to the stage.
- [ ] ChatGPT desktop app updated; confirm the account/model has site-tools access, open the production URL in its built-in browser, and confirm tool discovery.
- [x] `pnpm check:data` green (448 parts, 82 verified) and all 274 automated tests pass. [ ] Run the manual eval prompts ([EVALS.md](EVALS.md)) in both target clients.
- [ ] Demo dataset sanity (numbers from `src/data/SOURCES.md` "Demo path", read twice from manufacturer pages): the swap target is the **Fractal Design Terra — 322 mm GPU / 48 mm cooler / ITX / SFX**. The verified value cards the agent is likely to pick are 329–330 mm (ASUS TUF RX 9070 XT 330, TUF RTX 5070 Ti 329); fitting alternatives exist at 304–312 mm (ASUS Prime cards). **Every case under 329 mm in the catalog is ITX**, so the Beat 3 prompt asks for a *compact* build — the agent should already pick an ITX board + SFX PSU, and the Terra swap then breaks only the GPU (and possibly cooler height). If the agent built ATX anyway, the Terra swap raises 4 conflicts (board, PSU, cooler, GPU) — still a valid, richer Beat 4; budget the extra ~20 s or re-shoot.
- [ ] Color path rehearsed: Beat 3 starts with the **Thermaltake TR100 Hydrangea Blue** (`case-thermaltake-tr100-hydrangea-blue`) and explicitly requests a low-profile air cooler. This keeps the baseline ITX/SFX and prevents a large radiator from muddying the Terra repair beat. For the final showcase, checkpoint C deliberately supersedes the compact preference with the **Tower 300 Bubble Pink** (`case-thermaltake-tower-300-bubble-pink`) and **ARCTIC Liquid Freezer III Pro 360 A-RGB White** (`cooler-arctic-liquid-freezer-iii-pro-360-argb-white`). Rehearse the PSU replacement too: the Tower 300 record accepts ATX, while the compact build likely has SFX.
- [ ] Layout: ChatGPT conversation left, RigBuilder in the in-app browser pane right at its **narrow (~800 px) breakpoint** — stage over browser, collaboration drawer. Rehearse at exactly this width; plan zoom/crop cuts for the feed and validation cards.
- [ ] **Reset everything to initial state** before each full run-through:
  - Catalog (D1): `pnpm catalog:reset:remote` (local dev: `pnpm catalog:reset`). Wipes drafts, agent-added parts, the version history and the change log, then re-imports the seed as **catalog v1**. Without this, the part added in Beat 5c stays published, `catalog_search` finds it next time ("no duplicate" step breaks) and the version keeps climbing. Renders and share links are content-addressed and are *not* wiped — the warm render cache survives.
  - Shopper page: remove `rigbuilder.build.v1` from localStorage, then hard-reload. A normal non-share visit persists and restores the build, goal and latest active render; hard reload by itself is therefore **not** a reset. The activity feed is session-only, and the catalog cache revalidates by ETag and picks up v1 on its own.
  - `/admin`: hard-reload — its session log is in-memory; the change-log panel re-fetches the (now empty) server log.
  - Start state after that: **empty build**, no goal set, activity feed empty, catalog v1, no drafts.
- [ ] Recording: OBS or macOS/Windows capture, mic checked. Target ≤ 2:50 to leave margin under the 3:00 limit.

**Contingency rule for recording:** agents are non-deterministic. If the agent takes a different-but-sensible tool path, keep rolling — the criteria care that tools are used, not the exact order. Re-shoot only if it *skips* a flagship tool; nudge with the scripted follow-up prompts below (each beat has one).

**Golden demo pattern:** prefer prompts that produce a three-part answer: **make the requested change → evaluate its consequences → proactively propose a second change that preserves the user's intent.** The strongest observed example was: *"Let's swap for a faster CPU"* → Ryzen 7 9800X3D installed → performance re-estimated and the GPU identified as the new limiter → the over-budget goal noticed → a cheaper motherboard proposed to retain the CPU and recover the budget. This feels much more capable than a sequence of isolated commands, so Beat 5 deliberately recreates the pattern. Exact parts and dollar amounts are evidence from rehearsal, not lines to memorize; narrate whatever the tools actually return.

---

## 1. The narrative (video shooting script)

Screen layout: **ChatGPT in-app browser conversation left, RigBuilder page right.** Voiceover lines are suggestions — speak naturally over them.

### Beat 1 — The hook (0:00–0:20) · *Creativity & Ambition*

No app on screen yet; one title card or just voiceover over the empty site:

> "Every site that wants an AI assistant today has to ship one — embed a chat widget, run a backend, pay for inference. WebMCP flips that: the user brings their own agent, and the page hands it tools. This is RigBuilder — a PC part picker where the page is a compatibility solver, and *your* agent is the interface."

Show the header chip: **"WebMCP · 14 tools exposed to your agent."** Click it once — the tool list popover.

### Beat 2 — The page stands alone (0:20–0:35) · *Execution*

15 seconds, mouse only, no agent, fast cuts:

1. Open the Part browser on the **Case** tab and sweep across the Bubble Pink, Hydrangea Blue, Turquoise and Matcha cards; click the Hydrangea Blue TR100 so its exact blue product image fills the case slot.
2. Flip briefly to **Cooler** and show the white RGB AIO cards. Point at a 360 mm model greyed with its inline radiator-fit reason — color does not bypass compatibility.
3. Flip to GPU, point at the **"only compatible"** toggle (it switches itself on as soon as the build has a part); switch it off briefly to show an incompatible card greyed with its inline reason. Gesture at validation reacting live.

> "First: this is a complete product without any agent. Live constraint validation — sockets, clearances, power — runs entirely in the page. The page *is* the engine. Remember that; it matters in a second."

Click **Reset** → empty build. (Reset keeps the feed's 👤 rows on purpose; if you want Beat 3 to open on an empty feed, cut here and hard-reload.)

### Beat 3 — Agent builds, human watches (0:35–1:20) · *WebMCP Leverage + collaboration*

Type in ChatGPT:

> **Prompt 1:** "Build me a quiet, compact 1440p gaming PC under $1500 around the Hydrangea Blue Thermaltake TR100. Use a low-profile air cooler so we keep it genuinely compact."

Expected tool flow (narrate over it as it happens):
`set_build_goal` → goal banner appears → `search_parts` (with `compatibleWithCurrentBuild: true`) → a run of `add_part` calls — **slot cards fill one by one with flash-highlights, activity feed logs 🤖 rows, price ticker climbs, validation stays green.**

> "Watch the right side. Every action the agent takes is a WebMCP tool call — and every call comes back validated: the page checks sockets, clearances and power against its spec data on each mutation, so the agent isn't guessing whether a part fits. The feed records the meaningful work while omitting routine state-sync chatter, and every agent build change has an undo. The human stays in control."

Let the blue case card remain on screen for a beat as the neutral components fill around it. It gives the baseline build a visual identity before the compatibility story starts.

Briefly hover an undo button on one 🤖 feed row (don't click).

*Nudge if needed:* "Use the site's tools to add the parts, and set my goal on the page first."

**Render checkpoint A — the baseline (pickup insert, 2–3 s):**

> **Prompt 1b:** "Before we change anything, render this build as a three-quarter product photo."

`render_build`(photoreal, three-quarter) → save the checkpoint's share URL and capture the completed image. In the final edit, show the tool call for a fraction of a second, then use the image as the visual bridge into Beat 4. Do not wait through a cold render in the main take.

The Hydrangea Blue shell should be unmistakable in checkpoint A. If the render turns it black or generic, do not use that pickup; confirm the exact card is published and warm the corrected render before recording.

### Beat 4 — Human intervenes, agent adapts (1:20–1:55) · *the money shot: bidirectional shared state*

**By hand, in the UI, mid-conversation:** use the slot card's **swap** control to change the case to the **Fractal Terra** (322 mm clearance — shorter than the 329–330 mm card the agent picked). **Validation flips red: ⛔ GPU too long.**

> "Now I change my mind — by hand, not through the chat. I want this tiny case. The page immediately flags the conflict. Does the agent notice?"

> **Prompt 2:** "I swapped the case myself — I want that small one. Fix whatever broke, but keep it a strong 1440p build."

Expected: either the agent reads first (`get_build_state` / `validate_build`) **or it tries to write and gets `STALE_REVISION`** — both are the money shot; if the rejection happens, point at it ("the page refused a write based on stale knowledge — the agent never had to ask") → `explain_compatibility` / `suggest_alternatives` (engine-computed candidates that fit the new case) → `add_part` with `replace: true` → **validation flips back to green.**

> "The agent reads the *shared, versioned* state — it sees my manual change (the feed row even says 'the agent will see this on its next call (rev 14)'), asks the page which GPUs fit 322 millimeters according to the spec data, and swaps in one that does. It never guessed a measurement; the page checked it."

*Nudge if needed:* "Check the site's validation and use its alternative suggestions."

**Render checkpoint B — prove that the picture follows the state (pickup insert, 3–4 s):**

> **Prompt 2b:** "Now render the repaired compact build as a side-on technical cutaway."

`render_build`(cutaway, side) → save this checkpoint's share URL. Cut briefly between render A and render B, or place them side by side: the case class, proportions and fitted internal components should visibly change. This is the important second render—it demonstrates that rendering is derived from the shared build, not a generic image-generation flourish.

### Beat 5 — One request, intelligent follow-through (1:55–2:20) · *WebMCP Leverage depth*

> **Prompt 3:** "Let's swap for a faster CPU."

Ideal flow: `suggest_alternatives`(cpu, better) / `search_parts` → `add_part`(replace) → `estimate_performance`(gaming, 1440p) → the agent compares the old and new tier, identifies the new bottleneck and notices any `OVER_BUDGET` warning. If the upgrade breaks the budget goal, it calls `fit_to_budget` with the new CPU plus the GPU and case protected **without being asked**, then presents the recovery plan instead of silently applying a feature-reducing tradeoff.

> "That was one ordinary sentence, but the agent did more than swap a part. It checked what the upgrade actually changed, found the new limiting component, noticed the budget consequence, and asked the page's solver how to keep the speed without breaking the goal. `fit_to_budget` is bounded search over valid parts, not the LLM guessing prices — and it proposes the tradeoff, so I still decide."

**Observed rehearsal path (excellent alternate take):** Ryzen 7 9800X3D raised the gaming CPU tier 9 → 10 and the build total to $1,868; the 1440p rating stayed 9/10 because the tier-9 GPU became the limiter. `fit_to_budget` found a $1,798 configuration by replacing the B650E board with a cheaper B650 mATX board, with fewer motherboard features and a PCIe-generation note. The agent correctly left that secondary change unapplied. Use this exact path only with a case that supports mATX; after the Fractal Terra swap it is not a valid option.

*Nudge if the agent stops after the CPU swap:* "What did that change for performance and budget, and can I keep the faster CPU while recovering the budget elsewhere?" If the build already has the fastest CPU or the upgrade does not create a useful budget consequence, use the deterministic fallback: *"Get me under $1400, but don't touch the GPU, CPU, or case."* Expected: `fit_to_budget` with those slots protected → ordered plan presented → apply the proposed swaps only if time permits.

Optional 5-sec add if pace allows — **Prompt 3b:** "Would a 4K monitor make sense with this build?" → `estimate_performance` → bottleneck answer.

### Beat 5b — Color pass + final hero render (2:20–2:32) · *Creativity + collaboration*

> **Prompt 3c:** "For the final showcase, keep the CPU and GPU but make the hardware colorful: switch to the Bubble Pink Tower 300 and the white ARCTIC Liquid Freezer III Pro 360 A-RGB. Fix any PSU fit issue, validate it, then give me a clean studio hero shot with a small illustrated turtle sticker on the glass."

Expected: `search_parts` / `get_part_details` for the named case and cooler → `add_part`(case, replace) → `add_part`(cooler, replace) → validation identifies the compact SFX PSU mismatch → a compatible ATX PSU replacement → `validate_build` green → `render_build`(studio, three-quarter, flair: "a small illustrated turtle sticker on the glass side panel"). The exact pink case and rainbow-lit white AIO cards should flash into the slots before the schematic dissolves into checkpoint C (warmed cache, ~1 s).

This is an intentional priority change: the user is no longer preserving the compact-case goal, but explicitly protects CPU and GPU performance. If timing is tight, use a 5–7 s pickup insert that shows the two colorful card swaps, the green validation state and the warmed render; do not wait through searches or a cold render in the main take.

> "We started with a blue compact build, repaired it around an even smaller case, then changed priorities for the final showcase: pink chassis, white RGB cooling, same CPU and GPU. The agent treated color as a real hardware change — fit, PSU and radiator rules still applied — then placed the turtle art direction into the final artifact."

### Beat 5c — The operator's agent (2:32–2:50) · *Creativity + Execution (living catalog)*

Cut to `/admin` (already logged in via Access; second ChatGPT tab or same conversation). Chip reads "WebMCP · 5 catalog tools exposed to your agent".

> **Prompt 5:** "A new GPU launched this week — [pick a real recent part, verified during rehearsal]. Look up its specs and add it to the catalog with sources."

Expected: the agent uses **its own web search** → `catalog_get_schema` → `catalog_search` (no duplicate) → `catalog_upsert_part` with `sources` → a **draft** row appears with a diff. Human glances at the sources, clicks **Verify ✓** and **Publish** (or the agent calls `catalog_publish` and the human just verifies). Cut back to the shopper page: footer ticks to the new catalog version.

> "Same pattern, other side of the counter. The store's own agent researches a part that launched this week, drafts it into the schema-validated catalog with its sources — and a human verifies and publishes. The catalog is alive, and nobody had to ship an admin bot."

*Nudge if needed:* "Use the page's catalog tools to add it as a draft; I'll verify it myself."

Optional 5-sec add if pace allows — **Prompt 5b:** "The 9800X3D just dropped to $449 — update the price, with the source." → `catalog_update_price` → draft price row in the log; publish together with the new part.

### Beat 6 — Close the loop (2:50–2:58) · *Impact + wrap*

> **Prompt 4:** "Great — give me the build as a shareable link."

`export_build` → paste the URL (`/b/<id>#b=…`) in a new plain tab → **the exact build and goal load.** The share payload intentionally excludes the render, so the stage starts in schematic mode until `render_build` is called. (If time is short, show the link on screen and cut.)

Closing voiceover over a quick shot of the repo (MIT license visible) and the tool list in the Model Context Tool Inspector or the status chip popover:

> "Nineteen tools across two audiences, one constraint engine. Swap 'PC parts' for cars, kitchens or cloud configs — any configurator can work this way. The site doesn't ship an assistant. It ships *capability*, and whatever agent you already trust becomes the interface. That's the open web with agents in it. RigBuilder — MIT licensed, link below."

**Hard stop ≤ 2:58 — this cut is over-full by design.** Render A and B are pickup inserts, not additional real-time waits; budget 5–7 s total for both by trimming the agent's build loop and compatibility repair. Trim order if rehearsal runs long: shorten Beat 2 to 10 s, drop Prompt 3b, show render A/B as a 2 s split-screen, tighten Beat 6 to a title card. If rendering is unreliable in prod by Tue 2 midday, keep only the warmed final hero render; if the admin flow is unreliable, drop Beat 5c from the video only (DESIGN §11 scope policy).

---

## 2. Criteria coverage matrix (verify while rehearsing)

| Judges look for | Beat | On-screen evidence |
|---|---|---|
| Non-trivial, working WebMCP implementation | 3, 4, 5 | Real tool calls visible in ChatGPT; per-mutation validation responses; solver tools |
| Complete product, not a PoC | 2, 5, 6 | Mouse-only usable site; render; export/share loop; deployed URL, no flags needed |
| Human–agent collaboration | 3, 4 | Activity feed 🤖/👤 rows; human mid-conversation intervention; agent adapts; undo affordance |
| Credible real-world problem | 1, 5, 6 | Compatibility pain named; optimizer; generalization line |
| Novel vs existing concepts | 1, 5 | The inversion framing; page-as-solver vs agent-as-user; one request triggers consequence analysis and a reversible follow-up proposal |
| Theme: future of the open web | 1, 6 | Bring-your-own-agent framing, open standard, MIT, no walled garden |

Admin beat (5c) evidence: 🤖 draft row in the admin change log, human ✓ Verify + Publish, catalog version ticking up on the shopper page.

Admin tools: `catalog_get_schema`, `catalog_search`, `catalog_upsert_part` must appear in 5c; `catalog_publish` appears if the agent publishes (else the human does — both are fine); `catalog_update_price` is the optional 5b or judges' step 8.

Every flagship tool must appear at least once: `set_build_goal`, `search_parts`, `add_part`, `validate_build`, `explain_compatibility`, `suggest_alternatives`, `fit_to_budget`, `render_build`, `export_build`, plus `get_build_state` naturally. (`estimate_performance` is the optional 3b; `remove_part`/`reset_build`/`get_part_details` need no screen time.)

---

## 3. Judges' testing instructions (draft for the Devpost submission form)

> **Try it yourself (2 minutes, no account, no keys):**
> 1. Open **[RigBuilder](https://rigbuilder.andreas-adner.workers.dev/)** in ChatGPT's desktop built-in browser (your account/model must have site-tools access). Alternatively use Chrome 149+ with a compatible agent or the Model Context Tool Inspector; the production origin trial means no Chrome flag is needed. The header chip confirms: "WebMCP · 14 tools exposed to your agent."
> 2. Ask: *"Build me a quiet compact 1440p gaming PC under $1500 around the Hydrangea Blue Thermaltake TR100. Use a low-profile air cooler."* Watch the colorful case and the rest of the build assemble with live validation.
> 3. **Change something by hand** — swap the case to a small ITX one from the part browser. Then ask: *"I changed the case — fix whatever broke."* The agent reads your change through the shared page state.
> 4. Ask: *"Get me under $1400 but keep the GPU."* — the page's optimizer computes the swap plan. Then try: *"Let's swap for a faster CPU."* A good agent will evaluate the performance and budget consequences and, if needed, propose another valid saving rather than treating the swap as an isolated command.
> 5. Ask: *"Keep my CPU and GPU, but turn this into a colorful showcase with the Bubble Pink Tower 300 and a white RGB 360 mm AIO. Fix any fit issue, then render it with a small turtle sticker on the glass."* — the agent must treat the visual makeover as real component swaps, resolve case/radiator/PSU constraints, and then render the resulting build (first uncached render takes 10–40 s; you may need to click *Verify* once).
> 6. Ask for a shareable link and open it in any browser — the exact build and goal load from the link; request a render again if you want an image on the stage.
>
> 7. **Operator side:** open **[RigBuilder Admin](https://rigbuilder.andreas-adner.workers.dev/admin)** with the judge credentials below (Cloudflare Access). Ask your agent: *"Find the specs for [recent part] and add it to the catalog as a draft with sources."* Verify and publish it, then search for it on the shopper page.
> 8. Still on `/admin`, ask: *"The Ryzen 7 9800X3D is $449 at [retailer] today — update the price and cite the source."* — the agent drafts a price change via `catalog_update_price`; publish it and watch the shopper footer tick to the next catalog version.
>
> No agent available? The site is a full manual part picker with the same live compatibility engine — try the "only show compatible" toggle.

---

## 4. Rehearsal log

Run the full narrative in both environments before recording; log results here.

| Date | Env | Result / deviations | Fixes filed |
|---|---|---|---|
| — | ChatGPT desktop | | |
| — | Chrome 149+ (no flag, prod) + compatible inspector/agent | | |

---

## 5. High-value alternate prompts

These are backup takes and judge-conversation ideas built around the same **change → evaluate → improve** pattern. Do not cram all of them into the three-minute video.

1. **Quietness with a hard constraint:** *"Make it quieter without spending more, and tell me what I give up."* Expected: `suggest_alternatives` on cooler/case/PSU/GPU → price and noise deltas compared → one valid swap proposed or applied. This shows multi-objective reasoning rather than "buy the expensive one."
2. **A display changes the recommendation:** *"I'm moving from 1440p to 4K. Is this still balanced, and what single upgrade would matter most?"* Expected: `estimate_performance` at both resolutions → bottleneck changes or becomes clearer → `suggest_alternatives` for the limiting slot → budget/PSU/fit checked before any upgrade. Visually, the build may stay untouched until the human approves.
3. **Tempt the agent with an incompatible flagship:** *"Can we use the fastest GPU in the catalog without changing this case?"* Expected: `search_parts` → `explain_compatibility` catches the clearance or power problem before mutation → `suggest_alternatives` returns the fastest candidate that actually fits. This is a crisp demonstration that the agent consults page capability instead of guessing from product names.
4. **Human interrupts a plan:** while the agent is applying a multi-swap budget plan, manually change one slot. The next stale write should be rejected, then the agent re-reads state and recomputes. This is technically striking but timing-sensitive; keep it for a live demo or a separately rehearsed take, not the primary recording.
5. **Protect intent, not just parts:** *"Bring it under budget, but preserve performance and the compact case; choose where to compromise."* Expected: `fit_to_budget` with the case protected and performance preserved → an ordered proposal with explicit tradeoffs. This lets the agent translate natural-language intent into solver constraints.
6. **Color without hand-waving:** *"Keep CPU and GPU performance, but make this a white-and-rainbow build with a colorful case. Check radiator and PSU fit before changing anything."* Expected: `search_parts` for `hasRgb: true` AIOs and a non-black case → `explain_compatibility` / `suggest_alternatives` as needed → a proposed compatible set before mutation. This demonstrates that aesthetic intent becomes structured hardware constraints, not merely a render prompt.

**Selection rule:** use an alternate only when the current build gives it a visible consequence. A quietness prompt is weak if every installed part is already noise tier 1–2; a 4K prompt is weak if the CPU and GPU tiers are identical at both resolutions. Check the current state first and choose the prompt that makes the page's reasoning legible on screen.
