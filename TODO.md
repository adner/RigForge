# RigBuilder — TODO

**Deadline:** 2026-09-03 13:00 PT (= 22:00 CEST).
**Status snapshot:** 2026-08-29. See [docs/DESIGN.md](docs/DESIGN.md) for the implementation reference and [docs/DEMO.md](docs/DEMO.md) for the rehearsal/recording checklist.

## Klart

- [x] Publikt app-repo på `main`, MIT-licens och installations-/deployinstruktioner.
- [x] Produktions-URL: [rigbuilder.andreas-adner.workers.dev](https://rigbuilder.andreas-adner.workers.dev/). `/api/health` svarar 200; origin-trial-tokenen serveras.
- [x] Cloudflare-resurser kopplade: D1, R2, KV, Rate-Limiting, Durable Object, Turnstile/session och OpenAI-bildprovider. Access avleder oautentiserade `/api/admin/*`-anrop till inloggning.
- [x] 14 shopper-tools + 5 admin-tools, `lastSeenRevision`, guarded undo, lokal build-persistens, delningslänkar, renderflöde och manuell shopper/admin-UI.
- [x] Part-card-pipeline, exakta och generiska thumbnails, composed-render path med textfallback. Alla 38 granskade generiska kort finns lokalt och i produktion; de provade demo-korten är publicerade som exakta kort.
- [x] Seed: 448 delar, 82 handverifierade. `check:data` är grön.
- [x] Automatiska tester: 274/274 i 28 testfiler.
- [x] README: arkitektur, verktyg, lokal setup/deploy, dataproveniens, säkerhet, integritet och licens.

## Kvar före inspelning

- [ ] Sätt upp/verifiera Chrome 149+ utan flagga mot produktion (origin trial) och med `chrome://flags/#enable-webmcp-testing` lokalt; anslut en kompatibel agent/Model Context Tool Inspector och kontrollera tool list/inspector.
- [ ] Verifiera att kontot/modellen har site-tools-åtkomst i ChatGPT-desktopappens inbyggda webbläsare, kör mot produktion och kontrollera att alla 14 respektive 5 verktyg hittas.
- [ ] Kör och logga samtliga shopper- och admin-evals i båda klienterna enligt [docs/EVALS.md](docs/EVALS.md). Iterera beskrivningar endast om observerat agentbeteende kräver det.
- [ ] Verifiera en kall text-render och en kall composed-render i produktion, mät latens, kör A/B-grinden i [docs/RENDER_FIDELITY.md](docs/RENDER_FIDELITY.md), granska bilderna för text/loggor och värm checkpoint A/B/C inför inspelning.
- [ ] Repetera hela färg-/Terra-/budget-/share-/adminflödet i [docs/DEMO.md](docs/DEMO.md). En share-länk återställer build + goal; den återställer inte automatiskt en render.
- [ ] Verifiera Cloudflare Access med det faktiska domarkontot och lägg instruktionerna/inloggningen i Devpost-fältet “testing access”.
- [ ] Valfritt datalyft: handverifiera fler CPU-, RAM- och lagringsposter. Detta får inte blockera evals/video.

## Submission

- [x] Live-infrastruktur och origin-trial-token på produktionsorigin.
- [x] Textbeskrivning för use case, UX, human/agent-samarbete och WebMCP-implementation.
- [x] Publikt repo med källkod, setupinstruktioner och MIT-licens.
- [x] WebMCP-säkerhets-/integritetsgränser dokumenterade i README och DESIGN.
- [ ] Demovideo under 3 minuter med ljud; ladda upp till YouTube.
- [ ] Slutför Devpost-text, live-länk, videolänk och testing-access-instruktioner.
- [x] Slutkör data, tester, TypeScript och produktionsbundle; verifiera live health/catalog och gör en sista länk-/placeholderkontroll.
- [ ] Skicka in i god tid före 2026-09-03 22:00 CEST.

## Struket

- ~~Netlify-credits~~ — kör Cloudflare (beslut 2026-08-27).
- ~~PCF/Power Apps-spåret~~ — utvärderat 2026-08-27, förkastat på grund av iframe/origin-begränsningen och temapassningen.
