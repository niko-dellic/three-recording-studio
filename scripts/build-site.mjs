import { cp, rm } from "node:fs/promises";
await rm("site", { recursive: true, force: true });
await cp("tools/docs/docs/.vitepress/dist", "site", { recursive: true });
await cp("demo-dist", "site/demo", { recursive: true });

await cp("examples-dist", "site/examples", { recursive: true });
