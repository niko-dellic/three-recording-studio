import { defineConfig } from "vite";
export default defineConfig({
  root: "demo",
  base: "/demo/",
  build: { outDir: "../demo-dist", emptyOutDir: true },
  server: {
    port: 5187,
    strictPort: true,
  },
  resolve: { dedupe: ["three"] },
});
