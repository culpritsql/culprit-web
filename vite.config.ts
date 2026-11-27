import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE_PATH || (mode === "demo" ? "./" : "/"),
  define:
    mode === "demo"
      ? { "import.meta.env.VITE_DEMO_MODE": JSON.stringify("true") }
      : undefined,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/auth": "http://127.0.0.1:8080",
    },
  },
}));
