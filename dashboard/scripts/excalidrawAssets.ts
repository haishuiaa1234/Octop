import { createReadStream, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Ship viewer fonts locally, including CJK subsets. */
export function excalidrawAssets(): Plugin {
  const fonts = path.resolve(
    __dirname,
    "../node_modules/@excalidraw/excalidraw/dist/prod/fonts",
  );
  const prefix = "/excalidraw-assets/fonts/";
  return {
    name: "octop-excalidraw-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (!url?.startsWith(prefix)) return next();
        let file: string;
        try {
          file = path.resolve(
            fonts,
            decodeURIComponent(url.slice(prefix.length)),
          );
        } catch {
          res.statusCode = 400;
          res.end();
          return;
        }
        if (!file.startsWith(fonts + path.sep) || !file.endsWith(".woff2")) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const stream = createReadStream(file);
        stream.on("error", () => {
          res.statusCode = 404;
          res.end();
        });
        res.setHeader("Content-Type", "font/woff2");
        stream.pipe(res);
      });
    },
    generateBundle() {
      const emitFonts = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const file = path.join(dir, entry.name);
          if (entry.isDirectory()) emitFonts(file);
          else if (entry.name.endsWith(".woff2"))
            this.emitFile({
              type: "asset",
              fileName: `excalidraw-assets/fonts/${path
                .relative(fonts, file)
                .split(path.sep)
                .join("/")}`,
              source: readFileSync(file),
            });
        }
      };
      emitFonts(fonts);
    },
  };
}
