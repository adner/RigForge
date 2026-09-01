# RigBuilder — Agent evals

Scripted prompts to run manually against **both** target clients (ChatGPT desktop built-in browser with site-tools access; Chrome 149+ with the production origin trial or local flag plus a compatible agent/Model Context Tool Inspector) before recording and before submission. Each eval lists the prompt, the expected tool pattern (order may vary — agents are non-deterministic; what matters is that the flagged tools are used and the end state is right), and the pass criteria. Log results in the table at the bottom and in DEMO.md §4.

Conventions: `→` sequence, `×n` repeated, `[opt]` acceptable but not required, **bold** = must appear.

## Shopper evals (start state: remove `rigbuilder.build.v1` from localStorage, then hard reload)

| # | Prompt | Expected pattern | Pass criteria |
|---|---|---|---|
| S1 | "Build me a quiet, compact 1440p gaming PC under $1500 on this site." | **`set_build_goal`**(gaming, 1500, noise: quiet, size: compact) → **`search_parts`**(compatibleWithCurrentBuild) ×n → **`add_part`** ×6–8 → [opt] `validate_build` | All 8 slots filled (RAM/storage ≥1), 0 errors, total ≤ 1500, goal banner shows, feed has 🤖 rows with revisions, no `STALE_REVISION` |
| S2 | (after S1) "Would an RTX 5080 fit in this build?" | **`explain_compatibility`** or `validate_build`(hypothetical) — **no mutation** | Answer cites the case clearance number from the response; `buildRevision` unchanged |
| S3 | (after S1) **Human swaps the case to the Fractal Terra (322 mm) by hand.** Then: "I changed the case myself — fix whatever broke but keep it a strong 1440p build." | Either `get_build_state`/`validate_build` first, **or** an `add_part` that is rejected with **`STALE_REVISION`** → re-read → **`suggest_alternatives`**(gpu) → `add_part`(replace) | Ends with 0 errors; the GPU chosen fits the ITX case's clearance; if the stale rejection happened, the agent recovered without asking the user |
| S4 | (after S3) "I'm over budget now. Get me back under $1500 but don't touch the GPU or CPU." | **`fit_to_budget`**(protect: [gpu, cpu]) → agent *presents* the plan → `add_part`(replace / replacesPartId) per op | Plan shown before applying; ops applied in order; total ≤ 1500; GPU and CPU unchanged; each op used the previous op's revision (no `STALE_REVISION`) |
| S5 | (after S4) "Show me what this build looks like, with a small turtle sticker on the glass side panel." | **`render_build`** with matching `flair` ([opt] preceded by `VERIFICATION_REQUIRED` → human clicks Verify → retry) | Image appears on the stage with the requested cosmetic detail; `buildRevision` unchanged; second identical call returns `cached: true`; a no-flair call has a different hash |
| S6 | (after S5) "Give me a shareable link." | **`export_build`**(url) | URL is `/b/<id>#b=…`; opening it in a fresh tab restores the exact build and goal. The stage is schematic until `render_build` is called because render state is intentionally not in the share payload. |
| S7 | Fresh start. "What's the cheapest AM5 board that supports DDR5-6000 and has 3 M.2 slots?" | **`search_parts`**(motherboard, filters) | Correct filter use; answer names a real catalog part with `verified` status mentioned or visible |
| S8 | Fresh start. "Add a Ryzen 7 9800X3D and a B650 board, then tell me what else I need for a working PC." | `search_parts` → `add_part` ×2 → `validate_build` or `get_build_state` | Agent lists missing slots from `GOAL_SLOT_MISSING`/empty digest, mentions `COOLER_MISSING` (9800X3D has no stock cooler) |
| S9 | (after S8) "Add a DDR4 kit." | `search_parts`(ram) → `add_part` **or** `validate_build`(hypothetical) | Either the agent avoids DDR4 because `search_parts` marks it `incompatible` (RAM_TYPE_MISMATCH), or adds it and immediately reports the error — never silently leaves an error |
| S10 | (after S1) "Make it quieter without spending more." | **`suggest_alternatives`**(cooler/case/psu, direction: quieter) → `add_part`(replace) | Swaps reduce noiseTier; total does not increase; `DIRECTION_NOT_APPLICABLE` handled gracefully if the agent tries it on cpu/ram |
| S11 | (after S1) "Is this balanced for 4K?" | **`estimate_performance`**(gaming, 4k) | Answer quotes the bottleneck component and says it's an estimate |
| S12 | Fresh start. "Start over and add just a case — the smallest white one you can find." | `reset_build`(confirm) → `search_parts`(case, sortBy/filters) | `reset_build` used with `confirm: true`; a white, low-volume case added; `search_parts` `conditional` fits handled (no other slots yet) |

## Admin evals (open `/admin` via Cloudflare Access)

| # | Prompt | Expected pattern | Pass criteria |
|---|---|---|---|
| A1 | "[A real GPU launched in the last ~6 months, chosen at rehearsal] — look up its specs and add it to the catalog with sources." | agent's own web search → **`catalog_get_schema`**(gpu) → **`catalog_search`** → **`catalog_upsert_part`**(sources ≥1) | Draft row appears with diff; `verified: false`; sources are https manufacturer/press URLs; lengthMm/tdpW plausible; no duplicate created |
| A2 | "Mark it verified." | agent explains it cannot; suggests the human click Verify | **No** tool sets verified; if the agent tries `catalog_upsert_part` with `verified: true` it gets `VERIFIED_IS_HUMAN_ONLY` and reports it |
| A3 | "Update the price of [existing part] to $X — here's the source: [url]." then "Publish." | **`catalog_update_price`** → **`catalog_publish`**(confirm) | Draft price with source → publish bumps `catalogVersion`; shopper page footer shows the new version after reload; change log has 🤖 + 👤 rows |

## Size / description checks (automated, but eyeball once per client)

- Every tool visible in the client's tool list with its description intact (no truncation).
- Responses remain readable in the client's tool-call inspector. The automated payload test currently measures ~2.9 kchars for `get_build_state`, ~1.7 kchars for `validate_build`, and ≤1.5 kchars for the other sampled shopper tools; the repeated build digest contributes 476 chars of that total.

## Results log

| Date | Client | Evals run | Pass | Deviations / fixes filed |
|---|---|---|---|---|
| — | ChatGPT desktop | | | |
| — | Chrome 149+ + compatible inspector/agent | | | |
