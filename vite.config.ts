import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  test: {
    include: ["src/**/*.test.ts", "worker/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
