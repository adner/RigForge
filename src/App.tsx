import { useEffect, useState } from "react";
import { AdminLayout } from "./ui/AdminLayout";
import { ShopperLayout } from "./ui/ShopperLayout";
import type { Health, WebMCPState } from "./ui/SystemStrip";
import { useShopperBoot } from "./ui/useBoot";
import { isAvailable } from "./webmcp/adapter";

function useHealth() {
  const [health, setHealth] = useState<Health | "error" | null>(null);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth("error"));
  }, []);
  return health;
}

/** Shopper: catalog → share payload → WebMCP registration (see useShopperBoot). */
function Shopper() {
  const health = useHealth();
  const boot = useShopperBoot();
  return <ShopperLayout health={health} webmcp={boot.webmcp} toolCount={boot.toolCount} tools={boot.tools} />;
}

/** Operator side under /admin: AdminLayout registers the 5 catalog tools while mounted and derives the chip count itself. */
function Admin() {
  const health = useHealth();
  const [webmcp, setWebmcp] = useState<WebMCPState>("detecting");
  useEffect(() => setWebmcp(isAvailable() ? "present" : "absent"), []);
  return <AdminLayout health={health} webmcp={webmcp} />;
}

export default function App() {
  const isAdmin = window.location.pathname.startsWith("/admin");
  return isAdmin ? <Admin /> : <Shopper />;
}
