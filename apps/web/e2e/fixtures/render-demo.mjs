// Run the production renderer with local storage adapters. No cloud credentials,
// database, or network requests are used; FFmpeg and SVG composition are real.
import { registerHooks } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });

const [documentPath, outputDirectory] = process.argv.slice(2);
Object.assign(process.env, { R2_ACCOUNT_ID: "local-test", R2_ACCESS_KEY_ID: "local-test", R2_SECRET_ACCESS_KEY: "local-test", R2_BUCKET_NAME: "local-test", R2_PUBLIC_URL: "https://media.example.test" });
const fixture = await readFile(new URL("./device-demo.mp4", import.meta.url));
globalThis.fetch = async url => {
  if (String(url) !== "https://media.example.test/demo.mp4") throw new Error(`Unexpected asset: ${url}`);
  return new Response(fixture, { headers: { "content-length": String(fixture.length) } });
};
const { getR2Client } = await import("../../lib/r2.ts");
getR2Client().send = async command => {
  const filename = command.input.Key.endsWith(".mp4") ? "output.mp4" : "cover.jpg";
  await writeFile(join(outputDirectory, filename), command.input.Body);
  return {};
};
const { normalizeVideoTimeline } = await import("../../lib/video-timeline.ts");
const { renderVideoArtifactDetails } = await import("../../lib/video-renderer.ts");
const timeline = normalizeVideoTimeline(JSON.parse(await readFile(documentPath, "utf8")));
await renderVideoArtifactDetails({ projectId: "promotion-test", sourceUrl: "", labels: [], timeline, targetKey: "output.mp4" });
