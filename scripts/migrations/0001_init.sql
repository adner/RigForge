-- RigBuilder catalog of record (DESIGN.md §6.1).
-- A part id may exist twice: once as "published" and once as "draft" (the pending
-- edit). Publishing replaces the published row with the draft. Hence PK (id, status).

CREATE TABLE IF NOT EXISTS parts (
  id               TEXT    NOT NULL,
  status           TEXT    NOT NULL CHECK (status IN ('published', 'draft')),
  category         TEXT    NOT NULL,
  verified         INTEGER NOT NULL DEFAULT 0,
  added_by         TEXT    NOT NULL CHECK (added_by IN ('seed', 'human', 'agent')),
  price_usd        REAL    NOT NULL,
  price_updated_at TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  spec_json        TEXT    NOT NULL,   -- the full part, validated with partSchema
  PRIMARY KEY (id, status)
);
CREATE INDEX IF NOT EXISTS parts_category ON parts (category);
CREATE INDEX IF NOT EXISTS parts_status   ON parts (status);

CREATE TABLE IF NOT EXISTS catalog_versions (
  version       INTEGER PRIMARY KEY,
  published_at  TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,          -- YYYY-MM-DD shown in the shopper footer
  summary       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS change_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  actor   TEXT NOT NULL CHECK (actor IN ('seed', 'human', 'agent', 'system')),  -- a role, never an identity
  action  TEXT NOT NULL,
  part_id TEXT,
  detail  TEXT
);
CREATE INDEX IF NOT EXISTS change_log_part ON change_log (part_id);
