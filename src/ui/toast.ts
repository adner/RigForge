/** Tiny toast bus (no deps): `toast("Copied")` anywhere, `useToasts()` in the shell to render them. */
import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(message: string, tone: Toast["tone"] = "info", ttlMs = 4500): void {
  const t = { id: ++seq, message, tone };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => dismissToast(t.id), ttlMs);
}

export function dismissToast(id: number): void {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
    () => toasts,
  );
}
