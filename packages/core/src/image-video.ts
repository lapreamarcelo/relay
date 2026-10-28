/** Timing shared by the composer, validation and background image conversion. */
export function imageVideoSeconds(count: number, seconds?: number): number {
  if (!Number.isInteger(count) || count < 1 || count > 35) throw new Error("A YouTube slideshow needs between 1 and 35 images.");
  const single = count === 1;
  const value = seconds ?? (single ? 8 : 4);
  const minimum = single ? 5 : 3;
  const maximum = single ? 10 : 5;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(single ? "Choose 5–10 seconds for a single YouTube image." : "Choose 3–5 seconds per image for a YouTube slideshow.");
  }
  return value;
}
