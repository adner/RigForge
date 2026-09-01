/**
 * Catalog repository: the only module that knows SQL. Routes program against
 * `CatalogRepo`; `d1Repo()` backs it with D1 and `memoryRepo()` (repo-memory.ts)
 * backs it in tests. Rows store the full validated part in `spec_json`; the
 * indexed columns (status, category, price…) mirror fields of that JSON.
 */
import type { Category, Part, PartOf } from "../src/data/schema";

export type PartStatus = "published" | "draft";
export type StatusFilter = PartStatus | "all";
export type Actor = "seed" | "human" | "agent" | "system";

export interface CatalogVersion {
  version: number;
  publishedAt: string;
  snapshotDate: string;
  summary: string;
}

export interface ChangeLogEntry {
  at: string;
  actor: Actor;
  /** Verified Access identity responsible for the action. Admin-only; never enters part JSON. */
  identity?: string | null;
  action: string;
  partId?: string | null;
  detail?: string | null;
}

export interface ListFilter {
  status?: StatusFilter;
  category?: Category;
  /** Case-insensitive substring match on id, name or brand. */
  q?: string;
  limit?: number;
}

export interface PublishResult {
  version: number;
  publishedIds: string[];
}

export interface ChangeLogQuery {
  /** Default 50, max 200. */
  limit?: number;
  /** ISO timestamp cursor: only entries strictly older than this. */
  before?: string;
}

export const CHANGE_LOG_DEFAULT_LIMIT = 50;
export const CHANGE_LOG_MAX_LIMIT = 200;
export const clampLogLimit = (limit?: number): number =>
  Math.min(CHANGE_LOG_MAX_LIMIT, Math.max(1, Math.floor(limit ?? CHANGE_LOG_DEFAULT_LIMIT)));

export interface CatalogRepo {
  ping(): Promise<boolean>;
  currentVersion(): Promise<CatalogVersion | null>;
  listParts(filter?: ListFilter): Promise<Part[]>;
  getPart(id: string, status: PartStatus): Promise<Part | null>;
  /** Insert-or-replace the row keyed by (part.id, part.status). */
  upsertPart(part: Part): Promise<void>;
  deletePart(id: string, status: PartStatus): Promise<boolean>;
  /**
   * Promote drafts (all, or the given ids) to published, bump the version and write
   * change_log rows. Atomic where the backend allows it (D1 batch).
   */
  publish(input: { partIds?: string[]; actor: Actor; identity?: string | null; snapshotDate: string; now: string }): Promise<PublishResult>;
  appendLog(entry: ChangeLogEntry): Promise<void>;
  /** Newest first. */
  listChangeLog(query?: ChangeLogQuery): Promise<ChangeLogEntry[]>;
}

export const partOf = <C extends Category>(p: Part, category: C): p is PartOf<C> => p.category === category;

// ---------- D1 implementation ----------

interface PartRow {
  spec_json: string;
  status: string;
}

const rowToPart = (row: PartRow): Part => {
  const spec = JSON.parse(row.spec_json) as Part;
  // The status column is authoritative (publish flips it without rewriting JSON on older rows).
  return { ...spec, status: row.status as PartStatus };
};

const matchesQ = (p: Part, q: string): boolean => {
  const needle = q.toLowerCase();
  return p.id.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle) || p.brand.toLowerCase().includes(needle);
};

