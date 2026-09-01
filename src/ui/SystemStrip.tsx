export type Health = { ok: boolean; version: string; imageKeyConfigured: boolean; time: string };
export type WebMCPState = "detecting" | "present" | "absent";

/** Footer status strip: current Worker health and WebMCP detection. */
export function SystemStrip({ health, webmcp }: { health: Health | "error" | null; webmcp: WebMCPState }) {
  const dot = (ok: boolean | null) => (
    <span className={`inline-block size-1.5 rounded-full ${ok === null ? "bg-dust" : ok ? "bg-clear" : "bg-fault"}`} />
  );
  return (
    <span className="inline-flex items-center gap-3 font-mono text-micro text-dust">
      <span className="inline-flex items-center gap-1.5">
        {dot(health === null ? null : health !== "error" && health.ok)}
        {health === null ? "worker …" : health === "error" ? "worker unreachable" : `worker v${health.version} · image key ${health.imageKeyConfigured ? "ok" : "missing"}`}
      </span>
      <span className="inline-flex items-center gap-1.5">
        {dot(webmcp === "detecting" ? null : webmcp === "present")}
        {webmcp === "detecting" ? "webmcp …" : webmcp === "present" ? "document.modelContext present" : "document.modelContext absent"}
      </span>
    </span>
  );
}
