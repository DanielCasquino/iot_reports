import sharp from "sharp";

type Crop = { left: number; top: number; width: number; height: number };

export function parseCrop(raw: string, name: string): Crop {
  const parts = raw.split(",");
  if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part.trim()))) {
    throw new Error(`${name} must be left,top,width,height in original image pixels`);
  }
  const [left, top, width, height] = parts.map(Number);
  if (![left, top, width, height].every(Number.isSafeInteger) ||
      width! <= 0 || height! <= 0 || width! > 4000000 || height! > 4000000) {
    throw new Error(`${name} has invalid dimensions`);
  }
  return { left: left!, top: top!, width: width!, height: height! };
}

export async function selectOcrCrop(image: Buffer, primaryRaw: string, guardRaw: string, useFullGuard = false): Promise<Crop> {
  const primary = parseCrop(primaryRaw, "CAMERA_CROP");
  const guard = parseCrop(guardRaw, "CAMERA_OCR_GUARD_CROP");
  const metadata = await sharp(image, { limitInputPixels: 4_000_000 }).metadata();
  const imageWidth = metadata.width ?? 0, imageHeight = metadata.height ?? 0;
  if (guard.top !== primary.top || guard.height !== primary.height ||
      guard.left > primary.left || guard.left + guard.width < primary.left + primary.width ||
      guard.left + guard.width > imageWidth || guard.top + guard.height > imageHeight) {
    throw new Error("CAMERA_OCR_GUARD_CROP must fit the image and horizontally contain CAMERA_CROP at the same top and height");
  }
  if (useFullGuard) return guard;
  const seams: number[] = [];
  if (guard.left < primary.left && primary.left >= 2) seams.push(primary.left);
  const right = primary.left + primary.width;
  if (guard.left + guard.width > right && right + 2 <= imageWidth) seams.push(right);
  for (const seam of seams) {
    const { data, info } = await sharp(image, { limitInputPixels: 4_000_000 })
      .extract({ left: seam - 2, top: primary.top, width: 4, height: primary.height })
      .greyscale().raw().toBuffer({ resolveWithObject: true });
    let consecutive = 0;
    for (let row = 0; row < info.height; row++) {
      const offset = row * 4;
      const crossing = [0, 1, 2, 3].every(col => data[offset + col]! >= 180);
      consecutive = crossing ? consecutive + 1 : 0;
      if (consecutive >= 3) return guard;
    }
  }
  return primary;
}
