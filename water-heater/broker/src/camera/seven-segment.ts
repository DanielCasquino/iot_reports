import sharp from "sharp";

const DIGIT_PATTERNS = ["1111110", "0110000", "1101101", "1111001", "0110011",
  "1011011", "1011111", "1110000", "1111111", "1111011"];
const SEGMENT_REGIONS = [[.3, 0, .7, .15], [.7, .18, 1, .4], [.7, .6, 1, .82],
  [.3, .85, .7, 1], [0, .6, .3, .82], [0, .18, .3, .4], [.3, .42, .7, .58]];

function decodeDigits(mask: Uint8Array, width: number, height: number): number | null {
  const columns: number[] = [];
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) count += mask[y * width + x]!;
    columns.push(count);
  }
  const ranges: [number, number][] = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    const occupied = x < width && columns[x]! > height * .025;
    if (occupied && start < 0) start = x;
    if (!occupied && start >= 0) {
      if (x - start > height * .04) ranges.push([start, x - 1]);
      start = -1;
    }
  }
  const digitRanges: [number, number][] = [];
  for (const [left, right] of ranges) {
    const previous = digitRanges.at(-1);
    if (ranges.length > 2 && previous && left - previous[1] <= height * .025) previous[1] = right;
    else digitRanges.push([left, right]);
  }
  const digits: number[] = [];
  for (const [left, right] of digitRanges) {
    let top = height, bottom = 0;
    for (let x = left; x <= right; x++)
      for (let y = 0; y < height; y++)
        if (mask[y * width + x]) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    const digitWidth = right - left + 1, digitHeight = bottom - top + 1;
    if (digitHeight < height * .3) continue;
    if (digitWidth / digitHeight < .32) { digits.push(1); continue; }
    const pattern = SEGMENT_REGIONS.map(([x1, y1, x2, y2]) => {
      let active = 0, total = 0;
      for (let y = Math.floor(top + y1! * (digitHeight - 1)); y <= Math.floor(top + y2! * (digitHeight - 1)); y++)
        for (let x = Math.floor(left + x1! * (digitWidth - 1)); x <= Math.floor(left + x2! * (digitWidth - 1)); x++) {
          active += mask[y * width + x]!;
          total++;
        }
      return active / total > .3 ? "1" : "0";
    }).join("");
    const digit = DIGIT_PATTERNS.indexOf(pattern);
    if (digit < 0) return null;
    digits.push(digit);
  }
  return digits.length === 2 ? Number(digits.join("")) : null;
}

export async function readSevenSegmentImage(image: Buffer): Promise<{ value: number | null; image: Buffer }> {
  const { data, info } = await sharp(image).resize({ width: 600 }).removeAlpha().toColourspace("srgb")
    .raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let peak = 0;
  for (let i = 0; i < data.length; i += channels)
    peak = Math.max(peak, .6 * data[i]! + .4 * data[i + 1]!);
  const readings: (number | null)[] = [];
  let preview = new Uint8Array(width * height);
  for (const threshold of [.6, .65, .7]) {
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) {
      const red = data[i * channels]!, green = data[i * channels + 1]!;
      mask[i] = .6 * red + .4 * green > peak * threshold && red > green * .85 ? 1 : 0;
    }
    readings.push(decodeDigits(mask, width, height));
    if (threshold === .7) preview = mask;
  }
  const valid = readings.filter((value): value is number => value !== null);
  const value = valid.length >= 2 && valid.every(value => value === valid[0]) ? valid[0]! : null;
  const pixels = Buffer.from(preview.map(pixel => pixel ? 0 : 255));
  const processed = await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
  return { value, image: processed };
}
