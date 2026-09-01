# Review responses — dispositions and deliberate disagreements

Companion to [DESIGN.md](DESIGN.md). Review inputs (`scratchpad/FINDINGS_round1.md`, `scratchpad/FINDINGS_round2.md`) are git-ignored; this file is the durable record of what was accepted, what was adapted, and **where the design intentionally departs from a reviewer's recommendation, with reasoning**. Review models: please treat a listed disagreement as a decision to challenge on its merits, not as an oversight to re-report.

Legend: **Accepted** = adopted as recommended · **Adapted** = same goal, different mechanism · **Disagree** = not adopted, reasoning below · **Owner decision** = product call by the project owner.

**Current implementation note (2026-08-29):** the design that followed these reviews is
deployed with all 14 shopper tools, 5 admin tools, D1/R2/KV/Durable Object integrations,
448 seed parts (82 verified), generated cards and 285 passing automated tests. Manual
cross-client evals, the render A/B and the demo video remain. Historical dispositions
below are kept as decisions; where the final implementation differs, the correction is
called out explicitly.

## Round 2 (2026-08-29) → DESIGN v2.1

| # | Finding | Disposition | Where |
|---|---|---|---|
| 1 | "No feature cuts" not credible; restore cut lines with render last | **Owner decision + Adapted** | §11 |
| 2 | Render endpoint trusts client prompt/hash | **Accepted** | §3.3, §4.3 render details |
| 3 | `expectedRevision` must be required | **Disagree** (stronger alternative adopted) | §4.2, §4.5 |
| 4 | Build revision vs render artifact conflated; share contradiction | **Accepted** | §4.5 (7), §4.3, §7.2 |
| 5 | Optimizer arithmetic / objective / multi-slot ops | **Accepted** | §6.3, §6.4, §4.3 |
| 6 | `gpt-image-1` deprecated; pick one provider | **Accepted** (verified against OpenAI model pages 2026-08-29) | §3.1 |
| 7 | Turnstile single-use; KV not for counters | **Accepted / Adapted** | §4.3 render details |
| 8 | Short links: KV read-after-write, abuse, image storage | **Accepted** | §4.3 export, §7.2, §8 |
| 9 | Tri-state compatibility | **Accepted** | §4.1, §5, §7.2 |
| 10 | Response size split | **Accepted** | §4 (1), §4.4, §4.6 |
| 11 | Render fidelity overstated; strategic framing | **Accepted** | §1, §4.3, DEMO.md |
| 12 | `verified` in tool behavior; drop legal conclusion | **Accepted** | §4 (6), §6.1, §6.3 |
| 13 | Companion-doc drift | **Accepted** | DEMO.md, WEBMCP_PRIMER.md, TODO.md |
| 14 | Privacy wording; CORS not a control | **Accepted** | §8 privacy table |

### R2-#1 — Scope policy (Owner decision + Adapted)

The reviewer's diagnosis is accepted: parallel implementation does not parallelize integration, cross-client testing, video production, or the origin-trial wait, and the render subsystem is the largest new risk. The reviewer's *remedy* (ordered cut lines, render behind the core) is **not** adopted as a cut policy. The owner's decision (2026-08-29) is that the full 14-tool surface ships.

Risk is instead managed by two mechanisms the reviewer's own reasoning supports:

1. **Contracts frozen before fan-out** (this v2.1) — the reviewer's strongest point was "fix the contracts before parallel implementation hardens the wrong ones". Done.
2. **Ordered integration**, not ordered cuts: the core collaboration path (DEMO beats 2–5) must be rehearsable in both clients by Mon Sep 1; render is the only feature permitted to still be stabilizing on Tue Sep 2. If render is not reliable in production by Tue midday, the **video** omits the render beat; the feature still ships in the product.

What a reviewer should check next time: whether §11's integration order is being followed, not whether features were cut.

### R2-#3 — `expectedRevision` required vs. default-to-last-seen (Disagree)

**Reviewer's position:** the stale-write guarantee is only real if `expectedRevision` is *required* on every build mutation; description guidance is not a guarantee.

**Design's position:** agreed that guidance is not a guarantee — so v2.1 makes the guarantee **independent of the agent** rather than dependent on it supplying a parameter. The tool layer tracks `lastSeenRevision` = the `buildRevision` it most recently returned to the agent (every response carries one). A write without `expectedRevision` is checked against `lastSeenRevision`; a write with it is checked against the supplied value. Both mismatches → `STALE_REVISION`, nothing mutated.

Why this is preferred over a required parameter:

