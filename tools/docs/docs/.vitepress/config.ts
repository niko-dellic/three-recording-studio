import { defineConfig } from "vitepress";
export default defineConfig({
  base: "/",
  cleanUrls: true,
  title: "Three Recording Studio",
  description: "Create PNG images and MP4 videos from Three.js scenes.",
  appearance: true,
  vite: {
    server: {
      port: 5190,
      strictPort: true,
      proxy: {
        "/demo": {
          target: "http://127.0.0.1:5187",
          ws: true,
          rewrite: (path) => path.replace(/^\/demo(?=\?|$)/, "/demo/"),
        },
      },
    },
  },
  markdown: {
    theme: {
      light: "github-light-high-contrast",
      dark: "github-dark-high-contrast",
    },
  },
  themeConfig: {
    footer: {
      message: "Three Recording Studio · 0.1.0 preview",
      copyright: "MIT licensed",
    },
    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/guide" },
      { text: "API", link: "/api" },
      { text: "Demo", link: "/demo", target: "_self" },
    ],
    search: { provider: "local" },
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Introduction", link: "/guide" },
          { text: "Animation lifecycle", link: "/animation" },
          { text: "Camera and rendering", link: "/rendering" },
        ],
      },
      {
        text: "Integration",
        items: [
          { text: "Panel and themes", link: "/themes" },
          { text: "Saving and recovery", link: "/saving" },
          { text: "API reference", link: "/api" },
          { text: "Compatibility", link: "/compatibility" },
        ],
      },
    ],
  },
});
