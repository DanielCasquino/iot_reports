import sharp from "sharp";

// Sample the housing to the left of the guard crop, outside the digits.
// Keep the private, physically confirmed off reference at thumbnail resolution.
const WIDTH = 24, HEIGHT = 18;
async function thumbnail(image: string | Buffer) {
  const input = sharp(image, { limitInputPixels: 4_000_000 });
  const { width, height } = await input.metadata();
  const pixels = await input.resize(WIDTH, HEIGHT, { fit: "fill" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
  return { pixels, width, height };
}

function ambientLevel(pixels: Buffer, columns: number) {
  const samples: number[] = [];
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < columns; x++) samples.push(pixels[(y * WIDTH + x) * 3 + 1]!);
  return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
}

type Thumbnail = Awaited<ReturnType<typeof thumbnail>>;

async function loadReferences(setting: string): Promise<Thumbnail[]> {
  const paths: unknown = setting.trimStart().startsWith("[") ? JSON.parse(setting) : [setting];
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 4 ||
      paths.some(path => typeof path !== "string" || !path.trim()))
    throw new Error("Provide one daylight off image or a JSON array of one to four image paths");
  return Promise.all(paths.map(path => thumbnail(path)));
}

function matchesOff(current: Thumbnail, ref: Thumbnail, firstDisplayColumn: number, exposure: number) {
  if (exposure < .8 || exposure > 1.25) return false;
  let different = 0, outliers = 0, warmCells = 0;
  for (let i = 0; i < current.pixels.length; i += 3) {
    let error = 0;
    for (let c = 0; c < 3; c++)
      error = Math.max(error, Math.abs(current.pixels[i + c]! - Math.min(255, ref.pixels[i + c]! * exposure)));
    // A small white highlight can move on the glass even when the display is off.
    // A new warm patch on the display is stronger evidence of a lit segment.
    const column = (i / 3) % WIDTH;
    const warmth = current.pixels[i]! - current.pixels[i + 2]!;
    const referenceWarmth = exposure * (ref.pixels[i]! - ref.pixels[i + 2]!);
    if (column >= firstDisplayColumn && warmth > 16 && warmth - referenceWarmth > 12) warmCells++;
    if (error > 38) outliers++;
    if (error > 20) different++;
    if (different > WIDTH * HEIGHT * .1 || outliers > WIDTH * HEIGHT * .02 || warmCells >= 3) return false;
  }
  return true;
}

export class DaylightCalibration {
  private references?: Promise<Thumbnail[]>;
  private candidate: number | null = null;
  private candidateAt = 0;

  constructor(private readonly path: string) {}

  async inspect(image: Buffer, guardLeft: number) {
    this.references ??= loadReferences(this.path);
    const [refs, current] = await Promise.all([this.references, thumbnail(image)]);
    const firstDisplayColumn = current.width ? Math.floor(guardLeft * WIDTH / current.width) : 0;
    const columns = firstDisplayColumn - 1;
    if (columns < 1 || columns >= WIDTH || refs.some(ref => ref.width !== current.width || ref.height !== current.height))
      throw new Error("Daylight calibration requires the same camera size and housing visible left of the guard crop");
    const ambient = ambientLevel(current.pixels, columns);
    const baselines = refs.map(ref => ambientLevel(ref.pixels, columns));
    if (baselines.some(baseline => baseline < 100)) throw new Error("Daylight off reference must show the housing in daylight");
    // The original calibration owns the switch to the proven low-light reader.
    if (ambient < Math.max(95, baselines[0]! * .55)) return "night";
    return refs.some((ref, i) => matchesOff(current, ref, firstDisplayColumn, ambient / baselines[i]!))
      ? "off-reference" : "day";
  }

  confirm(value: number | null, at: number) {
    const confirmed = value !== null && value === this.candidate && at > this.candidateAt && at - this.candidateAt <= 2000;
    this.candidate = value;
    this.candidateAt = at;
    return confirmed ? value : null;
  }
}

// Amber LEDs have excess red over blue. Normalize each horizontal band to
// nearby bands so a white reflection across the bottom cannot erase one digit.
export async function enhanceAmberSegments(image: Buffer): Promise<Buffer | null> {
  const { data, info } = await sharp(image, { limitInputPixels: 4_000_000 })
    .removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const peaks = new Uint8Array(height);
  const histogram = new Uint32Array(256);
  let warm = 0;
  for (let y = 0; y < height; y++) {
    histogram.fill(0);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const excess = Math.max(0, data[i]! - data[i + 2]!);
      histogram[excess] = histogram[excess]! + 1;
      if (excess > 25 && data[i]! > 85) warm++;
    }
    let count = 0;
    for (let v = 0; v < 256; v++) {
      count += histogram[v]!;
      if (count > Math.floor(width * .95)) { peaks[y] = v; break; }
    }
  }
  if (warm < width * height * .015) return null;
  for (let y = 0; y < height; y++) {
    const band = peaks.slice(Math.max(0, y - 5), Math.min(height, y + 6)).sort();
    const gain = 255 / (Math.max(20, band[Math.floor(band.length / 2)]!) - 4);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const value = Math.round(Math.max(0, Math.min(255, (data[i]! - data[i + 2]! - 4) * gain)));
      data[i] = data[i + 1] = value;
      data[i + 2] = Math.floor(value * .7);
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
