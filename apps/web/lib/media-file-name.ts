const uploadPrefix = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[~-]/i;

/** Keep the user's basename intact, excluding paths and control characters. */
export function mediaUploadFileName(value: string): string {
  const name = (value.split(/[\\/]/).pop() ?? "").toWellFormed().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!name.trim() || name === "." || name === ".." || new TextEncoder().encode(name).length > 512) return "";
  return name;
}

/** A separate marker distinguishes the unique storage ID from the filename. */
export function mediaStorageFileName(name: string): string {
  return `${crypto.randomUUID()}~${name}`;
}

export function mediaDisplayFileName(key: string): string {
  const name = key.split("/").pop() || key;
  // Also hide the ID on older uploads. Their already-sanitized names cannot be
  // reconstructed, but their existing object URLs remain valid.
  return name.replace(uploadPrefix, "");
}

export function mediaRenamedStorageFileName(name: string): string {
  // A user's own UUID-prefixed filename must not be mistaken for our storage ID.
  return uploadPrefix.test(name) || name === ".project.json" ? mediaStorageFileName(name) : name;
}
