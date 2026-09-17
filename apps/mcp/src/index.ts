import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRelayMcpServer } from "./server.js";

const relayUrl = process.env.RELAY_URL?.trim().replace(/\/$/, "");
if (!relayUrl) throw new Error("RELAY_URL is required.");
if (process.env.MCP_TRANSPORT === "http") {
  const { createServer } = await import("node:http");
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const allowedOrigin = process.env.MCP_ALLOWED_ORIGIN;
  const http = createServer(async (request,response)=>{
    if (request.url !== "/mcp") { response.writeHead(404).end(); return; }
    if (request.headers.origin && request.headers.origin !== allowedOrigin) { response.writeHead(403).end("Origin not allowed"); return; }
    const match = /^Bearer (relay_sk_[A-Za-z0-9_-]+)$/i.exec(request.headers.authorization ?? "");
    if (!match) { response.writeHead(401,{"WWW-Authenticate":"Bearer"}).end("Relay API key required"); return; }
    try {
      const auth = await fetch(`${relayUrl}/api/v1/capabilities`,{headers:{Authorization:`Bearer ${match[1]}`},signal:AbortSignal.timeout(10000),redirect:"error"});
      if (!auth.ok) { response.writeHead(auth.status).end("Invalid Relay credentials"); return; }
      const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      const server=createRelayMcpServer(relayUrl,match[1],true);
      response.on("close",()=>{void transport.close();void server.close();});
      await server.connect(transport); await transport.handleRequest(request,response);
    } catch { if (!response.headersSent) response.writeHead(502).end("MCP request failed"); }
  });
  http.requestTimeout=300000;
  http.listen(Number(process.env.MCP_PORT??3100),process.env.MCP_HOST??"127.0.0.1",()=>console.error("Relay MCP HTTP listening"));
  for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>http.close());
} else {
  const apiKey=process.env.RELAY_API_KEY?.trim();if(!apiKey)throw new Error("RELAY_API_KEY is required for stdio.");
  await createRelayMcpServer(relayUrl,apiKey).connect(new StdioServerTransport());
}
