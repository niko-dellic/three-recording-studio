import { defineConfig } from "vite";
import { readFile } from "node:fs/promises";

// Theatre 0.7.2 strips its BUILT_FOR_PLAYGROUND switch from the published
// bundle. Disable only checkForUpdates for this embedded editor, whose version
// is managed by package.json. Fail on upstream changes rather than silently
// intercepting fetch or suppressing unrelated console/network errors.
function embeddedTheatre(source: string): string {
  const guard = 'if(!("0.7.2"!=null&&"0.7.2".match(/COMPAT/)))';
  if (
    source.split(guard).length !== 2 ||
    !source.includes("https://updates.theatrejs.com/updates/0.7.2")
  ) {
    throw new Error(
      "Recheck the embedded update-check adapter for this Theatre version.",
    );
  }
  return source.replace(guard, "if(false)");
}
const theatreBundle = /[/\\]@theatre[/\\]studio[/\\]dist[/\\]index\.js$/;

export default defineConfig({
  root: "demo",
  plugins: [
    {
      name: "embedded-theatre",
      enforce: "pre",
      transform(source, id) {
        if (theatreBundle.test(id)) return embeddedTheatre(source);
      },
    },
  ],
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: "embedded-theatre",
          setup(build) {
            build.onLoad({ filter: theatreBundle }, async ({ path }) => ({
              contents: embeddedTheatre(await readFile(path, "utf8")),
              loader: "js",
            }));
          },
        },
      ],
    },
  },
  base: "/demo/",
  build: {
    outDir: "../demo-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: { main: "demo/index.html", keyframes: "demo/keyframes.html" },
    },
  },
  server: {
    port: 5187,
    strictPort: true,
  },
  resolve: { dedupe: ["three"] },
});
