import { defineConfig } from "vitepress";
export default defineConfig({
  base: "/",
  cleanUrls: true,
  title: "Three Recording Studio",
  description: "Create PNG images and MP4 videos from Three.js scenes.",
  appearance: true,
  head: [
    ["link", { rel: "icon", href: "/favicon.ico", sizes: "any" }],
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16.png",
      },
    ],
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
      },
    ],
    [
      "link",
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
    ],
    ["link", { rel: "manifest", href: "/site.webmanifest" }],
  ],
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
    logo: {
      src: "/android-chrome-192x192.png",
      alt: "",
      width: 24,
      height: 24,
    },
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/niko-dellic/three-recording-studio",
      },
    ],
    footer: {
      message: "Three Recording Studio · 0.1.0",
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
