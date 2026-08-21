export function GET() {
  return Response.json({ status: "ok", service: "relay-web", version: "0.1.0" });
}
