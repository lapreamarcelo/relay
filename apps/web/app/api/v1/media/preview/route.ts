import { requireApiSession } from "../../../../../lib/api-session";
import { createMediaPreviewHandler } from "../../../../../lib/media-preview";
import { getR2Config } from "../../../../../lib/r2";

export const runtime = "nodejs";
export const GET = createMediaPreviewHandler({
  authorize: async request => (await requireApiSession(request, { apiKeyScope: "media:read" })).response,
  publicUrl: () => getR2Config().publicUrl,
});
