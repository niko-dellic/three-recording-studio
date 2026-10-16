import { defineConfig } from "vite";
export default defineConfig({
  root: "demo",
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
