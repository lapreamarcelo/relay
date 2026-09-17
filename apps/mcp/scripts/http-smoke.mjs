// Local-only transport test: no credentials or requests reach a real workspace.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const calls = [];
const backend = createServer((request, response) => {
  calls.push({ path: request.url, key: request.headers.authorization });
  const valid = ["Bearer relay_sk_first", "Bearer relay_sk_second"].includes(request.headers.authorization);
  response.writeHead(valid ? 200 : 401, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ data: request.url === "/api/v1/videos" ? [] : { scopes: ["videos:read"] } }));
});
backend.listen(0, "127.0.0.1");
await once(backend, "listening");
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: { ...process.env, RELAY_URL: `http://127.0.0.1:${backend.address().port}`, MCP_TRANSPORT: "http", MCP_HOST: "127.0.0.1", MCP_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
const clients = [];
const url = new URL(`http://127.0.0.1:${port}/mcp`);
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MCP server did not start")), 10000);
    child.stderr.on("data", chunk => { if (chunk.toString().includes("listening")) { clearTimeout(timer); resolve(); } });
    child.on("exit", code => { clearTimeout(timer); reject(new Error(`MCP exited ${code}`)); });
  });
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: "Bearer relay_sk_invalid" } })).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: "Bearer relay_sk_first", Origin: "https://untrusted.example" } })).status, 403);
  for (const key of ["relay_sk_first", "relay_sk_second"]) {
    const client = new Client({ name: "relay-http-test", version: "1.0" });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
    const tools = await client.listTools();
    assert.ok(tools.tools.some(tool => tool.name === "save_video"));
    assert.ok(!tools.tools.some(tool => tool.name === "upload_media"));
    const result = await client.callTool({ name: "list_videos", arguments: {} });
    assert.ok(!result.isError);
  }
  assert.deepEqual(new Set(calls.filter(call => call.path === "/api/v1/videos").map(call => call.key)), new Set(["Bearer relay_sk_first", "Bearer relay_sk_second"]));
  console.log("PASS: remote MCP handshake, discovery, tool calls, per-client credentials, unauthorized and cross-origin rejection");
} finally {
  await Promise.all(clients.map(client => client.close()));
  child.kill("SIGTERM");
  backend.closeAllConnections();
  await new Promise(resolve => backend.close(resolve));
}
