import sharp from "sharp";

export async function measureDisplayBrightness(image: Buffer, region?: string): Promise<number | null> {
  if (!region) return null;
  const parts = region.split(",");
  const values = parts.map(Number);
  if (parts.length !== 4 || parts.some(part => !part.trim()) ||
      values.some(value => !Number.isInteger(value)) || values[0]! < 0 || values[1]! < 0 ||
      values[2]! <= 0 || values[3]! <= 0)
    throw new Error("CAMERA_DISPLAY_REGION must be left,top,width,height in image pixels");
  const { data, info } = await sharp(image, { limitInputPixels: 4_000_000 })
    .extract({ left: values[0]!, top: values[1]!, width: values[2]!, height: values[3]! })
    .removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += info.channels) {
    const brightness = Math.round(.6 * data[i]! + .4 * data[i + 1]!);
    histogram[brightness] = histogram[brightness]! + 1;
  }
  const target = Math.ceil(info.width * info.height * .9);
  let count = 0;
  for (let brightness = 0; brightness < histogram.length; brightness++) {
    count += histogram[brightness]!;
    if (count >= target) return brightness;
  }
  return null;
}

export function classifyDisplayLight(brightness: number | null, env: NodeJS.ProcessEnv = process.env): "dark" | "lit" | "unknown" {
  const dark = Number(env.CAMERA_DISPLAY_DARK_MAX);
  const lit = Number(env.CAMERA_DISPLAY_LIT_MIN);
  if (brightness === null || !Number.isFinite(brightness) || brightness < 0 || brightness > 255 ||
      !env.CAMERA_DISPLAY_DARK_MAX?.trim() || !env.CAMERA_DISPLAY_LIT_MIN?.trim() ||
      !Number.isFinite(dark) || !Number.isFinite(lit) || dark < 0 || lit > 255 || dark >= lit)
    return "unknown";
  return brightness <= dark ? "dark" : brightness >= lit ? "lit" : "unknown";
}
