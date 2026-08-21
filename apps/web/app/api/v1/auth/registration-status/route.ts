import { getRegistrationStatus } from "../../../../../lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    return NextResponse.json(await getRegistrationStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Relay cannot reach its database." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
