import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = path.join(webRoot, ".next/standalone");
const standaloneWebRoot = path.join(standaloneRoot, "apps/web");
const server = path.join(standaloneWebRoot, "server.js");

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(server))) {
  throw new Error("Production build not found. Run `pnpm build` before `pnpm start`.");
}

await mkdir(path.join(standaloneWebRoot, ".next"), { recursive: true });
await cp(path.join(webRoot, ".next/static"), path.join(standaloneWebRoot, ".next/static"), {
  recursive: true,
  force: true,
});

const publicDirectory = path.join(webRoot, "public");
if (await exists(publicDirectory)) {
  await cp(publicDirectory, path.join(standaloneWebRoot, "public"), { recursive: true, force: true });
}

const child = spawn(process.execPath, [server], {
  cwd: standaloneRoot,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
