/** In-memory CatalogRepo for unit tests (no miniflare). Mirrors d1Repo semantics. */
import type { Part } from "../src/data/schema";
import { clampLogLimit, type CatalogRepo, type CatalogVersion, type ChangeLogEntry, type PartStatus } from "./repo";

export interface MemoryRepo extends CatalogRepo {
  rows: Map<string, Part>; // key `${id}|${status}`
  versions: CatalogVersion[];
  log: ChangeLogEntry[];
  reachable: boolean;
}

const key = (id: string, status: PartStatus) => `${id}|${status}`;

export function memoryRepo(seed: Part[] = [], initialVersion?: CatalogVersion): MemoryRepo {
  const rows = new Map<string, Part>();
  for (const p of seed) rows.set(key(p.id, p.status), structuredClone(p));
  const versions: CatalogVersion[] = initialVersion ? [initialVersion] : [];
  const log: ChangeLogEntry[] = [];

  const repo: MemoryRepo = {
    rows,
    versions,
    log,
    reachable: true,
    async ping() {
      return repo.reachable;
    },
    async currentVersion() {
      return versions.length ? versions[versions.length - 1] : null;
    },
    async listParts(filter = {}) {
      const status = filter.status ?? "published";
      const q = filter.q?.toLowerCase();
      let out = [...rows.values()]
        .filter((p) => status === "all" || p.status === status)
        .filter((p) => !filter.category || p.category === filter.category)
        .filter((p) => !q || p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))
        .sort((a, b) => (a.category + a.id).localeCompare(b.category + b.id));
      if (filter.limit) out = out.slice(0, filter.limit);
      return structuredClone(out);
    },
    async getPart(id, status) {
      const p = rows.get(key(id, status));
      return p ? structuredClone(p) : null;
    },
    async upsertPart(part) {
      rows.set(key(part.id, part.status), structuredClone(part));
    },
    async deletePart(id, status) {
      return rows.delete(key(id, status));
    },
    async publish({ partIds, actor, identity, snapshotDate, now }) {
      let drafts = await repo.listParts({ status: "draft" });
      if (partIds?.length) drafts = drafts.filter((d) => partIds.includes(d.id));
      const version = (versions.at(-1)?.version ?? 0) + 1;
      for (const d of drafts) {
        rows.delete(key(d.id, "draft"));
        rows.set(key(d.id, "published"), { ...d, status: "published", updatedAt: now });
        log.push({ at: now, actor, identity, action: "publish_part", partId: d.id, detail: `${d.category} ${d.addedBy}` });
      }
      const summary = `${drafts.length} part(s) published by ${actor}`;
      versions.push({ version, publishedAt: now, snapshotDate, summary });
      log.push({ at: now, actor, identity, action: "publish", detail: `v${version}: ${summary}` });
      return { version, publishedIds: drafts.map((d) => d.id) };
    },
    async appendLog(entry) {
      log.push(entry);
    },
    async listChangeLog(query = {}) {
      const limit = clampLogLimit(query.limit);
      // Reverse insertion order first so ties on `at` keep the same newest-first order as D1 (id DESC).
      const out = [...log]
        .reverse()
        .filter((e) => !query.before || e.at < query.before)
        .sort((a, b) => b.at.localeCompare(a.at));
      return structuredClone(out.slice(0, limit));
    },
  };
  return repo;
}
