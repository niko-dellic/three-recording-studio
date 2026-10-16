import { spawn } from "node:child_process";
const children = [
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    { stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    [
      "node_modules/vitepress/bin/vitepress.js",
      "dev",
      "tools/docs/docs",
      "--host",
      "127.0.0.1",
      "--port",
      "5190",
    ],
    { stdio: "inherit" },
  ),
];
let closing = false;
const stop = () => {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children)
  child.on("exit", (code) => {
    if (!closing && code) process.exitCode = code;
    stop();
  });