export function d1Repo(db: D1Database): CatalogRepo {
  const upsertStmt = (part: Part) =>
    db
      .prepare(
        `INSERT INTO parts (id, status, category, verified, added_by, price_usd, price_updated_at, updated_at, spec_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id, status) DO UPDATE SET
           category = excluded.category, verified = excluded.verified, added_by = excluded.added_by,
           price_usd = excluded.price_usd, price_updated_at = excluded.price_updated_at,
           updated_at = excluded.updated_at, spec_json = excluded.spec_json`,
      )
      .bind(
        part.id,
        part.status,
        part.category,
        part.verified ? 1 : 0,
        part.addedBy,
        part.priceUSD,
        part.priceUpdatedAt,
        part.updatedAt,
        JSON.stringify(part),
      );

  const logStmt = (e: ChangeLogEntry) =>
    db
      .prepare(`INSERT INTO change_log (at, actor, actor_identity, action, part_id, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(e.at, e.actor, e.identity ?? null, e.action, e.partId ?? null, e.detail ?? null);

  return {
    async ping() {
      try {
        await db.prepare("SELECT 1").first();
        return true;
      } catch {
        return false;
      }
    },

    async currentVersion() {
      const row = await db
        .prepare("SELECT version, published_at, snapshot_date, summary FROM catalog_versions ORDER BY version DESC LIMIT 1")
        .first<{ version: number; published_at: string; snapshot_date: string; summary: string }>();
      return row ? { version: row.version, publishedAt: row.published_at, snapshotDate: row.snapshot_date, summary: row.summary } : null;
    },

    async listParts(filter = {}) {
      const where: string[] = [];
      const binds: unknown[] = [];
      const status = filter.status ?? "published";
      if (status !== "all") {
        where.push(`status = ?${binds.length + 1}`);
        binds.push(status);
      }
      if (filter.category) {
        where.push(`category = ?${binds.length + 1}`);
        binds.push(filter.category);
      }
      const sql = `SELECT spec_json, status FROM parts${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY category, id`;
      const { results } = await db.prepare(sql).bind(...binds).all<PartRow>();
      let parts = results.map(rowToPart);
      if (filter.q) parts = parts.filter((p) => matchesQ(p, filter.q!));
      if (filter.limit) parts = parts.slice(0, filter.limit);
      return parts;
    },

    async getPart(id, status) {
      const row = await db.prepare("SELECT spec_json, status FROM parts WHERE id = ?1 AND status = ?2").bind(id, status).first<PartRow>();
      return row ? rowToPart(row) : null;
    },

    async upsertPart(part) {
      await upsertStmt(part).run();
    },

    async deletePart(id, status) {
      const res = await db.prepare("DELETE FROM parts WHERE id = ?1 AND status = ?2").bind(id, status).run();
      return (res.meta.changes ?? 0) > 0;
    },

    async publish({ partIds, actor, identity, snapshotDate, now }) {
      let drafts = await this.listParts({ status: "draft" });
      if (partIds?.length) {
        const wanted = new Set(partIds);
        drafts = drafts.filter((d) => wanted.has(d.id));
      }
      const current = await this.currentVersion();
      const version = (current?.version ?? 0) + 1;

      const stmts: D1PreparedStatement[] = [];
      for (const d of drafts) {
        const published: Part = { ...d, status: "published", updatedAt: now };
        stmts.push(db.prepare("DELETE FROM parts WHERE id = ?1").bind(d.id));
        stmts.push(upsertStmt(published));
        stmts.push(logStmt({ at: now, actor, identity, action: "publish_part", partId: d.id, detail: `${d.category} ${d.addedBy}` }));
      }
      const summary = `${drafts.length} part(s) published by ${actor}`;
      stmts.push(
        db
          .prepare("INSERT INTO catalog_versions (version, published_at, snapshot_date, summary) VALUES (?1, ?2, ?3, ?4)")
          .bind(version, now, snapshotDate, summary),
      );
      stmts.push(logStmt({ at: now, actor, identity, action: "publish", detail: `v${version}: ${summary}` }));
      await db.batch(stmts);
      return { version, publishedIds: drafts.map((d) => d.id) };
    },

    async appendLog(entry) {
      await logStmt(entry).run();
    },

    async listChangeLog(query = {}) {
      const limit = clampLogLimit(query.limit);
      const binds: unknown[] = [];
      let where = "";
      if (query.before) {
        where = " WHERE at < ?1";
        binds.push(query.before);
      }
      const { results } = await db
        .prepare(`SELECT at, actor, actor_identity, action, part_id, detail FROM change_log${where} ORDER BY at DESC, id DESC LIMIT ?${binds.length + 1}`)
        .bind(...binds, limit)
        .all<{ at: string; actor: string; actor_identity: string | null; action: string; part_id: string | null; detail: string | null }>();
      return results.map((r) => ({ at: r.at, actor: r.actor as Actor, identity: r.actor_identity, action: r.action, partId: r.part_id, detail: r.detail }));
    },
  };
}
