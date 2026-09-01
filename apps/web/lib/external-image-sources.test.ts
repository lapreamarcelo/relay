import assert from "node:assert/strict";
import test from "node:test";

import { allowedExternalImageUrl, normalizePexelsResults, safeExternalImageName } from "./external-image-sources.ts";

test("normalizes Pexels photos with creator and source provenance", () => {
  const [photo] = normalizePexelsResults({ photos: [{ id: 42, alt: "Ocean at dusk", photographer: "Ari", photographer_url: "https://www.pexels.com/@ari", url: "https://www.pexels.com/photo/42", src: { medium: "https://images.pexels.com/photos/42/preview.jpeg", large2x: "https://images.pexels.com/photos/42/large.jpeg", original: "https://images.pexels.com/photos/42/original.jpeg" } }] });
  assert.deepEqual(photo, { id: "pexels-42", provider: "pexels", title: "Ocean at dusk", previewUrl: "https://images.pexels.com/photos/42/preview.jpeg", importUrl: "https://images.pexels.com/photos/42/large.jpeg", sourceUrl: "https://www.pexels.com/photo/42", creator: "Ari", creatorUrl: "https://www.pexels.com/@ari", attribution: "Photo by Ari on Pexels" });
});

test("only approved HTTPS image CDNs can be imported", () => {
  assert.equal(allowedExternalImageUrl("pexels", "https://images.pexels.com/photos/1/a.jpg")?.hostname, "images.pexels.com");
  assert.equal(allowedExternalImageUrl("pexels", "https://example.com/a.jpg"), null);
  assert.equal(allowedExternalImageUrl("pexels", "http://images.pexels.com/photos/1/a.jpg"), null);
});

test("creates stable provider filenames from validated image types", () => {
  assert.equal(safeExternalImageName("pexels", "photo/42", "image/webp"), "pexels-photo-42.webp");
  assert.equal(safeExternalImageName("pexels", "pexels-123", "image/jpeg"), "pexels-123.jpg");
});
