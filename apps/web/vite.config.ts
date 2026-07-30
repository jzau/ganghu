import react from "@vitejs/plugin-react";
import { config } from "dotenv";
import { defineConfig, loadEnv, type Plugin } from "vite";

const projectRoot = new URL("../..", import.meta.url).pathname;
config({ path: `${projectRoot}/.env` });

const apiPort = process.env.API_PORT ?? "4000";
const webPort = Number(process.env.WEB_PORT ?? 5173);

function brandingPlugin(appName: string): Plugin {
  const manifest = JSON.stringify({
    name: appName,
    short_name: appName,
    icons: [
      { src: "/apple-touch-icon-120x120-v2.png", sizes: "120x120", type: "image/png" },
      { src: "/apple-touch-icon-152x152-v2.png", sizes: "152x152", type: "image/png" },
      { src: "/apple-touch-icon-167x167-v2.png", sizes: "167x167", type: "image/png" },
      { src: "/apple-touch-icon-180x180-v2.png", sizes: "180x180", type: "image/png" },
      { src: "/app-icon.svg", sizes: "any", type: "image/svg+xml" }
    ],
    theme_color: "#ececec",
    background_color: "#ececec",
    display: "standalone"
  }, null, 2);

  return {
    name: "app-branding",
    transformIndexHtml(html) {
      return html.replaceAll("__APP_NAME__", appName);
    },
    configureServer(server) {
      server.middlewares.use("/site.webmanifest", (_request, response) => {
        response.setHeader("Content-Type", "application/manifest+json");
        response.end(manifest);
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "site.webmanifest",
        source: manifest
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, "");
  const appName = process.env.VITE_APP_NAME_ZH?.trim() || env.VITE_APP_NAME_ZH?.trim() || "工夫 AI";

  return {
    envDir: projectRoot,
    plugins: [react(), brandingPlugin(appName)],
    server: {
      port: webPort,
      proxy: {
        "/api": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true
        }
      }
    }
  };
});
