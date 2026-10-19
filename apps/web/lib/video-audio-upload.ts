type AudioAsset = { key: string; url: string; name: string };
type UploadResponse = { key?: string; url?: string; uploadUrl?: string; error?: string };
const MAX_FALLBACK_BYTES = 100 * 1024 * 1024;

/** Keep the server fallback's returned key/URL: it creates a separate object. */
export async function uploadVideoAudio(file: File, projectId?: string, fetcher: typeof fetch = fetch): Promise<AudioAsset> {
  if (!file.size || !file.type.startsWith("audio/")) throw new Error("Choose a non-empty audio file.");
  const prepared = await fetcher("/api/v1/media", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, kind: "music", ...(projectId && projectId !== "all" ? { projectId } : {}) }),
  });
  const signed = await prepared.json() as UploadResponse;
  if (!prepared.ok || !signed.key || !signed.url || !signed.uploadUrl) throw new Error(signed.error || "Could not prepare the audio upload.");
  try {
    const uploaded = await fetcher(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (uploaded.ok) return { key: signed.key, url: signed.url, name: file.name };
  } catch { /* Browser access to direct storage may be blocked. */ }
  if (file.size > MAX_FALLBACK_BYTES) throw new Error("Direct audio upload failed. Try an audio file up to 100 MB.");
  const body = new FormData(); body.append("file", file); body.append("kind", "music");
  if (projectId && projectId !== "all") body.append("projectId", projectId);
  const response = await fetcher("/api/v1/media", { method: "POST", body });
  const result = await response.json() as UploadResponse;
  if (!response.ok || !result.key || !result.url) throw new Error(result.error || "Could not upload audio. Try again.");
  return { key: result.key, url: result.url, name: file.name };
}
