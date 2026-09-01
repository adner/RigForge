# RigBuilder theme — “the daylight workbench”

Implemented in `src/index.css` (Tailwind v4 `@theme` tokens) and `src/ui/primitives/`. The CSS is the source of truth for exact values; this file records the current visual intent and component conventions.

## Concept

A PC builder’s daylight workbench: a pale green ESD mat under warm ceramic work trays, with an engineering measurement board in the center. The interface should feel like a specific physical instrument, not a generic dashboard.

Two people work at the bench, and provenance is encoded in color: agent actions use cable orange (`ember`); human actions and interactive controls use instrument blue (`glacier`). Validation has its own red/amber/green semantic colors. The same color must not carry two meanings.

The signature element is the proportional **build measurement board**. It has switchable assembly/footprint views, draws selected components to a shared scale, derives a representative case envelope from catalog volume, and annotates real modeled constraints such as GPU and cooler clearance. Solid shapes are selected parts, dashed shapes are references, and red denotes a conflict.

Generated, brand-free part cards are allowed as compact inspection-window thumbnails. Exact reviewed cards win; deterministic reviewed generic cards are the fallback; a text/category marker is the final fallback. No vendor imagery or logos are shipped.

## Palette

| Token | Hex | Role |
|---|---|---|
| `soot` | `#dce8e3` | page / ESD-mat background |
| `iron` | `#fbfbf7` | ceramic panels and stage |
| `steel` | `#f1f3ee` | cards and secondary surfaces |
| `plate` | `#e5ece7` | hover, active, and gauge-track surfaces |
| `seam` / `seam-strong` | `#c5d1cb` / `#98aaa1` | rims, hairlines, stronger boundaries |
| `bone` | `#202925` | primary ink |
| `ash` | `#52635b` | secondary ink and specs |
| `dust` | `#78887f` | tertiary ink and placeholders |
| `ember` / `ember-dim` / `ember-glow` | `#ec641f` / `#ffdfcf` / `#ff925d` | agent provenance, WebMCP, drafts |
| `glacier` / `glacier-dim` | `#167aa6` / `#d7edf6` | human actions, links, controls, focus |
| `fault` / `fault-dim` | `#c83d32` / `#f8ded9` | blocking validation |
| `caution` / `caution-dim` | `#a76700` / `#fff0be` | warnings, budget/headroom caution |
| `clear` / `clear-dim` | `#18764b` / `#d9eee3` | verified and passing states |

The body uses a subtle 24 px drafting grid and a soft white daylight lift. `engraved` panels combine a crisp one-pixel rim, an inset highlight, and a restrained shadow.

## Type

| Role | Face | Token | Usage |
|---|---|---|---|
| Display | Big Shoulders Display Variable | `font-display` | product mark and high-impact display labels |
| Spec | JetBrains Mono Variable | `font-mono` | ids, prices, dimensions, timestamps, revisions |
| UI/prose | Instrument Sans Variable | `font-sans` | headings, labels, controls, explanations |

Scale (`text-*`): `micro` 11 px, `spec` 12 px, `body` 14 px, `label` 16 px, `title` 24 px, `mark` 32 px, `gauge` 44 px. Numbers in instruments use tabular figures. The reusable `eyebrow` utility is Instrument Sans, 12 px, semibold, with modest tracking; `display-h` is the condensed display face.

Fonts are bundled through `@fontsource-variable/*`; no runtime font request is required.

## Spacing and shape

- Base spacing is 4 px; panels normally use 12 px padding; page gaps are 12 px and become 16 px at `lg`.
- `chamfer` radius is 5 px and `plate` radius is 9 px. The shapes stay compact and machined without forcing every control into a sharp rectangle.
- App header is 48 px. Desktop footer is 32 px; narrow layouts use content padding instead of a fixed height.
- Slot cards use a two-pixel left edge for state: neutral when filled, dashed when empty, red/amber when a conflict points at the slot.

## Motion

All named animations are 300 ms or less and use the `instrument` easing curve (`cubic-bezier(0.2, 0.8, 0.2, 1)`). `prefers-reduced-motion` collapses animation and transition durations.

| Animation | Trigger |
|---|---|
| `animate-flash-ember` | agent build mutation |
| `animate-flash-glacier` | human build mutation |
| `animate-slide-in` | new feed row or conflict card |
| `animate-reveal` | a render replaces the schematic |
| `animate-drawer-in` | narrow collaboration drawer opens |
| gauge needle transition | power/headroom value changes |

Replay a slot flash by changing `flashKey`; render reveal is keyed by `renderId`.

## Layout

The shopper layout has two responsive modes plus a wide default:

- **≥ 1280 px:** three regions by default — `272px` build/goal/instruments, flexible stage + browser, `352px` validation/activity.
- **1024–1279 px:** two regions by default — build column and stage/browser. The header Activity button can add/remove the collaboration column; a badge surfaces blocking conflicts or unread activity while it is hidden.
- **< 1024 px:** one scrolling column. The stage and part browser come first; the goal, horizontal snap rail of eight slots, and price/power instruments follow. Validation and activity move to a right-hand drawer opened by the fixed Activity button.

The admin page is one column below `lg`, then a flexible catalog column plus a 380 px draft/change-log column.

## Component inventory (`src/ui/primitives/`)

| Component | Props / behavior of note |
|---|---|
| `Button` | variants `primary`, `outline`, `ghost`, `danger`; sizes `sm`, `md` |
| `Chip`, `WebMCPChip` | tool-count wording; `state`, `toolCount`, `scope` shopper/admin |
| `Panel` | `title`, `meta`, `actions`, `flush`, separate body class |
| `Badge` | validation plus `verified`, `count`, `draft`, `published` tones |
| `Toggle` | accessible switch used by “only compatible” |
| `SlotCard` | thumbnail, verification, multi-slot count, attention, provenance flash, compact rail mode |
| `ConflictCard` | severity edge/badge and optional “show parts that fix this” action |
| `FeedRow` | ember/glacier provenance rule, revision, guarded undo state |
| `PartThumbnail` | exact/generic same-origin image, marker fallback, hover/focus inspection preview |
| `PriceTicker` | total, optional budget, remaining/over-budget bar |
| `PowerGauge` | estimated watts and optional PSU limit on a 240° gauge |
| `CaseSilhouette` | proportional assembly/footprint measurement board and modeled-fit annotations |
| `RenderStage` | schematic/render toggle, pending and verification states, active/superseded artifacts, removal |

Layouts live in `src/ui/ShopperLayout.tsx` and `src/ui/AdminLayout.tsx`; the part browser, goal editor, tool popover, toast system, and footer/system strip live alongside them in `src/ui/`.

## Copy rules

Use sentence case except for the product mark and short instrument labels. Buttons name the action (“Swap in”, “Verify to render”, “Publish”). Validation badges are verbs the human can act on: *Blocks*, *Check*, *Note*. Never say “ground truth”, “the page knows”, or “never hallucinates”; the product checks only the modeled constraints against its current catalog snapshot.
