import { defineConfig } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

export default defineConfig({
  root: "examples",
  base: "/examples/",
  server: { host: "127.0.0.1", port: 5188, strictPort: true },
  build: {
    outDir: "../examples-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: "examples/index.html",
        vanilla: "examples/vanilla/index.html",
        react: "examples/react/index.html",
      },
    },
  },
  plugins: [
    {
      name: "local-recording-backend-recipe",
      configureServer(server) {
        // Local development recipe only. Production auth/storage belongs to the host app.
        server.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith("/api/recordings/")) return next();
          const origin = request.headers.origin;
          if (
            origin &&
            !["http://127.0.0.1:5188", "http://localhost:5188"].includes(origin)
          ) {
            response.statusCode = 403;
            response.end("Unexpected origin");
            return;
          }
          const match =
            /^\/api\/recordings\/([a-zA-Z0-9_-]{1,80})\/([a-zA-Z0-9_.-]{1,120})$/.exec(
              request.url,
            );
          if (
            request.method !== "POST" ||
            !match ||
            [".", ".."].includes(match[2])
          ) {
            response.statusCode = 400;
            response.end("Invalid upload");
            return;
          }
          try {
            const chunks: Buffer[] = [];
            let bytes = 0;
            for await (const chunk of request) {
              bytes += chunk.length;
              if (bytes > 16 * 1024 * 1024) {
                response.statusCode = 413;
                response.end("Example upload limit: 16 MiB");
                return;
              }
              chunks.push(Buffer.from(chunk));
            }
            const data = Buffer.concat(chunks);
            const folder = join(
              resolve(process.env.TRS_EXAMPLE_OUTPUT ?? "recordings/examples"),
              match[1],
            );
            await mkdir(folder, { recursive: true });
            const file = join(folder, match[2]);
            try {
              await writeFile(file, data, { flag: "wx" });
            } catch (error) {
              // Retrying the same result is idempotent; different content never overwrites it.
              if ((error as NodeJS.ErrnoException).code !== "EEXIST")
                throw error;
              if (!(await readFile(file)).equals(data)) {
                response.statusCode = 409;
                response.end("Result content differs");
                return;
              }
            }
            response.statusCode = 201;
            response.end("Saved");
          } catch (error) {
            response.statusCode = 500;
            response.end(
              error instanceof Error ? error.message : "Upload failed",
            );
          }
        });
      },
    },
  ],
});
