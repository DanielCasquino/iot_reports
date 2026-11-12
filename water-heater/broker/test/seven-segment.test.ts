import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readSevenSegmentImage } from "../src/camera/seven-segment.js";

const SEGMENTS: Record<string, number[]> = { a: [18, 8, 65, 14], b: [86, 25, 14, 67],
  c: [86, 110, 14, 67], d: [18, 180, 65, 14], e: [0, 110, 14, 67],
  f: [0, 25, 14, 67], g: [18, 94, 65, 14] };
const DIGITS = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgecd", "abc", "abcdefg", "abfgcd"];

async function display(value: number): Promise<Buffer> {
  let shapes = "";
  for (const [index, digit] of String(value).padStart(2, "0").split("").entries()) {
    for (const segment of DIGITS[Number(digit)]!) {
      const [x, y, width, height] = SEGMENTS[segment]!;
      shapes += `<rect x="${25 + index * 125 + x!}" y="${25 + y!}" width="${width}" height="${height}" rx="5" fill="#ffaeab"/>`;
    }
  }
  return sharp(Buffer.from(`<svg width="300" height="245" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="245" fill="#18242b"/>${shapes}</svg>`)).png().toBuffer();
}

test("seven-segment reader distinguishes complete digit patterns, including 19 and 99", async () => {
  for (const value of [0, 19, 25, 30, 34, 37, 40, 42, 44, 48, 60, 72, 75, 80, 99])
    assert.equal((await readSevenSegmentImage(await display(value))).value, value, `reading ${value}`);
});

test("blank and featureless images do not become temperatures", async () => {
  for (const background of ["black", "white", "#806020"]) {
    const image = await sharp({ create: { width: 300, height: 245, channels: 3, background } }).png().toBuffer();
    assert.equal((await readSevenSegmentImage(image)).value, null);
  }
});
