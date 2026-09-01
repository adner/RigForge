# RigBuilder — WebMCP Hackathon Project

Project for participating in **The WebMCP Challenge** — a time-bounded build and submission effort for building agent-native web apps with WebMCP.

## Purpose

Design, build, verify, and submit RigBuilder before the deadline. **This repository is the application repository**: the React app, Cloudflare Worker, seed catalog, scripts, tests, and project documentation all live here.

Current implementation snapshot (2026-09-01): production is deployed at [rigbuilder.andreas-adner.workers.dev](https://rigbuilder.andreas-adner.workers.dev/); the Worker reports D1, R2, KV, Durable Object quota, Rate-Limiting, Turnstile/session, and the OpenAI image provider configured; the origin-trial token is served; the seed contains 448 parts (82 verified); and the automated suite has 285 passing tests. Cross-client agent evals, the composed-render A/B gate, the demo video, and the final Devpost submission remain outstanding.

## Development approach

This is agentic development. Do not estimate work in calendar days, hours, or other human production-time units, and do not describe a change as requiring “days of work.” Time and agent resources are not the constraint. Instead, reason about:

- dependencies and prerequisites;
- implementation scope and affected files or interfaces;
- verification required to establish correctness;
- external blockers, rate limits, or unavailable environments; and
- risk, uncertainty, and the fastest useful vertical slice.

When sequencing work, use states such as **blocked**, **ready**, **in progress**, and **verified**, or name concrete acceptance criteria. The submission deadline is a fixed external constraint, but it is not a basis for estimating how long implementation should take.

## The hackathon

- **Host:** OpenAI, with Google Chrome, Cloudflare, Shopify, Vercel, Render and Netlify as co-sponsors.
- **Devpost:** https://webmcp.devpost.com/ (rules: `/rules`, resources: `/resources`)
- **Landing page:** https://openai.com/webmcp-challenge/
- **Registration & submission window:** 2026-08-25 11:00 PT → **2026-09-03 13:00 PT** (hard deadline)
- **Judging:** 2026-09-04 → 2026-09-21. **Winners announced ~2026-09-23.**
- **Brief:** "Build a WebMCP-powered web app that imagines and explores the future of the open web."

### Prizes

10 winning submissions, each getting a combined package: $3,000 cash (OpenAI) + 1-year ChatGPT Pro for up to 3 team members + Codex Micro + swag, $10,000 Cloudflare credits, ~$4,200/yr Vercel credits, $300 Render credits, $500 Netlify cash, Shopify gear, and a 3-month Google AI Ultra subscription per member. One prize per project.

### Judging criteria (equal weight)

1. **WebMCP leverage** — depth and authenticity of the WebMCP integration.
2. **Execution** — a functional, complete product, not a proof-of-concept.
3. **Potential impact** — credible problem/solution fit for a real audience.
4. **Creativity & ambition** — novel vs. what already exists.

Two-stage judging: viability screening, then criteria scoring.

### Required deliverables

- [x] Working **live URL** deployed with the production origin-trial token; final ChatGPT/Chrome agent evals are tracked separately in `docs/EVALS.md`.
- [x] **Text description** — use case, UX improvements, human/agent collaboration, WebMCP implementation details (`README.md` and `docs/DESIGN.md`).
- [x] **Public code repo** ([adner/RigBuilder](https://github.com/adner/RigBuilder)) with source, setup instructions, and an MIT license.
- [ ] **Demo video** under 3 minutes, with audio, covering functionality and WebMCP usage, uploaded to YouTube.
- [ ] Testing access (credentials if anything is gated).

Work must be new, or an existing project *meaningfully extended* with WebMCP during the submission window — document what was pre-existing using timestamped commits.

## Technical basics

Pages expose tools to the in-browser agent via the `document.modelContext` API:

```js
await document.modelContext.registerTool({
  name: "search_products",
  description: "Search the product catalog",
  inputSchema: { /* JSON Schema */ },
  annotations: { readOnlyHint: true },        // optional
  execute: async (input, { signal }) => { /* ... */ }
}, { signal: abortController.signal })        // abort() unregisters
```

Also: `document.modelContext.getTools()`, `executeTool()`, `"toolchange"` event. Cross-origin iframes need `allow="tools"` + `exposedTo` (not relevant to us — top-level page only).

The agent discovers registered tools and calls them, getting structured responses back — the web page itself *is* the MCP server, running client-side.

### Testing environments

- **ChatGPT** desktop app's built-in browser — site tools are available when the account and selected model support them.
- **Google Chrome 149+** — the production origin trial exposes the API without a flag; use a compatible agent/Model Context Tool Inspector. For local development, enable `chrome://flags/#enable-webmcp-testing`.

### Useful packages & docs

- Spec: `webmachinelearning/webmcp` on GitHub
- Chrome's WebMCP developer documentation + origin trial instructions
- WebMCP tool security guide (prompt-injection risks, trust boundaries)
- `@mcp-b/webmcp-polyfill`, `@mcp-b/webmcp-types`, `@mcp-b/webmcp-ts-sdk`, `@mcp-b/transports`
- `usewebmcp` / `useWebMCPTool` React hook; Angular has native integration
- WebMCP evals (test tools before shipping); Chrome WebMCP debugging with the Model Context Tool Inspector
- Starter templates: Cloudflare Workers React template, Vercel WebMCP storefront, Netlify starter, Chrome Labs demos

### Hosting credits

Cloudflare Workers/Pages, Vercel ($30 build credits, first 1000 builders), Netlify (3,000 credits, first 1000 — request by 2026-09-01 12:00 PT), Render (free tier + $50), ChatGPT Sites (paid plan required), Shopify storefronts.

## Chosen idea (decided 2026-08-27)

**RigBuilder** — an agent-native PC part picker. The page is a compatibility **solver** (socket, clearance, PSU, RAM-gen constraints…); the user's agent (ChatGPT desktop site tools / a compatible Chrome 149+ agent or inspector) drives the build through 14 WebMCP tools (including `render_build`) and gets engine validation + a state revision back on every call. A second audience — the store operator — maintains a **living catalog** (Cloudflare D1) through 5 admin WebMCP tools on `/admin`: their agent web-researches new parts and drafts them; humans verify, and either the human or agent can publish with an explicit confirmation. Manual UI is fully usable without an agent. Rebuilt from scratch (predecessor: the AgentCon CopilotKit PC-builder, cited as prior art only).

**Full design and implementation reference: [docs/DESIGN.md](docs/DESIGN.md)** (v2.3 documentation sync) — architecture, tool surface, engine rules, dataset, security, and current delivery status. Read it before changing a contract.
**Review dispositions: [docs/REVIEW_RESPONSES.md](docs/REVIEW_RESPONSES.md)** — what each review finding became, including deliberate disagreements. Review inputs are in git-ignored `scratchpad/`.
**WebMCP primer: [docs/WEBMCP_PRIMER.md](docs/WEBMCP_PRIMER.md)** — the spec explained + how RigBuilder applies it; the user's fluency doc for judge conversations.
**Demo script: [docs/DEMO.md](docs/DEMO.md)** — the master run-through: rehearsal script, video shooting script (< 3 min, timed beats), and the judges' testing instructions for Devpost. Keep it in sync if the tool surface changes.

Current decisions and implementation: **this repo is the app repo** (`adner/RigBuilder`, MIT) · React/Vite/TS/Zustand/Tailwind with a custom daylight-workbench visual identity · catalog of record in **D1** with `catalogVersion`, a 448-part seed as import + offline fallback, and 82 verified parts · `/admin` behind Cloudflare Access with 5 agent-native catalog tools (agents draft; verification is human-only; publishing is explicitly confirmed) · "client-side" is not a pitch line (the engine runs in-page for latency and offline manual use) · no polyfill · one Cloudflare Worker for catalog/admin, rendering, reviewed card thumbnails, quotas, and short share links · versioned shared state (`buildRevision`; stale-write guard defaults to the revision the agent last saw) · `gpt-image-2` via a Worker that rebuilds the prompt from ids and bounded `flair` (never trusts a client prompt/hash/image) · exact and reviewed-generic part cards with a text-only render fallback · Chrome origin-trial token · no in-page LLM fallback.

Background on the angle (Alex Nahas, author of MCP-B, mcp-b.ai): don't give the agent the same abilities as a human user — **let the agent become the interface** and ask what the page's job then is. Reference app: [Duckboard](https://github.com/WebMCP-org/duckboard) (data-viz driven by the agent, DuckDB WASM, 100% client-side).

## App repo

This repository — [github.com/adner/RigBuilder](https://github.com/adner/RigBuilder) — is the app repo (decided 2026-08-29). App code is at the root (see `docs/DESIGN.md` §3.2), with durable project documentation in `docs/`.
