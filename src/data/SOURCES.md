# RigBuilder seed catalog — sources and method

**Snapshot date:** 2026-08-29 (`snapshotDate` in `seed.ts`; every part carries `priceUpdatedAt` / `updatedAt` = `2026-08-29T00:00:00Z`).
**Seed catalog version:** 1 after a reset/import. The deployed D1 catalog was at v3 when checked on 2026-08-29.
**Files:** `src/data/parts/{cpu,motherboard,ram,gpu,cooler,case,psu,storage}.json`, validated by `pnpm check:data` (`src/data/check.ts`) against the frozen schema in `src/data/schema.ts`.
**Current seed:** 448 published parts; 82 are hand-verified (the category totals are recorded below).

## Disclaimer

RigBuilder is an independent demo project. It is **unaffiliated** with, and not endorsed by, any manufacturer or retailer named in the catalog. Product names are used textually to identify products (nominative use); no descriptions, images, logos or marketing text were copied. **Part cards** (specific and generic images used as references for `render_build` and as thumbnails) are original generated images: for *specific* cards, manufacturer product pages were consulted as visual references for appearance; no vendor image is stored, redistributed or shipped, and cards are reviewed by a human for stray text or marks before publication (see `docs/RENDER_FIDELITY.md`). The 38 *generic* category cards were generated from attribute-only prompts with no vendor input at all; they ship in the repository under `assets/cards/generic/` with their prompts (see the README there). **Prices are indicative** US street prices as observed around the snapshot date, entered by hand, and will be wrong by the time you read this. **This is demo data**: it is small, curated, and simplified (see "Modelling simplifications"). Always confirm specifications against the manufacturer before buying.

## Method

1. **Schema first.** `schema.ts` was authored independently (categories, fields, units) before any data was entered. Nothing in the dataset was imported from `docyx/pc-part-dataset`, PCPartPicker, or any other aggregated dataset.
2. **Bulk authoring.** Parts were entered from public knowledge of the product lines (model names, core counts, form factors, clearances, wattages) with a current-generation skew: AM5 (Zen 4 / Zen 5) and LGA1851 (Arrow Lake) plus one legacy generation each (AM4 Zen 3, LGA1700 Raptor/Alder Lake).
3. **Verification tier.** For the parts that sit on the demo and eval paths, the manufacturer's spec page was fetched at snapshot time and the physical/critical fields (socket, chipset, form factor, lengths, heights, clearances, radiator support, PSU form factor, wattage) were checked against it. Only those parts have `verified: true` and a `sources[]` entry. If a fetch failed or a value could not be confirmed on the page, the part stays `verified: false` with empty `sources` — even when the value is almost certainly right.
4. **Checks.** `pnpm check:data` enforces the schema and the referential rules listed below; `seed.ts` re-parses the whole catalog at module load.

Fetch notes for the record: several AMD, Intel, Noctua, Thermalright, Zotac, PowerColor and Samsung pages blocked automated fetches (403/429), timed out, or redirected to marketing pages during verification. Consequently **no CPU, RAM or storage part is verified** in this snapshot, and the remaining unlisted cooler/GPU records stay unverified. Their values are from the product lines' well-known published specs and should be confirmed by a human before being flipped to `verified`.

### Referential rules (enforced by `check.ts`)

- Every part parses; ids match `<prefix>-<slug>`, files match categories, `verified` parts have ≥ 1 https source, seed parts are `addedBy: "seed"` and `status: "published"`.
- No duplicate ids.
- Every motherboard `chipset` is a key of `CHIPSET_SUPPORT`; every CPU `generation` is a value in it.
- Every CPU socket has ≥ 3 motherboards; every board chipset supports ≥ 3 CPUs.
- Every DDR generation has RAM kits and boards.
- Every case supports ≥ 1 motherboard form factor present in the catalog.
- Every AIO radiator size is supported by ≥ 1 case; every PSU form factor fits ≥ 1 case; every GPU and air cooler fits ≥ 1 case.
- Per-category counts reach ≥ 80 % of the DESIGN §6.1 targets.

## Chipset support table (`CHIPSET_SUPPORT` in `schema.ts`)

The `CHIPSET_UNSUPPORTED` rule uses a deliberately simplified table: chipset → list of CPU generation labels.

| Socket | Chipsets | Generations | Rationale |
|---|---|---|---|
| AM5 | X870E, X870, X670E, X670, B850, B650E, B650, A620 | Zen 5, Zen 4 | All AM5 chipsets accept Ryzen 7000/8000/9000 with a BIOS update; the 600-series boards may need a flash for Zen 5 but ship updated in 2026. |
| AM4 | X570, B550, A520 | Zen 3, Zen 2 | 500-series boards support Ryzen 3000/5000 (incl. 5x00X3D and G-series). Zen+/Zen 1 and 300/400-series boards are out of scope. |
| LGA1851 | Z890, B860, H810 | Arrow Lake | Core Ultra 200S only. |
| LGA1700 | Z790, B760, H770, Z690, B660 | Raptor Lake, Alder Lake | 12th/13th/14th gen; 600-series boards need a BIOS update for 13th/14th gen, assumed applied. |

