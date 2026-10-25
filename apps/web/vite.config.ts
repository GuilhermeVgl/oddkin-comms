import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxyTarget =
  process.env["VITE_API_PROXY_TARGET"] ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: process.env["VITE_USE_POLLING"] === "true",
      interval: 100,
    },
    proxy: {
      "/api": {
        target: proxyTarget,
        changeOrigin: true,
        ws: true,
        headers: { Origin: new URL(proxyTarget).origin },
      },
    },
  },
});
