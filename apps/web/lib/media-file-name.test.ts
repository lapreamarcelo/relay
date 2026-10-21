import assert from "node:assert/strict";
import test from "node:test";
import { mediaDisplayFileName, mediaRenamedStorageFileName, mediaStorageFileName, mediaUploadFileName } from "./media-file-name.ts";

test("preserves spaces, Unicode, punctuation, extension, and long valid filenames", () => {
  for (const name of ["Summer launch (final).MP4", "Canción café — versión 2 🎵.mp3", "新しい写真 #1 & 50%.png", "Cafe\u0301  final.mov", `${"a".repeat(200)}.jpg`, ".cover.png"]) {
    assert.equal(mediaUploadFileName(name), name);
    assert.equal(mediaDisplayFileName(`media-owners/A/media/${mediaStorageFileName(name)}`), name);
  }
});

test("discards paths and controls, and rejects invalid names without truncating", () => {
  assert.equal(mediaUploadFileName("C:\\fakepath\\Summer launch.mp4"), "Summer launch.mp4");
  assert.equal(mediaUploadFileName("../photos/Café.jpg"), "Café.jpg");
  assert.equal(mediaUploadFileName("photo\u0000\r\n.jpg"), "photo.jpg");
  for (const name of ["", " ", ".", "..", `${"é".repeat(257)}.png`]) assert.equal(mediaUploadFileName(name), "");
});

test("duplicate names stay unique and a filename's own UUID remains intact", () => {
  const name = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa-original.mp4";
  assert.notEqual(mediaStorageFileName(name), mediaStorageFileName(name));
  assert.equal(mediaDisplayFileName(mediaStorageFileName(name)), name);
  assert.equal(mediaDisplayFileName(mediaRenamedStorageFileName(name)), name);
  assert.equal(mediaDisplayFileName(mediaRenamedStorageFileName(".project.json")), ".project.json");
});

test("existing upload keys hide their generated prefix without rewriting their URLs", () => {
  assert.equal(mediaDisplayFileName("media/file.png"), "file.png");
  assert.equal(mediaDisplayFileName("music/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa-old-song.mp3"), "old-song.mp3");
});
