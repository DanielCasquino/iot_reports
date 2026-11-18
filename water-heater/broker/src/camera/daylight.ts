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

export class DaylightCalibration {
  private reference?: ReturnType<typeof thumbnail>;
  private candidate: number | null = null;
  private candidateAt = 0;

  constructor(private readonly path: string) {}

  async inspect(image: Buffer, guardLeft: number) {
    this.reference ??= thumbnail(this.path);
    const [ref, current] = await Promise.all([this.reference, thumbnail(image)]);
    const columns = current.width ? Math.floor(guardLeft * WIDTH / current.width) - 1 : 0;
    if (columns < 1 || columns >= WIDTH || ref.width !== current.width || ref.height !== current.height)
      throw new Error("Daylight calibration requires the same camera size and housing visible left of the guard crop");
    const ambient = ambientLevel(current.pixels, columns);
    const baseline = ambientLevel(ref.pixels, columns);
    if (baseline < 100) throw new Error("Daylight off reference must show the housing in daylight");
    if (ambient < Math.max(95, baseline * .55)) return "night";
    const exposure = ambient / baseline;
    if (exposure < .8 || exposure > 1.25) return "day";
    let different = 0;
    for (let i = 0; i < current.pixels.length; i += 3) {
      let error = 0;
      for (let c = 0; c < 3; c++)
        error = Math.max(error, Math.abs(current.pixels[i + c]! - Math.min(255, ref.pixels[i + c]! * exposure)));
      if (error > 38) return "day";
      if (error > 20) different++;
      if (different > WIDTH * HEIGHT * .1) return "day";
    }
    return "off-reference";
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
