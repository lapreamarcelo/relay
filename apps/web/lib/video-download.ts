const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

export function objectKeyFromPublicUrl(renderedUrl: string, configuredPublicUrl: string): string | null {
  let rendered: URL;
  let publicUrl: URL;
  try {
    rendered = new URL(renderedUrl);
    publicUrl = new URL(configuredPublicUrl);
  } catch {
    return null;
  }

  if (
    !HTTP_PROTOCOLS.has(rendered.protocol)
    || rendered.origin !== publicUrl.origin
    || rendered.username
    || rendered.password
    || rendered.search
    || rendered.hash
    || publicUrl.search
    || publicUrl.hash
  ) return null;

  const basePath = publicUrl.pathname.replace(/\/+$/, "");
  const prefix = `${basePath}/`;
  if (!rendered.pathname.startsWith(prefix)) return null;

  const encodedSegments = rendered.pathname.slice(prefix.length).split("/");
  if (!encodedSegments.length || encodedSegments.some((segment) => !segment)) return null;

  try {
    const segments = encodedSegments.map((segment) => decodeURIComponent(segment));
    if (segments.some((segment) => (
      segment === "."
      || segment === ".."
      || segment.includes("/")
      || segment.includes("\\")
      || /[\u0000-\u001f\u007f]/.test(segment)
    ))) return null;
    return segments.join("/");
  } catch {
    return null;
  }
}

function withoutUnpairedSurrogates(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint >= 0xd800 && codePoint <= 0xdfff ? "-" : character;
  }).join("");
}

export function videoDownloadFilename(name: unknown): string {
  const input = typeof name === "string" ? withoutUnpairedSurrogates(name.normalize("NFKC")) : "";
  const stem = Array.from(input
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. -]+/, "")
    .replace(/[. ]+$/, "")
    .replace(/\.mp4$/i, "")
    .replace(/[. ]+$/, ""))
    .slice(0, 100)
    .join("")
    .trim();
  return `${stem || "video"}.mp4`;
}

export function videoDownloadContentDisposition(name: unknown): string {
  const filename = videoDownloadFilename(name);
  const asciiStem = filename.slice(0, -4)
    .replace(/[^\x20-\x7e]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[. -]+|[. -]+$/g, "");
  const asciiFilename = `${asciiStem || "video"}.mp4`;
  const encodedFilename = encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}
