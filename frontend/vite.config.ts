import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks: {
          motion: ["framer-motion"],
          stellar: ["@stellar/freighter-api", "@stellar/stellar-sdk"],
          three: ["three"],
        },
      },
    },
  },
});
