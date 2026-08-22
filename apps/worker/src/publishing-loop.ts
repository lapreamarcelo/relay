import type { PostPublishingService } from "./post-publishing.ts";
import type { TokenMaintenanceLogger } from "./token-maintenance-loop.ts";

const logger: TokenMaintenanceLogger = {
  info: (fields, message) => console.info(JSON.stringify({ level: "info", message, ...fields })),
  error: (fields, message) => console.error(JSON.stringify({ level: "error", message, ...fields })),
};

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => { const timeout = setTimeout(resolve, milliseconds); signal?.addEventListener("abort", () => { clearTimeout(timeout); resolve(); }, { once: true }); });
}

export async function runPublishingLoop(service: PostPublishingService, options: { intervalMs?: number; signal?: AbortSignal; logger?: TokenMaintenanceLogger } = {}): Promise<void> {
  const intervalMs = options.intervalMs ?? 5_000; const output = options.logger ?? logger;
  while (!options.signal?.aborted) {
    try { const result = await service.sweep(); if (result.examined > 0) output.info({ ...result }, "Post publishing sweep completed"); }
    catch (error) { output.error({ error: error instanceof Error ? error.message : "Unknown error" }, "Post publishing sweep failed"); }
    await wait(intervalMs, options.signal);
  }
}
