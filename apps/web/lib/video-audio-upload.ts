type AudioAsset = { key: string; url: string; name: string };
type UploadResponse = { key?: string; url?: string; uploadUrl?: string; error?: string };
const MAX_SERVER_BYTES = 100 * 1024 * 1024;

/** Normal songs use same-origin storage so they never depend on bucket CORS. */
export async function uploadVideoAudio(file: File, projectId?: string, fetcher: typeof fetch = fetch): Promise<AudioAsset> {
  if (!file.size || !file.type.startsWith("audio/")) throw new Error("Choose a non-empty audio file.");
  const folder = projectId && projectId !== "all" ? projectId : undefined;
  if (file.size <= MAX_SERVER_BYTES) {
    const body = new FormData(); body.append("file", file); body.append("kind", "music");
    if (folder) body.append("projectId", folder);
    const response = await fetcher("/api/v1/media", { method: "POST", body });
    const result = await response.json() as UploadResponse;
    if (!response.ok || !result.key || !result.url) throw new Error(result.error || "Could not upload audio. Try again.");
    return { key: result.key, url: result.url, name: file.name };
  }
  // Large files still use direct storage; the Relay endpoint caps multipart uploads.
  const prepared = await fetcher("/api/v1/media", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, kind: "music", ...(folder ? { projectId: folder } : {}) }),
  });
  const signed = await prepared.json() as UploadResponse;
  if (!prepared.ok || !signed.key || !signed.url || !signed.uploadUrl) throw new Error(signed.error || "Could not prepare the audio upload.");
  try {
    const uploaded = await fetcher(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (uploaded.ok) return { key: signed.key, url: signed.url, name: file.name };
  } catch { /* A smaller audio file can use Relay without browser access to R2. */ }
  throw new Error("Direct audio upload failed. Try an audio file up to 100 MB.");
}