Modelling simplifications: no BIOS-version tracking; the 8000G APUs are labelled "Zen 4" (their PCIe 4.0 limitation is not modelled); Intel non-K "Core Ultra" parts are "Arrow Lake" too. DDR generation is checked per board (`ddrGen`), not per chipset, because LGA1700 boards exist in DDR4 and DDR5 variants.

## Field conventions

- **CPU `tdpW`** — AMD: default TDP. Intel: *Maximum Turbo Power* (PL2) for K/KF parts and non-K parts alike, because that is the sustained load a cooler and PSU must handle on a desktop board with default limits. This makes `COOLER_UNDERSIZED` and the wattage estimate conservative for Intel.
- **CPU `includesCooler`** — true for AMD 65 W parts that ship with a Wraith cooler and for Intel non-K boxed parts; false for X / X3D / K / KF parts.
- **GPU `lengthMm`, `slots`** — manufacturer card length and slot occupancy; `recommendedPsuW` is the manufacturer's stated recommendation (NVIDIA/AMD reference figure where the partner does not state one).
- **Case `maxGpuLengthMm` / `maxCoolerHeightMm`** — manufacturer's stated maxima *without* front fans/radiators reducing them; `radiatorSupport` lists every size supported at any mount (not simultaneous); `volumeLiters` is the manufacturer's figure or an estimate from outer dimensions.
- **Cooler `tdpRatingW`** — manufacturer rating where published, otherwise an editorial estimate consistent with the product's tier (low-profile ≈ 95–130 W, single-tower ≈ 150–220 W, dual-tower ≈ 240–280 W, 240 mm AIO ≈ 250 W, 360 mm ≈ 300–340 W).
- **Storage `capacityGB`** — marketed capacity in GB (a "1TB" drive is 1000, Kingston's 1024-class drives 1024).

## Editorial tiers

`perfTier` (CPU, GPU; 1–10 per workload) and `noiseTier` (GPU, cooler, case, PSU; 1 = near-silent … 5 = loud) are **editorial**, not measured. They were authored from the general consensus of published reviews around the snapshot date and kept monotonic within a product line (a 9800X3D never scores below a 9700X for gaming; a Dual card never scores quieter than the TUF card of the same chip).

- `gaming1080p/1440p/4k` — GPU: relative frame-rate class at that resolution; CPU: how far the CPU is from limiting a top GPU at that resolution (X3D parts top the 1080p/1440p columns, differences compress at 4K).
- `streaming` — CPU core count plus GPU encoder quality (NVIDIA NVENC ≥ AMD ≥ Intel Arc weighted by generation).
- `videoEditing`, `rendering3d`, `ml` — multi-core throughput and, for GPUs, CUDA/ROCm maturity and VRAM.
- `office` — practically saturated; only entry parts drop below 8–10.
- `noiseTier` — from rated dBA where published (e.g. ≤ 25 dBA → 1, 25–30 → 2, 30–35 → 3, 35–40 → 4, > 40 → 5), otherwise from the cooler/fan class (dual-tower or 140 mm-fan designs → 1–2; 2-fan partner GPUs → 3; non-modular budget PSUs → 4).

`estimate_performance` labels its output as an editorial estimate; nothing in the UI presents these as benchmarks.

## Demo path

Chosen so that DEMO.md Beat 3 ("quiet 1440p gaming under $1500") and Beat 4 (human swaps to a tiny ITX case → `GPU_TOO_LONG` → agent finds a fitting card) work on **verified** parts. Numbers below were read from the manufacturer pages twice (initial fetch and a re-fetch while writing this file).

### The ITX case

| Part | id | maxGpuLengthMm | maxCoolerHeightMm | boards | PSU | radiators | source |
|---|---|---|---|---|---|---|---|
| Fractal Design Terra (Graphite) | `case-fractal-terra` | **322** | 48 | ITX | SFX, SFX-L | 120 | https://www.fractal-design.com/products/cases/terra/terra/graphite/ |
| Lian Li A4-H2O (backup) | `case-lianli-a4-h2o` | **322** | 55 | ITX | SFX, SFX-L | 240 | https://lian-li.com/product/a4h2o/ |
| Cooler Master NR200P (backup, roomier) | `case-coolermaster-nr200p` | **330** | 155 | ITX | SFX, SFX-L | 120/140/240/280 | https://www.coolermaster.com/en-global/products/masterbox-nr200p/ |

### Cards that are TOO LONG for the Terra (322 mm) — the "agent's pick" candidates

The verified long cards are deliberately the best-value cards in their tier so a "strong 1440p, under budget" search lands on them.

| Part | id | lengthMm | slots | price | source |
|---|---|---|---|---|---|
| ASUS TUF Gaming Radeon RX 9070 XT OC | `gpu-asus-tuf-rx-9070-xt` | **330** | 3.125 | $629 | https://www.asus.com/motherboards-components/graphics-cards/tuf-gaming/tuf-rx9070xt-o16g-gaming/techspec/ |
| ASUS TUF Gaming GeForce RTX 5070 Ti OC | `gpu-asus-tuf-rtx-5070-ti` | **329** | 3.125 | $779 | https://www.asus.com/motherboards-components/graphics-cards/tuf-gaming/tuf-rtx5070ti-o16g-gaming/techspec/ |
| ASUS TUF Gaming GeForce RTX 5070 OC | `gpu-asus-tuf-rtx-5070` | **329** | 3.125 | $649 | https://www.asus.com/motherboards-components/graphics-cards/tuf-gaming/tuf-rtx5070-o12g-gaming/techspec/ |
| ASUS TUF Gaming GeForce RTX 5080 OC | `gpu-asus-tuf-rtx-5080` | **348** | 3.6 | $1199 | https://www.asus.com/motherboards-components/graphics-cards/tuf-gaming/tuf-rtx5080-o16g-gaming/techspec/ |

Unverified long cards of the same tier also exist (MSI Gaming Trio 5070 Ti 338 mm, Gigabyte Gaming OC 5070 Ti 340 mm, Sapphire Nitro+ / XFX Mercury / PowerColor Red Devil 9070 XT 330–340 mm, ROG Astral 5070 Ti 358 mm).

### Cards of comparable tier that DO FIT the Terra (≤ 322 mm) — `suggest_alternatives` targets

| Part | id | lengthMm | slots | price | source |
|---|---|---|---|---|---|
| ASUS Prime Radeon RX 9070 XT OC | `gpu-asus-prime-rx-9070-xt` | **312** | 2.5 | $689 | https://www.asus.com/motherboards-components/graphics-cards/prime/prime-rx9070xt-o16g/techspec/ |
| ASUS Prime GeForce RTX 5070 Ti OC | `gpu-asus-prime-rtx-5070-ti` | **304** | 2.5 | $819 | https://www.asus.com/motherboards-components/graphics-cards/prime/prime-rtx5070ti-o16g/techspec/ |
| ASUS Prime Radeon RX 9070 OC | `gpu-asus-prime-rx-9070` | **312** | 2.5 | $579 | https://www.asus.com/motherboards-components/graphics-cards/prime/prime-rx9070-o16g/techspec/ |
| ASUS Prime GeForce RTX 5070 OC | `gpu-asus-prime-rtx-5070` | **304** | 2.5 | $599 | https://www.asus.com/motherboards-components/graphics-cards/prime/prime-rtx5070-o12g/techspec/ |
| ASUS Prime GeForce RTX 5080 OC | `gpu-asus-prime-rtx-5080` | **304** | 2.5 | $1099 | https://www.asus.com/motherboards-components/graphics-cards/prime/prime-rtx5080-o16g/techspec/ |
| ASUS Dual GeForce RTX 5070 OC | `gpu-asus-dual-rtx-5070` | **249** | 2.5 | $579 | https://www.asus.com/motherboards-components/graphics-cards/dual/dual-rtx5070-o12g/techspec/ |

Plus unverified fitting cards: PowerColor Reaper 9070 XT 302 mm, MSI Ventus 3X 5070 Ti 303 mm, PNY 5070 Ti 304 mm, Zotac Solid 5070 Ti 307 mm, Gigabyte Windforce SFF 5070 Ti 300 mm.

Note that the Terra's 48 mm cooler limit, ITX-only board support and SFX-only PSU bay mean a swap from an ATX build also raises `COOLER_TOO_TALL`, `FORM_FACTOR_MISMATCH` and `PSU_FORM_FACTOR`; the verified ITX-compatible set is: board `mb-asus-rog-strix-b850-i` (AM5, ITX) or `mb-asus-rog-strix-z890-i` (LGA1851, ITX), PSU `psu-corsair-sf750` (SFX, 750 W) / `psu-corsair-sf850l` (SFX-L, 850 W) / `psu-coolermaster-v850-sfx-gold` (SFX), and low-profile coolers `cooler-noctua-nh-l9a-am5` (37 mm) / `cooler-thermalright-axp90-x47` (47 mm) (both unverified — Noctua/Thermalright blocked fetches). If the video needs a single-conflict swap, use the NR200P (330 mm GPU, 155 mm cooler) with an unverified 338–340 mm card, or pre-seed Beat 3 as an ITX build.

### "Quiet 1440p gaming under $1500" — a verified-where-possible reference build

| Slot | Part | id | price | verified |
|---|---|---|---|---|
| CPU | AMD Ryzen 5 9600X | `cpu-r5-9600x` | $249 | no (AMD blocked fetch) |
| Cooler | Thermalright Peerless Assassin 120 SE (noise 2) | `cooler-thermalright-peerless-assassin-120-se` | $35 | no |
| Motherboard | ASUS Prime B650-Plus (ATX, DDR5, PCIe 4.0 x16) | `mb-asus-prime-b650-plus` | $159 | yes |
| RAM | G.Skill Flare X5 DDR5-6000 2x16GB | `ram-gskill-flare-x5-ddr5-6000-2x16` | $95 | no |
| GPU | ASUS TUF Gaming Radeon RX 9070 XT OC (330 mm) | `gpu-asus-tuf-rx-9070-xt` | $629 | yes |
| Storage | WD Black SN850X 1TB | `ssd-wd-black-sn850x-1tb` | $89 | no |
| PSU | Corsair RM750e (ATX, Gold, noise 2) | `psu-corsair-rm750e` | $99 | yes |
| Case | Fractal Design Define 7 Compact (noise 1, 341 mm GPU) | `case-fractal-define-7-compact` | $129 | yes |
| **Total** | | | **$1484** | |

Cheaper variant: Ryzen 5 7600 (`cpu-r5-7600`, $189, boxed cooler) without a separate cooler → $1389. Wattage estimate per DESIGN §5: 65×1.2 + 304×1.4 + 2×5 + 5 + 30 + 50 ≈ 599 W, within a 750 W unit (≈ 20 % headroom; the RM850e `psu-corsair-rm850e`, $119, gives comfortable margin).

## Verified parts (82)

Each entry lists the fields confirmed on the fetched page.

### Motherboards (15)
- `mb-asus-rog-strix-x870e-e` — socket AM5, X870E, ATX, DDR5 8000+, 4 DIMM, 5 M.2, 4 SATA, PCIe 5.0 — https://rog.asus.com/motherboards/rog-strix/rog-strix-x870e-e-gaming-wifi/spec/
- `mb-asus-prime-x870-p-wifi` — AM5, X870, ATX, DDR5 8000+, 4 DIMM, 4 M.2, 2 SATA, PCIe 5.0 — https://www.asus.com/motherboards-components/motherboards/prime/prime-x870-p-wifi/techspec/
- `mb-asus-tuf-b850-plus-wifi` — AM5, B850, ATX, DDR5 8000+, 4 DIMM, 3 M.2, 4 SATA, PCIe 5.0 — https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b850-plus-wifi/techspec/
- `mb-asus-rog-strix-b850-i` — AM5, B850, Mini-ITX, DDR5 8200+, 2 DIMM, 2 M.2, 2 SATA, PCIe 5.0 — https://rog.asus.com/motherboards/rog-strix/rog-strix-b850-i-gaming-wifi/spec/
- `mb-asus-rog-strix-b650e-f` — AM5, B650E, ATX, DDR5 8000+, 4 DIMM, 3 M.2, 4 SATA, PCIe 5.0 — https://rog.asus.com/motherboards/rog-strix/rog-strix-b650e-f-gaming-wifi-model/spec/
- `mb-asus-prime-b650-plus` — AM5, B650, ATX, DDR5 7600+, 4 DIMM, 2 M.2, 4 SATA, PCIe 4.0 x16 — https://www.asus.com/motherboards-components/motherboards/prime/prime-b650-plus/techspec/
- `mb-asus-prime-b650m-a-wifi-ii` — AM5, B650, mATX, DDR5 7600+, 4 DIMM, 2 M.2, 4 SATA, PCIe 4.0 x16 — https://www.asus.com/motherboards-components/motherboards/prime/prime-b650m-a-wifi-ii/techspec/
- `mb-asus-prime-a620m-a` — AM5, A620, mATX, DDR5 7600+, 4 DIMM, 2 M.2, 4 SATA, PCIe 4.0 — https://www.asus.com/motherboards-components/motherboards/prime/prime-a620m-a/techspec/
- `mb-asus-prime-b550m-a-wifi-ii` — AM4, B550, mATX, DDR4 4866, 4 DIMM, 2 M.2, 4 SATA, PCIe 4.0 — https://www.asus.com/motherboards-components/motherboards/prime/prime-b550m-a-wifi-ii/techspec/
- `mb-asus-prime-z890-p-wifi` — LGA1851, Z890, ATX, DDR5 8666+, 4 DIMM, 4 M.2, 4 SATA, PCIe 5.0 — https://www.asus.com/motherboards-components/motherboards/prime/prime-z890-p-wifi/techspec/
- `mb-asus-rog-strix-z890-i` — LGA1851, Z890, Mini-ITX, DDR5 9200+, 2 DIMM, 2 M.2, 2 SATA, PCIe 5.0 — https://rog.asus.com/motherboards/rog-strix/rog-strix-z890-i-gaming-wifi/spec/
- `mb-asus-tuf-b860m-plus-wifi` — LGA1851, B860, mATX, DDR5 8800+, 4 DIMM, 3 M.2, 4 SATA, PCIe 5.0 — https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b860m-plus-wifi/techspec/
- `mb-asus-prime-b860-plus-wifi` — LGA1851, B860, ATX, DDR5 8666+, 4 DIMM, 2 M.2, 4 SATA, PCIe 5.0 — https://www.asus.com/motherboards-components/motherboards/prime/prime-b860-plus-wifi/techspec/
- `mb-asus-tuf-z790-plus-wifi` — LGA1700, Z790, ATX, DDR5 7200, 4 DIMM, 4 M.2, 4 SATA, PCIe 5.0 — https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-z790-plus-wifi/techspec/
- `mb-asus-tuf-b760m-plus-wifi-ii` — LGA1700, B760, mATX, DDR5 7800, 4 DIMM, 3 M.2, 4 SATA, PCIe 5.0 — https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b760m-plus-wifi-ii/techspec/

### GPUs (13)
- `gpu-asus-tuf-rtx-5090` — 348 × 146 × 72 mm, 3.6 slot, 32 GB, PCIe 5.0 (PSU recommendation not on page; NVIDIA reference 1000 W used) — https://www.asus.com/motherboards-components/graphics-cards/tuf-gaming/tuf-rtx5090-o32g-gaming/techspec/
- `gpu-asus-prime-rtx-5080` — 304 × 126 × 50 mm, 2.5 slot, 850 W, 16 GB — https://www.asus.com/motherboards-components/graphics-cards/prime/prime-rtx5080-o16g/techspec/
- `gpu-asus-tuf-rtx-5080` — 348 × 146 × 72 mm, 3.6 slot, 850 W, 16 GB — https://www.asus.com/motherboards-components/graphics-cards/tuf-gaming/tuf-rtx5080-o16g-gaming/techspec/
- `gpu-asus-tuf-rtx-5070-ti` — 329 × 140 × 62.5 mm, 3.125 slot, 850 W, 16 GB — https://www.asus.com/motherboards-components/graphics-cards/tuf-gaming/tuf-rtx5070ti-o16g-gaming/techspec/
- `gpu-asus-prime-rtx-5070-ti` — 304 × 126 × 50 mm, 2.5 slot, 750 W, 16 GB — https://www.asus.com/motherboards-components/graphics-cards/prime/prime-rtx5070ti-o16g/techspec/
- `gpu-asus-prime-rtx-5070` — 304 × 126 × 50 mm, 2.5 slot, 750 W, 12 GB — https://www.asus.com/motherboards-components/graphics-cards/prime/prime-rtx5070-o12g/techspec/
- `gpu-asus-dual-rtx-5070` — 249 × 126 × 50.6 mm, 2.53 slot (stored as 2.5), 750 W, 12 GB — https://www.asus.com/motherboards-components/graphics-cards/dual/dual-rtx5070-o12g/techspec/
- `gpu-asus-tuf-rtx-5070` — 329 × 140 × 62.5 mm, 3.125 slot, 750 W, 12 GB — https://www.asus.com/motherboards-components/graphics-cards/tuf-gaming/tuf-rtx5070-o12g-gaming/techspec/
- `gpu-asus-dual-rtx-5060-ti-16g` — 229 × 120 × 50 mm, 2.5 slot, 550 W, 16 GB — https://www.asus.com/motherboards-components/graphics-cards/dual/dual-rtx5060ti-o16g/techspec/
- `gpu-asus-dual-rtx-5060` — 228 × 123 × 50 mm, 2.5 slot, 550 W, 8 GB — https://www.asus.com/motherboards-components/graphics-cards/dual/dual-rtx5060-o8g/techspec/
- `gpu-asus-tuf-rx-9070-xt` — 330 × 140 × 62.5 mm, 3.125 slot, 850 W, 16 GB — https://www.asus.com/motherboards-components/graphics-cards/tuf-gaming/tuf-rx9070xt-o16g-gaming/techspec/
- `gpu-asus-prime-rx-9070-xt` — 312 × 130 × 50 mm, 2.5 slot, 750 W, 16 GB — https://www.asus.com/motherboards-components/graphics-cards/prime/prime-rx9070xt-o16g/techspec/
- `gpu-asus-prime-rx-9070` — 312 × 130 × 50 mm, 2.5 slot, 650 W, 16 GB — https://www.asus.com/motherboards-components/graphics-cards/prime/prime-rx9070-o16g/techspec/

### Cases (34)
- `case-fractal-terra` — GPU 322 mm, cooler 48 mm, Mini-ITX, SFX/SFX-L, 120 mm side radiator, 10.4 L — https://www.fractal-design.com/products/cases/terra/terra/graphite/
- `case-lianli-a4-h2o` — GPU 322 mm, cooler 55 mm, Mini-ITX, SFX/SFX-L, 240 mm, 11 L — https://lian-li.com/product/a4h2o/
- `case-fractal-ridge` — GPU 335 mm, cooler 70 mm, Mini-ITX, SFX/SFX-L, 120 mm, 12.6 L — https://www.fractal-design.com/products/cases/ridge/ridge/black/
- `case-coolermaster-nr200p` — GPU 330 mm, cooler 155 mm, Mini-ITX, SFX/SFX-L, 120/140/240/280 mm, 18.25 L — https://www.coolermaster.com/en-global/products/masterbox-nr200p/
- `case-fractal-north` — GPU 355 mm, cooler 145 mm, ATX/mATX/ITX, ATX PSU, 120/140/240/280/360 mm, 42 L — https://www.fractal-design.com/products/cases/north/north/charcoal-black/
- `case-fractal-pop-air` — GPU 405 mm, cooler 170 mm, ATX/mATX/ITX, ATX PSU, 120/240/280 mm, 44 L — https://www.fractal-design.com/products/cases/pop/pop-air/black-tg-clear-tint/
- `case-fractal-define-7-compact` — GPU 341 mm, cooler 169 mm, ATX/mATX/ITX, ATX PSU, 120/140/240/280/360 mm, 39.3 L — https://www.fractal-design.com/products/cases/define/define-7-compact/black/
- `case-fractal-meshify-2-compact` — GPU 341 mm, cooler 169 mm, ATX/mATX/ITX, ATX PSU, 120/140/240/280/360 mm, 39.4 L — https://www.fractal-design.com/products/cases/meshify/meshify-2-compact/black-tg-light-tint/
- `case-corsair-4000d-airflow` — GPU 360 mm, cooler 170 mm, ITX…E-ATX, ATX PSU, 120/240/280/360 mm (volume estimated from 453 × 230 × 466 mm) — https://www.corsair.com/us/en/p/pc-cases/cc-9011200-ww/4000d-airflow-tempered-glass-mid-tower-atx-case-black-cc-9011200-ww
- `case-lianli-lancool-216` — GPU 392 mm, cooler 180 mm, ITX…E-ATX, ATX PSU, 240/280/360 mm (volume estimated) — https://lian-li.com/product/lancool-216/
- `case-lianli-lancool-207` — GPU 375 mm, cooler 180 mm, ATX/mATX/ITX, ATX PSU ≤ 160 mm, 240/280/360 mm, 45.5 L — https://lian-li.com/product/lancool-207/
- `case-lianli-o11-dynamic-evo` — GPU 426 mm, cooler 167 mm, ITX…E-ATX, ATX PSU, 280/360 mm (volume estimated) — https://lian-li.com/product/o11-dynamic-evo/
- `case-nzxt-h5-flow` — GPU 410 mm, cooler 170 mm, ITX…E-ATX, ATX PSU ≤ 200 mm, up to 360 mm front / 240 mm top, 45 L — https://nzxt.com/product/h5-flow
- `case-coolermaster-td500-mesh-v2` — GPU 410 mm, cooler 165 mm, ITX…E-ATX, ATX PSU ≤ 170 mm, 120/140/240/280/360 mm (volume estimated) — https://www.coolermaster.com/en-global/products/masterbox-td500-mesh-v2/
- `case-hyte-y70-blueberry-milk` — GPU 422 mm, cooler 180 mm, ITX…E-ATX, ATX PSU, 120/140/240/280/360 mm, 70.7 L — https://hyte.com/store/y70/cs-hyte-y70-bm
- `case-hyte-y70-strawberry-milk` — GPU 422 mm, cooler 180 mm, ITX…E-ATX, ATX PSU, 120/140/240/280/360 mm, 70.7 L — https://hyte.com/store/y70/cs-hyte-y70-sm
- `case-hyte-y70-taro-milk` — GPU 422 mm, cooler 180 mm, ITX…E-ATX, ATX PSU, 120/140/240/280/360 mm, 70.7 L — https://hyte.com/store/y70/cs-hyte-y70-tm
- `case-thermaltake-ceres-350-mx-bubble-pink` — GPU 360 mm, cooler 185 mm, ITX…E-ATX, ATX PSU, 120/140/240/280/360 mm, 53.9 L — https://latam.thermaltake.com/ceres-350-mx-bubble-pink-mid-tower-chassis.html
- `case-thermaltake-ceres-350-mx-bumblebee` — GPU 360 mm, cooler 185 mm, ITX…E-ATX, ATX PSU, 120/140/240/280/360 mm, 53.9 L — https://latam.thermaltake.com/ceres-350-mx-bumblebee-mid-tower-chassis.html
- `case-thermaltake-ceres-350-mx-hydrangea-blue` — GPU 360 mm, cooler 185 mm, ITX…E-ATX, ATX PSU, 120/140/240/280/360 mm, 53.9 L — https://latam.thermaltake.com/ceres-350-mx-hydrangea-blue-mid-tower-chassis.html
- `case-thermaltake-ceres-350-mx-matcha-green` — GPU 360 mm, cooler 185 mm, ITX…E-ATX, ATX PSU, 120/140/240/280/360 mm, 53.9 L — https://latam.thermaltake.com/ceres-350-mx-matcha-green-mid-tower-chassis.html
- `case-thermaltake-ceres-350-mx-racing-green` — GPU 360 mm, cooler 185 mm, ITX…E-ATX, ATX PSU, 120/140/240/280/360 mm, 53.9 L — https://latam.thermaltake.com/ceres-350-mx-racing-green-mid-tower-chassis.html
- `case-thermaltake-tower-300-bubble-pink` — GPU 400 mm, cooler 210 mm, ITX/mATX, ATX PSU, 120/240/280/360/420 mm, 56 L — https://www.thermaltake.com/the-tower-300-bubble-pink-micro-tower-chassis.html
- `case-thermaltake-tower-300-bumblebee` — GPU 400 mm, cooler 210 mm, ITX/mATX, ATX PSU, 120/240/280/360/420 mm, 56 L — https://www.thermaltake.com/the-tower-300-bumblebee-micro-tower-chassis.html
- `case-thermaltake-tower-300-gravel-sand` — GPU 400 mm, cooler 210 mm, ITX/mATX, ATX PSU, 120/240/280/360/420 mm, 56 L — https://www.thermaltake.com/the-tower-300-gravel-sand-micro-tower-chassis.html
- `case-thermaltake-tower-300-hydrangea-blue` — GPU 400 mm, cooler 210 mm, ITX/mATX, ATX PSU, 120/240/280/360/420 mm, 56 L — https://www.thermaltake.com/the-tower-300-hydrangea-blue-micro-tower-chassis.html
- `case-thermaltake-tower-300-limestone` — GPU 400 mm, cooler 210 mm, ITX/mATX, ATX PSU, 120/240/280/360/420 mm, 56 L — https://www.thermaltake.com/the-tower-300-limestone-micro-tower-chassis.html
- `case-thermaltake-tower-300-matcha-green` — GPU 400 mm, cooler 210 mm, ITX/mATX, ATX PSU, 120/240/280/360/420 mm, 56 L — https://www.thermaltake.com/the-tower-300-matcha-green-micro-tower-chassis.html
- `case-thermaltake-tower-300-matcha-plum` — GPU 400 mm, cooler 210 mm, ITX/mATX, ATX PSU, 120/240/280/360/420 mm, 56 L — https://www.thermaltake.com/the-tower-300-matcha-plum-micro-tower-chassis.html
- `case-thermaltake-tower-300-peach-fuzz` — GPU 400 mm, cooler 210 mm, ITX/mATX, ATX PSU, 120/240/280/360/420 mm, 56 L — https://www.thermaltake.com/the-tower-300-peach-fuzz-micro-tower-chassis.html
- `case-thermaltake-tower-300-racing-green` — GPU 400 mm, cooler 210 mm, ITX/mATX, ATX PSU, 120/240/280/360/420 mm, 56 L — https://www.thermaltake.com/the-tower-300-racing-green-micro-tower-chassis.html
- `case-thermaltake-tower-300-snow` — GPU 400 mm, cooler 210 mm, ITX/mATX, ATX PSU, 120/240/280/360/420 mm, 56 L — https://www.thermaltake.com/the-tower-300-snow-micro-tower-chassis.html
- `case-thermaltake-tower-300-turquoise` — GPU 400 mm, cooler 210 mm, ITX/mATX, ATX PSU, 120/240/280/360/420 mm, 56 L — https://www.thermaltake.com/the-tower-300-turquoise-micro-tower-chassis.html
- `case-thermaltake-tr100-hydrangea-blue` — GPU 360 mm, cooler 68 mm, Mini-ITX, SFX/SFX-L, 120/140/240/280 mm, 20.6 L — https://latam.thermaltake.com/tr100-hydrangea-blue-mini-tower-chassis.html

### Coolers (13)
- `cooler-coolermaster-hyper-212-black` — 152 mm, LGA1851/1700 + AM5/AM4, 32.8 dBA — https://www.coolermaster.com/en-global/products/hyper-212-black/
- `cooler-coolermaster-hyper-622-halo` — 157 mm, LGA1851/1700 + AM5/AM4, 27 dBA, ARGB — https://www.coolermaster.com/en-global/products/hyper-622-halo-black/
- `cooler-coolermaster-masterliquid-240l-core` — 240 mm radiator, LGA1700 + AM5/AM4 (LGA1851 not listed on page, so omitted), 27.2 dBA — https://www.coolermaster.com/en-global/products/masterliquid-240l-core/
- `cooler-arctic-liquid-freezer-iii-pro-360-argb-white` — white 360 mm AIO, LGA1851/1700 + AM5/AM4, ARGB — https://www.arctic.de/en/Liquid-Freezer-III-Pro-360-ARGB-White/ACFRE00188A
- `cooler-asus-rog-strix-lc-iii-360-argb-white` — white 360 mm AIO, LGA1700 + AM5/AM4, ARGB (LGA1851 not listed, so omitted) — https://rog.asus.com/us/cooling/cpu-liquid-coolers/rog-strix-lc/rog-strix-lc-iii-360-argb-white-edition/spec/
- `cooler-bequiet-light-loop-360-white` — white 360 mm AIO, LGA1851/1700 + AM5/AM4, ARGB — https://www.bequiet.com/en/cpucooler/5186
- `cooler-coolermaster-masterliquid-360-atmos-white` — white 360 mm AIO, LGA1700 + AM5/AM4, ARGB — https://www.coolermaster.com/en-global/products/masterliquid-360-atmos-white/
- `cooler-corsair-icue-link-titan-360-rx-rgb-white` — white 360 mm AIO, LGA1851/1700 + AM5/AM4, RGB — https://www.corsair.com/us/en/p/cpu-coolers/CW-9061021-WW/icue-link-titan-360-rx-rgb-aio-liquid-cpu-cooler-white-cw-9061021-ww
- `cooler-gigabyte-aorus-waterforce-ii-360-ice` — white 360 mm AIO, LGA1851/1700 + AM5/AM4, ARGB — https://www.gigabyte.com/us/CPU-Cooler/AORUS-WATERFORCE-II-360-ICE/sp
- `cooler-lianli-galahad-ii-lcd-sl-inf-360-white` — white 360 mm AIO, LGA1851/1700 + AM5/AM4, LCD pump cap and RGB fans — https://lian-li.com/product/galahad-ii-lcd/
- `cooler-msi-mag-coreliquid-e360-white` — white 360 mm AIO, LGA1700 + AM5/AM4, ARGB — https://us-store.msi.com/PC-Components/CPU-Coolers/Liquid-Cooler/MAG-CORELIQUID-E360-WHITE
- `cooler-phanteks-glacier-one-360d30-white` — white 360 mm AIO, LGA1700 + AM5/AM4, D30 RGB fans — https://phanteks.com/product/glacier-one-360d30-white/
- `cooler-thermaltake-th360-v2-ultra-ex-argb-snow` — white 360 mm AIO, LGA1851/1700 + AM5/AM4, LCD pump display and ARGB — https://www.thermaltake.com/catalog/product/view/id/2660/lcgs_video

### PSUs (7)
- `psu-corsair-rm750e` — 750 W, ATX, 80 PLUS Gold, fully modular — https://www.corsair.com/us/en/p/psu/cp-9020262-na/rm750e-fully-modular-low-noise-atx-power-supply-cp-9020262-na
- `psu-corsair-rm850e` — 850 W, ATX, 80 PLUS Gold, fully modular — https://www.corsair.com/us/en/p/psu/cp-9020263-na/rm850e-fully-modular-low-noise-atx-power-supply-cp-9020263-na
- `psu-corsair-rm1000x` — 1000 W, ATX, Gold, fully modular — https://www.corsair.com/us/en/p/psu/cp-9020271-na/rm1000x-fully-modular-low-noise-atx-power-supply-2024-cp-9020271-na
- `psu-corsair-sf750` — 750 W, SFX, 80 PLUS Platinum, fully modular — https://www.corsair.com/us/en/p/psu/cp-9020186-na/sf750-80-plus-platinum-fully-modular-sfx-power-supply-cp-9020186-na
- `psu-corsair-sf850l` — 850 W, SFX-L, 80 PLUS Gold, fully modular (page resolves to the SF850L) — https://www.corsair.com/us/en/p/psu/cp-9020245-na/sf850-80-plus-platinum-fully-modular-sfx-power-supply-cp-9020245-na
- `psu-coolermaster-mwe-gold-750-v2` — 750 W, ATX, 80 PLUS Gold, fully modular — https://www.coolermaster.com/en-global/products/mwe-gold-750-v2-full-modular/
- `psu-coolermaster-v850-sfx-gold` — 850 W, SFX (ATX bracket included), 80 PLUS Gold, fully modular — https://www.coolermaster.com/en-global/products/v850-sfx-gold/

### Not verified in this snapshot
All CPUs, RAM and storage, plus the remaining unlisted case/cooler/GPU/motherboard/PSU records. The ROG Strix B860-I fetch reported an implausible socket string, so it was left unverified rather than guessed.