- **Same guarantee, strictly fewer failure modes.** A human edit between two agent calls is rejected either way. But with a required parameter, an agent that simply omits it (which non-deterministic agents will do some fraction of the time) fails with `INVALID_INPUT` on a *legitimate* write, costs a round-trip, and may loop or give up — on camera, in the judged demo.
- **Chaining is automatic.** Each successful write's returned revision becomes `lastSeenRevision`, so multi-op budget plans chain without the agent having to thread a value through — the exact concern the reviewer raised about proposals.
- **The reviewer's residual worry** ("if the agent omits it, a stale mutation succeeds") no longer holds: omission is checked against the last revision the agent *actually saw*, which is precisely the knowledge the write is based on.

Known limitation, documented: `lastSeenRevision` is per page/tool-layer, not per agent. In the single-agent WebMCP model (one page, one agent host) this is equivalent; if multiple agents ever shared one page, they would need explicit `expectedRevision`, which remains supported.

**Ask for the next review:** attack the mechanism (e.g. initialization at registration, undo interaction, `get_build_state` updating `lastSeenRevision` as intended) rather than re-raising "optional ⇒ no guarantee".

### R2-#7 — Rate limiting (Adapted)

Accepted: KV is not for counters; Turnstile tokens are single-use/5-min, so "once per session" needs a server-issued session. Adapted: the Workers **Rate-Limiting binding** is used only for per-IP burst limits, because it supports only 10 s/60 s windows and is itself documented as "permissive, eventually consistent, not an accounting system" (verified 2026-08-29). The **daily cap** — the cost guard that must be accurate — uses a **Durable Object** counter. This is a refinement of the reviewer's list of options, not a departure.

### R2-#4 — Share links "render included" (Accepted in design; simplified in the final implementation)

The reviewed design proposed recomputing `buildHash` when a share URL loads and attaching
an existing R2 render. The final implementation deliberately keeps share payloads to the
build and goal only: a share visit restores those exactly and starts on the schematic.
Normal non-share visits may restore the latest active render from local persistence, and
an explicit identical `render_build` request may hit R2, but share navigation does not do
either automatically. DEMO.md and EVALS.md now test the implemented contract.

## v2.2 owner decisions (2026-08-29, after round 2, no review input) — partially reverses an earlier stance

Recorded here because the next review round will see a design that contradicts what round 2 reviewed:

1. **"Client-side" dropped as a selling point.** Round 1/2 both saw a design that leaned on "engine runs in the page / Duckboard precedent". The owner questioned whether that strengthens anything under the judging criteria; it does not (WebMCP tools run in-page by definition; where their backing logic lives is unjudged). The engine still executes in-page — for latency and offline manual use — but the pitch no longer mentions it.
2. **Catalog moves to D1 with an update path.** The owner's concern: a build-time JSON catalog reads as a proof-of-concept under *Execution*. Agreed — not because of *where* the bytes live but because a catalog that cannot change without a redeploy is a demo of a configurator. Fix: D1 catalog of record, `GET /api/catalog` with `catalogVersion`, seed/fallback JSON retained, `priceUpdatedAt` per part, import pipeline.
3. **`/admin` skeleton with 5 agent-native tools.** Makes the update path visible, and demonstrates the same WebMCP pattern for the *operator*: their agent researches a newly launched part with its own web search and drafts it via `catalog_upsert_part`; verification is human-only; publish needs confirm + Access. This is the one place web-sourced text enters the system — see DESIGN §4.7 and §8 for the boundary. Reviewers: this is the new highest-value target for a security review.
4. **Scope grows again.** Acknowledged against round 2 #1. The admin/D1 work is an independent workstream (depends only on schema + Worker) and sits with render in the "last to have to be perfect / video-only fallback" tier.

## Round 1 (2026-08-29) → DESIGN v2

Dispositions were applied in v2 and re-audited by round 2 (see that review's own disposition table). Items not adopted as recommended:

- **Scope cut to 80–120 parts / drop `estimate_performance` / URL-only export — Owner decision: not adopted.** Full surface retained; the final seed contains 448 parts with an 82-part verified tier, and `verified` is exposed to the agent.
- **Drop `quieter`/`smaller` directions — Adapted:** kept, with an explicit data model (`noiseTier`, `volumeLiters`, form-factor orderings) and `DIRECTION_NOT_APPLICABLE` for categories where they are meaningless.
- **Top-of-stack-only undo — Adapted:** full history kept with *guarded* inverse operations (undo only if the slot still holds what the action left), which the review itself listed as the alternative.
- **Greedy → "heuristic planner" wording — Adapted:** implemented as bounded exhaustive/beam search instead, so the "optimizer" wording is defensible.
