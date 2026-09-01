# Reviewed generic part cards

The 38 brand-neutral **generic part-card archetypes** that ship with RigBuilder, one directory
per archetype (`<archetype>/1.png`, 1024×1024 PNG, plus the exact `prompt.txt` that produced
it). They are the reviewed set: the Worker serves them as catalog thumbnails
(`GET /api/cards/:partId/thumb.webp?fallback=<archetype>`) and uses the compose-eligible
GPU / cooler / RAM ones as reference images for composed `render_build` output
(`docs/RENDER_FIDELITY.md`).

**Provenance.** Every image was generated from the attribute-only prompt recorded next to
it (`mode: generic`) — no manufacturer photo, logo or product name was used as input — and
was then reviewed by a human for stray text, marks or implausible geometry before being
accepted. They depict *categories* of hardware, not any real product. Archetype definitions
and prompts live in `src/engine/cardArchetype.ts`. Licensed under the repository's MIT license.

**Publishing.** The images are content-addressed in R2 (`cards/generic/<archetype>/<sha256>.png`
+ a 160×160 WebP thumbnail). Seed a bucket with the whole set:

```sh
pnpm cards:publish --local  --generic-all   # local R2 for `pnpm dev`
pnpm cards:publish --remote --generic-all   # production
```

Re-running is idempotent (an archetype whose bytes are already published is skipped).
To replace one, generate candidates with `pnpm cards:generic`, review them in
`scratchpad/cards/generic/contact.html`, then copy the accepted `<n>.png` over `1.png` here
together with its `prompt.txt`, and publish again.
