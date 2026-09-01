/**
 * Session-local change log for /admin. The Worker's `change_log` (GET /api/admin/log)
 * is the source of truth; this store holds this session's actions (agent rows for
 * WebMCP tool calls, human rows for UI actions) so they show up immediately, before
 * the panel re-fetches the server log. Newest first.
 */
import { create } from "zustand";
import type { Actor, FeedItem } from "../ui/types";

interface ActivityState {
  items: FeedItem[];
  log: (actor: Actor, title: string, detail?: string) => void;
  clear: () => void;
}

let seq = 0;
const stamp = () => new Date().toTimeString().slice(0, 8);

export const useAdminActivity = create<ActivityState>((set) => ({
  items: [],
  log: (actor, title, detail) =>
    set((s) => ({ items: [{ id: `a${++seq}`, actor, title, detail, time: stamp(), at: new Date().toISOString(), undo: "none" as const }, ...s.items].slice(0, 200) })),
  clear: () => set({ items: [] }),
}));

export const logActivity = (actor: Actor, title: string, detail?: string) => useAdminActivity.getState().log(actor, title, detail);
