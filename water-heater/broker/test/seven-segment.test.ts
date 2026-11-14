import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readSevenSegmentImage } from "../src/camera/seven-segment.js";

const SEGMENTS: Record<string, number[]> = { a: [18, 8, 65, 14], b: [86, 25, 14, 67],
  c: [86, 110, 14, 67], d: [18, 180, 65, 14], e: [0, 110, 14, 67],
  f: [0, 25, 14, 67], g: [18, 94, 65, 14] };
const DIGITS = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgecd", "abc", "abcdefg", "abfgcd"];

async function display(value: number, dimSegment = "", missingSegment = ""): Promise<Buffer> {
  let shapes = "";
  for (const [index, digit] of String(value).padStart(2, "0").split("").entries()) {
    for (const segment of DIGITS[Number(digit)]!) {
      if (segment === missingSegment) continue;
      const [x, y, width, height] = SEGMENTS[segment]!;
      const color = segment === dimSegment ? "#805755" : "#ffaeab";
      shapes += `<rect x="${25 + index * 125 + x!}" y="${25 + y!}" width="${width}" height="${height}" rx="5" fill="${color}"/>`;
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

test("complete 44 and 45 remain readable when a segment is dimmer", async () => {
  for (const value of [44, 45])
    assert.equal((await readSevenSegmentImage(await display(value, "c"))).value, value);
});

test("incomplete fours are rejected instead of inferred from previous readings", async () => {
  for (const segment of ["c", "g"])
    assert.equal((await readSevenSegmentImage(await display(44, "", segment))).value, null);
});


test("camera module reads the vertical mounted display without a crop", async () => {
  const { CameraModule } = await import("../src/camera/module.js");
  const keys = ["CAMERA_URL", "CAMERA_ROTATION", "CAMERA_CROP", "CAMERA_SEVEN_SEGMENT"];
  const previous = keys.map(key => process.env[key]);
  const previousFetch = globalThis.fetch;
  process.env.CAMERA_URL = "http://camera.test";
  process.env.CAMERA_ROTATION = "90";
  process.env.CAMERA_SEVEN_SEGMENT = "true";
  delete process.env.CAMERA_CROP;
  const image = await sharp(await display(38)).rotate(270).jpeg().toBuffer();
  globalThis.fetch = async () => new Response(image, { headers: { "content-type": "image/jpeg" } });
  const messages: string[] = [];
  const mqtt = { connected: true, publish(_topic: string, value: string, _options: unknown, callback?: () => void) {
    messages.push(value); callback?.();
  } };
  const module = new CameraModule(mqtt as unknown as import("mqtt").MqttClient);
  try {
    assert.equal(await module.readDisplayTemperature(), true);
    assert.equal(module.getState().value, 38);
    assert.equal(module.getState().confidence, null);
    assert.equal(messages.at(-1), "38");
    process.env.CAMERA_ROTATION = "45";
    assert.equal(await module.readDisplayTemperature(), false);
    assert.equal(messages.at(-1), "unavailable");
  } finally {
    await module.close();
    globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});
