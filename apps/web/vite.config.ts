import react from "@vitejs/plugin-react";
import { config } from "dotenv";
import { defineConfig } from "vite";

config({ path: new URL("../../.env", import.meta.url).pathname });

const apiPort = process.env.API_PORT ?? "4000";
const webPort = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true
      }
    }
  }
});
