import type { LabelFont } from "@relay/core";
import { bundledLabelFonts } from "./label-font-data.ts";

type Point = { x: number; y: number; on: boolean };
type Table = { offset: number; length: number };
type Face = { view: DataView; tables: Record<string, Table>; units: number; metrics: number; longLoca: boolean; cmap: number; cmapFormat: number; kern: Map<number, number>; outlines: Map<number, string> };
const faces = new Map<string, Face>();
const measurements = new Map<string, MeasuredText>();
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
const outlineContours = new WeakMap<Face, Map<number, Point[][]>>();
const n = (value: number) => Math.round(value * 1000) / 1000;

/** A small, synchronous reader for the bundled TrueType fonts; no browser canvas or system fonts. */
function faceFor(font: LabelFont = "modern", weight = 800): Face {
  const key = `${font}-${weight < 600 ? 400 : 800}` as keyof typeof bundledLabelFonts;
  const cached = faces.get(key); if (cached) return cached;
  const bytes = Uint8Array.from(atob(bundledLabelFonts[key]), character => character.charCodeAt(0));
  const view = new DataView(bytes.buffer), tables: Record<string, Table> = {};
  for (let i = 0; i < view.getUint16(4); i++) {
    const offset = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.slice(offset, offset + 4));
    tables[tag] = { offset: view.getUint32(offset + 8), length: view.getUint32(offset + 12) };
  }
  const cmapTable = tables.cmap.offset;
  let cmap = 0, cmapFormat = 0;
  for (let i = 0; i < view.getUint16(cmapTable + 2); i++) {
    const record = cmapTable + 4 + i * 8, candidate = cmapTable + view.getUint32(record + 4), format = view.getUint16(candidate);
    if (format === 12 || format === 4 && cmapFormat !== 12) { cmap = candidate; cmapFormat = format; }
  }
  const kern = new Map<number, number>();
  if (tables.kern) {
    let offset = tables.kern.offset + 4;
    for (let table = 0; table < view.getUint16(tables.kern.offset + 2); table++) {
      const length = view.getUint16(offset + 2), coverage = view.getUint16(offset + 4);
      if (coverage >> 8 === 0 && coverage & 1) {
        const count = view.getUint16(offset + 6);
        for (let i = 0; i < count; i++) { const pair = offset + 14 + i * 6; kern.set(view.getUint16(pair) * 65536 + view.getUint16(pair + 2), view.getInt16(pair + 4)); }
      }
      offset += length;
    }
  }
  const face: Face = { view, tables, units: view.getUint16(tables.head.offset + 18), longLoca: view.getInt16(tables.head.offset + 50) !== 0, metrics: view.getUint16(tables.hhea.offset + 34), cmap, cmapFormat, kern, outlines: new Map() };
  faces.set(key, face); outlineContours.set(face, new Map()); return face;
}
function glyphId(face: Face, code: number): number {
  const v = face.view, start = face.cmap;
  if (face.cmapFormat === 12) {
    let low = 0, high = v.getUint32(start + 12) - 1;
    while (low <= high) { const middle = (low + high) >>> 1, p = start + 16 + middle * 12, first = v.getUint32(p), last = v.getUint32(p + 4); if (code < first) high = middle - 1; else if (code > last) low = middle + 1; else return v.getUint32(p + 8) + code - first; }
    return 0;
  }
  if (code > 65535) return 0;
  const count = v.getUint16(start + 6) / 2, ends = start + 14, starts = ends + count * 2 + 2, deltas = starts + count * 2, ranges = deltas + count * 2;
  for (let i = 0; i < count; i++) if (code <= v.getUint16(ends + i * 2)) {
    if (code < v.getUint16(starts + i * 2)) return 0;
    const delta = v.getInt16(deltas + i * 2), range = v.getUint16(ranges + i * 2);
    if (!range) return (code + delta) & 65535;
    const id = v.getUint16(ranges + i * 2 + range + (code - v.getUint16(starts + i * 2)) * 2);
    return id ? (id + delta) & 65535 : 0;
  }
  return 0;
}
function advance(face: Face, glyph: number) { return face.view.getUint16(face.tables.hmtx.offset + Math.min(glyph, face.metrics - 1) * 4); }
function contours(face: Face, glyph: number, depth = 0): Point[][] {
  const cache = outlineContours.get(face)!; const cached = cache.get(glyph); if (cached) return cached;
  if (depth > 12) return [];
  const v = face.view, location = face.tables.loca.offset + glyph * (face.longLoca ? 4 : 2);
  const offset = face.longLoca ? v.getUint32(location) : v.getUint16(location) * 2;
  const end = face.longLoca ? v.getUint32(location + 4) : v.getUint16(location + 2) * 2;
  if (offset === end) return [];
  let p = face.tables.glyf.offset + offset;
  const count = v.getInt16(p); p += 10;
  let result: Point[][] = [];
  if (count >= 0) {
    const ends = Array.from({ length: count }, (_, i) => v.getUint16(p + i * 2)); p += count * 2;
    const instructions = v.getUint16(p); p += 2 + instructions;
    const size = count ? ends[count - 1] + 1 : 0, flags: number[] = [];
    while (flags.length < size) { const flag = v.getUint8(p++); flags.push(flag); if (flag & 8) { const repeat = v.getUint8(p++); for (let i = 0; i < repeat; i++) flags.push(flag); } }
    const points: Point[] = flags.map(flag => ({ x: 0, y: 0, on: Boolean(flag & 1) }));
    for (const [coordinate, short, same] of [["x", 2, 16], ["y", 4, 32]] as const) {
      let value = 0;
      flags.forEach((flag, i) => { let delta = 0; if (flag & short) { delta = v.getUint8(p++); if (!(flag & same)) delta = -delta; } else if (!(flag & same)) { delta = v.getInt16(p); p += 2; } value += delta; points[i][coordinate] = value; });
    }
    let first = 0; result = ends.map(last => { const contour = points.slice(first, last + 1); first = last + 1; return contour; });
  } else {
    let flags: number;
    do {
      flags = v.getUint16(p); const child = v.getUint16(p + 2); p += 4;
      const words = Boolean(flags & 1), xy = Boolean(flags & 2);
      const a = words ? (xy ? v.getInt16(p) : v.getUint16(p)) : (xy ? v.getInt8(p) : v.getUint8(p)); p += words ? 2 : 1;
      const b = words ? (xy ? v.getInt16(p) : v.getUint16(p)) : (xy ? v.getInt8(p) : v.getUint8(p)); p += words ? 2 : 1;
      let xx = 1, yy = 1, xyScale = 0, yx = 0;
      const scalar = () => { const value = v.getInt16(p) / 16384; p += 2; return value; };
      if (flags & 8) xx = yy = scalar(); else if (flags & 64) { xx = scalar(); yy = scalar(); } else if (flags & 128) { xx = scalar(); xyScale = scalar(); yx = scalar(); yy = scalar(); }
      const childContours = contours(face, child, depth + 1).map(contour => contour.map(point => ({ x: point.x * xx + point.y * xyScale, y: point.x * yx + point.y * yy, on: point.on })));
      let dx = xy ? a : 0, dy = xy ? b : 0;
      if (!xy) { const parentPoint = result.flat()[a], childPoint = childContours.flat()[b]; if (parentPoint && childPoint) { dx = parentPoint.x - childPoint.x; dy = parentPoint.y - childPoint.y; } }
      result.push(...childContours.map(contour => contour.map(point => ({ ...point, x: point.x + dx, y: point.y + dy }))));
    } while (flags & 32);
  }
  cache.set(glyph, result); return result;
}
function outline(face: Face, glyph: number): string {
  const cached = face.outlines.get(glyph); if (cached !== undefined) return cached;
  const path = contours(face, glyph).map(contour => {
    if (!contour.length) return "";
    const first = contour[0], last = contour.at(-1)!;
    const start = first.on ? first : last.on ? last : { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, on: true };
    const points = first.on ? contour.slice(1) : last.on ? contour.slice(0, -1) : contour;
    let d = `M${n(start.x)} ${n(-start.y)}`;
    for (let i = 0; i < points.length; i++) {
      const point = points[i]; if (point.on) d += `L${n(point.x)} ${n(-point.y)}`;
      else { const next = points[i + 1] ?? start; const end = next.on ? next : { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }; d += `Q${n(point.x)} ${n(-point.y)} ${n(end.x)} ${n(-end.y)}`; if (next.on) i++; }
    }
    return d + "Z";
  }).join("");
  face.outlines.set(glyph, path); return path;
}
export interface FontSettings { font?: LabelFont; fontWeight?: 400 | 700 | 800; letterSpacing?: number; italic?: boolean; kerning?: boolean }
export interface MeasuredGlyph { glyph: number; code: number; x: number; advance: number; path: string }
export interface MeasuredText { width: number; units: number; glyphs: MeasuredGlyph[]; unsupported: boolean }
export function measureLabelText(text: string, fontSize: number, settings: FontSettings = {}): MeasuredText {
  const normalized = text.normalize("NFC"), key = JSON.stringify([settings.font ?? "modern", settings.fontWeight ?? 800, fontSize, settings.letterSpacing ?? 0, settings.kerning !== false, normalized]);
  const cached = measurements.get(key); if (cached) return cached;
  const face = faceFor(settings.font, settings.fontWeight), scale = fontSize / face.units, tracking = settings.letterSpacing ?? 0;
  const glyphs: MeasuredGlyph[] = []; let width = 0, previous = -1, unsupported = false;
  // NFC keeps common combining sequences together and renders them as their native composed glyph.
  const characters = Array.from(normalized);
  characters.forEach((character, index) => {
    const code = character.codePointAt(0)!, glyph = glyphId(face, code);
    if (!glyph && !/\p{Default_Ignorable_Code_Point}/u.test(character)) unsupported = true;
    if (/\p{Default_Ignorable_Code_Point}/u.test(character)) return;
    if (previous >= 0 && settings.kerning !== false) width += (face.kern.get(previous * 65536 + glyph) ?? 0) * scale;
    const step = advance(face, glyph) * scale;
    glyphs.push({ glyph, code, x: width, advance: step, path: outline(face, glyph) });
    width += step + (index === characters.length - 1 ? 0 : tracking); previous = glyph;
  });
  const result = { width, units: face.units, glyphs, unsupported };
  if (measurements.size >= 4096) measurements.delete(measurements.keys().next().value!);
  measurements.set(key, result); return result;
}
export function labelGraphemes(text: string): string[] { return Array.from(graphemeSegmenter.segment(text), part => part.segment); }
export function labelWords(text: string): string[] {
  // Word segmentation handles scripts without spaces while retaining every punctuation/space glyph.
  const segments = Array.from(wordSegmenter.segment(text), part => ({ text: part.segment, word: part.isWordLike }));
  const words: string[] = [];
  for (const segment of segments) if (!segment.word && words.length) words[words.length - 1] += segment.text; else words.push(segment.text);
  return words;
}
