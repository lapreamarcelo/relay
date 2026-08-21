import type { TokenLifecycleService } from "./token-lifecycle.ts";

export interface TokenMaintenanceLogger {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

const consoleLogger: TokenMaintenanceLogger = {
  info: (fields, message) => console.info(JSON.stringify({ level: "info", message, ...fields })),
  error: (fields, message) => console.error(JSON.stringify({ level: "error", message, ...fields })),
};

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
}

export async function runTokenMaintenanceLoop(
  lifecycle: TokenLifecycleService,
  options: { intervalMs?: number; signal?: AbortSignal; logger?: TokenMaintenanceLogger } = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? 5 * 60_000;
  const logger = options.logger ?? consoleLogger;

  while (!options.signal?.aborted) {
    const startedAt = Date.now();
    try {
      const result = await lifecycle.sweep();
      logger.info({ ...result, durationMs: Date.now() - startedAt }, "Account token maintenance completed");
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : "Unknown error" }, "Account token maintenance failed");
    }
    await wait(intervalMs, options.signal);
  }
}
