/**
 * `lastSeenRevision` — the buildRevision most recently *returned to the agent* by any tool (DESIGN §4.5 (3)).
 * Write tools compare `expectedRevision ?? lastSeenRevision` against the current revision; mismatch → STALE_REVISION.
 */
let lastSeen = 0;

export const getLastSeenRevision = (): number => lastSeen;

/** Called by the envelope builder as every response is returned. */
export const markSeen = (revision: number): void => {
  lastSeen = revision;
};

/** Initialised to the current revision at registration so the first write works before any read. */
export const initLastSeen = (revision: number): void => {
  lastSeen = revision;
};

export type StaleCheck = { ok: true } | { ok: false; expected: number; current: number; source: "expectedRevision" | "lastSeenRevision" };

export function checkRevision(current: number, expectedRevision?: number): StaleCheck {
  const expected = expectedRevision ?? lastSeen;
  if (expected === current) return { ok: true };
  return { ok: false, expected, current, source: expectedRevision === undefined ? "lastSeenRevision" : "expectedRevision" };
}
