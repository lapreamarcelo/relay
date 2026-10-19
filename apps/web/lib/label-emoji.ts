import { inflateSync, strFromU8 } from "fflate";
import { labelEmojiChunks, labelEmojiIds } from "./label-emoji-data.ts";

export interface LabelEmoji { id: string; svg: string }
const artwork: Record<string, string> = {};
const pending = new Map<number, Promise<void>>();
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function emojiId(grapheme: string): string | undefined {
  if (grapheme.includes("\uFE0E") || !/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u20E3]/u.test(grapheme)) return;
  const id = Array.from(grapheme).filter(character => character !== "\uFE0F").map(character => character.codePointAt(0)!.toString(16)).join("-");
  return labelEmojiIds.has(id) ? id : undefined;
}

/** Load only the small artwork chunks used by this text, before rasterization. */
export async function preloadLabelEmoji(text: string): Promise<void> {
  const buckets = new Set<number>();
  for (const { segment } of segmenter.segment(text)) {
    const id = emojiId(segment);
    if (id && !artwork[id]) buckets.add(Array.from(id).reduce((sum, character) => sum + character.charCodeAt(0), 0) % labelEmojiChunks.length);
  }
  await Promise.all(Array.from(buckets, bucket => {
    let task = pending.get(bucket);
    if (!task) {
      task = labelEmojiChunks[bucket]().then(module => {
        Object.assign(artwork, JSON.parse(strFromU8(inflateSync(Uint8Array.from(atob(module.default), character => character.charCodeAt(0))))));
      }).catch(error => { pending.delete(bucket); throw error; });
      pending.set(bucket, task);
    }
    return task;
  }));
}

/** One local, color glyph per Unicode grapheme, shared by browser and export.
 * Reserve one square while its local artwork chunk loads. No font/CDN fetch.
 */
export function labelEmoji(grapheme: string): LabelEmoji | undefined {
  const id = emojiId(grapheme);
  return id ? { id, svg: artwork[id] ?? "" } : undefined;
}
