import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.RELAY_PLAYWRIGHT_PATH || "playwright");
const baseUrl = process.env.RELAY_CAPTURE_URL || "http://localhost:3019";
const output = resolve(process.cwd(), "../../docs/images");
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.RELAY_CHROME_PATH
    ? { executablePath: process.env.RELAY_CHROME_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(`${baseUrl}/demo`, { waitUntil: "networkidle" });
await page.screenshot({ path: resolve(output, "relay-analytics.png"), fullPage: true });

await page.getByRole("button", { name: "Home" }).click();
await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
await page.waitForTimeout(350);
await page.screenshot({ path: resolve(output, "relay-dashboard.png"), fullPage: true });

await page.getByRole("button", { name: "Create post" }).first().click();
await page.locator(".composer").waitFor();
await page.waitForTimeout(350);
await page.screenshot({ path: resolve(output, "relay-composer.png"), fullPage: false });

await browser.close();
console.log(`Captured README screenshots in ${output}`);
