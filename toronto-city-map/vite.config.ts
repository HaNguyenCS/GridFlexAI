import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { existsSync, statSync, createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import type { ServerResponse } from "node:http";

/**
 * Serve files staged by `npm run prefetch` (under `server/data/`) at
 * `/data/*`. We avoid `public/` because the prefetched payloads are
 * large and we don't want them bundled into the production build.
 */
function serveServerData(): PluginOption {
  const root = resolve(__dirname, "server", "data");
  const MIME: Record<string, string> = {
    ".geojson": "application/geo+json",
    ".json": "application/json",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".txt": "text/plain; charset=utf-8",
  };
  const send404 = (res: ServerResponse) => {
    res.statusCode = 404;
    res.end("Not Found");
  };
  return {
    name: "toronto-city-map:serve-server-data",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        try {
          const url = req.url ?? "/";
          const cleaned = url.split("?")[0].split("#")[0];
          if (cleaned === "/" || cleaned === "") return next();
          // Resolve + clamp to the data root to defeat traversal.
          const requested = normalize(join(root, cleaned));
          if (!requested.startsWith(root)) return send404(res);
          if (!existsSync(requested) || !statSync(requested).isFile()) {
            return send404(res);
          }
          const mime =
            MIME[extname(requested).toLowerCase()] ?? "application/octet-stream";
          res.setHeader("Content-Type", mime);
          res.setHeader("Cache-Control", "public, max-age=3600");
          res.setHeader("Access-Control-Allow-Origin", "*");
          createReadStream(requested).pipe(res);
        } catch {
          send404(res);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwind(), serveServerData()],
  server: {
    host: true,
    port: 5173,
  },
});
